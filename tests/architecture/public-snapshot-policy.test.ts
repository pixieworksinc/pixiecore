import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { selectPublicSnapshotFiles } from '../../scripts/publication/prepare.mjs';
import { assertPublicSnapshotClean, scanPublicSnapshot } from '../../scripts/publication/scan.mjs';
import { withTempDirectory } from '../helpers/temp.js';

test('public snapshot selection excludes every private archive boundary', () => {
  const publicFiles = selectPublicSnapshotFiles([
    'README.md',
    'benchmarks/evidence/provider/checkpoint.json',
    'benchmarks/results/provider/report.json',
    'conformance/evidence/runtime.json',
    'docs/internal/plan.md',
    'docs/project/backlog.md',
    'docs/project/pixiecore/review.md',
    'src/index.ts',
  ]);

  assert.deepEqual(publicFiles, ['README.md', 'src/index.ts']);
});

test('public snapshot scan reports rule and path without disclosing matched values', async () => {
  await withTempDirectory(async root => {
    const generatedSecret = `sk-proj-${'A'.repeat(32)}`;
    const prohibitedCodename = ['type', 'core'].join('');
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(
      join(root, 'src', 'unsafe.ts'),
      `const credential = ${JSON.stringify(generatedSecret)}; // ${prohibitedCodename}\n`,
    );

    const report = await scanPublicSnapshot(root);
    assert.deepEqual(
      report.findings.map(finding => finding.rule),
      ['old-codename', 'openai-api-key'],
    );
    const serialized = JSON.stringify(report.findings);
    assert.doesNotMatch(serialized, new RegExp(generatedSecret));
    assert.doesNotMatch(serialized, new RegExp(prohibitedCodename));
    assert.throws(() => assertPublicSnapshotClean(report), /2 issue\(s\)/u);
  });
});

test('public snapshot scan inventories clean source bytes deterministically', async () => {
  await withTempDirectory(async root => {
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'README.md'), '# PixieCore\n');
    await writeFile(join(root, 'src', 'index.ts'), 'export const ready = true;\n');

    const first = await scanPublicSnapshot(root);
    const second = await scanPublicSnapshot(root);
    assert.deepEqual(first.findings, []);
    assert.deepEqual(first.files, second.files);
    assert.deepEqual(first.files.map(file => file.path), ['README.md', 'src/index.ts']);
    assert.equal(await readFile(join(root, 'README.md'), 'utf8'), '# PixieCore\n');
  });
});
