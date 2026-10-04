import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import YAML from 'yaml';
import {
  BlueprintValidationError,
  BlueprintValidator,
  PromptRuntime,
} from '../../../../index.js';
import { runBlueprintEvaluation } from '../../../../core/kernel/evaluation/index.js';
import { ScriptedProvider } from '../../../../../tests/helpers/fake-provider.js';

const blueprintPath = new URL('../../../../../examples/customer-discount/customer-discount.yaml', import.meta.url);
const source = await readFile(blueprintPath, 'utf8');
const declaration = YAML.parse(source) as Record<string, unknown>;

test('structured Roles reach one provider call with input binding and declared order', async () => {
  // Deliberately incorrect but schema-valid: runtime must not recompute policy.
  const providerResult = { discount: 0, final_price: 1500 };
  const provider = new ScriptedProvider([{ content: JSON.stringify(providerResult) }]);
  await using runtime = new PromptRuntime({
    provider, mcpConfigPath: 'disabled', logToConsole: false,
  });
  const result = await runtime.executeYaml(source, {
    customer_tier: 'Gold', purchase_amount: 1500,
  });
  assert.deepEqual(result, providerResult);
  assert.equal(provider.calls.length, 1);
  const prompt = provider.calls[0]!.messages.at(-1)!.content;
  assert.equal(typeof prompt, 'string');
  const decoded = YAML.parse(prompt as string) as {
    Scenario: { Role: string; Instruction: { Given: string } }[];
  };
  assert.deepEqual(decoded.Scenario.map(step => step.Role), [
    'classifier', 'converter', 'verifier', 'orchestrator',
  ]);
  assert.match(decoded.Scenario[0]!.Instruction.Given, /Gold.*1500/u);
  assert.doesNotMatch(prompt as string, /\{\{\s*(?:customer_tier|purchase_amount)\s*\}\}/u);
  assert.deepEqual(provider.calls[0]!.tools ?? [], []);
});

test('structured prompt normalization preserves the source and existing Role plugin contract', () => {
  const original = structuredClone(declaration);
  const warnings: string[] = [];
  const validator = new BlueprintValidator({ warn: value => warnings.push(value) });
  const result = validator.validateDict(declaration);
  assert.equal(typeof result.prompt, 'string');
  assert.deepEqual(YAML.parse(result.prompt), original.prompt);
  assert.deepEqual(declaration, original);
  assert.deepEqual(warnings, []);
});

test('invalid Scenario declarations fail before provider execution', async () => {
  const instruction = { Given: 'Input', When: 'Compare', Then: 'Return' };
  const step = { Role: 'classifier', Instruction: instruction };
  const invalid = [
    null, 42, [], {},
    { Scenario: [] },
    { agent_role: '', Scenario: [step] },
    { Scenario: 'not an array' },
    { Scenario: [null] },
    { Scenario: [{ ...step, Role: '' }] },
    { Scenario: [{ Role: 'classifier', Instruction: 'Return JSON' }] },
    { Scenario: [{ ...step, Instruction: { ...instruction, Given: 42 } }] },
    { Scenario: [{ ...step, Instruction: { ...instruction, When: '' } }] },
    { Scenario: [{ ...step, Instruction: { Given: 'Input', When: 'Compare' } }] },
    { Scenario: [{ ...step, Instruction: { ...instruction, And: [] } }] },
    { Scenario: [{ ...step, Instruction: { ...instruction, And: [1] } }] },
    { Scenario: [{ ...step, Instruction: { ...instruction, And: [''] } }] },
    { Scenario: [{ ...step, Instruction: { ...instruction, Unknown: 'typo' } }] },
    { Scenario: [{ ...step, Unknown: 'typo' }] },
    { Scenario: [step], Unknown: 'typo' },
  ];
  const provider = new ScriptedProvider([]);
  await using runtime = new PromptRuntime({
    provider, mcpConfigPath: 'disabled', logToConsole: false,
  });
  for (const prompt of invalid) {
    await assert.rejects(runtime.executeYaml(YAML.stringify({ ...declaration, prompt }), {
      customer_tier: 'Gold', purchase_amount: 1500,
    }), BlueprintValidationError);
  }
  assert.equal(provider.calls.length, 0);
});

test('Scenario instruction bindings use the same declared-placeholder validation as text', () => {
  const validator = new BlueprintValidator();
  assert.throws(() => validator.validateDict({
    ...declaration,
    prompt: { Scenario: [{
      Role: 'verifier',
      Instruction: { Given: '{{ undeclared }}', When: 'Check', Then: 'Return' },
    }] },
  }), /undeclared input placeholder: undeclared/u);
});

test('Scenario reasoning hints need no Role plugin registration or optional fields', async () => {
  const provider = new ScriptedProvider([{ content: '{"discount":0,"final_price":500}' }]);
  await using runtime = new PromptRuntime({
    provider, mcpConfigPath: 'disabled', logToConsole: false,
  });
  const prompt = { Scenario: [{
    Role: 'business-reviewer-without-plugin',
    Instruction: { Given: 'Amount {{ purchase_amount }}', When: 'Review', Then: 'Return JSON' },
  }] };
  const result = await runtime.executeYaml(YAML.stringify({ ...declaration, prompt }), {
    customer_tier: 'Silver', purchase_amount: 500,
  });
  assert.deepEqual(result, { discount: 0, final_price: 500 });
  assert.equal(provider.calls.length, 1);
  assert.match(provider.calls[0]!.messages.at(-1)!.content as string,
    /business-reviewer-without-plugin/u);
});

test('semantic evaluation catches schema-valid discount errors from the provider', async () => {
  const path = new URL('../../../../../examples/customer-discount/evaluations/customer-discount.yaml', import.meta.url);
  const dataset = YAML.parse(await readFile(path, 'utf8')) as {
    cases: { expected_output: { discount: number; final_price: number } }[];
  };
  const provider = new ScriptedProvider(dataset.cases.map((item, index) => ({
    content: JSON.stringify(index === 0
      ? { discount: 0, final_price: 1500 }
      : item.expected_output),
  })));
  const result = await runBlueprintEvaluation({
    datasetPath: path.pathname,
    seed: 'scenario-discount-semantic-regression',
    runtimeOptions: { provider, mcpConfigPath: 'disabled', logToConsole: false },
  });
  assert.equal(result.cases[0]!.status, 'failed');
  assert.ok(result.cases.slice(1).every(item => item.status === 'passed'));
  assert.equal(provider.calls.length, dataset.cases.length);
});
