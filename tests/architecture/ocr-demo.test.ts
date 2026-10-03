import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';
import YAML from 'yaml';

const demoRoot = join(process.cwd(), 'examples', 'demos', 'ocr-document-review');

test('OCR demo keeps one canonical scenario across reusable presentation formats', async () => {
  const manifest = YAML.parse(await readFile(join(demoRoot, 'demo.yaml'), 'utf8')) as {
    schema: string;
    id: string;
    blueprint: string;
    dataset: string;
    case: string;
    fixture: string;
    runner: string;
    modes: Record<string, { command: string; evidence: string }>;
    claims: Record<string, string>;
  };
  assert.equal(manifest.schema, 'pixiecore.demo/v1');
  assert.equal(manifest.id, 'travel-document-ocr-review');
  assert.equal(manifest.case, 'scanned-pdf-partial');
  assert.deepEqual(Object.keys(manifest.modes), ['offline', 'real', 'comparison']);
  assert.equal(manifest.claims.remote_provider_quality, 'not_measured_for_initial_release');
  assert.equal(manifest.claims.side_effects, 'none');

  for (const path of [manifest.blueprint, manifest.dataset, manifest.fixture, manifest.runner]) {
    await access(resolve(demoRoot, path));
  }

  const dataset = YAML.parse(await readFile(resolve(demoRoot, manifest.dataset), 'utf8')) as {
    version: string;
    cases: readonly {
      id: string;
      comparison: { mode: string; pointers?: readonly string[] };
    }[];
  };
  assert.equal(dataset.version, '1.0.1');
  const selectedCase = dataset.cases.find(candidate => candidate.id === manifest.case);
  assert.ok(selectedCase);
  assert.deepEqual(selectedCase.comparison, {
    mode: 'fields',
    pointers: [
      '/status',
      '/document_type',
      '/fields',
      '/warnings/0/code',
      '/warnings/0/page',
    ],
  });
});

test('OCR demo runner and guidance preserve offline and claim boundaries', async () => {
  const [runner, readme, guide] = await Promise.all([
    readFile(join(demoRoot, 'run.mjs'), 'utf8'),
    readFile(join(demoRoot, 'README.md'), 'utf8'),
    readFile(join(process.cwd(), 'docs', 'blueprints', 'ocr-demo.md'), 'utf8'),
  ]);
  assert.match(runner, /--case=scanned-pdf-partial/u);
  assert.match(runner, /--mode=\$\{mode\}/u);
  assert.doesNotMatch(runner, /API_KEY|password|token\s*=/iu);
  assert.match(readme, /does not measure OCR model accuracy/u);
  assert.match(guide, /## Video shot list/u);
  assert.match(guide, /## Article outline/u);
  assert.match(guide, /## Conference runbook/u);
  assert.match(guide, /## Claim boundary/u);
});
