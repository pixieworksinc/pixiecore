# Node.js compatibility

Runtime minimum: `22.13.0`.

Development Node.js: `^22.22.2 || >=24.15.0`.

The installed package keeps `engines.node: >=22.13.0`. Building, documenting,
and linting the source require the development range above because the locked
JSDoc tools have stricter engines. Use the current Node 24 release for repository
work and install with `npm ci --engine-strict`. This is not a higher minimum for
applications using PixieCore.

`scripts/ci/node-policy.json` records these two boundaries. Run
`npm run check:node-engines` under development Node to compare every locked
engine against both development minima and the production runtime floor.
Platform-specific optional packages are included in this metadata check.

CI installs the locked graph with strict engine checking on Node 24, checks
source/API documentation, builds, and records one immutable package candidate.
It then selects Node 22.13.0 or the current Node 24 line for the remaining
type, architecture, contract, conformance, and full offline tests. Coverage runs
on Node 24. Both lanes install that same candidate into an isolated consumer
with strict engine checking and exercise its runtime, HTTP API, CLI, and
TypeScript declarations without rerunning documentation tools or repacking.
The floor lane therefore still runs the full test suite, not only a smoke test.

When dependencies change, engine incompatibilities must fail the policy check
or strict installation. Do not use `--force`, suppress engine warnings, remove
quality gates, or raise the production floor just to accommodate development
tools. Update this policy, CI, and documentation together if a separately
reviewed compatibility change is needed. Release-candidate and scheduled
stability installs also enforce engines on Node 24.
