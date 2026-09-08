# Task: Serve the dashboard from S3 + CloudFront with no server to administer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Status:** ACTIVE
**Issue:** user request, 2026-09-08 — "I want to run the dashboard on my AWS account but don't want
to have to use an EC2 server. Can this be a lightweight, static site? Maybe using S3?"
**Branch:** `aws-hosting`

**Goal:** A password-gated HTTPS URL that renders the current build record, published by one
command from a developer machine, with no compute to administer.

**Architecture:** One CloudFormation stack holds a private S3 bucket, a CloudFront distribution
reaching it through Origin Access Control, and a CloudFront Function that gates every
viewer-request on a shared basic-auth credential. Nothing under `src/` changes — the app is
already a static bundle, so hosting is purely additive. `npm run deploy` builds, uploads in three
cache-control passes, and invalidates the three unhashed paths.

**Tech Stack:** CloudFormation, S3, CloudFront (OAC + Functions, runtime `cloudfront-js-2.0`),
AWS CLI v2, bash, Vite 6.

**Spec:** `.specs/2026-09-08-static-hosting-design.md`

## Global Constraints

Every task's requirements implicitly include these. Values are copied verbatim from the spec.

- **Region:** `us-east-1` for the whole stack (spec §1).
- **Bucket name:** `!Sub 'panther-build-dashboard-${AWS::AccountId}'` — deterministic and globally
  unique without inventing a name (spec §1).
- **Price class:** `PriceClass_100` (spec §1).
- **Cache policy:** managed `CachingOptimized`, id `658327ea-f89d-4fab-a63d-7e88639e58f6`, with
  `Compress: true` (spec §2).
- **SPA fallback:** `403` **and** `404` both map to `/index.html` with `ResponseCode: 200` and
  `ErrorCachingMinTTL: 10`. `403` is the one that actually fires for a missing key on an S3 REST
  origin (spec §2).
- **Auth username:** fixed at `panther`. The credential parameter carries base64 of
  `panther:<password>` (spec §3).
- **The function source must not use JavaScript template literals.** `Fn::Sub` claims `${...}`, and
  `${BasicAuthCredential}` must be the only substitution in the inlined code (spec §3).
- **The password is printed once and stored nowhere** — not in `.env.deploy`, not recoverable from
  the stack (`NoEcho`). Rotation is re-running `bootstrap.sh` with a new password (spec §3).
- **Both scripts open with `set -euo pipefail`** (spec, Testing).
- **No changes under `src/`.** If `npm test`, `npm run type-check`, or `npm run lint` changes
  behavior, something was added that should not have been (spec, Testing).
- **`stats-treemap.html` is never uploaded** — it is `rollup-plugin-visualizer` output, not part of
  the app (spec §4).
- **No `git add` / `git commit` in any task.** The user's `CLAUDE.md` forbids it. Every task ends by
  listing the files it created or modified, and the user commits.
- **macOS bash is 3.2.** Expanding an empty array under `set -u` errors there, so use the
  `${ARR[@]+"${ARR[@]}"}` idiom rather than a bare `"${ARR[@]}"`.

## Context

- **Related files:** `.specs/2026-09-08-static-hosting-design.md`, `vite.config.ts`,
  `src/app/routes.tsx:18` (`createBrowserRouter` — the reason SPA fallback is required),
  `src/features/build/fixtures/source.ts:16` (the compile-time report import — the reason a new
  report needs a rebuild), `package.json`.
- **Triggered by:** user request, 2026-09-08. Spec approved the same day.
- **Environment verified:** AWS CLI `2.1.17`, one profile (`default`), default region `us-east-1`.
- **Branch note:** written against `proteome-version-data` @ `37f493d`, executed on `aws-hosting`
  @ `13f00a0`, which does not contain the proteome commit. The fixture here is the older
  sanitised 8-section report (`target: "target"`, `generated_at: 2026-08-20T23:26:31Z`), so
  Phase 5 would publish that rather than a cluster-path report. Nothing in Phases 1-4 depends
  on the fixture; `npm run build` verified on this branch at 3.94s.

## Current State

- **What works now:** `npm run build` succeeds — verified, 4.57s, `dist/` holds `index.html`,
  hashed assets under `assets/`, and `favicon.ico`. First load ≈336 kB gzipped. The app has no
  backend and no runtime fetch.
- **What's missing:** any hosting at all. The dashboard is reachable only from a developer checkout
  via `npm run dev` on port 4310. There is no `deploy/` directory and no AWS resources.

## Steps

### Phase 1: The CloudFormation stack

**Files:**

- Create: `deploy/infrastructure.yaml`

**Interfaces:**

- Consumes: nothing.
- Produces: three stack outputs later phases read by name — `BucketName` (string, the bucket),
  `DistributionId` (string, for invalidations), `SiteUrl` (string,
  `https://<domain>.cloudfront.net`). One parameter, `BasicAuthCredential` (String, `NoEcho`).

- [ ] **Step 1.1: Write the failing structural test**

The spec's §3 constraint — that `${BasicAuthCredential}` is the *only* `Fn::Sub` variable inside
the function code — is exactly the kind of thing that fails silently, so assert it directly.
Create `deploy/check-template.sh`:

```bash
#!/usr/bin/env bash
# Offline structural checks on infrastructure.yaml. No AWS call, no credentials.
set -euo pipefail
cd "$(dirname "$0")/.."
TEMPLATE=deploy/infrastructure.yaml

fail() { echo "FAIL: $*" >&2; exit 1; }

[[ -f $TEMPLATE ]] || fail "$TEMPLATE does not exist"

# Every Fn::Sub variable in the file must be one we intend. A stray '${...}' - most
# likely a JavaScript template literal in the inlined function - would make Fn::Sub
# either fail the stack or silently substitute an empty string.
EXPECTED='${AWS::AccountId}
${AWS::StackName}
${BasicAuthCredential}
${Distribution.DomainName}
${Distribution}
${SiteBucket.Arn}'
ACTUAL="$(grep -o '\${[^}]*}' "$TEMPLATE" | sort -u || true)"
if [[ "$ACTUAL" != "$(printf '%s' "$EXPECTED" | sort -u)" ]]; then
    fail "unexpected Fn::Sub variables. Got:
$ACTUAL"
fi

# Both error codes must be mapped, and both must rewrite the status to 200. Mapping
# only 404 leaves every deep link broken while '/' works.
grep -q 'ErrorCode: 403' "$TEMPLATE" || fail "403 is not mapped (it is the code an S3 REST origin returns for a missing key)"
grep -q 'ErrorCode: 404' "$TEMPLATE" || fail "404 is not mapped"
[[ $(grep -c 'ResponseCode: 200' "$TEMPLATE") -eq 2 ]] || fail "expected exactly two 'ResponseCode: 200' lines"

# OAC with an S3 origin requires the legacy OriginAccessIdentity field, left empty.
grep -q "OriginAccessIdentity: ''" "$TEMPLATE" || fail "S3OriginConfig.OriginAccessIdentity must be present and empty for OAC"

# Every Fn::GetAtt path must be one AWS actually exposes. The CloudFront Function's ARN
# is the trap: the docs list a bare 'FunctionARN' attribute but its description sends you
# to '!GetAtt <id>.FunctionMetadata.FunctionARN', which is the form that resolves. A wrong
# attribute path fails only at stack-create time, so audit it here.
EXPECTED_GETATT='BasicAuthFunction.FunctionMetadata.FunctionARN
OriginAccessControl.Id
SiteBucket.RegionalDomainName'
ACTUAL_GETATT="$(grep -o '!GetAtt [A-Za-z0-9.]*' "$TEMPLATE" | awk '{print $2}' | sort -u || true)"
if [[ "$ACTUAL_GETATT" != "$(printf '%s' "$EXPECTED_GETATT" | sort -u)" ]]; then
    fail "unexpected Fn::GetAtt paths. Got:
$ACTUAL_GETATT"
fi

# The managed CachingOptimized policy, by id.
grep -q '658327ea-f89d-4fab-a63d-7e88639e58f6' "$TEMPLATE" || fail "CachingOptimized cache policy id missing"

# A template literal in the function code would break Fn::Sub; so would a backtick.
if grep -q '`' "$TEMPLATE"; then
    fail "backtick found - the inlined function must not use template literals"
fi

echo "OK: $TEMPLATE passes offline structural checks"
```

- [ ] **Step 1.2: Run it to verify it fails**

```bash
cd panther_build_dashboard && bash deploy/check-template.sh
```

Expected: `FAIL: deploy/infrastructure.yaml does not exist`, exit 1.

- [ ] **Step 1.3: Write the template**

Create `deploy/infrastructure.yaml`:

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Description: >
  Static hosting for panther_build_dashboard. A private S3 bucket behind a CloudFront
  distribution, reached only through Origin Access Control, gated by a shared basic-auth
  credential checked at the edge on every viewer request.

Parameters:
  BasicAuthCredential:
    Type: String
    NoEcho: true
    MinLength: 8
    AllowedPattern: '^[A-Za-z0-9+/=]+$'
    Description: >
      Base64 of "panther:<password>". Generated and printed once by deploy/bootstrap.sh.
      NoEcho keeps it out of stack output; it is not recoverable afterwards.

Resources:
  # Private origin. No website hosting, no public ACL, no bucket-level public access.
  # CloudFront reaches it as a signed REST origin, which is also why a missing key
  # comes back as 403 rather than 404 (see CustomErrorResponses below).
  SiteBucket:
    Type: AWS::S3::Bucket
    Properties:
      BucketName: !Sub 'panther-build-dashboard-${AWS::AccountId}'
      PublicAccessBlockConfiguration:
        BlockPublicAcls: true
        BlockPublicPolicy: true
        IgnorePublicAcls: true
        RestrictPublicBuckets: true
      OwnershipControls:
        Rules:
          - ObjectOwnership: BucketOwnerEnforced
      BucketEncryption:
        ServerSideEncryptionConfiguration:
          - ServerSideEncryptionByDefault:
              SSEAlgorithm: AES256

  OriginAccessControl:
    Type: AWS::CloudFront::OriginAccessControl
    Properties:
      OriginAccessControlConfig:
        Name: !Sub '${AWS::StackName}-oac'
        OriginAccessControlOriginType: s3
        SigningBehavior: always
        SigningProtocol: sigv4

  # Shared-password gate. On viewer-request, so it runs before the cache and cannot be
  # bypassed by asking for something already at the edge. The credential is not part of
  # the cache key, so all authorized viewers share one cached copy.
  BasicAuthFunction:
    Type: AWS::CloudFront::Function
    Properties:
      Name: !Sub '${AWS::StackName}-basic-auth'
      AutoPublish: true
      FunctionConfig:
        Comment: Shared-password gate, evaluated before the cache.
        Runtime: cloudfront-js-2.0
      FunctionCode: !Sub |
        function handler(event) {
            var request = event.request;
            var headers = request.headers;
            var expected = 'Basic ${BasicAuthCredential}';

            if (!headers.authorization || headers.authorization.value !== expected) {
                return {
                    statusCode: 401,
                    statusDescription: 'Unauthorized',
                    headers: {
                        // Without WWW-Authenticate a browser shows a blank error page
                        // instead of a login prompt.
                        'www-authenticate': { value: 'Basic realm="PANTHER build dashboard", charset="UTF-8"' },
                        'cache-control': { value: 'no-store' }
                    }
                };
            }

            // CloudFront signs the origin request itself under OAC. A forwarded viewer
            // Authorization header would collide with that SigV4 signature.
            delete headers.authorization;

            return request;
        }

  Distribution:
    Type: AWS::CloudFront::Distribution
    Properties:
      DistributionConfig:
        Enabled: true
        Comment: !Sub '${AWS::StackName} - PANTHER build dashboard'
        DefaultRootObject: index.html
        PriceClass: PriceClass_100
        HttpVersion: http2and3
        IPV6Enabled: true
        Origins:
          - Id: s3-origin
            DomainName: !GetAtt SiteBucket.RegionalDomainName
            OriginAccessControlId: !GetAtt OriginAccessControl.Id
            # Required, and required to be empty, when using OAC with an S3 origin.
            S3OriginConfig:
              OriginAccessIdentity: ''
        DefaultCacheBehavior:
          TargetOriginId: s3-origin
          ViewerProtocolPolicy: redirect-to-https
          AllowedMethods: [GET, HEAD]
          CachedMethods: [GET, HEAD]
          Compress: true
          # Managed-CachingOptimized. Respects origin Cache-Control, so cache lifetime is
          # decided per object at upload time rather than here.
          CachePolicyId: 658327ea-f89d-4fab-a63d-7e88639e58f6
          FunctionAssociations:
            - EventType: viewer-request
              # Not the bare '.FunctionARN' attribute: AWS lists it but its own docs
              # redirect to this FunctionMetadata form, which is the one that resolves.
              FunctionARN: !GetAtt BasicAuthFunction.FunctionMetadata.FunctionARN
        # SPA fallback. 403 is the status an S3 REST origin returns for a key that does
        # not exist, because the signing principal has no s3:ListBucket; 404 is mapped
        # too for completeness. The status is rewritten to 200 so that monitors, crawlers
        # and 'curl -f' do not read every client-side route as broken.
        CustomErrorResponses:
          - ErrorCode: 403
            ResponseCode: 200
            ResponsePagePath: /index.html
            ErrorCachingMinTTL: 10
          - ErrorCode: 404
            ResponseCode: 200
            ResponsePagePath: /index.html
            ErrorCachingMinTTL: 10

  # Grants read to the CloudFront service principal, narrowed to this one distribution.
  # Not a public policy, so it coexists with Block Public Access above.
  SiteBucketPolicy:
    Type: AWS::S3::BucketPolicy
    Properties:
      Bucket: !Ref SiteBucket
      PolicyDocument:
        Version: '2012-10-17'
        Statement:
          - Sid: AllowCloudFrontServicePrincipalReadOnly
            Effect: Allow
            Principal:
              Service: cloudfront.amazonaws.com
            Action: s3:GetObject
            Resource: !Sub '${SiteBucket.Arn}/*'
            Condition:
              StringEquals:
                AWS:SourceArn: !Sub 'arn:aws:cloudfront::${AWS::AccountId}:distribution/${Distribution}'

Outputs:
  BucketName:
    Description: Upload target for deploy/deploy.sh.
    Value: !Ref SiteBucket
  DistributionId:
    Description: Invalidation target for deploy/deploy.sh.
    Value: !Ref Distribution
  SiteUrl:
    Description: The dashboard URL. Requires the basic-auth credential.
    Value: !Sub 'https://${Distribution.DomainName}'
```

- [ ] **Step 1.4: Run the offline test to verify it passes**

```bash
cd panther_build_dashboard && bash deploy/check-template.sh
```

Expected: `OK: deploy/infrastructure.yaml passes offline structural checks`, exit 0.

If the `Fn::Sub` assertion fails, read what it printed before editing the test — a variable in the
list that you did not intend is the bug, not the assertion.

- [ ] **Step 1.5: Validate server-side**

This is a read-only AWS API call. It costs nothing and creates nothing, but it does need
credentials.

```bash
cd panther_build_dashboard && aws cloudformation validate-template \
    --template-body "file://deploy/infrastructure.yaml" --region us-east-1
```

Expected: JSON listing `BasicAuthCredential` under `Parameters` with `NoEcho: true`. Malformed YAML
or a bad intrinsic function fails here, in a second, rather than after a distribution rollout.

- [ ] **Step 1.6: List the files created**

Print the paths for the user to review. Do not stage or commit.

```bash
cd panther_build_dashboard && ls -l deploy/
```

### Phase 2: Bootstrap — create the stack, generate the credential

**Files:**

- Create: `deploy/bootstrap.sh`
- Create: `.env.deploy.example`
- Modify: `.gitignore` (append `.env.deploy`)

**Interfaces:**

- Consumes: `deploy/infrastructure.yaml` and its three outputs from Phase 1.
- Produces: `.env.deploy`, a shell-sourceable config file holding `STACK_NAME`, `AWS_REGION`,
  `BUCKET`, `DIST_ID`, `SITE_URL` — the names Phase 3 reads. Accepts `DASHBOARD_PASSWORD` from the
  environment to set or rotate the password, and `--check` to run every preflight without calling
  CloudFormation.

- [ ] **Step 2.1: Write the failing tests**

Create `deploy/check-scripts.sh`. It grows one more case in Phase 3.

```bash
#!/usr/bin/env bash
# Offline behavioural checks on the deploy scripts. No AWS call, no credentials.
set -euo pipefail
cd "$(dirname "$0")/.."

pass() { echo "  ok: $*"; }
fail() { echo "  FAIL: $*" >&2; exit 1; }

echo "bootstrap.sh"

[[ -f deploy/bootstrap.sh ]] || fail "deploy/bootstrap.sh does not exist"

grep -q 'set -euo pipefail' deploy/bootstrap.sh \
    || fail "bootstrap.sh must open with 'set -euo pipefail'"
pass "fails fast on error and unset variables"

# --check must do every preflight and stop short of the stack call.
OUT="$(DASHBOARD_PASSWORD=hunter2 bash deploy/bootstrap.sh --check 2>&1)" \
    || fail "--check exited non-zero: $OUT"
grep -q 'would deploy' <<<"$OUT" || fail "--check should say what it would do. Got: $OUT"
pass "--check runs preflight without touching AWS"

# The credential is base64 of panther:<password> - the username is fixed, and getting
# this wrong is invisible until a browser refuses to log in.
grep -q 'cGFudGhlcjpodW50ZXIy' <<<"$OUT" \
    || fail "--check should show the credential it would send (base64 of 'panther:hunter2'). Got: $OUT"
pass "encodes the credential as base64 of panther:<password>"

# The generate-a-password branch is the documented default invocation, and every check
# above supplies DASHBOARD_PASSWORD explicitly, so none of them touches it. It crashed at
# exit 141 under pipefail until this case existed. Note the race: it did not fail on every
# run, which is exactly why it needs a test rather than a manual try.
OUT="$(env -u DASHBOARD_PASSWORD bash deploy/bootstrap.sh --check 2>&1)" \
    || fail "--check with no DASHBOARD_PASSWORD exited non-zero (the generate path). Got: $OUT"
grep -q 'would deploy' <<<"$OUT" || fail "the generate path should still preview a deploy. Got: $OUT"
# `|| true` for the same reason as bootstrap.sh's generator: under pipefail a grep that
# matches nothing would abort this script inside the assignment, before the explicit
# check below could report it.
GEN_CRED="$(grep -o 'credential: [A-Za-z0-9+/=]*' <<<"$OUT" | awk '{print $2}' || true)"
[[ -n $GEN_CRED ]] || fail "the generate path printed no credential. Got: $OUT"
GEN_DECODED="$(printf '%s' "$GEN_CRED" | base64 -d 2>/dev/null || true)"
[[ ${GEN_DECODED%%:*} == panther ]] || fail "generated credential is not for user 'panther': $GEN_DECODED"
[[ ${#GEN_DECODED} -eq 32 ]] \
    || fail "generated password is not 24 chars ('panther:' + 24 = 32): '$GEN_DECODED' is ${#GEN_DECODED}"
pass "generates a 24-char password for user panther when none is supplied"

# --check must not imply it knows whether the stack exists; it makes no AWS calls.
grep -q 'has not checked whether the stack' <<<"$OUT" \
    || fail "--check should disclose that it did not probe for an existing stack. Got: $OUT"
pass "--check discloses what it could not check"

# The password itself must never be written to .env.deploy.
if grep -q 'PASSWORD' .env.deploy.example; then
    fail ".env.deploy.example must not mention a password field - the secret is never stored"
fi
pass ".env.deploy.example carries config only"

git check-ignore -q .env.deploy \
    || fail ".env.deploy is not gitignored"
pass ".env.deploy is gitignored"

echo "all script checks passed"
```

- [ ] **Step 2.2: Run it to verify it fails**

```bash
cd panther_build_dashboard && bash deploy/check-scripts.sh
```

Expected: `FAIL: deploy/bootstrap.sh does not exist`, exit 1.

- [ ] **Step 2.3: Add the gitignore entry and the example config**

Append to `.gitignore`:

```
.env.deploy
```

Create `.env.deploy.example`:

```bash
# Written by deploy/bootstrap.sh into .env.deploy, which is gitignored.
# Config only - the basic-auth password is printed once by bootstrap.sh and stored nowhere.

STACK_NAME=panther-build-dashboard
AWS_REGION=us-east-1

# Filled in from the CloudFormation stack outputs.
BUCKET=panther-build-dashboard-000000000000
DIST_ID=E000000000000
SITE_URL=https://d000000000000.cloudfront.net

# Optional, and read only by deploy.sh, which sources this file before calling the AWS
# CLI. bootstrap.sh writes this file rather than reading it, so for bootstrap you must
# export AWS_PROFILE in your shell instead.
# AWS_PROFILE=default
```

- [ ] **Step 2.4: Write bootstrap.sh**

```bash
#!/usr/bin/env bash
# One-time (and idempotent) setup of the hosting stack. Safe to re-run: it updates the
# stack in place, and re-running with DASHBOARD_PASSWORD set rotates the gate.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
TEMPLATE="$HERE/infrastructure.yaml"
ENV_FILE="$ROOT/.env.deploy"

STACK_NAME="${STACK_NAME:-panther-build-dashboard}"
AWS_REGION="${AWS_REGION:-us-east-1}"
PASSWORD="${DASHBOARD_PASSWORD:-}"
CHECK_ONLY=0
[[ "${1:-}" == "--check" ]] && CHECK_ONLY=1

die() { echo "error: $*" >&2; exit 1; }

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
    [[ ${#PARAM_ARGS[@]} -gt 0 ]] && echo "  credential: ${CREDENTIAL}"
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
aws cloudformation deploy \
    --stack-name "$STACK_NAME" \
    --template-file "$TEMPLATE" \
    --region "$AWS_REGION" \
    --no-fail-on-empty-changeset \
    ${PARAM_ARGS[@]+"${PARAM_ARGS[@]}"}

stack_output() {
    aws cloudformation describe-stacks \
        --stack-name "$STACK_NAME" --region "$AWS_REGION" \
        --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}

BUCKET="$(stack_output BucketName)"
DIST_ID="$(stack_output DistributionId)"
SITE_URL="$(stack_output SiteUrl)"

[[ -n $BUCKET && $BUCKET != None ]] || die "stack produced no BucketName output"
[[ -n $DIST_ID && $DIST_ID != None ]] || die "stack produced no DistributionId output"
[[ -n $SITE_URL && $SITE_URL != None ]] || die "stack produced no SiteUrl output"

cat > "$ENV_FILE" <<ENVFILE
# Written by deploy/bootstrap.sh on $(date -u '+%Y-%m-%dT%H:%M:%SZ').
# Config only - the basic-auth password is not stored here or anywhere else.
STACK_NAME=$STACK_NAME
AWS_REGION=$AWS_REGION
BUCKET=$BUCKET
DIST_ID=$DIST_ID
SITE_URL=$SITE_URL
ENVFILE

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
    echo "      DASHBOARD_PASSWORD=<new> bash deploy/bootstrap.sh"
fi
echo
echo "Next: npm run deploy"
```

- [ ] **Step 2.5: Run the tests to verify they pass**

```bash
cd panther_build_dashboard && bash deploy/check-scripts.sh
```

Expected: five `ok:` lines under `bootstrap.sh`, then `all script checks passed`, exit 0.

- [ ] **Step 2.6: Lint the shell if shellcheck is available**

```bash
cd panther_build_dashboard && command -v shellcheck >/dev/null \
    && shellcheck deploy/bootstrap.sh deploy/check-template.sh deploy/check-scripts.sh \
    || echo "shellcheck not installed - skipping (not a hard dependency)"
```

Expected: no output from shellcheck, or the skip message. Fix anything it reports.

- [ ] **Step 2.7: List the files created and modified**

```bash
cd panther_build_dashboard && ls -l deploy/ .env.deploy.example && tail -3 .gitignore
```

### Phase 3: The deploy script

**Files:**

- Create: `deploy/deploy.sh`
- Modify: `package.json` (add `deploy` and `deploy:infra` scripts)
- Modify: `deploy/check-scripts.sh` (add the deploy.sh cases)

**Interfaces:**

- Consumes: `.env.deploy` written by Phase 2 — `BUCKET`, `DIST_ID`, `AWS_REGION`, `SITE_URL`.
- Produces: `npm run deploy` and `npm run deploy:infra`. `deploy.sh` accepts `--dry-run`, which
  prints the exact AWS commands without running them.

- [ ] **Step 3.1: Write the failing tests**

Append to `deploy/check-scripts.sh`, before the final `echo`:

```bash
echo
echo "deploy.sh"

[[ -f deploy/deploy.sh ]] || fail "deploy/deploy.sh does not exist"

grep -q 'set -euo pipefail' deploy/deploy.sh \
    || fail "deploy.sh must open with 'set -euo pipefail'"
pass "fails fast on error and unset variables"

# A misconfigured .env.deploy must fail in a second, not after a build.
SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT

if OUT="$(ENV_FILE="$SCRATCH/absent" bash deploy/deploy.sh --dry-run 2>&1)"; then
    fail "deploy.sh should refuse to run with no .env.deploy. Got: $OUT"
fi
grep -q 'bootstrap.sh' <<<"$OUT" \
    || fail "the missing-config error should point at bootstrap.sh. Got: $OUT"
pass "refuses to run without .env.deploy, and says how to get one"

printf 'BUCKET=\nDIST_ID=E123\n' > "$SCRATCH/empty-bucket"
if OUT="$(ENV_FILE="$SCRATCH/empty-bucket" bash deploy/deploy.sh --dry-run 2>&1)"; then
    fail "deploy.sh should refuse an empty BUCKET. Got: $OUT"
fi
grep -q 'BUCKET' <<<"$OUT" || fail "the error should name BUCKET. Got: $OUT"
pass "refuses an empty BUCKET by name"

# DIST_ID is validated identically to BUCKET, so it needs the same test - an asymmetric
# pair like this is how one of the two guards quietly rots.
printf 'BUCKET=b\nDIST_ID=\n' > "$SCRATCH/empty-dist"
if OUT="$(ENV_FILE="$SCRATCH/empty-dist" bash deploy/deploy.sh --dry-run 2>&1)"; then
    fail "deploy.sh should refuse an empty DIST_ID. Got: $OUT"
fi
grep -q 'DIST_ID' <<<"$OUT" || fail "the error should name DIST_ID. Got: $OUT"
pass "refuses an empty DIST_ID by name"

# The three upload passes exist because one Cache-Control cannot be right for all of
# index.html, the hashed assets, and the unhashed favicon.
printf 'BUCKET=b\nDIST_ID=E123\nAWS_REGION=us-east-1\n' > "$SCRATCH/ok"
OUT="$(ENV_FILE="$SCRATCH/ok" bash deploy/deploy.sh --dry-run 2>&1)" \
    || fail "--dry-run should exit 0 with valid config. Got: $OUT"

grep -q 'max-age=31536000,immutable' <<<"$OUT" || fail "hashed assets need a long immutable TTL. Got: $OUT"
grep -q 'no-cache,must-revalidate'   <<<"$OUT" || fail "index.html must never be served stale. Got: $OUT"
grep -q 'max-age=86400'              <<<"$OUT" || fail "favicon.ico is unhashed and must not be pinned for a year. Got: $OUT"
pass "three upload passes with distinct cache-control"

grep -q -- '--exclude stats-treemap.html' <<<"$OUT" \
    || fail "stats-treemap.html is build-internals output and must not be uploaded. Got: $OUT"
pass "excludes the bundle visualizer report"

grep -q 'create-invalidation' <<<"$OUT" || fail "no invalidation. Got: $OUT"
pass "invalidates the unhashed paths"
```

- [ ] **Step 3.2: Run it to verify the new cases fail**

```bash
cd panther_build_dashboard && bash deploy/check-scripts.sh
```

Expected: `bootstrap.sh` cases still pass, then `FAIL: deploy/deploy.sh does not exist`, exit 1.

- [ ] **Step 3.3: Write deploy.sh**

```bash
#!/usr/bin/env bash
# Build the bundle and publish it. Reads .env.deploy, written by deploy/bootstrap.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/.env.deploy}"
DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

die() { echo "error: $*" >&2; exit 1; }

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
        printf '%s\n' "$*"
    else
        "$@"
    fi
}

# The bundle embeds docs/build_state.json as it stands right now - check you copied the
# report you meant to publish.
if [[ $DRY_RUN -eq 0 ]]; then
    echo "Publishing the report currently in docs/build_state.json:"
    grep -o '"target": *"[^"]*"' "$ROOT/docs/build_state.json" | head -1 || true
    grep -o '"generated_at": *"[^"]*"' "$ROOT/docs/build_state.json" | head -1 || true
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
```

- [ ] **Step 3.4: Add the npm scripts**

In `package.json`, inside `"scripts"`, after `"preview"`:

```json
    "deploy": "bash deploy/deploy.sh",
    "deploy:infra": "bash deploy/bootstrap.sh",
```

- [ ] **Step 3.5: Run the tests to verify they pass**

```bash
cd panther_build_dashboard && bash deploy/check-scripts.sh
```

Expected: every case `ok:`, then `all script checks passed`, exit 0.

- [ ] **Step 3.6: Confirm nothing under src/ was touched**

```bash
cd panther_build_dashboard && npm run type-check && npm run lint && git status --short
```

Expected: type-check and lint clean. `git status` shows only `deploy/`, `.env.deploy.example`,
`.gitignore`, `package.json` — nothing under `src/`.

- [ ] **Step 3.7: Lint the shell and list the files**

```bash
cd panther_build_dashboard && command -v shellcheck >/dev/null \
    && shellcheck deploy/*.sh || echo "shellcheck not installed - skipping"
cd panther_build_dashboard && ls -l deploy/ && git status --short
```

### Phase 4: Documentation

**Files:**

- Create: `deploy/README.md`
- Modify: `README.md` (add a "Deploying" section)

**Interfaces:**

- Consumes: the commands and file names from Phases 1–3.
- Produces: nothing other code reads.

- [ ] **Step 4.1: Write the failing test**

Append to `deploy/check-scripts.sh`, before the final `echo`:

```bash
echo
echo "documentation"

[[ -f deploy/README.md ]] || fail "deploy/README.md does not exist"

for topic in "First-time setup" "Publishing" "Rotating" "Tearing down"; do
    grep -q "$topic" deploy/README.md || fail "deploy/README.md has no '$topic' section"
done
pass "covers setup, publishing, rotation and teardown"

# Deleting the stack fails while the bucket holds objects, and that is a confusing
# failure to hit for the first time during teardown.
grep -q 'rm --recursive\|rm -r' deploy/README.md \
    || fail "teardown must say to empty the bucket first - a stack will not delete otherwise"
pass "teardown says to empty the bucket first"

grep -qi 'shared password\|not access control\|shared secret' deploy/README.md \
    || fail "the README must be plain about what the gate does not provide"
pass "states the limits of the auth gate"

# The primary documented workflow deletes every object it did not just upload. A user who
# is not told that loses whatever they put in the bucket, with no prompt.
grep -q -- '--delete' deploy/README.md \
    || fail "the README must warn that publishing runs 'sync --delete' on the bucket"
pass "warns that publishing prunes the bucket"

grep -q 'deploy/README.md' README.md || fail "README.md does not point at deploy/README.md"
pass "the root README points at it"
```

- [ ] **Step 4.2: Run it to verify it fails**

```bash
cd panther_build_dashboard && bash deploy/check-scripts.sh
```

Expected: earlier cases pass, then `FAIL: deploy/README.md does not exist`, exit 1.

- [ ] **Step 4.3: Write deploy/README.md**

```markdown
# Deploying the dashboard

The dashboard is a static bundle with no backend, so it is served from a private S3 bucket
behind a CloudFront distribution. There is no server to administer and nothing runs between
deploys.

Design and rationale: `../.specs/2026-09-08-static-hosting-design.md`.

Every command below is run from the repository root, not from `deploy/`.

## First-time setup

Needs AWS credentials for the target account and an AWS CLI on the path.

```bash
bash deploy/bootstrap.sh
```

This creates the CloudFormation stack `panther-build-dashboard` in `us-east-1`, generates a
password, writes the stack outputs to `.env.deploy` (gitignored), and prints the URL and the
credential.

**Save the password when it is printed.** It is shown once. It is not written to
`.env.deploy`, and `NoEcho` keeps it out of the stack output, so it cannot be read back
afterwards. Losing it is not a lockout — see Rotating below.

Creating a CloudFront distribution takes 5–15 minutes. The script waits.

To choose the password yourself:

```bash
DASHBOARD_PASSWORD='something-you-picked' bash deploy/bootstrap.sh
```

## Publishing a report

The report is compiled into the bundle (`src/features/build/fixtures/source.ts`), so
publishing a new one means rebuilding. Copy the report first, then deploy:

```bash
cp /path/to/target/reports/build_state/build_state.json docs/build_state.json
npm run deploy
```

`npm run deploy` prints the `target` and `generated_at` it is about to publish before it
builds — check them. Then it builds, uploads in three cache-control passes, and invalidates
the three unhashed paths.

**Before publishing, know what is in the file.** The report carries absolute cluster paths
and per-proteome provenance. That is the reason the site is gated at all.

**The bucket is not a place to keep things.** The first upload pass runs
`aws s3 sync --delete`, so every object in the bucket that is not part of the build it just
made is deleted — silently, with no prompt. Do not put anything in this bucket by hand; it
will survive exactly until the next `npm run deploy`.

One consequence is worth knowing even if you never touch the bucket: the prune removes the
*previous* build's hashed chunks. Five report panels are loaded lazily
(`src/features/reports/registry.tsx`), so a colleague who had the dashboard open across a
deploy and then opens a report can request a chunk that no longer exists. They get
`index.html` at status 200 and a broken panel. A reload fixes it, because `index.html` is
served `no-cache`.

To see the exact commands without running them:

```bash
npm run deploy -- --dry-run
```

## Changing the infrastructure

Edit `deploy/infrastructure.yaml`, then re-run bootstrap. It updates the stack in place and
does not need the password again — CloudFormation reuses the stored value for any parameter
the deploy does not supply.

```bash
bash deploy/bootstrap.sh
```

## Rotating the password

```bash
DASHBOARD_PASSWORD='the-new-one' bash deploy/bootstrap.sh
```

This is also the recovery path if the password is lost: nothing needs to be deleted, and the
URL does not change.

## What the password gate is not

A single shared password, base64-encoded in the CloudFront Function's source and readable by
anyone with CloudFront read access in the account. Base64 is encoding, not encryption.

It is a gate against casual discovery, crawlers, and a forwarded link. It is **not access
control**: no per-person identity, no revoking one person's access without changing everyone's,
no audit trail of who looked.

If that is not enough, the spec records the two upgrade paths: an AWS WAF IP allowlist
(~$6/month, layered on top of the password) or Cognito via Lambda@Edge for real identity.

## Verifying a deploy

```bash
. ./.env.deploy
PW='the-password-bootstrap-printed'

curl -sI "$SITE_URL/"                             # 401, with a WWW-Authenticate header
curl -sI -u "panther:$PW" "$SITE_URL/"            # 200
curl -sI -u "panther:$PW" "$SITE_URL/release"     # 200, NOT 404 - the SPA fallback
```

The `/release` check is the one worth keeping: it is a client-side route, so it only works
because CloudFront rewrites the origin's 403 into `index.html` with a 200.

## Tearing down

A CloudFormation stack will not delete while its bucket still holds objects, so empty it
first:

```bash
. ./.env.deploy
aws s3 rm --recursive "s3://$BUCKET" --region "$AWS_REGION"
aws cloudformation delete-stack --stack-name "$STACK_NAME" --region "$AWS_REGION"
aws cloudformation wait stack-delete-complete --stack-name "$STACK_NAME" --region "$AWS_REGION"
```

Only once that `wait` has exited successfully:

```bash
rm -f .env.deploy
```

The split is deliberate. If `delete-stack` leaves the stack in `DELETE_FAILED`, pasting the
whole block as one unit would throw away the only local record of a stack that still exists
and is still billing.

## Cost

CloudFront's perpetual free tier covers 1 TB egress and 10M requests per month, which this
dashboard will not approach. S3 storage for a ~2 MB bundle and the edge function invocations
round to zero. Expect roughly $0/month, and no hourly charge for anything.
```

- [ ] **Step 4.4: Add the root README section**

Append to `README.md`:

```markdown
## Deploying

The dashboard is a static bundle — no backend, no server. It is published to a private S3
bucket behind CloudFront, gated by a shared password.

```bash
bash deploy/bootstrap.sh   # one time: create the stack, print the URL and password
npm run deploy             # publish whatever is in docs/build_state.json right now
```

See `deploy/README.md` for setup, rotating the password, and tearing the stack down, and
`.specs/2026-09-08-static-hosting-design.md` for why it is shaped this way.
```

- [ ] **Step 4.5: Run the tests to verify they pass**

```bash
cd panther_build_dashboard && bash deploy/check-scripts.sh
```

Expected: every case `ok:`, then `all script checks passed`, exit 0.

- [ ] **Step 4.6: List the files created and modified**

```bash
cd panther_build_dashboard && git status --short
```

### Phase 5: Live deploy and verification

> **Get the user's go-ahead before starting this phase.** Every step before this one is local
> files. These steps create real, billable resources in the user's AWS account and publish build
> data to an internet-reachable URL. Neither is reversible by editing a file.

**Files:** none. This phase runs what Phases 1–4 built.

- [ ] **Step 5.1: Confirm the account and the payload**

```bash
cd panther_build_dashboard && aws sts get-caller-identity
grep -o '"target": *"[^"]*"' docs/build_state.json | head -1
grep -o '"generated_at": *"[^"]*"' docs/build_state.json | head -1
```

Show the user the account id and the report identity, and confirm both are the intended ones
before continuing.

- [ ] **Step 5.2: Create the stack**

```bash
cd panther_build_dashboard && bash deploy/bootstrap.sh
```

Expected: 5–15 minutes, then a URL, a bucket name, and the password printed once. Capture the
password for the following steps; do not echo it into a file.

- [ ] **Step 5.3: Publish**

```bash
cd panther_build_dashboard && npm run deploy
```

Expected: the target and `generated_at` printed, a successful build, three upload passes, and an
invalidation id.

- [ ] **Step 5.4: Run the spec's verification checks**

Substitute the real password. Each check is here because it can fail on its own.

```bash
cd panther_build_dashboard
. ./.env.deploy
P='the-password-from-step-5.2'

echo "1. unauthenticated -> 401 with a login prompt"
curl -sI "$SITE_URL/" | sed -n '1p;/www-authenticate/Ip'

echo "2. authenticated root -> 200 text/html"
curl -sI -u "panther:$P" "$SITE_URL/" | sed -n '1p;/content-type/Ip;/cache-control/Ip'

echo "3. client-side route -> 200, NOT 404 (the SPA fallback)"
curl -sI -u "panther:$P" "$SITE_URL/release" | sed -n '1p'

echo "4. a hashed asset -> immutable for a year"
ASSET="$(grep -o '/assets/js/index-[^"]*\.js' dist/index.html | head -1)"
curl -sI -u "panther:$P" "$SITE_URL$ASSET" | sed -n '1p;/cache-control/Ip'

echo "5. the favicon -> a day, not a year"
curl -sI -u "panther:$P" "$SITE_URL/favicon.ico" | sed -n '1p;/cache-control/Ip'

echo "6. the bucket is not readable on its own -> 403"
curl -sI "https://${BUCKET}.s3.${AWS_REGION}.amazonaws.com/index.html" | sed -n '1p'

echo "7. the visualizer report was never uploaded -> 200 from the SPA fallback, not the file"
curl -s -u "panther:$P" "$SITE_URL/stats-treemap.html" | head -c 200
```

Expected, in order: `401` with `www-authenticate`; `200` with `text/html` and
`no-cache,must-revalidate`; **`200`** for `/release`; `200` with
`public,max-age=31536000,immutable`; `200` with `public,max-age=86400`; `403` from S3;
and for the last one, the SPA `index.html` rather than a treemap page.

- [ ] **Step 5.5: Check it in a browser**

Open `$SITE_URL`. Confirm: the password prompt appears; the record renders; `/release` renders the
release view; a hash deep link scrolls to its anchor; and a lazily loaded report panel opens
(these are separate chunks fetched after first paint, so this is the check that the asset pass
uploaded everything).

- [ ] **Step 5.6: Confirm a redeploy propagates**

`touch` alone will not do — it changes no content, so Vite emits the identical content hash
and the check passes without proving anything. Make a real change, verify, then revert it.

```bash
cd panther_build_dashboard
BEFORE="$(grep -o '/assets/js/index-[^"]*\.js' dist/index.html | head -1)"

printf '\n// temporary - redeploy propagation check, reverted below\n' >> src/App.tsx
npm run deploy
AFTER="$(grep -o '/assets/js/index-[^"]*\.js' dist/index.html | head -1)"
[ "$BEFORE" != "$AFTER" ] && echo "hash changed: $BEFORE -> $AFTER" || echo "FAIL: hash did not change"

# Reload the page once and confirm the served bundle is $AFTER, then put the file back.
git checkout src/App.tsx
npm run deploy
```

This is the check that `index.html` is genuinely uncached — the failure mode it catches is a
deploy that appears to succeed while viewers keep the old bundle. Confirm `git status` is
clean for `src/` afterwards.

- [ ] **Step 5.7: Report the result and hand over the credential**

Give the user the URL and the password directly, note that it is stored nowhere, and point at
`deploy/README.md` for rotation.

## Recovery Checkpoint

> **⚠ UPDATE THIS AFTER EVERY CHANGE**

- **Last completed action:** pre-flight scan done, two plan defects ruled on and amended
  (Step 5.6's vacuous `touch` check, stale branch metadata). Ledger at
  `<scratchpad>/sdd/03-static-hosting/progress.md`.
- **Next immediate action:** Phase 1, Step 1.1 — write `deploy/check-template.sh`.
- **Recent commands run:**
  - `npm run build` (succeeded, 4.57s)
  - `aws --version` → `aws-cli/2.1.17`
  - `aws configure get region` → `us-east-1`
- **Uncommitted changes:** `.specs/2026-09-08-static-hosting-design.md` (new),
  `.plans/config/03-static-hosting.md` (new). Nothing staged — the user's `CLAUDE.md` forbids
  `git add` and `git commit`.
- **Environment state:** no AWS resources created yet. `dist/` holds a fresh production build.

## Failed Approaches

| What was tried | Why it failed | Date |
| -------------- | ------------- | ---- |
|                |               |      |

## Files Modified

| File | Action | Status |
| ---- | ------ | ------ |
| `deploy/infrastructure.yaml` | Create | pending |
| `deploy/check-template.sh` | Create | pending |
| `deploy/check-scripts.sh` | Create | pending |
| `deploy/bootstrap.sh` | Create | pending |
| `deploy/deploy.sh` | Create | pending |
| `deploy/README.md` | Create | pending |
| `.env.deploy.example` | Create | pending |
| `.gitignore` | Modify — add `.env.deploy` | pending |
| `package.json` | Modify — add `deploy`, `deploy:infra` | pending |
| `README.md` | Modify — add "Deploying" | pending |

## Blockers

- Phase 5 needs the user's explicit go-ahead: it creates billable AWS resources and publishes
  build data to an internet-reachable URL.

## Notes

**Two deliberate deviations from the spec, both in the upload passes (spec §4).**

1. **A third pass for `favicon.ico`.** Spec §4 shows two passes, which would sweep the favicon
   into the immutable one-year bucket along with the hashed assets. It is unhashed, so a
   changed favicon would never propagate. It gets `max-age=86400` and is excluded from pass 1.
2. **`/favicon.ico` added to the invalidation paths.** One extra path, free within the 1,000/month
   allowance, and it makes the favicon change on the same deploy rather than within a day.

**Additions to the spec's file list.** `deploy/check-template.sh` and `deploy/check-scripts.sh`
are the offline test suite the spec's Testing section describes but does not name as files.
`.env.deploy` also carries `SITE_URL` beyond the five values the spec lists, so `deploy.sh` can
print the URL without another API call.

**Why the CloudFront Function is inlined in the YAML rather than kept as a `.js` file.** The
credential has to reach the code somehow, and `Fn::Sub` is the one substitution point.
CloudFront Functions have no environment variables. Passing the whole function body as a
CloudFormation parameter would work but means shell-quoting a multi-line JavaScript string
through `--parameter-overrides`, which is fragile on an older CLI. Inlining costs the ability to
lint the function as JavaScript; `check-template.sh` covers the specific failure that matters
(a stray `${` or a backtick breaking `Fn::Sub`), and Step 5.4's HTTP checks cover the behavior.

**Why `403` and not just `404`.** OAC signs requests to the S3 *REST* endpoint, and that endpoint
returns `403 Access Denied` for a key that does not exist because the signing principal has no
`s3:ListBucket`. This is the single easiest thing to get wrong here: map only `404` and the root
path works while every deep link 403s, which looks like an auth problem rather than a routing one.

**Two shell details that are load-bearing.** `run()` in `deploy.sh` executes `"$@"` rather than
`eval "$@"`, so arguments reach the AWS CLI exactly as written and a path containing a space cannot
re-split; `--dry-run` prints `"$*"`, which is display-only. And every assertion in the check scripts
is written `if grep ...; then fail; fi` rather than `grep ... && fail` — under `set -e` the AND-list
form exits with status 1 when grep finds nothing, turning a *passing* check into a silent failure.

**The `--delete` prune window — confirmed reachable, not theoretical.** Pass 1 removes the
previous build's chunks before pass 2 swaps `index.html`. `src/features/reports/registry.tsx:37-50`
lazy-loads five components via `React.lazy(() => import(...))`, and their chunks
(`ChecksPanel-*.js`, `MappingReport-*.js`, `NodeTrackingReport-*.js`, `ComparisonReport-*.js`,
`BarCell-*.js`) appear nowhere in `dist/index.html` — they are fetched only when a viewer opens
that panel. So a viewer holding the page open across a deploy who then opens a report requests a
chunk pass 1 just deleted; CloudFront answers with `index.html` at status 200, and the bundle tries
to parse HTML as JavaScript.

`index.html` is `no-cache`, so one reload fixes it. The one-line alternative is dropping `--delete`
from pass 1 and pruning occasionally instead: old assets then accumulate at roughly 1.2 MB per
deploy, which is about $0.003/month per hundred deploys. The spec weighed this and chose `--delete`
("accepted rather than solved by hoarding old assets forever"), so it stands — but the cost side of
that trade is smaller than the spec's wording implies, and this is the one open design question
worth revisiting.

## Lessons Learned

- [Fill during and after execution.]

## Additional Context (Claude)

**The rebuild-per-report coupling is the thing most likely to feel wrong in use.** Because the
report is a compile-time import, publishing a new `build_state.json` is a full rebuild and
re-upload rather than dropping one file in a bucket. That is faithful to the current design of
`fixtures/source.ts`, and the spec records switching to a runtime fetch as a follow-up. Worth
revisiting only once someone is actually annoyed by it — at a 4.5-second build, that may never
happen.

**A second, subtler consequence of the same coupling:** the deployed site shows exactly one build
record, and `--delete` removes the previous one's assets. There is no history and no way to
compare two builds through the URL. If that turns out to matter, it is the runtime-fetch follow-up
plus a selector in the app, not a hosting change.

**On the fixture drift noted in the workspace `CLAUDE.md`.** That file (verified 2026-09-04)
describes `docs/build_state.json` as modified and uncommitted with 176 failing tests from the
fixture swap. On this branch the tree is clean at `37f493d "More detailed proteome data"`, and the
build produces a `ProteomesReport` chunk, so the integration appears to have moved on. This plan
does not depend on it either way — hosting publishes whatever the fixture holds — but whoever runs
Phase 5 should look at what they are about to publish, which is what Step 5.1 is for.

**If the CLI version does become a problem,** the likeliest symptom is
`aws cloudformation deploy` rejecting an argument rather than anything template-related, since the
template is interpreted server-side. `brew upgrade awscli` is the fix; `bootstrap.sh` warns but
does not block.
