import assert from 'node:assert/strict';
import test from 'node:test';
import YAML from 'yaml';
import {
  buildLegacyPluginManifest,
  buildManagedPluginManifestV1,
} from '../helpers/plugin.js';

test('managed v1 manifest fixture emits the canonical schema, identity, version, and entry', () => {
  const source = buildManagedPluginManifestV1({
    id: 'acme.converter',
    name: 'Acme Converter',
    version: '1.2.3',
    entry: './index.js',
  });

  assert.equal(source, [
    'schema: pixiecore.plugin/v1',
    'id: "acme.converter"',
    'name: "Acme Converter"',
    'version: "1.2.3"',
    'entry: "./index.js"',
    '',
  ].join('\n'));
  assert.deepEqual(YAML.parse(source), {
    schema: 'pixiecore.plugin/v1',
    id: 'acme.converter',
    name: 'Acme Converter',
    version: '1.2.3',
    entry: './index.js',
  });
});

test('legacy manifest fixture remains explicitly unversioned and module-based', () => {
  assert.deepEqual(YAML.parse(buildLegacyPluginManifest({ name: 'Legacy Plugin' })), {
    name: 'Legacy Plugin',
    module: './plugin.mjs',
  });
});
