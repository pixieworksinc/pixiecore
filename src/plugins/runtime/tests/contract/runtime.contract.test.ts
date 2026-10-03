import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BlueprintValidationError,
  ConfigurationError,
  InputValidationError,
  PromptRuntime,
} from '../../../../index.js';
import type { GenerateRequest, GenerateResponse } from '../../../../index.js';
import { ScriptedProvider } from '../../../../../tests/helpers/fake-provider.js';
import { testData } from '../../../../../tests/helpers/test-data.js';
import { withTempDirectory } from '../../../../../tests/helpers/temp.js';

const data = testData('runtime contract');

const yaml = `
name: Runtime contract
version: '1.0'
role: assistant
prompt: Greet {{ name }}
input_placeholders:
  - name: name
    type: string
    required: true
output_schema: '{"type":"object","properties":{"greeting":{"type":"string"}},"required":["greeting"]}'
`;

test('execute and executeYaml have equivalent results and forward history', async () => {
  await withTempDirectory(async directory => {
    const name = data.person('equivalent name');
    const greeting = `Hello ${name}`;
    const earlierQuestion = data.text('earlier question', 'question');
    const earlierAnswer = data.text('earlier answer', 'answer');
    const path = join(directory, 'blueprint.yaml');
    await writeFile(path, yaml, 'utf8');
    const provider = new ScriptedProvider([
      { content: JSON.stringify({ greeting }) },
      { content: JSON.stringify({ greeting }) },
    ]);
    const runtime = new PromptRuntime({ provider, mcpConfigPath: 'disabled', logToConsole: false });
    const messages = [
      { role: 'user' as const, content: earlierQuestion },
      { role: 'assistant' as const, content: earlierAnswer },
    ];
    try {
      const fromFile = await runtime.execute(path, { name }, { messages });
      const fromYaml = await runtime.executeYaml(yaml, { name }, { messages });
      assert.deepEqual(fromFile, { greeting });
      assert.deepEqual(fromYaml, fromFile);
      for (const call of provider.calls) {
        assert.deepEqual(call.messages.slice(-3).map(message => message.content), [
          earlierQuestion, earlierAnswer, `Greet ${name}`,
        ]);
      }
    } finally { await runtime.close(); }
  });
});

test('built-in role delivers decoded prompt text without normalization', async () => {
  const value = data.text('verbatim delivery value', 'value');
  const decodedTemplate = [
    'Feature: Preserve decoded text',
    '',
    '    Scenario: Keep indentation',
    '      Given first  value',
    '',
    '',
    '      When replacing {value}',
    '      Then preserve surrounding whitespace  ',
  ].join('\n');
  const expectedPrompt = decodedTemplate.replace('{value}', value);
  const preservedYaml = `
name: Decoded prompt delivery
version: '1.0'
role: assistant
prompt: ${JSON.stringify(decodedTemplate)}
input_placeholders:
  - name: value
    type: string
    required: true
output_schema:
  type: object
  additionalProperties: false
  required: [result]
  properties:
    result: { type: string }
`;
  const provider = new ScriptedProvider([
    { content: JSON.stringify({ result: value }) },
  ]);
  const runtime = new PromptRuntime({
    provider,
    mcpConfigPath: 'disabled',
    logToConsole: false,
  });

  try {
    assert.deepEqual(
      await runtime.executeYaml(preservedYaml, { value }),
      { result: value },
    );
    assert.equal(provider.calls.length, 1);
    assert.equal(provider.calls[0]!.messages.at(-1)?.role, 'user');
    assert.equal(provider.calls[0]!.messages.at(-1)?.content, expectedPrompt);
  } finally {
    await runtime.close();
  }
});

test('optional input_schema validates normalized business inputs before provider execution', async () => {
  const name = data.person('input schema name');
  const greeting = `Hello ${name}`;
  const schemaYaml = `
name: Input schema contract
version: '1.0'
role: assistant
prompt: Greet {{ name }}
permissions:
  allow_roles: [manager]
input_schema:
  type: object
  properties:
    name:
      type: string
      minLength: 1
  required: [name]
  additionalProperties: false
output_schema:
  type: object
  properties:
    greeting: { type: string }
  required: [greeting]
  additionalProperties: false
`;
  const provider = new ScriptedProvider([
    { content: JSON.stringify({ greeting }) },
  ]);
  const runtime = new PromptRuntime({
    provider,
    mcpConfigPath: 'disabled',
    logToConsole: false,
  });
  try {
    assert.deepEqual(
      await runtime.executeYaml(schemaYaml, { name, user_role: 'manager' }),
      { greeting },
    );
    await assert.rejects(
      runtime.executeYaml(schemaYaml, { name: '', user_role: 'manager' }),
      error => error instanceof InputValidationError
        && error.message.startsWith('Input does not match schema:'),
    );
    assert.equal(provider.calls.length, 1);
  } finally {
    await runtime.close();
  }
});

test('executeYaml and execute normalize all Blueprint loading failures', async () => {
  await withTempDirectory(async directory => {
    const runtime = new PromptRuntime({ provider: new ScriptedProvider([]), mcpConfigPath: 'disabled', logToConsole: false });
    try {
      await assert.rejects(runtime.executeYaml('{{{'), BlueprintValidationError);
      await assert.rejects(runtime.executeYaml('just a string'), BlueprintValidationError);
      await assert.rejects(runtime.executeYaml('name: incomplete'), BlueprintValidationError);
      await assert.rejects(runtime.execute(join(directory, 'missing.yaml')), BlueprintValidationError);
    } finally { await runtime.close(); }
  });
});

test('concurrent first executions share one runtime initialization', async () => {
  const firstName = data.person('concurrent first name');
  const secondName = data.person('concurrent second name');
  const provider = new ScriptedProvider([
    { content: JSON.stringify({ greeting: `Hello ${firstName}` }) },
    { content: JSON.stringify({ greeting: `Hello ${secondName}` }) },
  ]);
  const runtime = new PromptRuntime({
    provider,
    mcpConfigPath: 'disabled',
    logToConsole: false,
  });
  const originalLoad = runtime.pluginManager.load.bind(runtime.pluginManager);
  let loadCount = 0;
  runtime.pluginManager.load = async (): Promise<void> => {
    loadCount++;
    await originalLoad();
  };

  try {
    assert.deepEqual(
      await Promise.all([
        runtime.executeYaml(yaml, { name: firstName }),
        runtime.executeYaml(yaml, { name: secondName }),
      ]),
      [
        { greeting: `Hello ${firstName}` },
        { greeting: `Hello ${secondName}` },
      ],
    );
    assert.equal(loadCount, 1);
    assert.equal(provider.calls.length, 2);
  } finally {
    await runtime.close();
  }
});

test('close is idempotent after execution failure and a closed runtime cannot execute again', async () => {
  class FailingProvider extends ScriptedProvider {
    closeCount = 0;
    constructor() { super([]); }
    override async generate(_request: GenerateRequest): Promise<GenerateResponse> {
      throw new Error('fixture provider failure');
    }
    close(): void { this.closeCount++; }
  }

  const provider = new FailingProvider();
  const runtime = new PromptRuntime({ provider, mcpConfigPath: 'disabled', logToConsole: false });
  const name = data.person('failing provider name');
  await assert.rejects(runtime.executeYaml(yaml, { name }), /fixture provider failure/);
  await runtime.close();
  await runtime.close();
  assert.equal(provider.closeCount, 1);
  await assert.rejects(
    runtime.executeYaml(yaml, { name }),
    (error: unknown) => error instanceof ConfigurationError && /closed/.test(error.message),
  );
  assert.throws(
    () => runtime.registerTool({
      name: data.text('closed runtime tool name', 'tool'),
      description: data.text('closed runtime tool description'),
      parameters: { type: 'object' },
      execute: () => undefined,
    }),
    error => error instanceof ConfigurationError && /closed/.test(error.message),
  );
  assert.equal(provider.calls.length, 0);
});

test('Symbol.asyncDispose closes an injected provider exactly once', async () => {
  class DisposableProvider extends ScriptedProvider {
    closeCount = 0;
    close(): void { this.closeCount++; }
  }
  const provider = new DisposableProvider([]);
  const runtime = new PromptRuntime({ provider, mcpConfigPath: 'disabled', logToConsole: false });
  await runtime[Symbol.asyncDispose]();
  await runtime[Symbol.asyncDispose]();
  assert.equal(provider.closeCount, 1);
});

test('concurrent close callers wait for the same in-flight runtime cleanup', async () => {
  let reportCloseStarted = (): void => undefined;
  const closeStarted = new Promise<void>(resolve => { reportCloseStarted = resolve; });
  let releaseClose = (): void => undefined;
  const closeGate = new Promise<void>(resolve => { releaseClose = resolve; });
  class GatedProvider extends ScriptedProvider {
    closeCount = 0;
    async close(): Promise<void> {
      this.closeCount++;
      reportCloseStarted();
      await closeGate;
    }
  }
  const provider = new GatedProvider([]);
  const runtime = new PromptRuntime({
    provider,
    mcpConfigPath: 'disabled',
    logToConsole: false,
  });

  const first = runtime.close();
  await closeStarted;
  let secondSettled = false;
  const second = runtime.close().then(() => { secondSettled = true; });
  await Promise.resolve();
  assert.equal(secondSettled, false);
  releaseClose();
  await Promise.all([first, second]);
  assert.equal(provider.closeCount, 1);
});

test('close waits for in-flight initialization cleanup without defining the execution outcome', async () => {
  let reportLoadStarted = (): void => undefined;
  const loadStarted = new Promise<void>(resolve => { reportLoadStarted = resolve; });
  let releaseLoad = (): void => undefined;
  const loadGate = new Promise<void>(resolve => { releaseLoad = resolve; });
  class ClosingProvider extends ScriptedProvider {
    closeCount = 0;
    close(): void { this.closeCount++; }
  }
  const name = data.person('close during initialization name');
  const provider = new ClosingProvider([
    { content: JSON.stringify({ greeting: `Hello ${name}` }) },
  ]);
  const runtime = new PromptRuntime({
    provider,
    mcpConfigPath: 'disabled',
    logToConsole: false,
  });
  const originalLoad = runtime.pluginManager.load.bind(runtime.pluginManager);
  runtime.pluginManager.load = async (): Promise<void> => {
    reportLoadStarted();
    await loadGate;
    await originalLoad();
  };

  const execution = runtime.executeYaml(yaml, { name });
  await loadStarted;
  let closeSettled = false;
  const closing = runtime.close().then(() => { closeSettled = true; });
  await Promise.resolve();
  assert.equal(closeSettled, false);
  releaseLoad();
  const [, closeResult] = await Promise.allSettled([execution, closing]);
  assert.equal(closeResult.status, 'fulfilled');
  assert.equal(provider.closeCount, 1);
});

test('close waits for an active execution and rejects new executions before cleanup', async () => {
  let reportGenerateStarted = (): void => undefined;
  const generateStarted = new Promise<void>(resolve => { reportGenerateStarted = resolve; });
  let releaseGenerate = (): void => undefined;
  const generateGate = new Promise<void>(resolve => { releaseGenerate = resolve; });
  const name = data.person('active execution close name');
  class ActiveProvider extends ScriptedProvider {
    closeCount = 0;
    close(): void { this.closeCount++; }
  }
  const provider = new ActiveProvider([
    async () => {
      reportGenerateStarted();
      await generateGate;
      return { content: JSON.stringify({ greeting: `Hello ${name}` }) };
    },
  ]);
  const runtime = new PromptRuntime({
    provider,
    mcpConfigPath: 'disabled',
    logToConsole: false,
  });

  const execution = runtime.executeYaml(yaml, { name });
  await generateStarted;
  let closeSettled = false;
  const closing = runtime.close().then(() => { closeSettled = true; });
  await new Promise<void>(resolve => setImmediate(resolve));
  try {
    assert.equal(closeSettled, false);
    assert.equal(provider.closeCount, 0);
    await assert.rejects(
      runtime.executeYaml(yaml, { name }),
      error => error instanceof ConfigurationError && /closed/.test(error.message),
    );
    assert.equal(provider.calls.length, 1);
  } finally {
    releaseGenerate();
  }

  assert.deepEqual(await execution, { greeting: `Hello ${name}` });
  await closing;
  assert.equal(provider.closeCount, 1);
});

test('runtime cleanup retains every nested MCP and peer failure cause', async () => {
  const mcpFailures = [
    new Error(data.text('first MCP cleanup error')),
    new Error(data.text('second MCP cleanup error')),
  ];
  const pluginFailure = new Error(data.text('plugin cleanup error'));
  const providerFailure = new Error(data.text('provider cleanup error'));
  class ThrowingProvider extends ScriptedProvider {
    close(): void { throw providerFailure; }
  }
  const runtime = new PromptRuntime({
    provider: new ThrowingProvider([]),
    mcpConfigPath: 'disabled',
    logToConsole: false,
  });
  runtime.mcpManager.close = async (): Promise<void> => {
    throw new AggregateError(mcpFailures, 'MCP cleanup failed');
  };
  runtime.pluginManager.close = async (): Promise<void> => { throw pluginFailure; };

  await assert.rejects(runtime.close(), error => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.message, 'Failed to close one or more runtime resources');
    assert.equal(error.errors.length, 3);
    assert.ok(error.errors[0] instanceof AggregateError);
    assert.deepEqual(error.errors[0].errors, mcpFailures);
    assert.equal(error.errors[1], pluginFailure);
    assert.equal(error.errors[2], providerFailure);
    return true;
  });
  await runtime.close();
});

test('abort after a provider response prevents tool, decorator, and retry work', async () => {
  const controller = new AbortController();
  const abortReason = new Error(data.text('runtime abort reason'));
  const toolName = data.text('aborted tool name', 'tool');
  let toolCalls = 0;
  let decoratorCalls = 0;
  const provider = new ScriptedProvider([
    () => {
      controller.abort(abortReason);
      return {
        toolCalls: [{
          id: data.text('aborted tool call id', 'call'),
          name: toolName,
          arguments: { value: data.text('aborted tool argument') },
        }],
      };
    },
    { content: JSON.stringify({ greeting: data.text('unexpected retry greeting') }) },
  ]);
  const runtime = new PromptRuntime({
    provider,
    mcpConfigPath: 'disabled',
    logToConsole: false,
    maxRetry: 3,
  });
  runtime.registerTool({
    name: toolName,
    description: data.text('aborted tool description'),
    parameters: { type: 'object' },
    execute: () => { toolCalls++; return data.text('unexpected tool result'); },
  });
  runtime.processor.registerDecorator({
    stage: 'after',
    validate: context => { decoratorCalls++; return context; },
  });

  try {
    await assert.rejects(
      runtime.executeYaml(yaml, { name: data.person('aborted execution name') }, {
        signal: controller.signal,
      }),
      error => error === abortReason,
    );
    assert.equal(provider.calls.length, 1);
    assert.equal(toolCalls, 0);
    assert.equal(decoratorCalls, 0);
  } finally {
    await runtime.close();
  }
});

test('close attempts every parallel owner and aggregates synchronous cleanup failures', async () => {
  class ThrowingProvider extends ScriptedProvider {
    close(): void { throw new Error('provider close failed'); }
  }
  const runtime = new PromptRuntime({
    provider: new ThrowingProvider([]),
    mcpConfigPath: 'disabled',
    logToConsole: false,
  });
  let loggerCloseCount = 0;
  runtime.logger.close = (): void => { loggerCloseCount++; };

  await assert.rejects(
    runtime.close(),
    (error: unknown) => error instanceof AggregateError
      && error.errors.some(item => item instanceof Error && item.message === 'provider close failed'),
  );
  assert.equal(loggerCloseCount, 1);
  await runtime.close();
  assert.equal(loggerCloseCount, 1);
});
