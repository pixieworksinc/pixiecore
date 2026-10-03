# POP-RFC-0001: Instruction text delivery

- Status: draft
- Authors: naoi
- Change class: compatible normative
- Created: 2026-08-25
- Proposed review start: not started
- Decision date: not decided
- Discussion: not opened
- Affected artifacts: proposed POP Core 0.2 optional capability and conformance suite; POP Core 0.1 and its schemas and suite remain unchanged
- Conflicts and recusals: none disclosed
- Supersedes: none
- Superseded by: none

This draft has no normative effect. The capitalized requirements below describe
the contract that would apply only if this RFC is accepted and published in a
new POP minor line.

## Summary

Define an optional `pop.runtime.instruction-text-preservation` capability for
runtimes that preserve decoded instruction text while resolving declared
inputs. Add a language-neutral black-box fixture that observes effective
instructions, Role, and cognitive-execution count without prescribing provider
messages or a runtime-specific placeholder dialect.

## Motivation and scope

Artifact-schema validation proves that two runtimes accept the same abstract
Blueprint. It does not prove that they deliver the same instructions. A runtime
can trim text, collapse blank lines, alter indentation, reorder lines, silently
substitute a Role, or split one Blueprint into multiple cognitive requests and
still pass the POP Core 0.1 structural cases.

This proposal covers the boundary after a serialization adapter has decoded a
Blueprint into the POP abstract data model and before the selected cognitive
mechanism executes. It includes declared input resolution, effective Role, and
the number of cognitive executions started for one Blueprint invocation.

It does not:

- require Gherkin or assign semantics to `Given`, `When`, or `Then`;
- standardize a placeholder spelling in YAML, JSON, or a host runtime;
- require a provider-specific `system` or `user` message layout;
- prohibit explicit, declared localization or custom Role behavior;
- define output quality, model determinism, retries, or Tool rounds; or
- change POP Core 0.1 or its existing conformance results.

## Specification

The proposed capability identifier is
`pop.runtime.instruction-text-preservation`.

A runtime claiming this capability MUST expose a conformance adapter that
accepts:

1. one valid abstract Blueprint;
2. normalized business inputs;
3. adapter-declared input-binding metadata; and
4. a capture cognitive executor that performs no remote call.

The adapter-declared binding metadata identifies the input references in the
runtime's native serialization. This metadata is test-harness input, not a new
portable Blueprint placeholder syntax.

For one captured invocation, the adapter MUST return:

- the effective instruction string presented to the Role boundary;
- the effective Role identifier; and
- the number of cognitive executions started.

The effective instruction string MUST equal the serialization-decoded
instruction string after only the declared input-reference spans have been
replaced with their resolved values. Every other Unicode scalar value, line
break, blank line, indentation character, repeated space, and line order MUST
remain unchanged.

A missing required input MUST fail before cognitive execution. A runtime MUST
NOT report this capability if an undeclared normalization changes the effective
instruction string. The runtime MUST report an unsupported Role and MUST NOT
silently substitute another Role, as already required by POP Core 0.1.

The capture executor MUST record one cognitive execution for one successful
atomic Blueprint invocation. Output-correction retries and Tool rounds remain
separate metadata and are outside the fixture's initial success path.

Custom Role behavior is allowed only when the Role is explicitly named by the
Blueprint. A conformance report MUST identify that Role. The generic
preservation fixture uses a Role whose adapter contract forwards the effective
instruction string without transforming it.

### Proposed black-box fixture

The future conformance-suite schema would encode the following logical case.
The illustrative JSON is not an accepted schema or fixture identifier:

```json
{
  "id": "runtime.instruction-text-preservation",
  "capability": "pop.runtime.instruction-text-preservation",
  "decoded_instructions": "Feature: Preserve text\n\n    Scenario: Keep indentation\n      Given first  value\n\n\n      When resolving <binding:value>\n      Then keep trailing spaces  ",
  "normalized_inputs": {
    "value": "fixture-value"
  },
  "bindings": [
    {
      "token": "<binding:value>",
      "input": "value"
    }
  ],
  "expected": {
    "effective_instructions": "Feature: Preserve text\n\n    Scenario: Keep indentation\n      Given first  value\n\n\n      When resolving fixture-value\n      Then keep trailing spaces  ",
    "role": "example.capture_role",
    "cognitive_execution_count": 1
  }
}
```

Before publication, the placeholder-like `token` above MUST be represented as
an explicit string span or another dialect-neutral binding structure in the
suite schema. It MUST NOT become a required authoring syntax. Each runtime
adapter maps that abstract binding to its native artifact and reports the
mapping used.

Negative cases MUST detect trimming, blank-line collapse, reindentation,
line-order changes, substitution outside declared spans, silent Role fallback,
and more than one cognitive execution on the success path.

## Compatibility and migration

This is proposed as a compatible normative change because the capability is
optional and would be published only in a new POP minor line. Existing POP Core
0.1 artifacts, profiles, suite results, and claims remain valid and unchanged.

A runtime would migrate by adding the capture adapter, reporting the capability
only after its fixture passes, and documenting any explicit custom Role
transformation. Removing the capability restores the prior claim surface and is
the rollback path. No existing POP identifier would be overwritten.

## Security, privacy, cost, and interoperability

The fixture uses synthetic local values and a no-network capture executor, so
it adds no provider cost. Conformance reports MUST NOT include production
instructions, credentials, or business inputs. Implementations SHOULD expose
only fixture-derived instruction text in portable reports.

Exact delivery improves interoperability by making silent normalization and
Role substitution observable. It can also preserve malicious whitespace or
instruction content, but this proposal does not bypass admission, trust,
authorization, or content policy. Those checks occur before the captured
cognitive boundary and must remain explicit.

## Conformance and independent evidence

Current evidence is intentionally insufficient for acceptance:

- PixieCore has focused rendering and built-in Role runtime tests for the
  proposed behavior.
- No accepted language-neutral fixture schema exists yet.
- No independent runtime adapter result has been recorded against the same
  dialect-neutral fixture.
- The required negative cases have not been published in a versioned suite.

Before this RFC can move beyond `draft`, the proposal needs a concrete suite
schema, exact future artifact identifiers, a PixieCore adapter result, and at
least one independent implementation result.

## Alternatives

1. Require byte-for-byte preservation of source YAML or JSON. Rejected because
   serialization decoding legitimately changes source bytes while preserving
   the abstract string.
2. Standardize `{name}` or another placeholder spelling in this RFC. Rejected
   because delivery preservation and binding syntax need separate review. A
   portable `{{ name }}` binding is proposed separately in POP-RFC-0002.
3. Compare provider-native message arrays. Rejected because valid runtimes can
   use local code, humans, or different provider protocols.
4. Leave this to implementation regression tests. Rejected as a portable goal
   because independent runtimes could continue claiming the same profile while
   delivering materially different instructions.

## Review record

- 2026-08-25: initial draft; public discussion and review have not started.

## Final call

- Eligible maintainers: not determined
- Recused maintainers: none disclosed
- Votes: none
- Quorum result: not evaluated
- Approval result: not decided
- Unresolved objections: dialect-neutral binding representation and independent evidence remain open
