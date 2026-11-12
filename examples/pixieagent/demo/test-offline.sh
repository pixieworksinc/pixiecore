#!/bin/sh
# Run from the repository root after npm ci and npm run build.
set -eu
export OPENAI_API_KEY=''
node --import ./examples/pixieagent/tests/deny-network.mjs --experimental-strip-types --test \
  examples/pixieagent/tests/agent.test.mjs \
  examples/pixieagent/tests/agent-boundaries.test.mjs \
  examples/pixieagent/tests/network-guard.test.mjs
node --import ./examples/pixieagent/tests/deny-network.mjs --import tsx --test \
  examples/pixieagent/tests/harness.test.ts \
  examples/pixieagent/tests/luna.test.ts \
  examples/pixieagent/tests/live.test.ts \
  examples/pixieagent/tests/evaluation.test.ts \
  examples/pixieagent/tests/suite-budget.test.ts \
  examples/pixieagent/tests/suite-live.test.ts
# The web HTTP tests intentionally use local sockets with injected fixture hosts.
node --test examples/pixieagent/demo/replay/*.test.mjs examples/pixieagent/demo/live/*.test.mjs
node --import ./examples/pixieagent/tests/deny-network.mjs --import tsx examples/pixieagent/evaluate.ts --offline --markdown
