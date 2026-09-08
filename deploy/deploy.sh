#!/usr/bin/env bash
# Build the bundle and publish it. Reads .env.deploy, written by deploy/bootstrap.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/.env.deploy}"

die() { echo "error: $*" >&2; exit 1; }

# Only $1 is ever inspected below, so a typo'd flag (--dryrun, -dry-run, --dry-run=1) must
# not silently fall through to the live path - that is a real 'sync --delete' against the
# bucket. Reject anything unrecognized, and reject extra arguments beyond the first.
DRY_RUN=0
[[ $# -le 1 ]] || die "unexpected extra arguments: ${*:2}"
case "${1:-}" in
    "") ;;
    --dry-run) DRY_RUN=1 ;;
    *) die "unknown argument: $1 (expected --dry-run)" ;;
esac

[[ -f $ENV_FILE ]] || die "$ENV_FILE not found. Run 'bash deploy/bootstrap.sh' first."

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

[[ -n ${BUCKET:-} ]]  || die "BUCKET is empty in $ENV_FILE. Re-run deploy/bootstrap.sh."
[[ -n ${DIST_ID:-} ]] || die "DIST_ID is empty in $ENV_FILE. Re-run deploy/bootstrap.sh."
AWS_REGION="${AWS_REGION:-us-east-1}"

run() {
    if [[ $DRY_RUN -eq 1 ]]; then
        # %q quotes only what needs it, so this is the exact command a shell would run -
        # '%s\n' "$*" printed --content-type's value unquoted, which is unsafe to paste.
        printf '%q ' "$@"
        printf '\n'
    else
        "$@"
    fi
}

# The bundle embeds docs/build_state.json as it stands right now - check you copied the
# report you meant to publish.
if [[ $DRY_RUN -eq 0 ]]; then
    echo "Publishing the report currently in docs/build_state.json:"
    grep -o '"target": *"[^"]*"' "$ROOT/docs/build_state.json" | head -1 \
        || echo "  (no \"target\" field found - is docs/build_state.json the shape you expect?)"
    grep -o '"generated_at": *"[^"]*"' "$ROOT/docs/build_state.json" | head -1 \
        || echo "  (no \"generated_at\" field found - is docs/build_state.json the shape you expect?)"
    echo
    npm --prefix "$ROOT" run build
fi

# Pass 1 - content-hashed assets. The hash is in the filename, so a year is safe.
# --delete prunes assets from previous builds; an --exclude'd file is also excluded
# from deletion, which is what keeps pass 2's index.html from being removed here.
run aws s3 sync "$ROOT/dist/" "s3://${BUCKET}/" --delete \
    --exclude 'index.html' --exclude 'favicon.ico' --exclude 'stats-treemap.html' \
    --cache-control 'public,max-age=31536000,immutable' \
    --region "$AWS_REGION"

# Pass 2 - the entry point. The one file whose name never changes while its contents
# change every deploy, so it must never be cached.
run aws s3 cp "$ROOT/dist/index.html" "s3://${BUCKET}/index.html" \
    --cache-control 'no-cache,must-revalidate' \
    --content-type 'text/html; charset=utf-8' \
    --region "$AWS_REGION"

# Pass 3 - the favicon is also unhashed, so it gets a day rather than a year.
run aws s3 cp "$ROOT/dist/favicon.ico" "s3://${BUCKET}/favicon.ico" \
    --cache-control 'public,max-age=86400' \
    --region "$AWS_REGION"

# Only the unhashed paths need invalidating; everything else is content-addressed.
run aws cloudfront create-invalidation --distribution-id "$DIST_ID" \
    --paths '/' '/index.html' '/favicon.ico'

if [[ $DRY_RUN -eq 0 ]]; then
    echo
    echo "Deployed: ${SITE_URL:-check the SiteUrl stack output}"
    echo "The edge may take a minute to pick up the invalidation."
fi
