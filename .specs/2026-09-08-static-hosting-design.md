# Static Hosting on S3 + CloudFront

Design for serving `panther_build_dashboard` from an AWS account with no server to
administer — no EC2, no container, no backend process of any kind.

## Problem

The dashboard currently runs only from a developer checkout (`npm run dev`, port 4310).
Anyone who wants to look at a build record needs the repo, Node, and the right branch.
That makes the build record effectively private to whoever is doing the build, which is
the opposite of what a build/release record is for.

Nothing about the app requires a server. The constraint is entirely one of hosting: there
is no place to put the compiled bundle.

## Goals

1. A URL that renders the current build record, reachable from a browser with no local
   checkout.
2. No compute to patch, restart, or pay for by the hour.
3. Access limited to people who have been given a credential — the report carries absolute
   cluster paths and per-proteome provenance that should not be on the open web.
4. Publishing a newly copied `docs/build_state.json` is one command from a developer
   machine.
5. Cost that rounds to zero at this traffic level.

## Non-goals

- **A custom domain.** The distribution's own `*.cloudfront.net` name is the address. The
  template is written so an ACM certificate and aliases can be added later without moving
  the bucket or changing the deploy flow.
- **CI/CD.** Deploys are run by hand from a developer machine, deliberately: the input to a
  deploy is a hand-copied `build_state.json`, so a push-triggered build would have nothing
  to trigger on that the developer has not already done locally.
- **Per-user authentication.** See "Access control" for exactly what the chosen gate does
  and does not do.
- **Serving the report at runtime.** `docs/build_state.json` stays a compile-time import
  (`src/features/build/fixtures/source.ts:16`). Changing that is a real code change to the
  model layer and is out of scope here; it is recorded as a follow-up.
- **Build history.** One distribution shows one build record — whichever was last deployed.

## Current state — why this is possible at all

Verified on branch `proteome-version-data` at `37f493d`:

- **No backend and no runtime data fetch.** `fetch(`, `axios`, and `XMLHttpRequest` do not
  appear anywhere under `src/`. The single `import.meta.env` reference is the router
  basename (`src/app/routes.tsx:34`).
- **The report is compiled in.** `src/features/build/fixtures/source.ts` imports
  `../../../../docs/build_state.json` directly, and its own docblock states the intent:
  "The data is static: there is no fetch layer, no loading state and no backend."
- **`npm run build` already emits a deployable tree.** Verified: built in 4.57s to
  `dist/` — one `index.html`, hashed assets under `assets/`, `favicon.ico`. First load is
  roughly 336 kB gzipped (`index.js` 159.67, `mantine.js` 90.39, `react-router` 30.59,
  `redux` 12.43, CSS 42.60); the five report panels are separate lazily loaded chunks.
- **Path prefixes are already parameterized.** `vite.config.ts` reads `base` from
  `VITE_BASE_URL` and the router reads the same variable as its `basename`, so serving from
  a subpath needs configuration, not code. This design serves from the root and leaves the
  variable unset.

The one thing the app needs from a host: **SPA fallback.** `createBrowserRouter`
(`src/app/routes.tsx:18`) means `/release` is a client-side path. A plain object store asked
for the key `release` has nothing to return, so the host must answer with `index.html`.

## Design

### 1. One CloudFormation stack, five resources

`deploy/infrastructure.yaml` declares everything, so the whole hosting setup can be created,
updated, and torn down by name rather than clicked together in a console:

| Resource                                  | Role                                                                       |
| ----------------------------------------- | -------------------------------------------------------------------------- |
| `AWS::S3::Bucket`                         | Holds `dist/`. Fully private: all four Block Public Access flags on, no website hosting, no public ACL. |
| `AWS::CloudFront::OriginAccessControl`    | Lets the distribution — and only the distribution — sign requests to the bucket. |
| `AWS::S3::BucketPolicy`                   | Grants `s3:GetObject` to the `cloudfront.amazonaws.com` service principal, conditioned on `AWS:SourceArn` matching this distribution. |
| `AWS::CloudFront::Function`               | Viewer-request basic-auth gate (§3).                                        |
| `AWS::CloudFront::Distribution`           | The public edge: HTTPS, compression, cache behavior, SPA fallback (§2).     |

Region is `us-east-1`, matching the configured default of the deploying machine. The bucket
region is not load-bearing for a CloudFront origin, but keeping the stack in `us-east-1`
means a future ACM certificate — which CloudFront requires in `us-east-1` specifically —
lives in the same stack as everything else.

The bucket is named `!Sub 'panther-build-dashboard-${AWS::AccountId}'`. S3 bucket names are
globally unique across all AWS accounts; appending the account id makes the name
deterministic without risking a collision with a stranger's bucket, and without asking the
operator to invent one.

`PriceClass_100` restricts edge locations to North America and Europe. The audience is a US
lab; the cheaper price class is the honest default.

### 2. SPA fallback and caching

**Fallback.** The distribution maps origin `403` *and* `404` to `/index.html` with response
status **`200`**, at `ErrorCachingMinTTL: 10`.

Two details matter here and are easy to get wrong:

- **`403` is the status that actually fires.** An S3 *REST* origin — which is what OAC uses,
  as opposed to the S3 *website* endpoint — returns `403 Access Denied`, not `404`, for a key
  that does not exist, because the signing principal has no `s3:ListBucket`. Configure only
  `404` and every deep link breaks while `/` works, which is a confusing way to discover
  this. Both are configured.
- **The response status must be rewritten to `200`.** Serving `index.html` under a `404`
  status renders correctly but tells crawlers, monitors, and `curl -f` that every route in
  the app is broken.

**Caching.** The managed `CachingOptimized` policy
(`658327ea-f89d-4fab-a63d-7e88639e58f6`) plus `Compress: true`. That policy respects
`Cache-Control` from the origin, so cache lifetime is decided at upload time per object
(§4) rather than in the distribution. Compression happens at the edge, so S3 stores the
bundle uncompressed and viewers still get the ~336 kB gzipped transfer.

The viewer protocol policy is `redirect-to-https`; allowed methods are `GET`/`HEAD` only.

### 3. Access control

A CloudFront Function on **viewer-request** compares the `Authorization` header against one
expected `Basic` credential and, on mismatch, returns `401` with a
`WWW-Authenticate: Basic realm="..."` header — without which a browser shows a blank error
page instead of a login prompt.

Three properties of this placement are the reason to choose it:

- **It runs before the cache.** A viewer-request function executes on every request,
  including cache hits, so the gate cannot be bypassed by requesting something already at
  the edge.
- **The credential is not part of the cache key.** `CachingOptimized` does not include
  `Authorization`, so all authorized viewers share one cached copy.
- **The header is stripped before the origin.** The function deletes
  `request.headers.authorization` after validating. With OAC, CloudFront signs the origin
  request itself; a forwarded viewer `Authorization` header would collide with SigV4.

A function-generated `401` is returned directly to the viewer and is *not* passed through
the custom error responses in §2 — those apply to origin responses. Since only `403` and
`404` are mapped, there is no interaction between the gate and the fallback.

**What this is not.** This is a single shared password, base64-encoded in the function
source, visible to anyone with CloudFront read access in the account. It is a gate against
casual discovery, crawlers, and link-sharing — not access control. It offers no per-person
identity, no revocation short of rotating the shared secret, and no audit trail. Recorded
as follow-ups: an AWS WAF IP allowlist (~$6/month, if USC provides a stable range) which
can layer on top, or Cognito via Lambda@Edge if real identity is ever needed.

**Where the secret lives.** A `NoEcho` CloudFormation parameter, `BasicAuthCredential`,
carrying the base64 of `panther:<password>`. The username is fixed at `panther`; a
per-person username would imply per-person credentials, which this gate does not provide,
so varying it would only suggest a guarantee that is not there. The parameter is
substituted into the function source with `Fn::Sub` at stack-update time, so it is never
committed. `aws cloudformation deploy` sends `UsePreviousValue` for parameters it is not
given, so later infrastructure changes do not require re-supplying it.

The password is **not** written to `.env.deploy` and not recoverable afterwards. `NoEcho`
hides it from stack output, and `deploy.sh` never needs it — publishing is an S3 and
CloudFront operation, and only a browser viewer ever presents the credential. `bootstrap.sh`
prints it once, for the operator to keep wherever they keep passwords. Losing it is not a
lockout: re-running `bootstrap.sh` with a new password rotates the gate in place, which is
also the documented rotation procedure.

Because `Fn::Sub` claims `${...}`, the inlined function source must not use JavaScript
template literals — string concatenation only. This is the reason the function is inlined in
the YAML rather than kept as a separate lintable `.js` file: one substitution in one place,
verified by an actual HTTP check after deploy (§6) rather than by a unit test that could
only assert the code matches itself.

### 4. The deploy flow

`deploy/deploy.sh`, wired to `npm run deploy`, in four steps:

```bash
npm run build

# Pass 1 — hashed, immutable assets. Filenames carry a content hash, so a year is safe.
aws s3 sync dist/ "s3://$BUCKET/" --delete \
    --exclude 'index.html' --exclude 'favicon.ico' --exclude 'stats-treemap.html' \
    --cache-control 'public,max-age=31536000,immutable'

# Pass 2 — the entry point, which must never be served stale.
aws s3 cp dist/index.html "s3://$BUCKET/index.html" \
    --cache-control 'no-cache,must-revalidate' \
    --content-type 'text/html; charset=utf-8'

# Pass 3 — the favicon is unhashed too, so it gets a day rather than a year.
aws s3 cp dist/favicon.ico "s3://$BUCKET/favicon.ico" \
    --cache-control 'public,max-age=86400'

aws cloudfront create-invalidation --distribution-id "$DIST_ID" \
    --paths '/' '/index.html' '/favicon.ico'
```

The three passes exist because a single `Cache-Control` cannot be right for all of them.
Hashed assets should be cached as long as possible; `index.html` and `favicon.ico` are the
files whose *names* never change while their contents can, so a long TTL would make a deploy
invisible until the edge expired it. `index.html` must never be stale at all; the favicon can
tolerate a day.

`--exclude` in an `aws s3 sync --delete` also excludes the file from deletion, so pass 1
does not remove the `index.html` that pass 2 replaces.

`stats-treemap.html` is `rollup-plugin-visualizer` output that Vite writes into `dist/`. It
is excluded because it is a build-internals report, not part of the app.

Only three invalidation paths are needed — everything else is content-hashed — which stays
far inside the 1,000-paths-per-month free allowance.

### 5. Files

| File                       | Purpose                                                                 |
| -------------------------- | ----------------------------------------------------------------------- |
| `deploy/infrastructure.yaml` | The CloudFormation stack of §1–§3.                                    |
| `deploy/bootstrap.sh`      | One-time and idempotent `aws cloudformation deploy`. Generates a password if none is supplied, prints it once (§3), writes the resolved stack outputs to `.env.deploy`, then prints the distribution URL. |
| `deploy/deploy.sh`         | §4. Reads `.env.deploy`, refuses to run if the stack outputs are missing. |
| `deploy/README.md`         | First-time setup, routine publishing, rotating the password, tearing the stack down. |
| `.env.deploy.example`      | Documents the five config values `bootstrap.sh` resolves into `.env.deploy`: `STACK_NAME`, `AWS_REGION`, `BUCKET`, `DIST_ID`, `SITE_URL`. `AWS_PROFILE` is a sixth, optional, hand-added line read only by `deploy.sh`. Config only — no secret (§3). |

Modified: `package.json` gains `deploy` and `deploy:infra` scripts; `.gitignore` gains
`.env.deploy`.

No file under `src/` changes. That is the point of the design — the app is already static,
so hosting is additive.

## Documentation

`deploy/README.md` is the operational document. `README.md` gains a short "Deploying" section
pointing at it. The workspace-level `CLAUDE.md` seam description is unaffected: this changes
nothing about `build_state.json` or the contract, only where the compiled consumer is served
from.

## Testing

The deploy path is shell and declarative YAML against a live AWS account, so it is verified
by observing the deployed artifact rather than by unit tests. `npm test`, `npm run
type-check`, and `npm run lint` must remain untouched by this work — if any of them changes
behavior, something has been added to `src/` that should not have been.

What can be checked without touching AWS is checked before it runs:

- Both scripts open with `set -euo pipefail`, so a missing variable or a failed upload stops
  the deploy instead of continuing to the invalidation and reporting success.
- `deploy.sh` validates that `BUCKET` and `DIST_ID` are set and non-empty before it builds,
  so a misconfigured `.env.deploy` fails in a second rather than after a four-second build.
- `aws cloudformation validate-template` runs against `infrastructure.yaml` in
  `bootstrap.sh` before the stack operation — it catches malformed YAML and bad intrinsic
  functions without waiting on a distribution rollout.
- `shellcheck` is run on both scripts during development if available; it is not made a
  hard dependency of deploying.

## Risks

| Risk | Mitigation |
| ---- | ---------- |
| Shared password is weak protection, and is readable by anyone with account access. | Stated plainly in §3 and in `deploy/README.md`. Follow-ups recorded. Not a surprise, a chosen trade-off. |
| `--delete` prunes chunks a viewer's open session may still request, breaking a lazily loaded report panel mid-session. | `index.html` is `no-cache`, so a reload recovers immediately. The window is one deploy against one live session; accepted rather than solved by hoarding old assets forever. |
| Distribution create/update takes 5–15 minutes; an operator may think it hung. | `bootstrap.sh` says so before it waits. |
| The installed AWS CLI is 2.1.17 (January 2021). | Every command used — `s3 sync`, `s3 cp`, `cloudfront create-invalidation`, `cloudformation deploy` — long predates it, and the template is interpreted server-side, so CFN features are unaffected by CLI age. `bootstrap.sh` warns and recommends an upgrade rather than requiring one. |
| A stack cannot be deleted while its bucket holds objects. | `deploy/README.md` documents `aws s3 rm --recursive` first. |
| The published bundle embeds whatever `docs/build_state.json` held at build time, including absolute `/scratch2/...` paths. | This is the reason access is gated at all. Noted in `deploy/README.md` as a pre-deploy check. |

## Verification

Run after `bootstrap.sh` and the first `npm run deploy`, against the printed distribution
domain. Each check is here because it can fail independently:

1. `npm run build` exits 0 and writes `dist/index.html`.
2. Stack reaches `CREATE_COMPLETE`; outputs include a bucket name and distribution id.
3. `curl -sI https://$DOMAIN/` → `401`, with a `WWW-Authenticate: Basic` header present.
4. `curl -sI -u user:pass https://$DOMAIN/` → `200`, `content-type: text/html`.
5. `curl -sI -u user:pass https://$DOMAIN/release` → **`200`**, not `404`. This is the SPA
   fallback, and the one check that proves the `403`-vs-`404` detail in §2 was handled.
6. An asset URL returns `cache-control: public,max-age=31536000,immutable`; `/` returns
   `cache-control: no-cache,must-revalidate`.
7. `curl -sI https://$BUCKET.s3.us-east-1.amazonaws.com/index.html` → `403`, proving the
   bucket is not independently readable.
8. In a browser: `/` renders the record, `/release` renders the release view, a hash deep
   link scrolls to its anchor, and a lazily loaded report panel opens.
9. Touch a source file, re-run `npm run deploy`, reload once: the new asset hash is served.

## Follow-ups

Deliberately deferred, in the order they would become worth doing:

- **Custom domain** — ACM certificate in `us-east-1`, distribution aliases, DNS record.
  Additive to this stack.
- **WAF IP allowlist** — layered with, not replacing, the password gate.
- **Runtime fetch of `build_state.json`** — would let a new report be published by uploading
  one file instead of rebuilding the bundle. Contradicts the current deliberate design of
  `fixtures/source.ts` and belongs to the model layer, not to hosting.
- **Multiple build records** — several reports behind one distribution requires the runtime
  fetch above plus a selector in the app.
