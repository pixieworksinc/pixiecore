/**
 * Verifies the APISIX ai-rag child plugin.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { aiRagContribution, createCorePluginActivator } from '../../ai-rag.js';

test('ai-rag is an optional environment-backed APISIX contribution', () => {
  assert.equal(aiRagContribution.name, 'ai-rag');
  assert.deepEqual(
    aiRagContribution.createConfiguration({
      environment: { PIXIECORE_APISIX_AI_RAG_CONFIG: '{"content":"content"}' },
    }),
    { content: 'content' },
  );
  assert.notEqual(createCorePluginActivator(), createCorePluginActivator());
});
