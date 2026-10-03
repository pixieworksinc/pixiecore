# Explicit provider fallback

`@pixieworks/pixiecore/fallback` executes an ordered provider/model plan only when an
explicit policy permits it. It does not modify `PromptRuntime` provider
selection and never silently changes a model.

## Outage boundary

The policy contains a non-empty list of `fallback_error_codes`. A failed target
advances to the next target only when its normalized error code is on that
list. Validation errors, authorization failures, application limits, and other
unlisted failures propagate immediately. `AbortError` and an aborted parent
signal always propagate and never trigger fallback.

Applications should keep the outage list narrow, based on their provider
adapter error taxonomy. A broad value such as `Error` defeats this boundary and
is not recommended.

## Quality boundary

Every target declares a quality score from 0 to 1 together with the dataset ID,
dataset version, and canonical UTC measurement time that support it. Before any
provider call, PixieCore rejects a plan when a target:

- falls below `minimum_quality_score`; or
- drops farther from the primary score than `maximum_quality_drop`.

Set `maximum_quality_drop` to zero to prohibit degradation. A non-zero value is
an explicit acceptance of a bounded, measured downgrade; it is not permission
to substitute an untested model. PixieCore validates the supplied evidence
metadata but cannot prove that a benchmark was honestly or recently executed.

## Receipt

Success returns the application value and a frozen
`pixiecore.provider-fallback-receipt/v1`. Exhaustion throws
`ProviderFallbackExhaustedError` with the same receipt. The receipt contains
only policy identity, selected target, measured quality drop, and value-free
attempt records. It excludes prompts, inputs, outputs, exception messages,
credentials, and provider response bodies. Its schema is published as
`@pixieworks/pixiecore/fallback/receipt-schema.json`.

The caller owns Provider and `PromptRuntime` creation and cleanup. It also owns
rate limits, budgets, telemetry persistence, user disclosure, and any decision
to retry the complete fallback plan.

```ts
import { executeWithProviderFallback } from '@pixieworks/pixiecore/fallback';

const result = await executeWithProviderFallback({
  targets: [primaryTarget, secondaryTarget],
  policy: {
    policy_id: 'travel-classification',
    policy_version: '1.0.0',
    fallback_error_codes: ['llm_api_error'],
    minimum_quality_score: 0.95,
    maximum_quality_drop: 0.02,
  },
  signal,
}, ({ target, signal: targetSignal }) => executeTarget(target, targetSignal));
```
