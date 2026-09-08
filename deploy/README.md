# Deploying the dashboard

The dashboard is a static bundle with no backend, so it is served from a private S3 bucket
behind a CloudFront distribution. There is no server to administer and nothing runs between
deploys.

Design and rationale: `../.specs/2026-09-08-static-hosting-design.md`.

Every command below is run from the repository root, not from `deploy/`.

## First-time setup

Needs AWS credentials for the target account and an AWS CLI on the path, with three things
granted to those credentials:

- `AmazonS3FullAccess` — covers the bucket.
- `CloudFrontFullAccess` — covers the distribution, the Origin Access Control, and the
  basic-auth edge function.
- **`AWSCloudFormationFullAccess`.** This is the one most likely to be missing. Probed
  directly against the target account: `cloudformation:DescribeStacks` and `ListStacks` are
  allowed, `cloudformation:ValidateTemplate` is denied, and the only CloudFormation grant
  found (`AWSCodeStarFullAccess`) is read-only and scoped to `stack/awscodestar-*` — none of
  that covers `CreateChangeSet`/`ExecuteChangeSet` on a stack named
  `panther-build-dashboard`. Without this attached, the most likely first-run outcome is
  `AccessDenied`. This grant also covers `cloudformation:DescribeStackEvents` specifically —
  confirmed denied on its own in the target account — which is what `bootstrap.sh`'s
  on-failure diagnostic calls to retrieve the root cause; without it, a failed deploy prints
  only an `AccessDenied` for that call too, not the actual stack event.

Attach `AWSCloudFormationFullAccess` to the user or group running bootstrap; the S3 and
CloudFront grants above may already be present via existing IAM groups.

```bash
bash deploy/bootstrap.sh
```

Equivalently: `npm run deploy:infra`.

This creates the CloudFormation stack `panther-build-dashboard` in `us-east-1`, generates a
password, writes the stack outputs to `.env.deploy` (gitignored), and prints the URL and the
credential. Re-running bootstrap later rewrites `.env.deploy` in place; if you have hand-added
an `AWS_PROFILE=` line to it (see `.env.deploy.example`), that line is preserved across the
rewrite.

**Save the password when it is printed.** It is shown once. It is not written to
`.env.deploy`, and `NoEcho` keeps it out of the stack output, so it cannot be read back
afterwards. Losing it is not a lockout — see Rotating below.

Creating a CloudFront distribution takes 5–15 minutes. The script waits.

To choose the password yourself, use the prompting form so the password never touches argv
or shell history:

```bash
bash deploy/bootstrap.sh --set-password
```

For scripted use, `DASHBOARD_PASSWORD` still works, but be aware that neither bash nor zsh
ignores space-prefixed history by default, so this form writes the password into your shell
history file:

```bash
DASHBOARD_PASSWORD='something-you-picked' bash deploy/bootstrap.sh
```

**These two are mutually exclusive.** `--set-password` together with `DASHBOARD_PASSWORD`
set (in the environment or on the command line) is a hard error — bootstrap refuses to
guess which one you meant and exits before prompting or making any AWS call. If your shell
already has `DASHBOARD_PASSWORD` exported, unset it before using `--set-password`.

## If bootstrap fails

`bootstrap.sh` runs `aws cloudformation deploy` under `set -e`; on failure it also prints the
last 20 stack events (`aws cloudformation describe-stack-events`), which is what actually
surfaces the cause when the CLI itself reports only `ROLLBACK_COMPLETE`.

- **`AccessDenied`.** See the IAM permissions above — this is the most likely first-run
  outcome on a fresh set of credentials.
- **Stack stuck in `ROLLBACK_COMPLETE`.** A stack in this state cannot be updated; it has to
  be deleted and recreated:
  ```bash
  aws cloudformation delete-stack --stack-name panther-build-dashboard --region us-east-1
  aws cloudformation wait stack-delete-complete --stack-name panther-build-dashboard --region us-east-1
  bash deploy/bootstrap.sh
  ```
  Stack *deletion* takes roughly 15–20 minutes — longer than creation. The CloudFront
  distribution has to be disabled before it can be removed, and that step alone takes most of
  it.
- **Root cause still unclear.** Run the same command bootstrap prints on failure:
  ```bash
  aws cloudformation describe-stack-events --stack-name panther-build-dashboard --region us-east-1 --max-items 20
  ```
- **Sanity-check before trying again.** `bash deploy/bootstrap.sh --check` previews
  everything offline with zero AWS calls — the cheapest way to rule out a template or
  argument mistake before spending another 15 minutes on a real attempt.
- **`panther-build-dashboard-<account-id> already exists`.** Bucket names here are
  deterministic and globally unique. If an earlier `delete-stack` ended in `DELETE_FAILED`
  because the bucket still held objects, the stack is gone (or stuck in `DELETE_FAILED`) but
  the bucket survives, and a fresh bootstrap fails trying to recreate it under the same name.
  Empty and delete the orphaned bucket by hand (see Tearing down), then re-run bootstrap.
- **Old AWS CLI, inspecting the Origin Access Control or the basic-auth CloudFront
  Function.** `bootstrap.sh` prints a note when the CLI looks old; concretely, CLI 2.1.17
  cannot even parse `aws cloudfront list-origin-access-controls` or
  `aws cloudfront list-functions` as commands — those APIs postdate it. Deployment itself is
  unaffected, since CloudFormation creates both server-side, but troubleshooting the auth
  gate or the OAC from the command line is not possible on a CLI this old. Use the AWS
  console for either resource, or upgrade (`brew upgrade awscli`) if you want CLI access to
  them — neither is required for anything in this deploy path.

## Publishing a report

The report is compiled into the bundle (`src/features/build/fixtures/source.ts`), so
publishing a new one means rebuilding. Copy the report first, then deploy:

```bash
cp /path/to/target/reports/build_state/build_state.json docs/build_state.json
npm run deploy
```

`npm run deploy` prints the `target` and `generated_at` it is about to publish before it
builds — check them. Then it builds, uploads in three cache-control passes, and invalidates
the three unhashed paths (`/`, `/index.html`, `/favicon.ico`).

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
bash deploy/bootstrap.sh --set-password
```

This prompts for the new password rather than taking it as an argument, so it never reaches
argv or shell history. (`DASHBOARD_PASSWORD='the-new-one' bash deploy/bootstrap.sh` still
works for scripted use, with the shell-history caveat noted under First-time setup. The two
forms are mutually exclusive — see the note there — so unset `DASHBOARD_PASSWORD` first if
you want the prompt instead.)

To preview a rotation without sending it, add `--check`, in either order
(`--set-password --check` or `--check --set-password`):

```bash
bash deploy/bootstrap.sh --set-password --check
```

This still prompts for the password, but then takes the offline `--check` path - no AWS
calls, and the credential is never printed, only a note that one would be sent.

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

curl -sI "https://$BUCKET.s3.$AWS_REGION.amazonaws.com/index.html"     # 403 - not independently readable
curl -sI -u "panther:$PW" "$SITE_URL/"                                 # Cache-Control: no-cache,must-revalidate
curl -sI -u "panther:$PW" "$SITE_URL/assets/<a-hashed-asset-from-dist/assets>"  # Cache-Control: public,max-age=31536000,immutable
```

The `/release` check is the one worth keeping: it is a client-side route, so it only works
because CloudFront rewrites the origin's 403 into `index.html` with a 200.

The direct-to-bucket check is the only one that confirms the private-origin claim: if that
ever returns 200 instead of 403, the CloudFront/OAC gate is being bypassed and the bucket is
readable by anyone, with no password required. The two cache-header checks confirm the
three-pass upload actually landed the values it exists to set, rather than merely that some
`Cache-Control` header is present.

**"200 everywhere" is not, by itself, proof of a good deploy.** Because the SPA fallback maps
both 403 and 404 to `index.html` at status 200, a *broken* deploy — missing assets, a bad
bucket policy — also renders as 200 for every path. It shows up as a white screen with a
console MIME-type error, not as an HTTP error, so the checks above are what actually catch it.

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
