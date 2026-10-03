import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Ajv2020 } from 'ajv/dist/2020.js';

const schema = JSON.parse(await readFile(
  new URL('../../schemas/pixiecore.blueprint-package-v1.schema.json', import.meta.url),
  'utf8',
)) as object;
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

test('Blueprint package schema accepts namespaced data-only metadata and integrity inventory', () => {
  const metadata = {
    ...fixture(),
    dependencies: { 'acme.shared-blueprints': '^2.0.0' },
    provenance: {
      source: 'https://example.invalid/acme/travel-blueprints.git',
      commit: '0123456789abcdef',
    },
    signature: {
      algorithm: 'Ed25519',
      keyId: 'a'.repeat(64),
      value: 'c2lnbmF0dXJl',
    },
  };
  assert.equal(validate(metadata), true, JSON.stringify(validate.errors));
});

test('Blueprint package schema rejects reserved IDs, path escapes, code entries, and missing license', () => {
  for (const metadata of [
    { ...fixture(), package: { ...fixture().package, namespace: 'pixiecore.reserved' } },
    { ...fixture(), blueprints: [{ ...fixture().blueprints[0], path: '../escape.yaml' }] },
    { ...fixture(), blueprints: [{ ...fixture().blueprints[0], entry: 'index.js' }] },
    { ...fixture(), package: { name: 'acme.travel-blueprints', namespace: 'acme.travel', version: '1.0.0' } },
    { ...fixture(), dependencies: { unnamespaced: '^1.0.0' } },
    { ...fixture(), provenance: { commit: 'not-a-revision' } },
    { ...fixture(), signature: { algorithm: 'RSA', keyId: 'a'.repeat(64), value: 'c2ln' } },
    { ...fixture(), signature: { algorithm: 'Ed25519', keyId: 'short', value: 'c2ln' } },
  ]) {
    assert.equal(validate(metadata), false, JSON.stringify(metadata));
  }
});

function fixture() {
  return {
    schema: 'pixiecore.blueprint-package/v1',
    package: {
      name: 'acme.travel-blueprints',
      namespace: 'acme.travel',
      version: '1.0.0',
      license: 'Apache-2.0',
    },
    compatibility: { pop: '^0.1.0', pixiecore: '^0.1.0' },
    blueprints: [{
      id: 'acme.travel.date-normalizer',
      version: '1.0.0',
      path: 'blueprints/date-normalizer.yaml',
    }],
    files: {
      'blueprints/date-normalizer.yaml': `sha256-${'A'.repeat(43)}=`,
    },
  };
}
