#!/usr/bin/env node

import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { dirname, join, parse, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_REPOSITORY_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

if (isMainModule()) await cleanTestRuntime(DEFAULT_REPOSITORY_ROOT);

/** Removes the clean runtime output and its local-only incremental metadata. */
export async function cleanTestRuntime(repositoryRoot = DEFAULT_REPOSITORY_ROOT) {
  const root = resolve(repositoryRoot);
  const distDirectory = resolve(root, 'dist');
  const buildInfoPath = resolve(root, '.pixiecore', 'test-runtime.tsbuildinfo');

  assert.equal(distDirectory, join(root, 'dist'));
  assert.notEqual(distDirectory, root);
  assert.notEqual(distDirectory, parse(distDirectory).root);

  await Promise.all([
    rm(distDirectory, { recursive: true, force: true }),
    rm(buildInfoPath, { force: true }),
  ]);
}

/** Determines whether this module is the invoked cleanup entry point. */
function isMainModule() {
  return process.argv[1] !== undefined
    && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}
