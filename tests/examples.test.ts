import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { BlueprintValidator } from '../src/index.js';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const examplesDirectory = join(projectRoot, 'examples');

test('every packaged top-level Blueprint YAML example satisfies the public contract', async () => {
  const yamlFiles = (await readdir(examplesDirectory))
    .filter(name => /\.ya?ml$/i.test(name))
    .sort();
  assert.ok(yamlFiles.length > 0, 'At least one YAML example must be packaged');

  const validator = new BlueprintValidator({ warn: () => undefined });
  for (const filename of yamlFiles) {
    const blueprint = await validator.validateFile(join(examplesDirectory, filename));
    assert.ok(blueprint.name, `${filename} must have a name`);
  }
});

test('every YAML example referenced by README exists in the package examples directory', async () => {
  const readme = await readFile(join(projectRoot, 'README.md'), 'utf8');
  const references = new Set([...readme.matchAll(/\bexamples\/[A-Za-z0-9._/-]+\.ya?ml\b/g)].map(match => match[0]));
  assert.ok(references.size > 0, 'README must reference at least one YAML example');
  for (const reference of references) await access(join(projectRoot, reference));
});
