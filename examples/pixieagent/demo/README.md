# Reproducible PixieAgent browser demos

The default site replays six saved **fixture** results. The optional live site
uses the same bounded PixieAgent/PixieCore harness with a provider. Both retain
the original six-card layout, three execution steps and result panel. Replay
animation is illustrative; live steps become complete only after a response.

These are checkout-based examples, not an npm release or a production service.
The source and fixtures use the repository's Apache-2.0 license. Keep the root
license and third-party notices with redistributed runtime images.

## Default: replay only

Requirements: Docker with Compose v2. Run from the repository root:

```sh
docker compose -f examples/pixieagent/demo/compose.yaml up --build -d
```

Open `http://localhost:8080/pixieagent/`. Select a card, click the replay button,
and inspect the category, severity, reason and JSON. No key, live service,
model request or paid operation is involved. The `/pixieagent/live/` route is
disabled in this configuration. The port is bound to loopback.

```sh
docker compose -f examples/pixieagent/demo/compose.yaml down
```

The Dockerfile has `web` and `live` targets. `web` is the default target and
contains static assets only. `live` builds PixieCore and the four existing
harness modules using official Node 24, the repository lockfile and a
multi-stage build. It runs as a non-root user with production dependencies.
No prebuilt maintainer image or privately assembled runtime bundle is required.
The build-specific ignore file excludes local state, secrets and metadata.
Record the resulting image ID/digest when reviewing a deployment; base-image
major tags and separate builds are not a promise of bit-for-bit reproduction.

## Optional: restricted live trial

This is an explicit opt-in. Merely building either image does not activate it.
The supplied [configuration template](config.example.json) is disabled and
expired. It is not an execution approval.

Before enabling a trial, review the existing model, endpoint and rate
assumptions in the harness with the operator. Agree on the concrete expiry,
shared USD 1 budget, maximum 30 requests, six once-only synthetic cases and
access-code distribution. This publication does not authorize provider calls.

1. Prepare an administrator-controlled directory **outside the checkout**.
   Copy the configuration template into it as `config.json`. Add separate
   files named `credential` (provider key) and `access-code` (a newly generated
   random value of at least 32 characters). Do not put their contents into
   commands, images, build arguments, Git, frontend assets or logs.
2. Keep the configuration's container paths, model, USD 1 ceiling and request
   cap as supplied. Set `origin` to the exact browser origin, without a path or
   trailing slash, and `expiresAt` to the explicitly approved future UTC time.
   Set `enabled` to `true` only after that review. The sample localhost origin
   is for local use; public deployments require HTTPS.
3. Make the directory and files readable by the container's Node user
   (UID 1000), with access restricted to that operator/container account.
   Linux bind mounts enforce the host's numeric ownership. Verify readability
   without printing file contents; do not fix it with world-readable modes.
4. Set `PIXIEAGENT_SECRETS_DIRECTORY` to the directory's absolute path and run:

```sh
docker compose -f examples/pixieagent/demo/compose.yaml \
  -f examples/pixieagent/demo/compose.live.yaml up --build -d
```

Open `http://localhost:8080/pixieagent/live/` for local use, or the same path on
the configured HTTPS origin. Enter the **access code**, not the provider key.
Connecting performs an authenticated status read only. Selecting a card does
not run it. Only the explicit execution button requests a paid run. Completed
results can be viewed again without another provider request.

The API has no host-published port. The web container proxies only the fixed
`/pixieagent/live/api/` prefix. Its existing interface is authenticated
`GET /status` and same-origin `POST /run` with `{ "caseId": "<bundled ID>" }`.
There is no free input, alternate model/endpoint, tool/MCP, or retry setting.

The service shares one persistent ledger across all users and cases. Limits
remain five requests per case, 512 output tokens, 16 KiB requests, 30-second
requests and 90-second cases. Unknown/invalid usage, exhausted budget, failed
execution or result checks, cancellation and expiry stop execution. Accounting
is based on pinned rates and reported usage, not verified billing or an
account-wide cap. Selecting a case does not guarantee it can complete within
the remaining budget. The browser does not store access codes persistently.

## HTTPS deployment, stop and state retention

Place the loopback-bound web service behind your existing HTTPS reverse proxy.
Forward `/pixieagent/` to `http://127.0.0.1:8080/pixieagent/`, preserving the path,
Authorization and Origin headers; allow at least 100 seconds for the live
response. Disable proxy retries and caching for the API. Keep all other site
routes as they are. Set `origin` to the public HTTPS origin and retain the
container's CSP, no-index and no-sniff headers. TLS certificates and host-vhost
configuration are deployment-specific and are not shipped with this example.

Before a deployment, preserve the reviewed image, configuration and persistent
volume together in administrator-controlled storage. Validate configuration,
check the public assets, unauthenticated rejection and authenticated **GET**
status. Those checks must not press the execution button or send `/run`.

To stop an activated trial:

```sh
docker compose -f examples/pixieagent/demo/compose.yaml \
  -f examples/pixieagent/demo/compose.live.yaml down
```

**Do not add `--volumes` to a real trial.** The `trial-state` volume retains the
ledger, completed results and exclusive process lock. Restarts are disabled;
the retained lock prevents automatic restart even after a clean stop. Inspect
that record before any separately reviewed recovery. Do not delete the lock,
change the deadline, replace the volume or recreate a fresh project name to
refill a budget or replay a consumed case. Rollback is to stop the live trial
and serve replay only; it is not permission to reset or rerun it. Protect and
retain saved results as operator data, outside the public repository.

## Offline verification

After the root README's Node 24 install and build:

```sh
sh examples/pixieagent/demo/test-offline.sh
```

This runs the existing 73 PoC tests, 3 replay tests, 12 live-control/UI tests,
and the six-case fixture scorecard. PoC tests deny network entry points; web
control tests use local sockets and injected fixtures. Standalone demo `.mjs`
files are checked by Node syntax validation and executable tests, separately
from the repository's TypeScript example check.

To verify the actual compiled image, with outbound networking disabled:

```sh
docker build -f examples/pixieagent/demo/Dockerfile --target live -t pixieagent-live-test .
docker run --rm --network none --read-only --tmpfs /tmp:size=32m,mode=1777 \
  --cap-drop ALL --security-opt no-new-privileges pixieagent-live-test \
  --import ./examples/pixieagent/tests/deny-network.mjs examples/pixieagent/demo/container-test.mjs
docker run --rm --network none --read-only --tmpfs /tmp:size=32m,mode=1777 \
  --cap-drop ALL --security-opt no-new-privileges pixieagent-live-test \
  --test examples/pixieagent/demo/container-http.test.mjs
```

The first check runs the existing six fixtures through the compiled harness.
The second starts the real entrypoint with a fixture provider and temporary
state, checks authentication and Origin rejection, executes the same six
cases over loopback, and checks replay rejection, retained accounting and
restart rejection. A disabled configuration must exit before credential reads.
CI additionally builds/serves the default web image, verifies that live routes
are disabled, and checks the optional proxy with a disabled API configuration.
No real key is supplied and no provider calls are made by these checks.
