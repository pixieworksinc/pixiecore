import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AgentRoleNotFoundError,
  DefaultAgentRole,
  PermissionGuard,
  PromptProcessor,
  PromptRuntime,
  RolePermissionError,
  SchemaGuard,
  SchemaValidationError,
  ScopePermissionError,
  SelfEvalDecorator,
  SelfEvaluationError,
  UserPermissionError,
} from '../../src/index.js';
import { ScriptedProvider } from '../helpers/fake-provider.js';
import type { Blueprint, DecoratorContext } from '../../src/index.js';

const blueprint = (permissions?: Blueprint['permissions']): Blueprint => ({
  name: 'Decorator contract',
  version: '1.0',
  role: 'assistant',
  prompt: 'Return a result',
  output_schema: {
    type: 'object',
    properties: { result: { type: 'string' } },
    required: ['result'],
  },
  ...(permissions ? { permissions } : {}),
});

const context = (options: {
  permissions?: Blueprint['permissions'];
  inputs?: Record<string, unknown>;
  output?: unknown;
} = {}): DecoratorContext => ({
  blueprint: blueprint(options.permissions),
  inputs: options.inputs ?? {},
  provider: new ScriptedProvider([]),
  attempt: 1,
  ...(options.output === undefined ? {} : { output: options.output }),
});

test('PermissionGuard grants allow-list matches and requires every configured scope', () => {
  const guard = new PermissionGuard();
  const allowed = context({
    permissions: {
      allow_roles: ['admin', 'editor'],
      allow_users: ['user@example.com'],
      allow_scopes: ['read', 'write'],
    },
    inputs: {
      user_role: 'admin',
      user_id: 'user@example.com',
      user_scopes: new Set(['read', 'write', 'delete']),
    },
  });
  assert.equal(guard.validate(allowed), allowed);
  const noPermissions = context();
  assert.equal(guard.validate(noPermissions), noPermissions);
});

test('PermissionGuard gives deny rules priority and uses distinct public errors', () => {
  const guard = new PermissionGuard();
  assert.throws(() => guard.validate(context({
    permissions: { allow_roles: ['admin'], deny_roles: ['admin'] },
    inputs: { user_role: 'admin' },
  })), RolePermissionError);
  assert.throws(() => guard.validate(context({
    permissions: { allow_roles: ['admin'] },
    inputs: { user_role: 'viewer' },
  })), RolePermissionError);
  assert.throws(() => guard.validate(context({
    permissions: { allow_users: ['allowed@example.com'] },
    inputs: { user_id: 'other@example.com' },
  })), UserPermissionError);
  assert.throws(() => guard.validate(context({
    permissions: { deny_users: ['blocked@example.com'] },
    inputs: { user_id: 'blocked@example.com' },
  })), UserPermissionError);
  assert.throws(() => guard.validate(context({
    permissions: { allow_scopes: ['read', 'write'] },
    inputs: { user_scopes: ['read'] },
  })), ScopePermissionError);
  assert.throws(() => guard.validate(context({
    permissions: { deny_scopes: ['admin'] },
    inputs: { user_scopes: 'read admin' },
  })), ScopePermissionError);
});

test('SchemaGuard accepts object and string schemas and reports invalid output', () => {
  const guard = new SchemaGuard();
  const valid = context({ output: { result: 'ok' } });
  assert.deepEqual(guard.validate(valid).output, { result: 'ok' });
  assert.throws(() => guard.validate(context({ output: {} })), SchemaValidationError);

  const stringSchema = context({ output: { result: 'ok' } });
  stringSchema.blueprint.output_schema = JSON.stringify(stringSchema.blueprint.output_schema);
  assert.deepEqual(guard.validate(stringSchema).output, { result: 'ok' });
});

test('provider validation precedes decorators and SchemaGuard revalidates early mutations', async () => {
  const invalidProvider = new ScriptedProvider([
    { content: '{}' },
    { content: '{"result":"valid"}' },
  ]);
  const prevalidated = new PromptProcessor(invalidProvider, 1);
  prevalidated.registerAgentRole(new DefaultAgentRole());
  let decoratorCalls = 0;
  prevalidated.registerDecorator({
    priority: 5,
    stage: 'after',
    validate: value => {
      decoratorCalls++;
      return value;
    },
  });
  prevalidated.registerDecorator(new SchemaGuard());

  assert.deepEqual(await prevalidated.execute(blueprint(), {}), { result: 'valid' });
  assert.equal(invalidProvider.calls.length, 2);
  assert.equal(decoratorCalls, 1);

  const mutatedProvider = new ScriptedProvider([
    { content: '{"result":"first"}' },
    { content: '{"result":"second"}' },
  ]);
  const guarded = new PromptProcessor(mutatedProvider, 1);
  guarded.registerAgentRole(new DefaultAgentRole());
  let mutationCalls = 0;
  guarded.registerDecorator({
    priority: 5,
    stage: 'after',
    validate: value => {
      mutationCalls++;
      if (mutationCalls === 1) return { ...value, output: {} };
      return value;
    },
  });
  guarded.registerDecorator(new SchemaGuard());

  assert.deepEqual(await guarded.execute(blueprint(), {}), { result: 'second' });
  assert.equal(mutatedProvider.calls.length, 2);
  assert.equal(mutationCalls, 2);
});

test('runtime preserves explicit plugin decorator priority independently of object priority', async () => {
  const provider = new ScriptedProvider([{ content: '{"result":"valid"}' }]);
  const runtime = new PromptRuntime({ provider, mcpConfigPath: 'disabled' });
  const calls: string[] = [];
  const explicitlyFirst = {
    priority: 200,
    validate: (value: DecoratorContext): DecoratorContext => {
      calls.push('explicitly-first');
      return value;
    },
  };
  const explicitlyLast = {
    priority: 0,
    validate: (value: DecoratorContext): DecoratorContext => {
      calls.push('explicitly-last');
      return value;
    },
  };
  runtime.pluginManager.registerDecorator(explicitlyFirst, 0);
  runtime.pluginManager.registerDecorator(explicitlyLast, 200);

  try {
    assert.deepEqual(
      runtime.pluginManager.getDecorators().filter(
        decorator => decorator === explicitlyFirst || decorator === explicitlyLast,
      ),
      [explicitlyFirst, explicitlyLast],
    );
    assert.deepEqual(await runtime.executeYaml(`
name: Explicit decorator priority
version: '1.0'
role: assistant
prompt: Return a result
output_schema:
  type: object
  properties:
    result: { type: string }
  required: [result]
`), { result: 'valid' });
    assert.deepEqual(calls, ['explicitly-first', 'explicitly-last']);
  } finally {
    await runtime.close();
  }
});

test('SelfEvalDecorator distinguishes absent, empty, and non-empty errors', () => {
  const decorator = new SelfEvalDecorator();
  for (const output of [
    'plain output',
    { result: 'ok' },
    { result: 'ok', errors: [] },
    { result: 'ok', errors: '' },
    { result: 'ok', errors: {} },
  ]) assert.doesNotThrow(() => decorator.validate(context({ output })));

  for (const output of [
    { errors: ['first'] },
    { errors: 'failed' },
    { errors: { field: 'failed' } },
  ]) assert.throws(() => decorator.validate(context({ output })), SelfEvaluationError);
});

test('runtime retries self-evaluation failures and rejects unknown roles before generation', async () => {
  const provider = new ScriptedProvider([
    { content: '{"result":"bad","errors":["retry"]}' },
    { content: '{"result":"ok","errors":[]}' },
  ]);
  const runtime = new PromptRuntime({ provider, mcpConfigPath: 'disabled' });
  try {
    const yaml = `
name: Self evaluation
version: '1.0'
role: assistant
prompt: Return a result
output_schema:
  type: object
  properties:
    result: { type: string }
    errors: { type: array }
  required: [result]
`;
    assert.deepEqual(await runtime.executeYaml(yaml), { result: 'ok', errors: [] });
    assert.equal(provider.calls.length, 2);

    await assert.rejects(runtime.executeYaml(yaml.replace('role: assistant', 'role: missing')), AgentRoleNotFoundError);
    assert.equal(provider.calls.length, 2);
  } finally { await runtime.close(); }
});
