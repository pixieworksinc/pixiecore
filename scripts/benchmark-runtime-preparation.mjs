#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import {
  PromptRuntime,
  runtimePreparationCacheSnapshot,
} from '../src/core/kernel/runtime/index.js';

const iterations = parseIterations(process.argv.slice(2));
const source = await readFile(
  new URL('../examples/hello.yaml', import.meta.url),
  'utf8',
);
const provider = Object.freeze({
  name: 'runtime-preparation-benchmark',
  model: 'deterministic-fixture',
  supportsTools: false,
  supportsMultimodal: false,
  supportsVision: () => false,
  supportsFileInput: () => false,
  getModelList: async () => ['deterministic-fixture'],
  generate: async () => ({ content: JSON.stringify({ greeting: 'fixture' }) }),
});
const runtime = new PromptRuntime({
  provider,
  mcpConfigPath: 'disabled',
  pluginConfigPath: 'disabled',
  logToConsole: false,
});

try {
  const coldStarted = performance.now();
  await runtime.executeYaml(source, { name: 'cold' });
  const coldMilliseconds = performance.now() - coldStarted;
  const warmStarted = performance.now();
  for (let index = 0; index < iterations; index++) {
    await runtime.executeYaml(source, { name: `warm-${index}` });
  }
  const warmMilliseconds = performance.now() - warmStarted;
  const cache = runtimePreparationCacheSnapshot(runtime);
  console.log(JSON.stringify({
    schema: 'pixiecore.runtime-preparation-benchmark/v1',
    iterations,
    cold_ms: coldMilliseconds,
    warm_total_ms: warmMilliseconds,
    warm_average_ms: warmMilliseconds / iterations,
    blueprint_cache: cache,
  }));
} finally {
  await runtime.close();
}

function parseIterations(args) {
  const argument = args.find(value => value.startsWith('--iterations='));
  const value = Number(argument?.slice('--iterations='.length) ?? '200');
  if (!Number.isSafeInteger(value) || value < 1 || value > 10_000) {
    throw new TypeError('--iterations must be an integer from 1 through 10000');
  }
  return value;
}
