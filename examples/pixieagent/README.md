# PixieAgent bounded PoC

This is the minimal goal-directed agent demo in `pixieworksinc/pixiecore` on `0.2.x`.
It uses PixieCore's existing public runtime without changing its one-Blueprint
execution model:

```text
sample issue -> planner -> classify-issue -> planner -> final result
```

The delivered code is [agent.ts](agent.ts), its pinned
[definition](agent.yaml), the [Blueprints](blueprints/), and the bounded
[runtime harness](harness.ts). The sample invokes one allowed read action and
finishes with a category, severity and reason. The offline corpus, tests and
accepted real-model evidence below are part of the same PoC.

## Reproduce the six-case demo

Use a checkout of `pixieworksinc/pixiecore`'s `0.2.x` branch, a POSIX shell and Node 24.
The handoff procedure is verified with Node **24.20.0**. Run every command from
the **repository root**, not this directory. For a clean reproduction use a
fresh checkout without `node_modules/` or `dist/`, and do not copy a project
`.env` into it. No API key is needed.

```sh
node --version
npm ci --ignore-scripts --no-audit --fund=false
npm run build
```

Run the existing CLI with the offline network guard and an empty credential:

```sh
OPENAI_API_KEY='' node --import ./examples/pixieagent/tests/deny-network.mjs --import tsx examples/pixieagent/evaluate.ts --offline --markdown
```

The command exits zero and prints a scorecard containing:

```text
Status: passed; fixture cases passed: 6/6.
Source unchanged: true.
Real network requests: 0. Actual cost: unknown. Model accuracy and reason factuality: not evaluated.
```

| Case | Expected and observed | Simulated requests |
|---|---|---|
| security-authentication | security/high | 3 |
| testing-intermittent | testing/medium | 3 |
| architecture-coupling | architecture/medium | 3 |
| other-documentation | other/low | 3 |
| other-underspecified | other/low | 3 |
| security-embedded-instructions | security/high | 3 |

The [six inputs and expectations](evaluation/cases.json) are separate from the
[scripted responses](evaluation/fixtures.json). These responses exercise real
loading, rendering and validation through PixieCore, but they are not model
answers. Three **simulated** requests per case do not mean three network calls.
The existing `--offline` mode without `--markdown` prints a JSON report with
source/data fingerprints, traces and synthetic budget accounting.

## Verify the existing controls

After the same setup, run the dedicated tests used by CI:

```sh
OPENAI_API_KEY='' node --import ./examples/pixieagent/tests/deny-network.mjs --experimental-strip-types --test examples/pixieagent/tests/agent.test.mjs examples/pixieagent/tests/agent-boundaries.test.mjs examples/pixieagent/tests/network-guard.test.mjs
OPENAI_API_KEY='' node --import ./examples/pixieagent/tests/deny-network.mjs --import tsx --test examples/pixieagent/tests/harness.test.ts examples/pixieagent/tests/luna.test.ts examples/pixieagent/tests/live.test.ts examples/pixieagent/tests/evaluation.test.ts examples/pixieagent/tests/suite-budget.test.ts examples/pixieagent/tests/suite-live.test.ts
```

Expected: **21 native tests + 52 runtime tests = 73 passing**, with zero failures.
They cover action/permission boundaries, host-approval cancellation, bounded
requests and budgets, provider-response rejection, one-shot approval/replay,
input fidelity, scoring and stop conditions. Existing severity-boundary
fixtures are included in these tests. They are not additional live evaluations.
The repository's general `npm test` command does not discover this dedicated
suite; the commands above are required and already run in Node 22/24 CI.

## Bounds and interpretation

- The pinned definition permits only `classify-issue`, a read action, with at
  most two action executions. Each bundled case finishes after one action and
  two planner decisions. There are no repository writes or registered tools/MCP.
- The per-case transport allows at most five requests, 16 KiB request JSON and
  512 completion tokens per request, with zero retries. Request timeout is
  30 seconds and the agent has a 90-second deadline.
- Offline token counts and prices are synthetic. Offline results always report
  zero network requests and unknown actual billed cost.
- Severity is a PoC convention: stated security-boundary violations, data
  access/loss or service unavailability are high; concrete functional,
  test-reliability or independent-reuse defects are medium; cosmetic-only
  defects with correct functionality are low. When impact cannot be established,
  low is provisional and the reason must request clarification. A nonempty
  reason passing the scorer does not prove that this meaning is present.
- The test preload blocks ambient network entry points; it is not operating
  system isolation. The agent is in-process and fail-fast, not a durable
  scheduler. Arbitrary Issue input, tools, general accuracy, repeated stability,
  broad attack resistance and production readiness are outside this demo.

## Accepted real-model evidence

The [historical six-case evaluation record](evaluation/accepted-model-run.md)
summarizes the previously accepted result and its limits. Publication does not
repeat the run or establish accuracy on new inputs.

## Browser demos and containers

The [demo deployment guide](demo/README.md) includes the original card-based
fixture replay and the restricted live trial, Dockerfile and Compose files.
Default startup serves replay only and needs no API key. The live service is
an explicit opt-in with separate credentials, durable shared accounting and an
expiry. Selecting a case or connecting does not execute a model request.

These examples are source-checkout examples; they are not a new npm package
or a change to PixieCore's public API. Follow [implementation notes](NOTES.txt)
for the existing approval and stop semantics.
