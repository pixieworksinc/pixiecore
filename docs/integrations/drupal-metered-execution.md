# Drupal demo: metered real-provider boundary (draft)

This is the design record for [Issue #6](https://github.com/pixieworksinc/pixiecore/issues/6).
It does not enable paid execution. The clean-install demo in
[Issue #4](https://github.com/pixieworksinc/pixiecore/issues/4) remains MOCK-only.

## Why a separate boundary is necessary

The stock `pixiecore serve` response reports provider, model, and duration, but
does not provide a durable budget reservation, provider call count, token usage,
or estimated cost. The Drupal demo must not send a paid request and only then
discover that the response lacks evidence it promised to save. It also must
not treat missing usage as zero.

## Proposed two-step protocol

1. Drupal makes an authenticated `GET /demo-capabilities` request to the same
   trusted endpoint immediately before each paid Execute. The response must
   identify a versioned `pixiecore.drupal-metered-execution/v1` contract, the
   configured provider/model, complete usage reporting, and server-enforced
   durable call and USD budgets. The stock API lacks this route and fails
   closed without any provider call. Drupal must not follow redirects.
2. After verifying those exact capabilities against its trusted deployment
   settings, Drupal sends the saved Blueprint and synthetic inputs to
   `POST /execute` once. The response returns the usual validated `data` plus
   metadata containing the contract ID, provider, model, provider call count,
   input/output token counts, pricing source and effective date, estimated USD
   cost, and an opaque budget record ID. Drupal rejects missing, negative, or
   nonfinite accounting values and retains its own sanitized execution record.

The capability response is not a budget guarantee. The runtime must reserve
the configured worst-case call/cost before contacting OpenAI, atomically and
durably across concurrent requests. It finalizes the reservation using observed
usage when available. Failed, interrupted, or unmetered calls retain their
worst-case reservation. One owner controls retries; the demo's first version
has no automatic retry. A server restart must not reset the budget ledger.

The initial [capability](../../examples/integrations/drupal/real-provider/contracts/capabilities-v1.schema.json)
and [execution](../../examples/integrations/drupal/real-provider/contracts/execute-v1.schema.json)
schemas, with [synthetic fixtures](../../examples/integrations/drupal/real-provider/contracts/fixtures/),
pin the wire shape. They do not themselves implement preflight, a provider,
or a budget ledger. The caller must additionally compare provider and model to
trusted settings and verify the returned cost is within the configured cap.

## Configuration and trust

- Model, endpoint, pricing, call/amount caps, output-token cap, timeout, and
  credential are deployment settings, not Blueprint fields or source literals.
- The OpenAI key stays only in the runtime container. Drupal sends only a
  separate backend Bearer credential. Neither key is exported to config,
  a browser, a Blueprint, a log, or a persisted execution record.
- The endpoint is non-public or protected by TLS and authentication. An HTTP
  exception for an isolated private network requires an explicit reviewed
  deployment setting; numeric host aliases and public addresses never qualify.
- Authentication context injected by the runtime is separate from the strict
  business input schema. The runtime and Drupal tests must exercise this with
  a real caller identity, not merely schema acceptance.
- No live call or hosted deployment is authorized by this document. A paid
  run requires separate approval of exact model, fixtures, maximum calls,
  USD cap, and retry policy.

## Implementation order and acceptance

1. Freeze machine-readable capability and response fixtures, including
   negative cases for the stock API, partial usage, mismatched model, and
   unsupported contract version.
2. Implement the persistent reservation ledger and an authenticated runtime
   adapter. Prove atomic concurrent admission, restart persistence, and
   failure/timeout charging with offline provider doubles.
3. Add Drupal preflight and evidence validation, then offline HTTP tests that
   prove an unsupported backend is rejected before `POST /execute`.
4. Verify a fresh Drupal install with the separately operated runtime. Record
   the exact image/package versions and keep the result explicitly unverified
   for business-rule accuracy until a separately approved evaluation runs.

The PR implementing this Issue stays draft until all four steps pass. Merge,
deployment, and provider spending remain separate approvals.
