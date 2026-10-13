import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import YAML from 'yaml';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const schemaPath = join(projectRoot, 'schemas', 'pixiecore.blueprint-v2.schema.json');
const schema = JSON.parse(await readFile(schemaPath, 'utf8')) as object;
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

test('current Blueprint schema accepts every repository Blueprint example', async () => {
  const yamlPaths = await collectYamlFiles(join(projectRoot, 'examples'));
  let blueprintCount = 0;

  for (const path of yamlPaths) {
    const candidate = YAML.parse(await readFile(path, 'utf8')) as unknown;
    if (!isBlueprintCandidate(candidate)) continue;
    blueprintCount++;
    assert.equal(validate(candidate), true, `${path}: ${JSON.stringify(validate.errors)}`);
  }

  assert.ok(blueprintCount > 0, 'Expected at least one packaged Blueprint example');
});

test('v2 Scenario schema agrees with runtime validation while v1 remains text-only', async () => {
  const candidate = YAML.parse(await readFile(
    join(projectRoot, 'examples/customer-discount/customer-discount.yaml'), 'utf8',
  )) as Record<string, unknown>;
  assert.equal(validate(candidate), true, JSON.stringify(validate.errors));
  const legacy = JSON.parse(await readFile(
    join(projectRoot, 'schemas/pixiecore.blueprint-v1.schema.json'), 'utf8',
  )) as object;
  const validateLegacy = new Ajv2020({ strict: true }).compile(legacy);
  assert.equal(validateLegacy(candidate), false);
  assert.equal(validateLegacy({ ...candidate, prompt: 'Return JSON.' }), true);
  const instruction = { Given: 'Input', When: 'Check', Then: 'Return' };
  const invalid = [
    { Scenario: [] },
    { Scenario: [{ Role: '', Instruction: instruction }] },
    { Scenario: [{ Role: 'classifier', Instruction: { ...instruction, Given: 1 } }] },
    { Scenario: [{ Role: 'classifier', Instruction: { ...instruction, And: [] } }] },
    { Scenario: [{ Role: 'classifier', Instruction: { ...instruction, extra: 'typo' } }] },
    { agent_role: '', Scenario: [{ Role: 'classifier', Instruction: instruction }] },
    { extra: 'typo', Scenario: [{ Role: 'classifier', Instruction: instruction }] },
  ];
  for (const prompt of invalid) assert.equal(validate({ ...candidate, prompt }), false);
});

test('published Blueprint schema describes supported fields and extension points', () => {
  const candidate = {
    name: 'Classify request',
    version: '1.2',
    role: 'company_classifier',
    prompt: 'Classify {{ request }}.',
    input_placeholders: [
      'legacy_input',
      {
        name: 'request',
        type: 'object',
        required: true,
        description: 'Request to classify',
        extension_hint: 'accepted for forward compatibility',
      },
    ],
    input_schema: { type: 'object' },
    output_schema: '{"type":"object"}',
    localization: { language: 'en-US' },
    permissions: { allow_roles: ['reviewer'], company_groups: ['operations'] },
    examples: [{ input: { request: {} }, output: { category: 'standard' } }],
    model: 'company-model',
    temperature: 0,
    tools: ['lookup_policy'],
    extension_policy: { owner: 'company' },
  };

  assert.equal(validate(candidate), true, JSON.stringify(validate.errors));
});

test('published Blueprint schema reports structural editor diagnostics', () => {
  const base = {
    name: 'Validate request',
    version: '1.0',
    role: 'validator',
    prompt: 'Validate the request.',
    output_schema: { type: 'object' },
  };
  const invalid = [
    { ...base, prompt: undefined },
    { ...base, name: '   ' },
    { ...base, version: '1' },
    { ...base, role: '' },
    { ...base, output_schema: [] },
    { ...base, input_placeholders: [{ name: 'value', type: 'unknown' }] },
    { ...base, permissions: { allow_roles: 'reviewer' } },
    { ...base, examples: [{ input: {}, output: 'invalid' }] },
    { ...base, localization: { language: 1 } },
    { ...base, model: '   ' },
    { ...base, tools: [''] },
  ];

  for (const candidate of invalid) {
    assert.equal(validate(candidate), false, JSON.stringify(candidate));
  }
});

async function collectYamlFiles(root: string): Promise<string[]> {
  const paths: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) paths.push(...await collectYamlFiles(path));
    else if (entry.isFile() && /\.ya?ml$/i.test(entry.name)) paths.push(path);
  }
  return paths.sort();
}

function isBlueprintCandidate(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  return 'prompt' in value && 'output_schema' in value;
}
