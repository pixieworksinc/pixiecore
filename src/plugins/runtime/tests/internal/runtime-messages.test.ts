import assert from 'node:assert/strict';
import test from 'node:test';
import { ConfigurationError } from '../../../../core/contracts/errors/index.js';
import type {
  AgentRoleResult,
  Blueprint,
  Message,
  ToolCall,
  ToolExecutionResult,
} from '../../../../core/contracts/types/index.js';
import { createMultimodalService } from '../../../../plugins/multimodal/src/service.js';
import {
  appendToolRound,
  appendValidationRetry,
  assemblePromptMessages,
  formatToolResult,
  renderPrompt,
  validateAgentRoleResult,
} from '../../../../plugins/runtime/src/messages.js';
import { ScriptedProvider } from '../../../../../tests/helpers/fake-provider.js';
import { testData } from '../../../../../tests/helpers/test-data.js';

const data = testData('runtime message branches');
const provider = new ScriptedProvider([], {
  name: data.text('provider name', 'provider'),
  model: data.text('provider model', 'model'),
});
const multimodal = {
  ...createMultimodalService(),
  enhanceMessagesWithMultimodal: (messages: readonly Message[]): Message[] => [...messages],
};

test('prompt rendering formats values and empties nullish declared inputs while preserving missing placeholders', () => {
  const stringValue = data.text('string prompt value');
  const objectValue = {
    label: data.text('object label'),
    count: data.integer('object count', 2, 100),
  };
  const arrayValue = [
    data.text('array first'),
    data.integer('array second', 101, 200),
  ];
  const template = 'string={{ string_value }};object={{object_value}};array={array_value};undefined={{ undefined_value }};missing={{ missing_value }}';

  const rendered = renderPrompt(template, {
    string_value: stringValue,
    object_value: objectValue,
    array_value: arrayValue,
    undefined_value: undefined,
  });

  assert.equal(
    rendered,
    `string=${stringValue};object=${JSON.stringify(objectValue)};array=${JSON.stringify(arrayValue)};undefined=;missing={{ missing_value }}`,
  );
});

test('prompt rendering changes only matching placeholder spans', () => {
  const value = data.text('preserved prompt value', 'value');
  const template = [
    'Feature: Preserve decoded text',
    '',
    '    Scenario: Keep indentation',
    '      Given first  value',
    '',
    '',
    '      When replacing {{ value }}',
    '      Then preserve surrounding whitespace  ',
    'literal={missing_value}',
  ].join('\n');

  assert.equal(
    renderPrompt(template, { value }),
    template.replace('{{ value }}', value),
  );
});

test('agent role validation accepts a complete ordered message array including tool messages', () => {
  const role = data.text('valid role', 'role');
  const result: AgentRoleResult = {
    messages: [
      { role: 'system', content: data.text('system content') },
      {
        role: 'user',
        content: [{ type: 'text', text: data.text('user text part') }],
      },
      { role: 'assistant', content: data.text('assistant content') },
      {
        role: 'tool',
        content: data.text('tool content'),
        toolCallId: data.text('tool call id', 'call'),
        name: data.text('tool name', 'tool'),
      },
    ],
    model: data.text('role model', 'model'),
    temperature: data.decimal('role temperature', 0.1, 1, 2),
  };
  const before = structuredClone(result);

  validateAgentRoleResult(result, role);

  assert.deepEqual(result, before);
});

test('agent role validation rejects each invalid result, message, model, temperature, and tool-message branch', async t => {
  const role = data.text('invalid role', 'role');
  const cases = [
    {
      name: 'non-object result',
      value: undefined,
      message: `Agent role ${role} must return a messages array`,
    },
    {
      name: 'missing messages array',
      value: {},
      message: `Agent role ${role} must return a messages array`,
    },
    {
      name: 'empty model',
      value: { messages: [], model: '' },
      message: `Agent role ${role} returned an invalid model`,
    },
    {
      name: 'non-string model',
      value: { messages: [], model: data.integer('invalid model number', 2, 100) },
      message: `Agent role ${role} returned an invalid model`,
    },
    {
      name: 'non-number temperature',
      value: { messages: [], temperature: data.text('invalid temperature') },
      message: `Agent role ${role} returned an invalid temperature`,
    },
    {
      name: 'non-finite temperature',
      value: { messages: [], temperature: Number.POSITIVE_INFINITY },
      message: `Agent role ${role} returned an invalid temperature`,
    },
    {
      name: 'invalid message role',
      value: { messages: [{ role: data.text('invalid message role'), content: data.text('invalid role content') }] },
      message: `Agent role ${role} returned an invalid message`,
    },
    {
      name: 'missing message content',
      value: { messages: [{ role: 'user' }] },
      message: `Agent role ${role} returned an invalid message`,
    },
    {
      name: 'invalid message content',
      value: { messages: [{ role: 'assistant', content: data.integer('invalid content', 2, 100) }] },
      message: `Agent role ${role} returned invalid message content`,
    },
    {
      name: 'tool message with array content',
      value: { messages: [{ role: 'tool', content: [], toolCallId: data.text('array tool id', 'call') }] },
      message: `Agent role ${role} returned an invalid tool message`,
    },
    {
      name: 'tool message without call id',
      value: { messages: [{ role: 'tool', content: data.text('tool without id content') }] },
      message: `Agent role ${role} returned an invalid tool message`,
    },
  ] as const;

  for (const item of cases) {
    await t.test(item.name, () => {
      assert.throws(
        () => validateAgentRoleResult(item.value, role),
        error => exactConfigurationError(error, item.message),
      );
    });
  }
});

test('message assembly orders leading systems, localization, examples, history, and current user input', () => {
  const firstSystem = data.text('first system');
  const secondSystem = data.text('second system');
  const currentUser = data.text('current user');
  const locale = data.text('locale');
  const audience = data.text('audience');
  const earlierUser = data.text('earlier user');
  const earlierAssistant = data.text('earlier assistant');
  const firstInput = { value: data.text('first example input') };
  const firstOutput = { value: data.text('first example output') };
  const secondInput = { value: data.text('second example input') };
  const secondOutput = { value: data.text('second example output') };
  const roleResult: AgentRoleResult = {
    messages: [
      { role: 'system', content: firstSystem },
      { role: 'system', content: secondSystem },
      { role: 'user', content: currentUser },
    ],
  };
  const history: Message[] = [
    { role: 'user', content: earlierUser },
    { role: 'assistant', content: earlierAssistant },
  ];
  const definition = blueprint({
    localization: {
      locale: 'Use {{ locale }}',
      audience: 'Address {{ audience }}',
    },
    examples: [
      { input: firstInput, output: firstOutput },
      { input: secondInput, output: secondOutput },
    ],
  });
  const roleMessagesBefore = structuredClone(roleResult.messages);
  const historyBefore = structuredClone(history);

  const messages = assemblePromptMessages(
    roleResult,
    definition,
    { locale, audience },
    history,
    provider,
    multimodal,
  );

  assert.deepEqual(messages, [
    { role: 'system', content: firstSystem },
    { role: 'system', content: secondSystem },
    {
      role: 'system',
      content: `Localization requirements:\n- locale: Use ${locale}\n- audience: Address ${audience}`,
    },
    {
      role: 'user',
      content: `input: ${JSON.stringify(firstInput)}\noutput: ${JSON.stringify(firstOutput)}`,
    },
    {
      role: 'user',
      content: `input: ${JSON.stringify(secondInput)}\noutput: ${JSON.stringify(secondOutput)}`,
    },
    { role: 'user', content: earlierUser },
    { role: 'assistant', content: earlierAssistant },
    { role: 'user', content: currentUser },
  ]);
  assert.deepEqual(roleResult.messages, roleMessagesBefore);
  assert.deepEqual(history, historyBefore);
});

test('empty examples preserve messages while missing users produce each exact assembly error', () => {
  const systemContent = data.text('empty examples system');
  const userContent = data.text('empty examples user');
  const roleResult: AgentRoleResult = {
    messages: [
      { role: 'system', content: systemContent },
      { role: 'user', content: userContent },
    ],
  };

  const messages = assemblePromptMessages(
    roleResult,
    blueprint({ examples: [] }),
    {},
    [],
    provider,
    multimodal,
  );
  assert.deepEqual(messages, roleResult.messages);
  assert.notEqual(messages, roleResult.messages);

  const noUserResult: AgentRoleResult = {
    messages: [{ role: 'system', content: systemContent }],
  };
  assert.throws(
    () => assemblePromptMessages(
      noUserResult,
      blueprint({ examples: [] }),
      {},
      [],
      provider,
      multimodal,
    ),
    error => exactConfigurationError(
      error,
      'Agent role must return at least one user message',
    ),
  );
  assert.throws(
    () => assemblePromptMessages(
      noUserResult,
      blueprint({
        examples: [{
          input: { value: data.text('missing user example input') },
          output: { value: data.text('missing user example output') },
        }],
      }),
      {},
      [],
      provider,
      multimodal,
    ),
    error => exactConfigurationError(
      error,
      'Cannot insert examples without a user message',
    ),
  );
});

test('standard tool rounds append the complete assistant call and ordered tool results', () => {
  const initial: Message = { role: 'user', content: data.text('standard initial user') };
  const assistantContent = data.text('standard assistant content');
  const calls: ToolCall[] = [
    {
      id: data.text('standard first call id', 'call'),
      name: data.text('standard first tool', 'tool'),
      arguments: { value: data.text('standard first argument') },
    },
    {
      id: data.text('standard second call id', 'call'),
      name: data.text('standard second tool', 'tool'),
      arguments: { value: data.text('standard second argument') },
    },
  ];
  const results: ToolExecutionResult[] = [
    {
      id: calls[0]!.id,
      name: calls[0]!.name,
      content: data.text('standard first result'),
      isError: false,
    },
    {
      id: calls[1]!.id,
      name: calls[1]!.name,
      content: data.text('standard second result'),
      isError: true,
    },
  ];
  const messages: Message[] = [initial];
  const callsBefore = structuredClone(calls);
  const resultsBefore = structuredClone(results);

  appendToolRound(messages, assistantContent, calls, results, false);

  assert.deepEqual(messages, [
    initial,
    { role: 'assistant', content: assistantContent, toolCalls: calls },
    {
      role: 'tool',
      toolCallId: calls[0]!.id,
      name: calls[0]!.name,
      content: results[0]!.content,
    },
    {
      role: 'tool',
      toolCallId: calls[1]!.id,
      name: calls[1]!.name,
      content: results[1]!.content,
      isError: true,
    },
  ]);
  assert.deepEqual(calls, callsBefore);
  assert.deepEqual(results, resultsBefore);
});

test('pseudo tool rounds use ordered user messages and omit empty assistant content', () => {
  const initial: Message = { role: 'system', content: data.text('pseudo initial system') };
  const assistantContent = data.text('pseudo assistant content');
  const results: ToolExecutionResult[] = [
    {
      id: data.text('pseudo first call id', 'call'),
      name: data.text('pseudo first tool', 'tool'),
      content: data.text('pseudo first result'),
      isError: false,
    },
    {
      id: data.text('pseudo second call id', 'call'),
      name: data.text('pseudo second tool', 'tool'),
      content: data.text('pseudo second result'),
      isError: true,
    },
  ];
  const withAssistant: Message[] = [initial];

  appendToolRound(withAssistant, assistantContent, [], results, true);

  assert.deepEqual(withAssistant, [
    initial,
    { role: 'assistant', content: assistantContent },
    { role: 'user', content: `Tool ${results[0]!.name} returned: ${results[0]!.content}` },
    { role: 'user', content: `Tool ${results[1]!.name} returned: ${results[1]!.content}` },
  ]);

  const withoutAssistant: Message[] = [initial];
  appendToolRound(withoutAssistant, '', [], [results[0]!], true);
  assert.deepEqual(withoutAssistant, [
    initial,
    { role: 'user', content: `Tool ${results[0]!.name} returned: ${results[0]!.content}` },
  ]);
});

test('tool-result formatting handles strings, undefined, JSON values, and non-JSON symbols', () => {
  const text = data.text('string tool result');
  const jsonValue = {
    label: data.text('JSON tool result label'),
    count: data.integer('JSON tool result count', 2, 100),
  };
  const symbolDescription = data.text('symbol tool result');
  const symbol = Symbol(symbolDescription);

  assert.equal(formatToolResult(text), text);
  assert.equal(formatToolResult(undefined), 'null');
  assert.equal(formatToolResult(jsonValue), JSON.stringify(jsonValue));
  assert.equal(formatToolResult(symbol), `Symbol(${symbolDescription})`);
});

test('validation retries append the invalid assistant response before the corrective user request', () => {
  const initialSystem = data.text('retry system');
  const initialUser = data.text('retry user');
  const invalidResponse = data.text('invalid response');
  const validationMessage = data.text('validation message');
  const messages: Message[] = [
    { role: 'system', content: initialSystem },
    { role: 'user', content: initialUser },
  ];

  appendValidationRetry(messages, invalidResponse, validationMessage);

  assert.deepEqual(messages, [
    { role: 'system', content: initialSystem },
    { role: 'user', content: initialUser },
    { role: 'assistant', content: invalidResponse },
    {
      role: 'user',
      content: `Your response was invalid: ${validationMessage}. Return corrected JSON only.`,
    },
  ]);
});

function blueprint(overrides: Partial<Blueprint> = {}): Blueprint {
  return {
    name: data.text('blueprint name', 'blueprint'),
    version: '1.0',
    role: data.text('blueprint role', 'role'),
    prompt: data.text('blueprint prompt'),
    output_schema: { type: 'object' },
    ...overrides,
  };
}

function exactConfigurationError(error: unknown, message: string): boolean {
  assert.ok(error instanceof Error);
  assert.equal(error.constructor, ConfigurationError);
  const configurationError = error as ConfigurationError;
  assert.equal(configurationError.code, 'configuration_error');
  assert.equal(configurationError.message, message);
  return true;
}
