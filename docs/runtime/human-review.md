# Human-review handoff contracts

PixieCore can hand a structured model result to an application-owned review
workflow without starting a UI, database, notification, or external-system
update. Import the contract helpers from `@pixieworks/pixiecore/review`.

```ts
import {
  createReviewHandoff,
  createReviewReceipt,
  verifyReviewReceipt,
} from '@pixieworks/pixiecore/review';

const handoff = createReviewHandoff({
  reviewId: 'invoice-482-review-1',
  traceId: 'trace-52f9',
  createdAt: new Date().toISOString(),
  blueprint: { name: 'invoice extractor', version: '1.0', role: 'extractor' },
  output: { invoice_number: 'INV-482', total: 12500 },
  issues: [{
    code: 'low_confidence_total',
    message: 'Confirm the total against the source document.',
    severity: 'warning',
    path: '/total',
  }],
});

// The application displays and persists the handoff, authenticates the
// reviewer, and records its own authorization evidence.
const receipt = createReviewReceipt(handoff, {
  decision: 'approved',
  reviewerId: 'user-739',
  decidedAt: new Date().toISOString(),
  reviewedOutput: { invoice_number: 'INV-482', total: 12500 },
});

if (!verifyReviewReceipt(handoff, receipt)) {
  throw new Error('Receipt does not refer to this exact handoff');
}
```

## Published artifacts

The package publishes the following versioned JSON Schemas:

- `@pixieworks/pixiecore/review/handoff-schema.json`
- `@pixieworks/pixiecore/review/receipt-schema.json`

`createReviewHandoff()` and `createReviewReceipt()` reject blank identifiers,
non-canonical timestamps, malformed issue paths, and non-JSON values. They
clone and freeze caller-owned values so later application mutation cannot
silently change the created artifact.

Timestamps use canonical UTC ISO 8601 form, such as
`2026-02-04T09:30:00.000Z`. Issue paths use RFC 6901 JSON Pointer syntax.

## Integrity and trust boundary

Every receipt contains a deterministic SHA-256 digest of the complete handoff.
`verifyReviewReceipt()` checks that digest together with `review_id` and
`trace_id`, detecting a changed handoff or a receipt linked to another review.
Canonical hashing makes object-property order irrelevant.

The digest is an integrity link, not a digital signature and not proof of the
reviewer's identity or authority. The host application remains responsible
for authentication, authorization, durable append-only storage, signatures
when required, retention, notification, UI, and external side effects.
PixieCore does not automatically approve an output or write an approved result
to another system.

## Decisions and corrected output

Receipts support `approved`, `rejected`, and `changes_requested`. The optional
`reviewed_output` records a human-corrected structured result without changing
the original handoff. Applications should use the receipt decision and their
own policy to decide whether that output may proceed.
