# Customer discount through the LLM runtime

This example applies a deterministic specification entirely in a Blueprint.
It is a normal prompt-first POP use case. The LLM selects the discount, computes
the price, verifies the result, and returns the declared JSON.

One structured Scenario array contains Classifier, Converter, Verifier, and
Orchestrator Roles. PixieCore validates the declaration and serializes the
instructions for one model invocation. It does not calculate the discount or
replace the business policy with a Tool.

## Policy

The discount is `0.15` only when the customer tier exactly equals `Gold` and
the purchase amount is strictly greater than `1000`. Otherwise the discount is
`0`. The final price is the original amount multiplied by `1 - discount`.
The tier is not trimmed or case-normalized, and the result is not rounded.

The input contract accepts numbers, including zero and negative values; the
policy does not add an unrequested purchase-validity rule. Output `discount`
uses a decimal fraction, not percentage points.

## Execute and evaluate

From the repository, build the CLI and configure a supported provider:

```bash
npm ci
npm run build
export OPENAI_API_KEY=...
export OPENAI_MODEL=<model-id>
node dist/core/kernel/cli/index.js execute \
  examples/customer-discount/customer-discount.yaml \
  --inputs='{"customer_tier":"Gold","purchase_amount":1500}'
node dist/core/kernel/cli/index.js blueprint validate \
  examples/customer-discount/customer-discount.yaml
node dist/core/kernel/cli/index.js blueprint eval \
  examples/customer-discount/evaluations/customer-discount.yaml \
  --seed=discount-run-1
```

Repeat evaluation with recorded run labels and retain provider/model metadata
alongside the report. A seed identifies the evaluation run; it does not seed
or guarantee deterministic model generation. Provider sampling capabilities
vary, including whether `temperature: 0` is supported.

## Evidence and provenance

The dataset has 18 exact-comparison cases, including the threshold itself,
both sides of the threshold, non-Gold tiers, case and whitespace mismatches,
and fractional arithmetic. Expected outcomes are test oracles, not execution
code. These synthetic examples derive from the owner's supplied discount
policy and contain no private customer data or copied PDF implementation.

Offline contract tests capture a provider request and deliberately inject an
incorrect but schema-valid discount result. The runtime returns that result
unchanged, and semantic evaluation marks it failed. This verifies the execution
boundary and error detection. It does not establish real-model accuracy.

See [POP principles](../../docs/specification/pop-principles.md) and the
[0.2 development plan](../../docs/project/0.2-development.md).
