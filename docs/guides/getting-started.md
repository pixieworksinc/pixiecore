# Getting started with PixieCore

This is the shortest supported learning path. It starts without provider
credentials or network calls after installation, then leads to one independently
tested Blueprint and an ordinary TypeScript application.

## Five-minute quickstart

Prerequisites are Node.js 22.13.0 or later and npm.

These are installed-runtime requirements. To build or contribute to the
repository, use the separate [development Node policy](node-compatibility.md).

```bash
mkdir pixiecore-quickstart
cd pixiecore-quickstart
npm init -y
npm install @pixieworks/pixiecore
npx --package @pixieworks/pixiecore pixiecore blueprint create ./blueprints/expense-category \
  --operation=classifier \
  --name='Expense category'
npx --package @pixieworks/pixiecore pixiecore blueprint validate \
  ./blueprints/expense-category/expense-category.yaml
npx --package @pixieworks/pixiecore pixiecore blueprint test ./blueprints/expense-category
npx --package @pixieworks/pixiecore pixiecore blueprint inspect \
  ./blueprints/expense-category/expense-category.yaml
npx --package @pixieworks/pixiecore pixiecore blueprint play \
  ./blueprints/expense-category/evaluations/expense-category.yaml
```

The last four commands are offline. `create` produces one Blueprint, its policy
README, a versioned evaluation dataset, and a public-API contract test. The
default `play` mode runs one dataset case through the actual runtime pipeline
with a deterministic fixture provider. It does not contact a model provider.

At this point you have verified the basic development loop:

```text
declare contract -> validate -> test unit layout -> inspect -> replay one case
```

The generated content is deliberately incomplete product behavior. Do not
publish it until its accepted domain, ambiguity policy, schemas, cases, and
quality threshold describe a real operation.

## Continue in one order

1. Follow the [30-minute Blueprint tutorial](tutorial.md) to replace the
   scaffold with a bounded operation and execute its seeded offline test.
2. Read the [architecture guide](../architecture/architecture.md) before introducing
   application state, tools, custom plugins, or persistence.
3. Use the [migration guide](migration-guide.md) when converting a large prompt,
   direct provider wrapper, agent graph, or workflow node.
4. Consult [Blueprint granularity](../architecture/blueprint-granularity.md) and
   [application composition](../architecture/application-composition.md) for design review.
5. Use [evaluation](../blueprints/evaluation.md), [data policy](../runtime/data-policy.md), and the
   [threat model](../project/threat-model.md) before production deployment.

Real provider execution is intentionally a later step. Configure one provider
using the [provider guide](../plugins/providers.md), then run `pixiecore execute` or use
`PromptRuntime` from application code. Provider credentials are never needed
for the default repository or generated contract tests.
