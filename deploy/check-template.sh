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
# Exactly two: the 403 and 404 mappings above, each rewritten to 200. A future third
# error-code mapping needs this count updated deliberately, not silently passed.
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

# Every check above is a grep, so a bad indent or a stray tab passes all of them and fails
# only at stack-create. A real parse catches that class of error offline. PyYAML does not
# know CloudFormation's short intrinsic tags (!Sub, !GetAtt, !Ref) - a generic multi
# constructor stands in for all of them, since we only need the document to parse and the
# Resources/Outputs shape to be right, not the resolved values.
YAML_PARSE_RAN=0
if command -v python3 >/dev/null 2>&1 && python3 -c 'import yaml' >/dev/null 2>&1; then
    python3 - "$TEMPLATE" <<'PYEOF'
import sys

import yaml

path = sys.argv[1]
yaml.SafeLoader.add_multi_constructor("!", lambda loader, suffix, node: None)
try:
    with open(path) as fh:
        doc = yaml.safe_load(fh)
except yaml.YAMLError as exc:
    sys.exit(f"FAIL: {path} is not valid YAML: {exc}")

if not isinstance(doc, dict):
    sys.exit("FAIL: template did not parse to a mapping")

expected_resources = {
    "SiteBucket",
    "OriginAccessControl",
    "BasicAuthFunction",
    "Distribution",
    "SiteBucketPolicy",
}
resources = set((doc.get("Resources") or {}).keys())
if resources != expected_resources:
    sys.exit(f"FAIL: unexpected Resources keys: {sorted(resources)}")

expected_outputs = {"BucketName", "DistributionId", "SiteUrl"}
outputs = set((doc.get("Outputs") or {}).keys())
if outputs != expected_outputs:
    sys.exit(f"FAIL: unexpected Outputs keys: {sorted(outputs)}")

print(f"OK: {path} parses as YAML with the expected Resources and Outputs")
PYEOF
    YAML_PARSE_RAN=1
else
    echo "SKIP: PyYAML not available - skipping structural YAML parse of $TEMPLATE" >&2
fi

# The last line is what someone skimming the output actually reads - it must not claim more
# than what ran. Without PyYAML, every check above is still a grep (see the comments above
# each one), so this passing does NOT mean the file is structurally valid YAML.
if [[ $YAML_PARSE_RAN -eq 1 ]]; then
    echo "OK: $TEMPLATE passes offline structural checks (including a full YAML parse)"
else
    echo "OK: $TEMPLATE passes offline structural checks (YAML parse SKIPPED - no PyYAML)"
fi
