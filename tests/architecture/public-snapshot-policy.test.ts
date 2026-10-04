import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { selectPublicSnapshotFiles } from '../../scripts/publication/prepare.mjs';
import { assertPublicSnapshotClean, scanPublicSnapshot } from '../../scripts/publication/scan.mjs';
import { withTempDirectory } from '../helpers/temp.js';
import { testData } from '../helpers/test-data.js';

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
    const data = testData('public snapshot redacted findings');
    const generatedSecret = `sk-proj-${data.text('credential', 'synthetic').repeat(2)}`;
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

test('public snapshot scan rejects classic and fine-grained GitHub tokens without disclosing values', async () => {
  await withTempDirectory(async root => {
    const data = testData('public snapshot GitHub credentials');
    const prefixes = ['ghp_', 'gho_', 'ghu_', 'ghs_', 'ghr_', 'github_pat_'];
    const credentials = prefixes.map(prefix => {
      const body = data.text(prefix, 'synthetic').replaceAll('_', '').repeat(5);
      return prefix === 'github_pat_'
        ? `${prefix}${body.slice(0, 22)}_${body.slice(22, 81)}`
        : `${prefix}${body.slice(0, 36)}`;
    });
    for (const [index, credential] of credentials.entries()) {
      await writeFile(join(root, `credential-${index}.txt`), `credential=${credential}\n`);
    }

    const report = await scanPublicSnapshot(root);
    assert.deepEqual(report.findings, credentials.map((_, index) => ({
      rule: 'github-token',
      path: `credential-${index}.txt`,
    })));
    assert.throws(() => assertPublicSnapshotClean(report), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /6 issue\(s\)/u);
      for (const credential of credentials) {
        assert.equal(JSON.stringify(report).includes(credential), false);
        assert.equal(error.message.includes(credential), false);
      }
      return true;
    });
  });
});

test('public snapshot scan rejects every environment-file variant including nested paths', async () => {
  await withTempDirectory(async root => {
    const data = testData('public snapshot environment files');
    const paths = [
      '.env',
      '.env.local',
      '.env.production',
      '.env.development',
      '.env.production.local',
      '.env.example',
      `config/.env.${data.text('custom environment')}`,
      'config/.env.local',
      'config/.env.production',
      'config/.env.development',
      'config/.env.example',
      'nested/.env.local/settings.txt',
    ];
    const opaqueCredential = data.text('unrecognized credential', 'synthetic');
    for (const path of paths) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), `SERVICE_CREDENTIAL=${opaqueCredential}\n`);
    }

    const report = await scanPublicSnapshot(root);
    assert.deepEqual(report.findings, paths
      .map(path => ({ rule: 'forbidden-path-part', path }))
      .sort((left, right) => left.path.localeCompare(right.path)));
    assert.throws(() => assertPublicSnapshotClean(report), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /12 issue\(s\)/u);
      assert.equal(JSON.stringify(report).includes(opaqueCredential), false);
      assert.equal(error.message.includes(opaqueCredential), false);
      return true;
    });
  });
});

test('public snapshot scan accepts harmless environment-like paths and token references', async () => {
  await withTempDirectory(async root => {
    const data = testData('public snapshot harmless references');
    const paths = ['env.local', '.environment', 'config/app.env', 'config/.envrc', 'docs/environment.md'];
    const content = `${data.text('documentation')}\nToken prefixes: github_pat_, ghp_. Example: github_pat_short.\n`;
    for (const path of paths) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), content);
    }

    const report = await scanPublicSnapshot(root);
    assert.deepEqual(report.findings, []);
    assert.doesNotThrow(() => assertPublicSnapshotClean(report));
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
