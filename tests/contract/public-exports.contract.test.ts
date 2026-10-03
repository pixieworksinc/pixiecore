import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import * as pixiecoreApi from '../../src/core/kernel/api/index.js';
import * as pixiecoreApisix from '../../src/core/kernel/apisix/index.js';
import * as pixiecoreApplication from '../../src/core/kernel/application/index.js';
import * as pixiecoreAudit from '../../src/core/kernel/audit/index.js';
import * as pixiecoreBlueprintPackages from '../../src/core/kernel/blueprint/packages.js';
import * as pixiecoreCache from '../../src/core/kernel/cache/index.js';
import * as pixiecoreConformance from '../../src/core/kernel/conformance/index.js';
import * as pixiecoreDataPolicy from '../../src/core/kernel/data-policy/index.js';
import * as pixiecoreEvaluation from '../../src/core/kernel/evaluation/index.js';
import * as pixiecoreFallback from '../../src/core/kernel/fallback/index.js';
import * as pixiecoreJit from '../../src/core/kernel/jit/index.js';
import * as pixiecoreMcpServer from '../../src/core/kernel/mcp-server/index.js';
import * as pixiecorePlugin from '../../src/core/contracts/plugin/index.js';
import * as pixiecoreRag from '../../src/core/kernel/rag/index.js';
import * as pixiecoreReview from '../../src/core/kernel/review/index.js';
import * as pixiecoreTelemetry from '../../src/core/kernel/telemetry/index.js';
import * as pixiecore from '../../src/index.js';

interface RuntimeExportSnapshot {
  readonly '@pixieworks/pixiecore': readonly string[];
  readonly '@pixieworks/pixiecore/api': readonly string[];
  readonly '@pixieworks/pixiecore/apisix': readonly string[];
  readonly '@pixieworks/pixiecore/application': readonly string[];
  readonly '@pixieworks/pixiecore/audit': readonly string[];
  readonly '@pixieworks/pixiecore/blueprint-packages': readonly string[];
  readonly '@pixieworks/pixiecore/cache': readonly string[];
  readonly '@pixieworks/pixiecore/conformance': readonly string[];
  readonly '@pixieworks/pixiecore/data-policy': readonly string[];
  readonly '@pixieworks/pixiecore/eval': readonly string[];
  readonly '@pixieworks/pixiecore/fallback': readonly string[];
  readonly '@pixieworks/pixiecore/jit': readonly string[];
  readonly '@pixieworks/pixiecore/mcp-server': readonly string[];
  readonly '@pixieworks/pixiecore/plugin': readonly string[];
  readonly '@pixieworks/pixiecore/rag': readonly string[];
  readonly '@pixieworks/pixiecore/review': readonly string[];
  readonly '@pixieworks/pixiecore/telemetry': readonly string[];
}

const snapshotPath = fileURLToPath(new URL('../fixtures/public-runtime-exports.json', import.meta.url));
const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8')) as RuntimeExportSnapshot;

test('package entry points retain their exact runtime export surface', () => {
  assert.deepEqual(Object.keys(pixiecore).sort(), [...snapshot['@pixieworks/pixiecore']].sort());
  assert.deepEqual(Object.keys(pixiecoreApi).sort(), [...snapshot['@pixieworks/pixiecore/api']].sort());
  assert.deepEqual(Object.keys(pixiecoreApisix).sort(), [...snapshot['@pixieworks/pixiecore/apisix']].sort());
  assert.deepEqual(
    Object.keys(pixiecoreApplication).sort(),
    [...snapshot['@pixieworks/pixiecore/application']].sort(),
  );
  assert.deepEqual(Object.keys(pixiecoreAudit).sort(), [...snapshot['@pixieworks/pixiecore/audit']].sort());
  assert.deepEqual(
    Object.keys(pixiecoreBlueprintPackages).sort(),
    [...snapshot['@pixieworks/pixiecore/blueprint-packages']].sort(),
  );
  assert.deepEqual(Object.keys(pixiecoreCache).sort(), [...snapshot['@pixieworks/pixiecore/cache']].sort());
  assert.deepEqual(
    Object.keys(pixiecoreConformance).sort(),
    [...snapshot['@pixieworks/pixiecore/conformance']].sort(),
  );
  assert.deepEqual(
    Object.keys(pixiecoreDataPolicy).sort(),
    [...snapshot['@pixieworks/pixiecore/data-policy']].sort(),
  );
  assert.deepEqual(
    Object.keys(pixiecoreEvaluation).sort(),
    [...snapshot['@pixieworks/pixiecore/eval']].sort(),
  );
  assert.deepEqual(Object.keys(pixiecoreFallback).sort(), [...snapshot['@pixieworks/pixiecore/fallback']].sort());
  assert.deepEqual(Object.keys(pixiecoreJit).sort(), [...snapshot['@pixieworks/pixiecore/jit']].sort());
  assert.deepEqual(
    Object.keys(pixiecoreMcpServer).sort(),
    [...snapshot['@pixieworks/pixiecore/mcp-server']].sort(),
  );
  assert.deepEqual(Object.keys(pixiecorePlugin).sort(), [...snapshot['@pixieworks/pixiecore/plugin']].sort());
  assert.deepEqual(Object.keys(pixiecoreRag).sort(), [...snapshot['@pixieworks/pixiecore/rag']].sort());
  assert.deepEqual(Object.keys(pixiecoreReview).sort(), [...snapshot['@pixieworks/pixiecore/review']].sort());
  assert.deepEqual(Object.keys(pixiecoreTelemetry).sort(), [...snapshot['@pixieworks/pixiecore/telemetry']].sort());
});
