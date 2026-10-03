import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Ajv2020 } from 'ajv/dist/2020.js';

type JsonObject = Record<string, unknown>;

interface ValidationFixture {
  id: string;
  artifact: keyof typeof artifactSchemas;
  document: unknown;
  expected_valid: boolean;
}

interface ComparisonFixture {
  id: string;
  comparison: JsonObject;
  output_schema?: JsonObject;
  expected_output: JsonObject;
  actual_output: JsonObject;
  expected_semantic_valid: boolean;
}

interface RuntimeFixture {
  id: string;
  blueprint: JsonObject;
  inputs: JsonObject;
  generated_output: unknown;
  expected:
    | { outcome: 'success'; output: JsonObject }
    | { outcome: 'validation_error'; stage: 'input' | 'output' };
}

interface CapabilityFixture {
  id: string;
  blueprint: JsonObject & { requires?: string[] };
  supported_capabilities: string[];
  expected: { supported: boolean; missing_capability?: string };
}

interface ConformanceSuite {
  schema: string;
  specification: string;
  validation: ValidationFixture[];
  comparison: ComparisonFixture[];
  runtime: RuntimeFixture[];
  capability: CapabilityFixture[];
}

const readJson = async (path: string): Promise<JsonObject> => JSON.parse(
  await readFile(new URL(path, import.meta.url), 'utf8'),
) as JsonObject;

const [suiteSchema, blueprintSchema, datasetSchema, resultSchema, packageSchema, suite] =
  await Promise.all([
    readJson('../../schemas/pop.conformance-suite-0.1.schema.json'),
    readJson('../../schemas/pop.blueprint-0.1.schema.json'),
    readJson('../../schemas/pop.evaluation-dataset-0.1.schema.json'),
    readJson('../../schemas/pop.evaluation-result-0.1.schema.json'),
    readJson('../../schemas/pop.blueprint-package-0.1.schema.json'),
    readJson('../../conformance/pop-0.1/suite.json') as Promise<unknown> as Promise<ConformanceSuite>,
  ]);

const artifactSchemas = {
  blueprint: blueprintSchema,
  evaluation_dataset: datasetSchema,
  evaluation_result: resultSchema,
  blueprint_package: packageSchema,
};

test('POP 0.1 conformance suite is schema-valid and has globally unique case IDs', () => {
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(suiteSchema);
  assert.equal(validate(suite), true, JSON.stringify(validate.errors, null, 2));

  const ids = [
    ...suite.validation,
    ...suite.comparison,
    ...suite.runtime,
    ...suite.capability,
  ].map(fixture => fixture.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('validation fixtures produce their declared portable schema outcomes', () => {
  const validators = Object.fromEntries(Object.entries(artifactSchemas).map(
    ([artifact, schema]) => [
      artifact,
      new Ajv2020({ allErrors: true, strict: true }).compile(schema),
    ],
  ));

  for (const fixture of suite.validation) {
    const actual = validators[fixture.artifact]!(fixture.document);
    assert.equal(actual, fixture.expected_valid, fixture.id);
  }
});

test('comparison fixtures have implementation-independent expected outcomes', () => {
  for (const fixture of suite.comparison) {
    assert.equal(compare(fixture), fixture.expected_semantic_valid, fixture.id);
  }
});

test('runtime fixtures enforce input before generation and output before success', () => {
  const blueprintValidator = new Ajv2020({ allErrors: true, strict: true }).compile(blueprintSchema);

  for (const fixture of suite.runtime) {
    assert.equal(blueprintValidator(fixture.blueprint), true, fixture.id);
    const inputSchema = fixture.blueprint.input_schema as JsonObject | undefined;
    if (inputSchema && !validateJsonSchema(inputSchema, fixture.inputs)) {
      assert.deepEqual(fixture.expected, { outcome: 'validation_error', stage: 'input' }, fixture.id);
      continue;
    }

    const outputSchema = fixture.blueprint.output_schema as JsonObject;
    if (!validateJsonSchema(outputSchema, fixture.generated_output)) {
      assert.deepEqual(fixture.expected, { outcome: 'validation_error', stage: 'output' }, fixture.id);
      continue;
    }

    assert.deepEqual(
      fixture.expected,
      { outcome: 'success', output: fixture.generated_output },
      fixture.id,
    );
  }
});

test('capability fixtures distinguish support from a missing required capability', () => {
  for (const fixture of suite.capability) {
    const supported = new Set(fixture.supported_capabilities);
    const missing = (fixture.blueprint.requires ?? []).find(capability => !supported.has(capability));
    assert.equal(missing === undefined, fixture.expected.supported, fixture.id);
    assert.equal(missing, fixture.expected.missing_capability, fixture.id);
  }
});

test('published conformance data is independent of one implementation or host language', () => {
  const serialized = JSON.stringify({ suiteSchema, suite });
  assert.doesNotMatch(
    serialized,
    /PixieCore|TypeScript|PromptRuntime|node_modules|src\/|\.ts\b/u,
  );
});

function compare(fixture: ComparisonFixture): boolean {
  const mode = fixture.comparison.mode;
  if (mode === 'exact') {
    return isDeepStrictEqual(fixture.expected_output, fixture.actual_output);
  }
  if (mode === 'schema') {
    return fixture.output_schema !== undefined
      && validateJsonSchema(fixture.output_schema, fixture.expected_output)
      && validateJsonSchema(fixture.output_schema, fixture.actual_output);
  }
  if (mode === 'fields') {
    return readPointers(fixture.comparison.pointers).every(pointer =>
      isDeepStrictEqual(atPointer(fixture.expected_output, pointer), atPointer(fixture.actual_output, pointer))
    );
  }
  if (mode === 'set') {
    const pointer = String(fixture.comparison.pointer);
    return setsEqual(atPointer(fixture.expected_output, pointer), atPointer(fixture.actual_output, pointer));
  }
  if (mode === 'numeric_tolerance') {
    return readPointers(fixture.comparison.pointers).every(pointer => {
      const expected = atPointer(fixture.expected_output, pointer);
      const actual = atPointer(fixture.actual_output, pointer);
      if (typeof expected !== 'number' || typeof actual !== 'number') return false;
      const absolute = typeof fixture.comparison.absolute_tolerance === 'number'
        ? fixture.comparison.absolute_tolerance
        : 0;
      const relative = typeof fixture.comparison.relative_tolerance === 'number'
        ? fixture.comparison.relative_tolerance * Math.abs(expected)
        : 0;
      return Math.abs(actual - expected) <= Math.max(absolute, relative);
    });
  }
  return false;
}

function readPointers(value: unknown): string[] {
  assert.ok(Array.isArray(value));
  return value.map(String);
}

function atPointer(value: unknown, pointer: string): unknown {
  if (pointer === '') return value;
  return pointer.slice(1).split('/').reduce<unknown>((current, token) => {
    if (!isObject(current) && !Array.isArray(current)) return undefined;
    const key = token.replace(/~1/gu, '/').replace(/~0/gu, '~');
    return (current as Record<string, unknown>)[key];
  }, value);
}

function setsEqual(expected: unknown, actual: unknown): boolean {
  if (!Array.isArray(expected) || !Array.isArray(actual)) return false;
  const normalize = (values: unknown[]): Set<string> => new Set(values.map(canonicalJson));
  const expectedSet = normalize(expected);
  const actualSet = normalize(actual);
  return expectedSet.size === actualSet.size
    && [...expectedSet].every(value => actualSet.has(value));
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function validateJsonSchema(schema: JsonObject, value: unknown): boolean {
  return new Ajv2020({ allErrors: true, strict: true }).compile(schema)(value) as boolean;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
