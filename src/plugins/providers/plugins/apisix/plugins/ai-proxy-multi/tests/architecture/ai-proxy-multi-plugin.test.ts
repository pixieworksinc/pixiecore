/**
 * Verifies the APISIX ai-proxy-multi child plugin.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aiProxyMultiContribution,
  createCorePluginActivator,
} from '../../ai-proxy-multi.js';

test('ai-proxy-multi is an optional environment-backed APISIX contribution', () => {
  assert.equal(aiProxyMultiContribution.name, 'ai-proxy-multi');
  assert.equal(
    aiProxyMultiContribution.createConfiguration({ environment: {} }),
    undefined,
  );
  assert.deepEqual(
    aiProxyMultiContribution.createConfiguration({
      environment: { PIXIECORE_APISIX_AI_PROXY_MULTI_CONFIG: '{"instances":[]}' },
    }),
    { instances: [] },
  );
  assert.notEqual(createCorePluginActivator(), createCorePluginActivator());
});
