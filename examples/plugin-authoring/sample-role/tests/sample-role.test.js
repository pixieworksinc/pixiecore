import assert from 'node:assert/strict';
import test from 'node:test';
import { SampleRoleRole } from '../sample-role.js';

test('sample role owns its supported role', () => {
  assert.deepEqual(SampleRoleRole.supportedRoles, ['sample-role']);
});
