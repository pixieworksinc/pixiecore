/**
 * Verifies the APISIX ai-rate-limiting child plugin.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aiRateLimitingContribution,
  createCorePluginActivator,
} from '../../ai-rate-limiting.js';

test('ai-rate-limiting is an optional environment-backed APISIX contribution', () => {
  assert.equal(aiRateLimitingContribution.name, 'ai-rate-limiting');
  assert.deepEqual(
    aiRateLimitingContribution.createConfiguration({
      environment: {
        PIXIECORE_APISIX_AI_RATE_LIMITING_CONFIG:
          '{"limit_strategy":"total_tokens","instances":[]}',
      },
    }),
    { limit_strategy: 'total_tokens', instances: [] },
  );
  assert.notEqual(createCorePluginActivator(), createCorePluginActivator());
});
