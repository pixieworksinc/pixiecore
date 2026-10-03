import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import test from 'node:test';
import YAML from 'yaml';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const schemaPath = join(projectRoot, 'schemas', 'pixiecore.plugin-v1.schema.json');
const packageSchemaPath = join(
  projectRoot,
  'schemas',
  'pixiecore.plugin-package-v1.schema.json',
);
const exampleManifestPaths = [
  join(projectRoot, 'examples', 'plugin-project', 'custom', 'plugins', 'roles', 'converter', 'converter.yaml'),
  join(projectRoot, 'examples', 'plugin-project', 'custom', 'plugins', 'roles', 'classifier', 'classifier.yaml'),
  ...['sample-role', 'sample-decorator', 'sample-tool', 'sample-provider'].map(name => (
    join(projectRoot, 'examples', 'plugin-authoring', name, `${name}.yaml`)
  )),
];

const schema = JSON.parse(await readFile(schemaPath, 'utf8')) as object;
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
const packageSchema = JSON.parse(await readFile(packageSchemaPath, 'utf8')) as object;
const validatePackage = new Ajv2020({ allErrors: true, strict: true }).compile(packageSchema);

test('published managed-plugin schema accepts every packaged plugin example', async () => {
  for (const manifestPath of exampleManifestPaths) {
    const manifest = YAML.parse(await readFile(manifestPath, 'utf8')) as unknown;
    assert.equal(validate(manifest), true, `${manifestPath}: ${JSON.stringify(validate.errors)}`);
  }
});

test('published managed-plugin schema covers every supported custom authoring form', () => {
  const baseManifest = {
    schema: 'pixiecore.plugin/v1',
    id: 'example.plugin',
    name: 'Example plugin',
    version: '1.0.0',
    entry: './index.js',
  };
  const validManifests = [
    baseManifest,
    {
      ...baseManifest,
      components: [{
        type: 'decorator',
        export: 'ContentGuard',
        module: './decorator.js',
        priority: 15,
        stage: 'both',
      }],
    },
    {
      ...baseManifest,
      components: [{
        type: 'tool',
        export: 'LookupTool',
        module: './tool.js',
        tool_name: 'lookup',
      }],
    },
    {
      ...baseManifest,
      components: [{
        type: 'provider',
        export: 'CompanyProvider',
        provider_name: 'company_provider',
      }],
    },
  ];

  for (const manifest of validManifests) {
    assert.equal(validate(manifest), true, JSON.stringify(validate.errors));
  }
});

test('published managed-plugin schema rejects reserved, core-only, and unknown fields', () => {
  const baseManifest = {
    schema: 'pixiecore.plugin/v1',
    id: 'example.role',
    name: 'Example role',
    version: '1.0.0',
    entry: './index.mjs',
  };
  const invalidManifests = [
    { ...baseManifest, id: 'pixiecore.spoof' },
    { ...baseManifest, id: 'Example.Role' },
    { ...baseManifest, version: '1.0.0-01' },
    { ...baseManifest, enabled: true },
    {
      ...baseManifest,
      components: [{
        type: 'service',
        export: 'createService',
        service_id: 'example.service',
      }],
    },
    { ...baseManifest, components: [] },
    {
      ...baseManifest,
      components: [{ type: 'agent_role', export: 'MissingRoles' }],
    },
    {
      ...baseManifest,
      components: [{
        type: 'tool',
        class: 'LegacyAlias',
        export: 'LegacyAlias',
        tool_name: 'legacy_alias',
      }],
    },
  ];

  for (const manifest of invalidManifests) {
    assert.equal(validate(manifest), false, JSON.stringify(manifest));
  }
});

test('published distribution schema accepts integrity and provenance metadata', () => {
  const metadata = {
    schema: 'pixiecore.plugin-package/v1',
    plugin: {
      id: 'example.tool',
      version: '1.0.0',
      manifest: 'tool.yaml',
      entry: 'tool.js',
    },
    compatibility: { pixiecore: '^1.0.0' },
    files: { 'tool.js': `sha256-${'A'.repeat(43)}=` },
    provenance: {
      source: 'https://example.invalid/tool.git',
      commit: '0123456789abcdef',
    },
    signature: {
      algorithm: 'Ed25519',
      keyId: 'a'.repeat(64),
      value: 'c2lnbmF0dXJl',
    },
  };
  assert.equal(validatePackage(metadata), true, JSON.stringify(validatePackage.errors));
  assert.equal(validatePackage({ ...metadata, unexpected: true }), false);
  assert.equal(validatePackage({
    ...metadata,
    files: { 'tool.js': 'md5-not-supported' },
  }), false);
});
