import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import {
  expectedRuntimeJavaScriptOutputs,
  inspectRuntimeBuildCache,
  resolveRuntimeBuildCacheMode,
} from '../../scripts/build-test-runtime-repeat.mjs';
import { withTempDirectory } from '../helpers/temp.js';

test('repeat build cache accepts a complete runtime tree and rejects stale output', async () => {
  await withTempDirectory(async root => {
    await writeRuntimeFixture(root);
    assert.deepEqual(await expectedRuntimeJavaScriptOutputs(root), [
      'index.js',
      'plugins/example/example.js',
    ]);
    assert.deepEqual(await inspectRuntimeBuildCache(root), { reusable: true, reason: 'current' });

    await rm(join(root, 'dist', 'plugins', 'example', 'example.js'));
    assert.deepEqual(await inspectRuntimeBuildCache(root), { reusable: false, reason: 'stale_dist' });

    await writeFile(join(root, 'dist', 'stale.js'), 'export {};\n');
    assert.deepEqual(await inspectRuntimeBuildCache(root), { reusable: false, reason: 'stale_dist' });
  });
});

test('repeat build cache fails closed when build metadata or dist is unavailable', async () => {
  await withTempDirectory(async root => {
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'src', 'index.ts'), 'export {};\n');
    assert.deepEqual(await inspectRuntimeBuildCache(root), {
      reusable: false,
      reason: 'missing_build_info',
    });

    await mkdir(join(root, '.pixiecore'), { recursive: true });
    await writeFile(join(root, '.pixiecore', 'test-runtime.tsbuildinfo'), '{}\n');
    assert.deepEqual(await inspectRuntimeBuildCache(root), {
      reusable: false,
      reason: 'missing_dist',
    });
  });
});

test('repeat build cache mode defaults to reuse and accepts only explicit safe values', () => {
  assert.equal(resolveRuntimeBuildCacheMode(undefined), 'reuse');
  assert.equal(resolveRuntimeBuildCacheMode('reuse'), 'reuse');
  assert.equal(resolveRuntimeBuildCacheMode('clean'), 'clean');
  assert.throws(() => resolveRuntimeBuildCacheMode('yes'), /PIXIECORE_TEST_RUNTIME_CACHE/u);
});

async function writeRuntimeFixture(root: string): Promise<void> {
  await Promise.all([
    mkdir(join(root, '.pixiecore'), { recursive: true }),
    mkdir(join(root, 'dist', 'plugins', 'example'), { recursive: true }),
    mkdir(join(root, 'src', 'plugins', 'example', 'tests'), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(root, '.pixiecore', 'test-runtime.tsbuildinfo'), '{}\n'),
    writeFile(join(root, 'src', 'index.ts'), 'export {};\n'),
    writeFile(join(root, 'src', 'plugins', 'example', 'example.ts'), 'export {};\n'),
    writeFile(join(root, 'src', 'plugins', 'example', 'tests', 'example.test.ts'), 'export {};\n'),
    writeFile(join(root, 'dist', 'index.js'), 'export {};\n'),
    writeFile(join(root, 'dist', 'plugins', 'example', 'example.js'), 'export {};\n'),
  ]);
}
