# PixieCore Blueprints

A Blueprint declares prompt-first business behavior with inputs, instructions,
and a JSON Schema output contract. It can combine several reasoning Roles and
deterministic rules serving the declared result. See
[POP principles](../specification/pop-principles.md) for the `0.2.x` direction.

PixieCore validates and executes one Blueprint per
`execute(path, inputs, options)` or `executeYaml(source, inputs, options)` call.
Host code supplies runtime and integration mechanics. Business comparisons,
branching, calculations, and routing policy can remain inside the Blueprint.

Read [POP concepts](../specification/pop-concepts.md) for canonical terminology and the
[Blueprint granularity guide](../architecture/blueprint-granularity.md) before designing a
multi-step application.

Packaged reference units place one Blueprint beside its policy README,
fixtures, versioned evaluation dataset, expected semantic results, and offline
contract test. The
[travel document field Extractor](../../examples/blueprints/extractor/travel-document-fields/README.md)
demonstrates real PDF and screenshot attachments with page-level evidence, the
[travel destination Classifier](../../examples/blueprints/classifier/travel-destination-level/README.md)
demonstrates caller-supplied policy classification without geographic guessing,
[travel request Summarizer](../../examples/blueprints/summarizer/travel-request-summary/README.md)
demonstrates bounded factual summaries with field-level traceability, the
[travel request form Validator](../../examples/blueprints/validator/travel-request-form/README.md)
demonstrates field-level rule evaluation without input repair, the
[travel document evidence Verifier](../../examples/blueprints/verifier/travel-document-evidence/README.md)
demonstrates evidence-preserving comparison without extraction or approval,
and
the [date-normalizer Converter](../../examples/blueprints/converter/date-normalizer/README.md)
demonstrates deterministic text conversion, the
[travel purpose Translator / Localizer](../../examples/blueprints/translator/travel-purpose-localizer/README.md)
demonstrates exact protected-term preservation across locales, and the
[travel approval Router / Orchestrator](../../examples/blueprints/router/travel-approval-routing/README.md)
demonstrates side-effect-free CSV priority routing. Stable IDs, directory
layout, naming, SemVer, ownership, and deprecation follow the
[reference Blueprint library contract](blueprint-library.md).

## Create a unit

Generate the complete Blueprint, README, evaluation dataset, and offline
contract-test skeleton together:

```bash
npx --package @pixieworks/pixiecore pixiecore blueprint create ./blueprints/date-normalizer \
  --operation=converter \
  --name='Date normalizer'
```

`--operation` is one of `extractor`, `classifier`, `summarizer`, `validator`,
`verifier`, `converter`, `translator`, or `router`. The destination basename
must be lowercase kebab-case. Creation fails if the destination already exists;
PixieCore never overwrites or merges an existing unit.

The generated test imports only `@pixieworks/pixiecore`, uses one pseudo-random seed per test
run, prints that seed as test diagnostics, and accepts `TEST_SEED` for exact
replay. Replace the placeholder prompt, schemas, case, and README policy before
publishing the unit.

Use the same command family from creation through semantic evaluation:

```bash
npx --package @pixieworks/pixiecore pixiecore blueprint validate ./blueprints/date-normalizer/date-normalizer.yaml
npx --package @pixieworks/pixiecore pixiecore blueprint test ./blueprints/date-normalizer
npx --package @pixieworks/pixiecore pixiecore blueprint eval ./blueprints/date-normalizer/evaluations/date-normalizer.yaml
npx --package @pixieworks/pixiecore pixiecore blueprint inspect ./blueprints/date-normalizer/date-normalizer.yaml
npx --package @pixieworks/pixiecore pixiecore blueprint play \
  ./blueprints/date-normalizer/evaluations/date-normalizer.yaml \
  --case=canonical-example
```

`validate` checks one Blueprint contract. `test` checks the complete unit
layout, dataset schema/path/version, and public test import without executing
arbitrary test code. `eval` performs semantic cases through the configured
runtime and emits a replayable artifact. `inspect` returns stable JSON metadata
without printing the prompt or fixture values. `validate`, `test`, `inspect`,
and the default mock `play` mode are offline.

`play` runs one named dataset case as a local playground. Its default `mock`
mode uses that case's `inputs` and `expected_output` through the real runtime
pipeline while disabling MCP and custom plugin discovery, so it is deterministic
and offline. `--mode=real` uses the configured provider and compares its output
with the case policy; `--mode=both` returns the mock baseline and real result in
one artifact. Real modes are opt-in and may incur provider cost.

<!-- pixiecore-sync source="examples/hello.yaml" -->
```yaml
name: Hello
version: '1.0.1'
role: assistant
input_placeholders:
  - name: name
    type: string
    required: true
prompt: |
  Greet {{ name }} warmly. Return only JSON matching the output schema.
output_schema: |
  {"type":"object","properties":{"greeting":{"type":"string"}},"required":["greeting"],"additionalProperties":false}
```

## Fields

Required fields are non-empty `name`, `version`, `role`, `prompt`, and
`output_schema`. Versions accept `major.minor` or `major.minor.patch` numeric
forms. `output_schema` may be an object or a JSON string.

Repository CI treats standalone syntax and version transitions as separate
checks. A changed Blueprint must advance its version. Changes to `role`, input
placeholders, input or output schemas, tools, or permissions require a
Blueprint major bump. Moving the file changes its stable repository identity
and also requires a major bump. YAML comments and formatting alone do not.
Physical removal is accepted only together with a PixieCore package major bump.
Run the same policy locally against a known base commit with:

```bash
npm run check:blueprint-versions -- --base <git-sha>
```

Optional fields are:

- `input_placeholders`: legacy names or typed declarations.
- `input_schema`: an object or JSON string containing the JSON Schema applied
  to normalized business inputs before provider execution.
- `examples`: input/output objects inserted before history and the live prompt.
- `localization`: string settings such as language, currency, timezone, and
  date format; values can contain input placeholders.
- `permissions`: role, user, and scope allow/deny rules.
- `model` and `temperature`: request-level provider overrides.
- `tools`: names of registered tools available to this Blueprint.

These fields define a business contract. Several Roles may work together
inside its instructions. External capabilities and side effects must be explicit;
reasoning about an approval or route does not itself persist or notify anything.

Plain Gherkin is the recommended authoring form for `prompt`, using
`Feature`, `Scenario`, `Given`, `When`, and `Then`. This makes a Blueprint's
preconditions, business behavior, and expected result easy to review without
changing the runtime data type.

```yaml
prompt: |
  Feature: Normalize an explicit date
    Scenario: Convert one supported date
      Given the caller supplies {{ date_text }}
      When explicit-date normalization is requested
      Then the result contains the corresponding yyyy-mm-dd calendar date
```

This is a recommendation, not a compatibility requirement. Text `prompt` values
remain valid, and PixieCore does not invoke a Gherkin parser for text. When a prompt starts using `Feature`
or `Scenario`, the validator emits only a soft warning if the recommended five
keywords are incomplete. A warning never blocks loading or execution.

### Structured Scenario prompts

The `0.2.x` branch also accepts a structured `prompt` with an optional
`agent_role` and a non-empty `Scenario` array:

```yaml
prompt:
  agent_role: orchestrator
  Scenario:
    - Role: classifier
      Instruction:
        Given: The customer tier is {{ customer_tier }} and the amount is {{ purchase_amount }}.
        When: Evaluate exact Gold membership and whether the amount is greater than 1000.
        Then: Choose a 0.15 discount only when both conditions are true; otherwise choose 0.
    - Role: converter
      Instruction:
        Given: The discount has been selected.
        When: Calculate the final purchase price.
        Then: Multiply the original purchase_amount by (1 - discount).
        And: Return the result without rounding.
```

Each step requires a non-blank `Role` and an `Instruction` object containing
non-blank `Given`, `When`, and `Then` strings. Optional `And` accepts a string
or a non-empty array of non-blank strings. Unknown fields in this structure
are rejected so instruction typos do not silently disappear.

Validation serializes the structure to YAML text in array order. Input binding
then uses the same renderer as text prompts, including declared-placeholder
checks. The validated `Blueprint.prompt` remains a string for existing Role
plugins. The LLM executes all policy and calculation instructions; this is not
a host-code Scenario interpreter. Inner Role names do not need plugin
registration. Top-level `role` still selects the message-preparation plugin.

The [Customer discount unit](../../examples/customer-discount/README.md)
contains the complete runnable declaration and its semantic evaluation corpus.

In recommended Gherkin, `Given` states context, `When` states the action or
event, and `Then` states an observable outcome. JSON structure belongs in
`output_schema`; it does not need to be repeated as a `Then` instruction.

PixieCore treats the decoded `prompt` string as opaque instruction text. After
YAML or another serialization has decoded that string, rendering replaces only
matching `{{ name }}` placeholder spans. It does not trim, reindent, collapse
blank lines, reorder lines, or otherwise normalize the remaining text. The
built-in `assistant` and `default` roles forward the rendered string unchanged
as the current user message. A custom Role plugin is an explicit
message-construction boundary and owns any transformation it performs.

`{{ name }}` is the canonical, portable authoring form. Spaces or tabs are
allowed inside the delimiters, but a reference cannot cross a line. PixieCore
implements only Mustache-style variable interpolation, not Mustache sections, comments,
HTML escaping, delimiter changes, or nested-property lookup. Portable names
match `[A-Za-z_][A-Za-z0-9_]*`. PixieCore 0.x also accepts `{name}` and flat
names containing dots or hyphens as migration extensions, but new Blueprints
should not depend on those extensions.

When a Blueprint declares `input_placeholders`, every placeholder referenced by
`prompt` or a `localization` value must appear in that declaration; validation
fails before any provider call otherwise. A Blueprint with no declaration keeps
PixieCore's existing arbitrary-input mode, but portable Blueprints should declare
their bindings. String values are inserted verbatim, other JSON values use
compact JSON, and an optional `null` or `undefined` value becomes an empty
string. A JSON object literal such as `{"type":"object"}` is not a
placeholder. The packaged, data-only fixture at
`@pixieworks/pixiecore/instruction-template/conformance-suite.json` lets another language
implementation test the same rendering and declaration cases without importing
TypeScript code.

Cross-runtime evidence is compared with the packaged
`conformance/runners/compare-instruction-template-reports.mjs` command. The
runner validates both adapter reports, requires distinct implementation names,
and treats only portable cases as the interoperability claim. PixieCore-specific
legacy syntax remains visible as an extension result.

## Editor support

PixieCore publishes the versioned Blueprint JSON Schema at the package subpath
`@pixieworks/pixiecore/blueprint/schema.json`. Schema-aware YAML editors use its property
descriptions for hover documentation, its types and enums for completion, and
its constraints for immediate diagnostics.

For VS Code with the YAML extension, associate Blueprint files in workspace
settings after installing PixieCore:

```json
{
  "yaml.schemas": {
    "./node_modules/@pixieworks/pixiecore/schemas/pixiecore.blueprint-v2.schema.json": [
      "blueprints/**/*.yaml",
      "**/blueprints/**/*.yaml"
    ]
  }
}
```

Tools can resolve the same artifact through the public package export:

```ts
import blueprintSchema from '@pixieworks/pixiecore/blueprint/schema.json' with { type: 'json' };
```

The editor catches structural errors without executing code or contacting a
provider. `pixiecore blueprint validate <blueprint.yaml>` remains the
authoritative offline check for JSON-encoded schema strings and JSON Schema
compilation, which a structural YAML association cannot fully inspect.

## Inputs

Typed declarations support `string`, `integer`, `float`, `number`, `boolean`,
`array`, `object`, `file`, and `image`. Declarations can set `required`,
`default`, and `description`.

Documented numeric and boolean strings are coerced. An omitted optional value
without a default becomes `null`. Strict mode rejects unknown inputs, while
non-strict mode ignores them. A Blueprint with no placeholders passes arbitrary
inputs through unchanged.

When `input_schema` is present, PixieCore first applies placeholder defaults and
type coercion, then validates the normalized object against the schema. If both
contracts are present in strict mode, inputs must satisfy both. Schema failures
raise `InputValidationError` before any provider call. Authentication context
used by `permissions` is not forced into the business-input schema unless the
schema or placeholders explicitly declare that field. Use
`additionalProperties: false` when the Blueprint should reject undeclared
business inputs.

```yaml
input_schema:
  type: object
  properties:
    amount:
      type: number
      exclusiveMinimum: 0
    department:
      type: string
      minLength: 1
  required: [amount, department]
  additionalProperties: false
```

`image_path` and `file_path` accept one string or an array. They are normalized
into attachments and added to every user message. Paths, data URLs, and
provider file IDs are supported according to provider capabilities.

## Processing order

The canonical message order is:

1. Agent-role system messages.
2. Localization system instructions.
3. Example user messages.
4. Supplied conversation history.
5. The current rendered user prompt.

Output must be JSON matching `output_schema`. Plain JSON and fenced JSON are
accepted. Invalid output receives bounded correction retries; schema,
self-evaluation, and configured output decorators run before a result is
returned.
