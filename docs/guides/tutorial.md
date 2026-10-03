# Thirty-minute Blueprint tutorial

This tutorial turns the quickstart scaffold into one narrow Classifier and adds
it to a TypeScript application boundary. The target is a complete development
loop, not a claim of production model quality.

## 0 to 5 minutes: create the unit

Complete the [five-minute quickstart](getting-started.md). It creates:

```text
blueprints/expense-category/
├── expense-category.yaml
├── README.md
├── evaluations/
│   └── expense-category.yaml
└── tests/
    └── expense-category.contract.test.ts
```

This directory is the change unit. Keep its declaration, policy, dataset, and
offline test versioned together.

## 5 to 12 minutes: narrow the contract

Edit `expense-category.yaml`. Keep one operation: classify one normalized
expense description into one caller-defined category. Do not also extract a
receipt, approve payment, update a ledger, or send a notification.

Use a contract shaped like this:

```yaml
name: Expense category
version: 0.1.0
role: assistant
temperature: 0
input_placeholders:
  - name: input
    type: string
    required: true
input_schema:
  type: object
  additionalProperties: false
  required: [input]
  properties:
    input: { type: string, minLength: 1, pattern: '\S' }
prompt: |
  Classify exactly one normalized expense description from {{ input }}.
  Return the category only. Do not approve, reimburse, or update records.
  Return only JSON matching the output schema.
output_schema:
  type: object
  additionalProperties: false
  required: [result]
  properties:
    result:
      type: string
      enum: [travel, meals, lodging, software, other]
```

The categories above are an example policy. A production Blueprint should take
changing business policy as versioned caller input or a bounded tool rather
than hide it in application code or assume it from general knowledge.

Update the generated contract test at the same time: make its fixture provider
return `{ result: 'software' }` and assert that exact result instead of echoing
the seeded input. The test must always return a value accepted by the current
output schema.

## 12 to 18 minutes: make expected behavior explicit

Edit `evaluations/expense-category.yaml`. Add ordinary, boundary, ambiguous,
and unsupported inputs. Each case needs a stable ID, inputs, expected output,
and comparison policy. Start with exact comparison:

```yaml
schema: pixiecore.blueprint-eval-dataset/v1
name: Expense category evaluation
version: 0.1.0
blueprint:
  path: ../expense-category.yaml
  version: 0.1.0
tags: [classifier, tutorial]
cases:
  - id: canonical-software
    tags: [canonical]
    inputs: { input: annual source-control subscription }
    expected_output: { result: software }
    comparison: { mode: exact }
```

Add cases for descriptions with insufficient evidence instead of forcing a
guess. If the contract needs an `ambiguous` status, change the output schema and
expected outputs before changing the prompt.

## 18 to 23 minutes: run the offline contract

Install the TypeScript test loader and execute the generated public-API test:

```bash
npm install --save-dev typescript tsx @types/node
TEST_SEED=tutorial-replay-1 node --test --import tsx \
  blueprints/expense-category/tests/expense-category.contract.test.ts
npx --package @pixieworks/pixiecore pixiecore blueprint validate \
  blueprints/expense-category/expense-category.yaml
npx --package @pixieworks/pixiecore pixiecore blueprint test blueprints/expense-category
npx --package @pixieworks/pixiecore pixiecore blueprint play \
  blueprints/expense-category/evaluations/expense-category.yaml \
  --case=canonical-software
```

The generated test injects an offline `Provider` through the public
`PromptRuntime` API. Replace its fixture output as the schema evolves. A fixed
`TEST_SEED` reproduces one failure; omit it during normal project test runs to
generate one seed for that run.

`blueprint play` defaults to an offline expected-output fixture. It proves the
runtime and comparison path, not remote-model accuracy. Use `blueprint eval`
with an explicitly configured provider when measuring actual model behavior.

## 23 to 30 minutes: add the call to an application

Keep orchestration in TypeScript. The application validates deterministic
inputs, calls the Blueprint, handles its typed result, and owns side effects:

```ts
import { PromptRuntime } from '@pixieworks/pixiecore';

export async function classifyExpense(description: string): Promise<string> {
  if (!description.trim()) throw new TypeError('description must be non-blank');

  await using runtime = new PromptRuntime();
  const result = await runtime.execute(
    './blueprints/expense-category/expense-category.yaml',
    { input: description },
  );
  return String(result.result);
}
```

In a larger application, pass one shared runtime into the composition root
instead of creating one per function. Map fields explicitly between Blueprint
calls, propagate one `AbortSignal`, and perform persistence, authorization,
notification, approval, and retries at their documented owner boundary.

Before merging:

- run the seeded offline test and every evaluation case;
- record the tested Blueprint, dataset, provider, and model versions;
- increment the Blueprint version when behavior changes;
- require a major Blueprint bump for role, input/output contract, tools,
  permissions, or stable-path changes;
- add an end-to-end application test without weakening the unit test.

Next, read the [architecture guide](../architecture/architecture.md) and the complete
[application composition guide](../architecture/application-composition.md).
