import test from 'node:test';
import assert from 'node:assert/strict';
import { BlueprintValidationError, BlueprintValidator } from '../../../../index.js';

const minimal = {
  name: 'Contract',
  version: '1.0',
  role: 'assistant',
  prompt: 'Return a result',
  output_schema: '{"type":"object"}',
};

test('Blueprint contract accepts supported versions and optional fields', () => {
  const validator = new BlueprintValidator();
  for (const version of ['1.0', '1.0.0', '2.3.4', '10.20.30']) {
    const result = validator.validateDict({
      ...minimal,
      version,
      model: 'model-id',
      temperature: 0.2,
      localization: { language: 'en', currency: 'USD' },
      permissions: { allow_roles: ['admin'], deny_users: ['blocked@example.com'] },
      input_placeholders: [{ name: 'name', type: 'string', required: false, description: 'A name' }],
      input_schema: {
        type: 'object',
        properties: { name: { type: 'string', minLength: 1 } },
      },
      examples: [{ input: { name: 'Ada' }, output: { greeting: 'Hello' } }],
    });
    assert.equal(result.version, version);
  }
});

test('Blueprint contract reports every required field and invalid schema', () => {
  for (const field of ['name', 'version', 'role', 'prompt', 'output_schema']) {
    const invalid = { ...minimal } as Record<string, unknown>;
    delete invalid[field];
    assert.throws(() => new BlueprintValidator().validateDict(invalid), error => error instanceof BlueprintValidationError && error.message.includes(field));
  }
  assert.throws(() => new BlueprintValidator().validateDict({ ...minimal, output_schema: 'not-json' }), /valid JSON/);
  assert.throws(() => new BlueprintValidator().validateDict({ ...minimal, input_schema: 'not-json' }), /input_schema must be valid JSON Schema/);
});

test('Blueprint contract turns malformed placeholder structures into validation errors', () => {
  for (const input_placeholders of [[null], [42], [{}], [{ name: 'x' }], [{ name: 'x', type: 'wat' }], [{ name: 'x', type: 'string', required: 'yes' }]]) {
    assert.throws(() => new BlueprintValidator().validateDict({ ...minimal, input_placeholders }), BlueprintValidationError);
  }
});

test('Blueprint contract rejects invalid and duplicate placeholder names', () => {
  const validator = new BlueprintValidator();
  assert.throws(
    () => validator.validateDict({ ...minimal, input_placeholders: ['not portable'] }),
    /has invalid name/u,
  );
  assert.throws(
    () => validator.validateDict({
      ...minimal,
      input_placeholders: ['duplicate', { name: 'duplicate', type: 'string' }],
    }),
    /Duplicate input placeholder: duplicate/u,
  );
});

test('Blueprint contract requires prompt and localization bindings to be declared', () => {
  const validator = new BlueprintValidator();
  assert.throws(
    () => validator.validateDict({
      ...minimal,
      prompt: 'Normalize {{ date_text }} for {{ locale }}',
      input_placeholders: [{ name: 'date_text', type: 'string' }],
    }),
    /prompt references undeclared input placeholder: locale/u,
  );
  assert.throws(
    () => validator.validateDict({
      ...minimal,
      prompt: 'Normalize {{ date_text }}',
      input_placeholders: [{ name: 'date_text', type: 'string' }],
      localization: { locale: 'Format for {{ locale }} and {{ timezone }}' },
    }),
    /localization\.locale references undeclared input placeholders: locale, timezone/u,
  );
  assert.doesNotThrow(() => validator.validateDict({
    ...minimal,
    prompt: 'Normalize {{ date_text }} and legacy {locale}',
    input_placeholders: [
      { name: 'date_text', type: 'string' },
      { name: 'locale', type: 'string' },
    ],
  }));
});

test('Blueprint Gherkin validation is advisory', () => {
  const warnings: string[] = [];
  const validator = new BlueprintValidator({ warn: warning => warnings.push(warning) });
  const result = validator.validateDict({
    ...minimal,
    prompt: `Feature: Contract\n  Scenario: Return a result\n    Given valid input`,
  });
  assert.equal(result.name, 'Contract');
  assert.deepEqual(warnings, [
    'Prompt does not follow the recommended Feature/Scenario/Given/When/Then form; free-form prompts remain valid',
  ]);

  warnings.length = 0;
  validator.validateDict({
    ...minimal,
    prompt: `Feature: Contract\n  Scenario: Return a result\n    Given valid input\n    When the Blueprint executes\n    Then return the result`,
  });
  assert.deepEqual(warnings, []);

  validator.validateDict({ ...minimal, prompt: 'Return a result as JSON.' });
  assert.deepEqual(warnings, []);
});
