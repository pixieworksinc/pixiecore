/** Verify real TypeDoc traversal with minimatch 11 and the bounded compatibility preparation. */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { applyTypeDocCompat } from './run-typedoc.mjs';

const require = createRequire(import.meta.url);
const packageDirectory = dirname(require.resolve('typedoc/package.json'));
applyTypeDocCompat(packageDirectory);
const { glob } = await import(pathToFileURL(join(packageDirectory, 'dist/node-utils.js')).href);

test('TypeDoc traverses nested and negated globs without entering node_modules', () => {
  const root = mkdtempSync(join(tmpdir(), 'pixiecore-typedoc-glob-'));
  try {
    for (const name of ['main.ts', 'src/deep/example.ts', 'src/readme.md', 'skip/hidden.ts', 'node_modules/pkg/index.ts']) {
      const path = join(root, name);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, '');
    }
    const names = pattern => glob(pattern, root).map(path => path.slice(root.length + 1)).sort();
    assert.deepEqual(names(`${root}/src/**/*.ts`), ['src/deep/example.ts']);
    // Preserve TypeDoc 0.28.20's traversal scope, measured with minimatch 10.
    // Negated patterns do not imply recursion into every unrelated directory.
    assert.deepEqual(names(`!${root}/skip/**`), ['main.ts']);
    assert.deepEqual(names(`!${root}/src/**/*.md`), ['main.ts', 'src/deep/example.ts']);
    assert.deepEqual(names(`${root}/node_modules/**/*.ts`), ['node_modules/pkg/index.ts']);
    assert.deepEqual(names(`${root}/missing/**/*.ts`), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('compatibility preparation is repeatable without changing the installed file again', () => {
  const file = join(packageDirectory, 'dist/node-utils.js');
  const before = readFileSync(file, 'utf8');
  assert.equal(applyTypeDocCompat(packageDirectory), false);
  assert.equal(readFileSync(file, 'utf8'), before);
});

test('unexpected legacy TypeDoc source is rejected without modifying it', () => {
  const root = mkdtempSync(join(tmpdir(), 'pixiecore-typedoc-unsupported-'));
  try {
    mkdirSync(join(root, 'dist'));
    writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '0.28.20' }));
    const file = join(root, 'dist/node-utils.js');
    const source = 'differentMatcher.matchOne(path);';
    writeFileSync(file, source);
    assert.throws(() => applyTypeDocCompat(root), /Unsupported TypeDoc traversal/);
    assert.equal(readFileSync(file, 'utf8'), source);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
