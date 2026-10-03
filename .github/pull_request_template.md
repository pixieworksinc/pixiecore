## Change

Describe the problem, intended behavior, non-goals, and affected public surface.

## Compatibility and ownership

- [ ] Compatibility class and all required package, Blueprint, dataset, schema,
      or plugin version changes are identified.
- [ ] Blueprint catalog owner, CODEOWNERS reviewer, and maintainer authority are
      not being treated as interchangeable.
- [ ] Ownership transfer, conflict, recusal, or single-maintainer self-review is
      recorded when applicable.

## Evidence

- [ ] Tests cover the changed behavior and relevant failures.
- [ ] Fixtures are authorized, redistributable, and contain no secrets or
      unauthorized production data.
- [ ] Documentation, schema, example, changelog, and package inventory changes
      are synchronized where applicable.
- [ ] Security, privacy, retention, cancellation, lifecycle, side effects, and
      rollback were reviewed or are explicitly unchanged.
- [ ] Required local and CI gates pass; any failure includes its `TEST_SEED`.

## Change-specific review

- [ ] Blueprint changes satisfy the one-operation, schema, dataset, semantic
      evidence, version-transition, and catalog-owner checklist.
- [ ] Plugin changes satisfy trusted-code, dependency, permission, lifecycle,
      offline-test, integrity, provenance, and rollback review.
- [ ] POP specification changes include the required RFC, compatibility,
      conformance, security, participants, recusal, quorum, and vote evidence.
- [ ] Third-party Blueprint packages satisfy the data-only, namespace, license,
      provenance, signature, lifecycle, quality-evidence, and publisher-contact
      checklist in `docs/blueprints/blueprint-publishing.md`.
- [ ] Items above that do not apply are explained in the change description.

See [`docs/project/review-policy.md`](../docs/project/review-policy.md) for the authoritative
criteria.
