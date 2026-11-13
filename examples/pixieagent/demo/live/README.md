# Restricted PixieAgent live trial

A separate, access-restricted trial of the existing six synthetic PoC cases. It calls `gpt-6-luna` at the OpenAI Chat Completions endpoint through the unchanged PixieAgent/PixieCore harness. The static replay remains available separately.

## Limits

- Shared USD 1 ceiling across all six once-only cases, 30 requests total, at most five per case, 512 completion tokens, 16 KiB requests, no retries, 30-second requests and 90-second cases. Activation expires after the approved window.
- Durable reservations use the existing PoC's conservative context-wide ceiling and token rates; validated usage releases the unused reservation. This is application accounting, not independently verified billing or an account-wide limit.
- Claims are saved before work; reservations before communication. Crashes, missing/invalid usage, request/response errors or failed result checks stop the trial. No automatic restart, reset, refill, replay or diagnostic call.
- Access code stays in browser memory. The provider key is read only on the server. No arbitrary input, tools, MCP, CORS or raw provider errors. Same-origin POST and bearer authentication are required.
- Completed results are stored for authenticated viewing. Mechanical classification/path validation is distinct from semantic review of the reason. Human acceptance remains separate.

## Components and checks

`server.mjs` is dependency-injected for offline HTTP tests. `ledger.mjs` persists the shared accounting and case claims. `start.mjs` connects the pinned runtime, bounded transport and credential reader only when a reviewed activation configuration enables it. `public/` contains the access-code screen and live interaction. Only public assets are exposed as static files.

Run `node --test examples/pixieagent/demo/live/*.test.mjs` on Node 24 or later. Tests never invoke a provider. Before activation additionally verify the packaged unchanged PoC runtime with all six original fixture cases, under the actual deployment Node version.

Use a separately reviewed runtime package, read-only mounts, private secret files, persistent state, a single process with an exclusive lock, and a loopback-only published service behind HTTPS. `TRIAL_CONFIG` supplies the administrator-controlled configuration. Verify runtime hashes and prepare rollback before activation. Authentication details, exact operational configuration, activation approvals and recovery locations belong in administrator-controlled storage outside GitHub. The key must never be copied into public assets or the repository.

The user must approve the concrete provider/model, endpoint, request/token/time limits, shared budget, authentication arrangement and expiration before live activation. General accuracy and production readiness are outside this scope.

See the [deployment guide](../README.md) for portable configuration and containers.
