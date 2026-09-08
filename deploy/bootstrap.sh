#!/usr/bin/env bash
# One-time (and idempotent) setup of the hosting stack. Safe to re-run: it updates the
# stack in place, and re-running with --set-password (or DASHBOARD_PASSWORD set) rotates
# the gate.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
TEMPLATE="$HERE/infrastructure.yaml"
ENV_FILE="$ROOT/.env.deploy"

die() { echo "error: $*" >&2; exit 1; }

STACK_NAME="${STACK_NAME:-panther-build-dashboard}"
AWS_REGION="${AWS_REGION:-us-east-1}"
PASSWORD="${DASHBOARD_PASSWORD:-}"
CHECK_ONLY=0
SET_PASSWORD=0

# A typo'd flag (--chekc, -check, --check=1) must not silently fall through to the live
# path - that path creates a CloudFront distribution. Reject anything unrecognized. --check
# and --set-password are the one deliberate pair allowed together (in either order): that
# combination prompts for the password, then takes the --check exit - the only way to
# preview a rotation without ever sending the real credential to CloudFormation. Anything
# else - a duplicate flag, a third argument, an unrecognized one - is rejected.
for arg in "$@"; do
    case "$arg" in
        --check)
            [[ $CHECK_ONLY -eq 0 ]] \
                || die "unrecognized or extra argument: '$arg' (each flag may be given at most once)"
            CHECK_ONLY=1
            ;;
        --set-password)
            [[ $SET_PASSWORD -eq 0 ]] \
                || die "unrecognized or extra argument: '$arg' (each flag may be given at most once)"
            SET_PASSWORD=1
            ;;
        *)
            die "unrecognized or extra argument: '$arg' (bootstrap.sh accepts --check and/or --set-password, each at most once)"
            ;;
    esac
done

if [[ $SET_PASSWORD -eq 1 ]]; then
    # DASHBOARD_PASSWORD in argv or env ends up in shell history (see README) - this mode
    # exists so a rotation never has to spell the password on a command line at all.
    [[ -z $PASSWORD ]] \
        || die "--set-password prompts for the password interactively; do not also set DASHBOARD_PASSWORD"
    # 'read' itself returns non-zero at EOF (closed stdin), which - unguarded - would abort
    # here under 'set -e' before the emptiness check below ever runs, with no message. Route
    # both failure shapes (closed stdin, and a successful read of a blank line) to the same
    # clear error.
    read -rsp 'New password: ' PASSWORD || die "no password entered"
    echo
    [[ -n $PASSWORD ]] || die "no password entered"
fi

command -v aws >/dev/null 2>&1 || die "the AWS CLI is not installed"
[[ -f $TEMPLATE ]] || die "$TEMPLATE not found"

# 2.1.17 is from January 2021. Every command used here long predates it and the template
# is interpreted server-side, so this is advice, not a requirement.
CLI_VERSION="$(aws --version 2>&1 | sed -n 's|^aws-cli/\([0-9.]*\).*|\1|p')"
CLI_MAJOR="${CLI_VERSION%%.*}"
CLI_MINOR="$(printf '%s' "$CLI_VERSION" | cut -d. -f2)"
if [[ ${CLI_MAJOR:-0} -lt 2 || ( ${CLI_MAJOR:-0} -eq 2 && ${CLI_MINOR:-0} -lt 13 ) ]]; then
    echo "note: AWS CLI $CLI_VERSION is old; an upgrade is recommended but not required."
fi

bash "$HERE/check-template.sh"

# Whether to send the credential at all. On an existing stack with no password given,
# omitting the parameter makes 'cloudformation deploy' reuse the stored value, so an
# infrastructure change does not require re-supplying the secret.
STACK_EXISTS=0
if [[ $CHECK_ONLY -eq 0 ]] \
    && aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$AWS_REGION" >/dev/null 2>&1; then
    STACK_EXISTS=1
fi

GENERATED=0
PARAM_ARGS=()
if [[ -n $PASSWORD || $STACK_EXISTS -eq 0 ]]; then
    if [[ -z $PASSWORD ]]; then
        # `head -c 24` closes the pipe as soon as it has its 24 bytes, which SIGPIPEs `tr`
        # reading from an endless /dev/urandom. Under `set -o pipefail` that becomes a
        # non-zero pipeline status and `set -e` aborts the script at exit 141 - silently,
        # since the trap is an assignment. It is a race, so it does not fail every time.
        # `|| true` absorbs the signal; the length assertion is what actually stops a
        # truncated read from quietly becoming a weak credential.
        PASSWORD="$(LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 24 || true)"
        [[ ${#PASSWORD} -eq 24 ]] \
            || die "could not generate a 24-character password (got ${#PASSWORD} characters)"
        GENERATED=1
    fi
    CREDENTIAL="$(printf '%s' "panther:${PASSWORD}" | base64 | tr -d '\n')"
    PARAM_ARGS=(--parameter-overrides "BasicAuthCredential=${CREDENTIAL}")
fi

if [[ $CHECK_ONLY -eq 1 ]]; then
    echo "would deploy stack '$STACK_NAME' to $AWS_REGION from $TEMPLATE"
    if [[ ${#PARAM_ARGS[@]} -gt 0 ]]; then
        if [[ $GENERATED -eq 1 ]]; then
            echo "  credential: ${CREDENTIAL}"
        else
            # A supplied password (DASHBOARD_PASSWORD) previews a rotation, not a new
            # stack. --check is documented as safe to run casually, so it must not be the
            # place that echoes a real secret back out.
            echo "  credential: (not shown - a supplied password is never printed, only an auto-generated one)"
        fi
    fi
    echo "  env file:   $ENV_FILE"
    echo
    # --check makes no AWS calls at all, which is what makes it runnable with no
    # credentials - but it therefore cannot know whether the stack already exists, and
    # must not imply that it does.
    echo "  Note: --check makes no AWS calls, so it has not checked whether the stack"
    echo "  exists. The credential above is what a NEW stack would be given. Against an"
    echo "  existing stack with no DASHBOARD_PASSWORD set, a real run sends no credential"
    echo "  at all and CloudFormation keeps the stored one."
    exit 0
fi

echo "Deploying stack '$STACK_NAME' to $AWS_REGION."
echo "A CloudFront distribution takes 5-15 minutes to create or update. This will wait."

# Note the bash 3.2 idiom: expanding an empty array under 'set -u' errors on macOS.
#
# The template's first real validation is this call - ValidateTemplate is denied in the
# target account (see README), so a bad template or an IAM gap surfaces only here, and
# under 'set -e' would otherwise die with nothing but whatever the CLI printed, which for
# a botched previous attempt is often just 'ROLLBACK_COMPLETE'. Wrap it so a failure also
# prints the stack events, which carry the actual reason.
if ! aws cloudformation deploy \
    --stack-name "$STACK_NAME" \
    --template-file "$TEMPLATE" \
    --region "$AWS_REGION" \
    --no-fail-on-empty-changeset \
    ${PARAM_ARGS[@]+"${PARAM_ARGS[@]}"}; then
    echo >&2
    echo "Deploy failed. Recent stack events (most likely cause is usually near the top):" >&2
    aws cloudformation describe-stack-events \
        --stack-name "$STACK_NAME" --region "$AWS_REGION" --max-items 20 >&2 \
        || echo "  (could not fetch stack events - see README's 'If bootstrap fails')" >&2
    echo >&2
    echo "See deploy/README.md's 'If bootstrap fails' for AccessDenied and ROLLBACK_COMPLETE." >&2
    exit 1
fi

stack_output() {
    aws cloudformation describe-stacks \
        --stack-name "$STACK_NAME" --region "$AWS_REGION" \
        --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}

# By this point the stack has been created (or updated) - the credential above, if
# generated, is already the live gate. A bare `X="$(stack_output ...)"` here is an
# unguarded top-level command substitution: under 'set -e' its failure aborts the script
# immediately on the CLI's raw exit code, before .env.deploy is written and before the
# password is ever printed - the one copy of a secret that already exists is lost with no
# message. This is the same failure mode the deploy-call wrapper above exists to prevent,
# so every path out of this block that doesn't reach 'Stack ready.' below must go through
# report_outputs_failure, which prints the password (if one was generated) before anything
# else.
report_outputs_failure() {
    echo >&2
    if [[ $GENERATED -eq 1 ]]; then
        echo "IMPORTANT: the stack already exists with this credential live - it was sent to" >&2
        echo "CloudFormation by the deploy above, and this is the only copy. Save it now:" >&2
        echo >&2
        echo "  Sign in with:  panther / $PASSWORD" >&2
        echo >&2
    fi
    echo "$1" >&2
    echo "$ENV_FILE was not written." >&2
    echo >&2
    echo "Fetch the outputs by hand:" >&2
    echo "  aws cloudformation describe-stacks --stack-name \"$STACK_NAME\" --region \"$AWS_REGION\"" >&2
    echo >&2
    echo "Re-running 'bash deploy/bootstrap.sh' is safe and will retry." >&2
    exit 1
}

OUTPUTS_OK=1
BUCKET="$(stack_output BucketName)"      || OUTPUTS_OK=0
DIST_ID="$(stack_output DistributionId)" || OUTPUTS_OK=0
SITE_URL="$(stack_output SiteUrl)"       || OUTPUTS_OK=0
[[ $OUTPUTS_OK -eq 1 ]] \
    || report_outputs_failure "Stack '$STACK_NAME' was created (or updated), but its outputs could not be read."

[[ -n $BUCKET && $BUCKET != None ]] \
    || report_outputs_failure "Stack '$STACK_NAME' produced no BucketName output."
[[ -n $DIST_ID && $DIST_ID != None ]] \
    || report_outputs_failure "Stack '$STACK_NAME' produced no DistributionId output."
[[ -n $SITE_URL && $SITE_URL != None ]] \
    || report_outputs_failure "Stack '$STACK_NAME' produced no SiteUrl output."

# This file is rewritten wholesale below, but a multi-account operator may have hand-added
# an AWS_PROFILE line (per .env.deploy.example) - that line is read only by deploy.sh, so
# bootstrap never needs it itself, but must not silently discard it on every re-run.
EXISTING_PROFILE_LINE=""
if [[ -f $ENV_FILE ]]; then
    EXISTING_PROFILE_LINE="$(grep -E '^AWS_PROFILE=' "$ENV_FILE" || true)"
fi

cat > "$ENV_FILE" <<ENVFILE
# Written by deploy/bootstrap.sh on $(date -u '+%Y-%m-%dT%H:%M:%SZ').
# Config only - the basic-auth password is not stored here or anywhere else.
STACK_NAME=$STACK_NAME
AWS_REGION=$AWS_REGION
BUCKET=$BUCKET
DIST_ID=$DIST_ID
SITE_URL=$SITE_URL
ENVFILE

if [[ -n $EXISTING_PROFILE_LINE ]]; then
    printf '%s\n' "$EXISTING_PROFILE_LINE" >> "$ENV_FILE"
fi

echo
echo "Stack ready."
echo "  URL:    $SITE_URL"
echo "  bucket: $BUCKET"
echo "  config: $ENV_FILE"
if [[ $GENERATED -eq 1 ]]; then
    echo
    echo "  Sign in with:  panther / $PASSWORD"
    echo
    echo "  This is the only time the password is shown. It is not written to $ENV_FILE"
    echo "  and NoEcho keeps it out of the stack output, so save it now. To rotate it:"
    echo "      bash deploy/bootstrap.sh --set-password"
fi
echo
echo "Next: npm run deploy"
