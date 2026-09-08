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

# Only $1 is ever inspected, so a typo'd flag must not silently fall through to the live
# path - that path creates a CloudFront distribution. All three of these must die before
# any AWS call, which is what makes them safe to run in an offline test suite.
if OUT="$(bash deploy/bootstrap.sh --chekc 2>&1)"; then
    fail "bootstrap.sh accepted an unrecognized flag (--chekc). Got: $OUT"
fi
grep -q 'unrecognized or extra argument' <<<"$OUT" \
    || fail "the rejection should say 'unrecognized or extra argument'. Got: $OUT"
pass "rejects an unrecognized flag instead of falling through to the live path"

if OUT="$(bash deploy/bootstrap.sh --check extra-arg 2>&1)"; then
    fail "bootstrap.sh accepted an extra argument. Got: $OUT"
fi
grep -qi 'extra argument' <<<"$OUT" || fail "the rejection should mention the extra argument. Got: $OUT"
pass "rejects extra arguments beyond the first"

if OUT="$(DASHBOARD_PASSWORD=x bash deploy/bootstrap.sh --set-password 2>&1)"; then
    fail "bootstrap.sh allowed --set-password combined with DASHBOARD_PASSWORD. Got: $OUT"
fi
grep -qi -- '--set-password' <<<"$OUT" \
    || fail "the rejection should mention --set-password. Got: $OUT"
pass "rejects --set-password combined with DASHBOARD_PASSWORD before any AWS call"

# --check and --set-password are the one deliberate pair allowed together, in either order:
# combined, they prompt for the password and then take the --check exit - an offline
# preview of a rotation that must never leak the supplied password or its credential. A
# piped answer to the prompt keeps this terminal-free.
PIPED_PW='chosen-pw-1234'
PIPED_B64="$(printf 'panther:%s' "$PIPED_PW" | base64 | tr -d '\n' || true)"

OUT="$(printf '%s\n' "$PIPED_PW" | env -u DASHBOARD_PASSWORD bash deploy/bootstrap.sh --set-password --check 2>&1)" \
    || fail "--set-password --check should exit 0 (an offline preview). Got: $OUT"
grep -q 'would deploy' <<<"$OUT" || fail "--set-password --check should still preview a deploy. Got: $OUT"
if grep -q "$PIPED_PW" <<<"$OUT"; then
    fail "the piped password leaked into --set-password --check output. Got: $OUT"
fi
if grep -q "$PIPED_B64" <<<"$OUT"; then
    fail "the credential for a piped password leaked into --set-password --check output. Got: $OUT"
fi
grep -q 'credential:.*not shown' <<<"$OUT" \
    || fail "--set-password --check should say a credential would be sent without showing it. Got: $OUT"
pass "combines --set-password and --check: offline preview, credential never shown"

# Order must not matter.
OUT="$(printf '%s\n' "$PIPED_PW" | env -u DASHBOARD_PASSWORD bash deploy/bootstrap.sh --check --set-password 2>&1)" \
    || fail "--check --set-password should exit 0 (an offline preview). Got: $OUT"
if grep -q "$PIPED_PW" <<<"$OUT"; then
    fail "the piped password leaked into --check --set-password output. Got: $OUT"
fi
if grep -q "$PIPED_B64" <<<"$OUT"; then
    fail "the credential for a piped password leaked into --check --set-password output. Got: $OUT"
fi
pass "combines the same two flags in the opposite order, with identical guarantees"

# An empty answer at the prompt must be rejected outright, not accepted as a zero-length
# password that would be sent to CloudFormation.
if OUT="$(printf '\n' | env -u DASHBOARD_PASSWORD bash deploy/bootstrap.sh --set-password --check 2>&1)"; then
    fail "an empty prompted password should be rejected, not accepted. Got: $OUT"
fi
grep -q 'no password entered' <<<"$OUT" \
    || fail "the rejection should say no password was entered. Got: $OUT"
pass "rejects an empty password entered at the --set-password prompt"

# 'read' itself returns non-zero at EOF (closed stdin), distinct from a successful read of
# a blank line - unguarded, that would abort under 'set -e' before the emptiness check ever
# ran, with no message at all. Both shapes must produce the same clear error.
if OUT="$(env -u DASHBOARD_PASSWORD bash deploy/bootstrap.sh --set-password --check < /dev/null 2>&1)"; then
    fail "closed stdin at the --set-password prompt should be rejected, not accepted. Got: $OUT"
fi
grep -q 'no password entered' <<<"$OUT" \
    || fail "closed stdin at the prompt should say no password was entered. Got: $OUT"
pass "rejects closed stdin at the --set-password prompt with the same clear error"

# --check must do every preflight and stop short of the stack call.
OUT="$(DASHBOARD_PASSWORD=hunter2 bash deploy/bootstrap.sh --check 2>&1)" \
    || fail "--check exited non-zero: $OUT"
grep -q 'would deploy' <<<"$OUT" || fail "--check should say what it would do. Got: $OUT"
pass "--check runs preflight without touching AWS"

# A supplied DASHBOARD_PASSWORD previews a rotation, not a new stack. --check is
# documented as safe to run casually, so it must not be the place that echoes a real
# secret back out - only an auto-generated credential (for a brand-new stack) is shown.
if grep -q 'cGFudGhlcjpodW50ZXIy' <<<"$OUT"; then
    fail "--check must not print the real credential for a supplied DASHBOARD_PASSWORD. Got: $OUT"
fi
grep -q 'credential:.*not shown' <<<"$OUT" \
    || fail "--check should say a credential would be sent without showing it. Got: $OUT"
pass "does not print a supplied password's credential, only a placeholder"

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

echo
echo "deploy.sh"

[[ -f deploy/deploy.sh ]] || fail "deploy/deploy.sh does not exist"

grep -q 'set -euo pipefail' deploy/deploy.sh \
    || fail "deploy.sh must open with 'set -euo pipefail'"
pass "fails fast on error and unset variables"

# Only $1 is ever inspected, so a typo'd flag must not silently fall through to the live
# path - that path runs 'sync --delete' against the bucket. Both die before the .env.deploy
# check even runs, so these are safe to run with no config in place.
if OUT="$(bash deploy/deploy.sh --dryrun 2>&1)"; then
    fail "deploy.sh accepted an unrecognized flag (--dryrun). Got: $OUT"
fi
grep -q 'unknown argument' <<<"$OUT" || fail "the rejection should say 'unknown argument'. Got: $OUT"
pass "rejects an unrecognized flag instead of falling through to the live path"

if OUT="$(bash deploy/deploy.sh --dry-run extra-arg 2>&1)"; then
    fail "deploy.sh accepted an extra argument. Got: $OUT"
fi
grep -qi 'extra argument' <<<"$OUT" || fail "the rejection should mention the extra argument. Got: $OUT"
pass "rejects extra arguments beyond the first"

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

# Bind each Cache-Control value to the specific object it applies to, not merely to the
# transcript as a bag of strings - grepping the whole transcript would still pass if pass
# 2's and pass 3's flags were swapped, which would pin index.html for a day and make every
# future deploy invisible for up to 24 hours. (--dry-run prints with printf %q, which
# backslash-escapes the commas in these values - '[\\]?' tolerates that either way.)
# `|| true` on each: a bare capture like this is itself a top-level command under
# 'set -e', so if deploy.sh ever drops a pass, the grep that would find no matching line
# aborts the suite right here with no output at all - the explicit `[[ -n ... ]] || fail`
# diagnostics immediately below become unreachable, exactly the class of bug this fix wave
# has hit three times already.
SYNC_LINE="$(grep 's3 sync' <<<"$OUT" || true)"
INDEX_LINE="$(grep 's3 cp.*index\.html' <<<"$OUT" || true)"
FAVICON_LINE="$(grep 's3 cp.*favicon\.ico' <<<"$OUT" || true)"
INVALIDATE_LINE="$(grep 'create-invalidation' <<<"$OUT" || true)"

[[ -n $SYNC_LINE ]]       || fail "no 's3 sync' line in dry-run output. Got: $OUT"
[[ -n $INDEX_LINE ]]      || fail "no 's3 cp ... index.html' line in dry-run output. Got: $OUT"
[[ -n $FAVICON_LINE ]]    || fail "no 's3 cp ... favicon.ico' line in dry-run output. Got: $OUT"
[[ -n $INVALIDATE_LINE ]] || fail "no invalidation line in dry-run output. Got: $OUT"

grep -Eq -- 'max-age=31536000[\\]?,?immutable' <<<"$SYNC_LINE" \
    || fail "hashed assets (sync pass) need a long immutable TTL. Got: $SYNC_LINE"
grep -Eq -- 'no-cache[\\]?,?must-revalidate' <<<"$INDEX_LINE" \
    || fail "index.html must never be served stale. Got: $INDEX_LINE"
grep -q -- 'max-age=86400' <<<"$FAVICON_LINE" \
    || fail "favicon.ico is unhashed and must not be pinned for a year. Got: $FAVICON_LINE"
pass "three upload passes with distinct cache-control, each tied to its own object"

grep -q -- '--content-type' <<<"$INDEX_LINE" \
    || fail "index.html must be uploaded with an explicit --content-type. Got: $INDEX_LINE"
pass "sets an explicit content-type for index.html"

grep -q -- '--delete' <<<"$SYNC_LINE" \
    || fail "the sync pass must prune stale assets with --delete. Got: $SYNC_LINE"
pass "the sync pass prunes stale assets with --delete"

grep -q -- '--exclude index.html' <<<"$SYNC_LINE" \
    || fail "the sync pass must exclude index.html, or --delete would remove pass 2's upload. Got: $SYNC_LINE"
grep -q -- '--exclude favicon.ico' <<<"$SYNC_LINE" \
    || fail "the sync pass must exclude favicon.ico, or --delete would remove pass 3's upload. Got: $SYNC_LINE"
pass "the sync pass excludes the files the other two passes upload"

grep -q -- '--exclude stats-treemap.html' <<<"$SYNC_LINE" \
    || fail "stats-treemap.html is build-internals output and must not be uploaded. Got: $SYNC_LINE"
pass "excludes the bundle visualizer report"

grep -q -- 'create-invalidation' <<<"$INVALIDATE_LINE" || fail "no invalidation. Got: $OUT"
grep -Eq -- '(^| )/( |$)'  <<<"$INVALIDATE_LINE" || fail "invalidation must include the root path '/'. Got: $INVALIDATE_LINE"
grep -q -- '/index.html'  <<<"$INVALIDATE_LINE" || fail "invalidation must include '/index.html'. Got: $INVALIDATE_LINE"
grep -q -- '/favicon.ico' <<<"$INVALIDATE_LINE" || fail "invalidation must include '/favicon.ico'. Got: $INVALIDATE_LINE"
pass "invalidates all three unhashed paths"

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

echo "all script checks passed"
