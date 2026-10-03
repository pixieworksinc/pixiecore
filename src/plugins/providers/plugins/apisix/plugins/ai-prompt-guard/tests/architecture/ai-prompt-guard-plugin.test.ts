/**
 * Verifies the APISIX ai-prompt-guard child plugin.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aiPromptGuardContribution,
  createCorePluginActivator,
} from '../../ai-prompt-guard.js';

test('ai-prompt-guard is an optional environment-backed APISIX contribution', () => {
  assert.equal(aiPromptGuardContribution.name, 'ai-prompt-guard');
  assert.deepEqual(
    aiPromptGuardContribution.createConfiguration({
      environment: { PIXIECORE_APISIX_AI_PROMPT_GUARD_CONFIG: '{"deny_patterns":["secret"]}' },
    }),
    { deny_patterns: ['secret'] },
  );
  assert.notEqual(createCorePluginActivator(), createCorePluginActivator());
});
