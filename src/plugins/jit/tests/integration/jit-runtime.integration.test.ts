import assert from 'node:assert/strict';
import test from 'node:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  captureLogs,
  PromptRuntime,
  SchemaValidationError,
} from '../../../../index.js';
import type { Blueprint, JitExecutionEvent, JitProgram, OutputDecorator } from '../../../../index.js';
import { BlueprintValidator } from '../../../validation/validation.js';
import { ScriptedProvider } from '../../../../../tests/helpers/fake-provider.js';
import { withTempDirectory } from '../../../../../tests/helpers/temp.js';
import {
  blueprintDigest,
  jitProgramDigest,
  validateJitProgram,
} from '../../jit.js';

const SOURCE = `name: Greeting
version: '1.0.0'
role: assistant
input_placeholders:
  - name: name
    type: string
    required: true
prompt: |
  Return a greeting for {{ name }}.
output_schema: |
  {"type":"object","properties":{"greeting":{"type":"string"}},"required":["greeting"],"additionalProperties":false}
`;

const PROGRAM = validateJitProgram({
  outputs: {
    greeting: {
      kind: 'concat',
      parts: [
        { kind: 'const', value: 'Hello ' },
        { kind: 'input', name: 'name' },
      ],
    },
  },
});

test('runtime rejects an ambiguous blank promotion path before acquiring resources', () => {
  assert.throws(
    () => new PromptRuntime({ promotionsPath: '   ' }),
    /promotionsPath must be a non-blank string/u,
  );
});

test('opt-in runtime executes an admitted program without a provider call and audits its digest', async () => {
  await withTempDirectory(async directory => {
    const path = await writeArtifact(directory, SOURCE, 'fixture-model', PROGRAM);
    const provider = new ScriptedProvider([], { model: 'fixture-model' });
    const events: JitExecutionEvent[] = [];
    await using runtime = new PromptRuntime({
      provider,
      promotionsPath: path,
      onJitEvent: event => events.push(event),
      mcpConfigPath: 'disabled',
      pluginConfigPath: 'disabled',
      maxRetry: 0,
    });
    using logs = captureLogs(runtime.logger);

    assert.deepEqual(await runtime.executeYaml(SOURCE, { name: 'Ada' }), { greeting: 'Hello Ada' });
    assert.deepEqual(await runtime.executeYaml(SOURCE, { name: 'Grace' }), { greeting: 'Hello Grace' });
    assert.equal(provider.calls.length, 0);
    assert.deepEqual(events, [{
      outcome: 'compiled',
      blueprint: 'Greeting',
      version: '1.0.0',
      model: 'fixture-model',
      artifact: jitProgramDigest(PROGRAM),
    }, {
      outcome: 'compiled',
      blueprint: 'Greeting',
      version: '1.0.0',
      model: 'fixture-model',
      artifact: jitProgramDigest(PROGRAM),
    }]);
    const decision = logs.records.find(record => record.step === 'jit_execution');
    assert.equal(decision?.event, 'compiled');
    assert.equal(decision?.artifact, jitProgramDigest(PROGRAM));
    assert.equal('inputs' in (decision ?? {}), false);
    assert.equal('output' in (decision ?? {}), false);
  });
});

test('compiled path preserves permission and output-decorator guards', async () => {
  await withTempDirectory(async directory => {
    const protectedSource = `${SOURCE}permissions:\n  allow_roles: [admin]\n`;
    const path = await writeArtifact(directory, protectedSource, 'fixture-model', PROGRAM);
    const provider = new ScriptedProvider([], { model: 'fixture-model' });
    const events: JitExecutionEvent[] = [];
    await using runtime = new PromptRuntime({
      provider,
      promotionsPath: path,
      onJitEvent: event => events.push(event),
      mcpConfigPath: 'disabled',
      pluginConfigPath: 'disabled',
      maxRetry: 0,
    });

    await assert.rejects(
      runtime.executeYaml(protectedSource, { name: 'Ada' }),
      /Role is not allowed/u,
    );
    assert.equal(provider.calls.length, 0);
    assert.deepEqual(events, []);

    runtime.processor.registerDecorator(invalidatingDecorator(), 5);
    await assert.rejects(
      runtime.executeYaml(protectedSource, { name: 'Ada', user_role: 'admin' }),
      SchemaValidationError,
    );
    assert.equal(provider.calls.length, 0);
  });
});

test('missing, invalid, stale, and model-mismatched promotions fall back to the provider', async t => {
  const cases = [
    { name: 'missing artifact', prepare: async (directory: string) => join(directory, 'missing.json'), reason: 'artifact_unavailable' },
    {
      name: 'invalid artifact',
      prepare: async (directory: string) => {
        const path = join(directory, 'invalid.json');
        await writeFile(path, '{not-json', 'utf8');
        return path;
      },
      reason: 'artifact_invalid',
    },
    {
      name: 'promotion missing',
      prepare: (directory: string) => writeArtifact(
        directory,
        SOURCE.replace('name: Greeting', 'name: Other Greeting'),
        'fixture-model',
        PROGRAM,
      ),
      reason: 'promotion_missing',
    },
    {
      name: 'changed source',
      prepare: (directory: string) => writeArtifact(directory, SOURCE.replace('Return a greeting', 'Return one greeting'), 'fixture-model', PROGRAM),
      reason: 'source_changed',
    },
    {
      name: 'changed model',
      prepare: (directory: string) => writeArtifact(directory, SOURCE, 'other-model', PROGRAM),
      reason: 'model_changed',
    },
  ] as const;

  for (const item of cases) {
    await t.test(item.name, () => withTempDirectory(async directory => {
      const path = await item.prepare(directory);
      const provider = new ScriptedProvider([{ content: '{"greeting":"From model"}' }], { model: 'fixture-model' });
      const events: JitExecutionEvent[] = [];
      await using runtime = new PromptRuntime({
        provider,
        promotionsPath: path,
        onJitEvent: event => events.push(event),
        mcpConfigPath: 'disabled',
        pluginConfigPath: 'disabled',
        maxRetry: 0,
      });

      assert.deepEqual(await runtime.executeYaml(SOURCE, { name: 'Ada' }), { greeting: 'From model' });
      assert.equal(provider.calls.length, 1);
      assert.equal(events[0]?.outcome, 'fallback');
      assert.equal(events[0]?.outcome === 'fallback' ? events[0].reason : undefined, item.reason);
    }));
  }
});

test('JIT observation failures never change compiled execution', async () => {
  await withTempDirectory(async directory => {
    const path = await writeArtifact(directory, SOURCE, 'fixture-model', PROGRAM);
    const provider = new ScriptedProvider([], { model: 'fixture-model' });
    await using runtime = new PromptRuntime({
      provider,
      promotionsPath: path,
      onJitEvent() {
        throw new Error('observer failure');
      },
      mcpConfigPath: 'disabled',
      pluginConfigPath: 'disabled',
      maxRetry: 0,
    });

    assert.deepEqual(await runtime.executeYaml(SOURCE, { name: 'Lin' }), { greeting: 'Hello Lin' });
    assert.equal(provider.calls.length, 0);
  });
});

function invalidatingDecorator(): OutputDecorator {
  return {
    stage: 'after',
    validate(context) {
      return { ...context, output: { greeting: 42 } };
    },
  };
}

async function writeArtifact(
  directory: string,
  source: string,
  model: string,
  program: JitProgram,
): Promise<string> {
  const blueprint = new BlueprintValidator().validateYaml(source) as Blueprint;
  const path = join(directory, 'promotions.json');
  await writeFile(path, `${JSON.stringify({
    schema: 'pixiecore.jit-promotions/v1',
    note: 'test artifact',
    promotions: [{
      blueprint: blueprint.name,
      version: blueprint.version,
      model,
      source_digest: blueprintDigest(blueprint),
      artifact_digest: jitProgramDigest(program),
      evidence: {
        dataset_digest: `sha256:${'1'.repeat(64)}`,
        seed: 'fixture-seed',
        case_count: 1,
        run_count: 1,
        correct: 1,
        agreed: 1,
        measured_at: '2026-08-27T12:00:00.000Z',
      },
      program,
    }],
  })}\n`, 'utf8');
  return path;
}
