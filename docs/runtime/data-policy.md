# Data retention policy boundary

PixieCore does not persist Blueprint inputs or outputs by default. The public
`@pixieworks/pixiecore/data-policy` boundary lets a host make an explicit, testable decision
before it writes a value to storage. The boundary performs redaction and emits
a storage-neutral record; it does not select or contact a database.
It implements the host-policy responsibility described by the
[POP Core security boundary](../specification/pop-core-specification-0.1.md#10-security-and-side-effects)
without adding a portable storage requirement.

## Trust boundary

Construct `DataPolicyBoundary` with a server-owned `tenantId` and a
`DataPolicyPort`. Callers cannot override the tenant per request. The policy
hook receives:

- tenant ID, stage, Blueprint ID and version, and classification;
- every available JSON Pointer path; and
- host-declared PII path/category pairs.

The hook does not receive input or output values. This prevents a remote policy
service from becoming an accidental second copy of the protected payload.
PixieCore validates that every declared PII and redaction path exists.

PII categories and classification labels are deliberately application-defined.
The host remains responsible for detecting and completely declaring PII;
PixieCore does not infer a legal classification from field names or values.

## Decisions

A policy returns one disposition:

- `retain`: requires a positive retention period and may list non-overlapping
  JSON Pointer paths to replace with `[REDACTED]`;
- `discard`: produces a record with no payload and no expiry; or
- `deny`: throws `DataPolicyDeniedError` and produces no record.

Every decision identifies the policy and version and supplies value-free reason
codes. Redaction paths that are missing, malformed, or parent/child overlaps
fail closed. There is no implicit retain decision. `createDiscardDataPolicy()`
is the safe explicit default.

## Retention record

`prepareRetention()` returns a frozen
`pixiecore.data-retention-record/v1` artifact containing:

- record, tenant, Blueprint, policy, classification, and stage identity;
- unique PII categories without original values;
- creation and expiry timestamps;
- disposition, redacted paths, and reason codes; and
- either the redacted JSON payload or `null`.

The schema is published as `@pixieworks/pixiecore/data-policy/record-schema.json`.
`readPayload()` checks the server-owned tenant before validating or returning
the payload, rejects a record at its exact expiry time, and clones/freezes the
returned JSON. A discarded record returns `null`.

## Example

```ts
import { DataPolicyBoundary } from '@pixieworks/pixiecore/data-policy';

const boundary = new DataPolicyBoundary({
  tenantId: authenticatedTenant.id,
  policy: {
    evaluate(request) {
      return {
        policy_id: 'example.customer-records',
        policy_version: '1.0.0',
        disposition: 'retain',
        redact_paths: ['/email'],
        retention_seconds: 86_400,
        reason_codes: ['support_followup'],
      };
    },
  },
});

const record = await boundary.prepareRetention({
  stage: 'input',
  blueprintId: 'example.inquiry_classifier',
  blueprintVersion: '1.0.0',
  classification: 'confidential',
  pii: [{ path: '/email', category: 'email_address' }],
  payload: { email: 'person@example.test', inquiry: 'Delivery status' },
});
```

Authentication, PII discovery, encryption, storage authorization, deletion
jobs, legal holds, audit export, and physical tenant partitioning remain host
responsibilities. The record is evidence of one policy decision, not proof that
those operational controls exist.
