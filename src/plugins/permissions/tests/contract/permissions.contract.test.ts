import test from 'node:test';
import assert from 'node:assert/strict';
import { PermissionGuard } from '../../permissions.js';
import { RolePermissionError } from '../../../../core/contracts/errors/index.js';
import type { Blueprint, DecoratorContext, Provider } from '../../../../core/contracts/types/index.js';
import { testData } from '../../../../../tests/helpers/test-data.js';

const data = testData('permissions plugin');
const provider: Provider = {
  name: data.text('provider name'),
  model: data.text('model name'),
  supportsTools: false,
  supportsMultimodal: false,
  supportsVision: () => false,
  supportsFileInput: () => false,
  getModelList: async () => [],
  async generate() { return { content: '{}' }; },
};

function context(role: string, allowRoles: readonly string[]): DecoratorContext {
  const blueprint: Blueprint = {
    name: data.text('blueprint name'),
    version: '1.0',
    role: 'assistant',
    prompt: data.text('prompt'),
    output_schema: { type: 'object' },
    permissions: { allow_roles: [...allowRoles] },
  };
  return { blueprint, inputs: { user_role: role }, provider, attempt: 1 };
}

test('permissions plugin entry enforces role allow lists', () => {
  const allowed = data.text('allowed role', 'role');
  const denied = data.text('denied role', 'role');
  const guard = new PermissionGuard();
  assert.equal(guard.validate(context(allowed, [allowed])).inputs.user_role, allowed);
  assert.throws(() => guard.validate(context(denied, [allowed])), RolePermissionError);
});
