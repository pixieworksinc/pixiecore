import assert from 'node:assert/strict';
import test from 'node:test';
import {
  comparePublicationBriefApproaches,
  type PublicationBriefApproach,
} from '../../examples/comparison/publication-brief/compare.js';
import type { RuntimeOptions } from '../../src/index.js';
import { ScriptedProvider } from '../helpers/fake-provider.js';
import { testData } from '../helpers/test-data.js';

const data = testData('publication brief approach comparison');

test('one monolithic Blueprint and five composed Blueprints execute the same business input', async () => {
  const sourceText = data.text('comparison source', 'source');
  const locale = data.text('comparison locale', 'locale');
  const resultValue = {
    extraction: {
      title: data.text('comparison title', 'title'),
      audience: data.text('comparison audience', 'audience'),
      facts: [data.text('comparison fact', 'fact')],
    },
    classification: {
      category: 'product' as const,
      rationale: data.text('comparison rationale', 'rationale'),
    },
    summary: { summary: data.text('comparison summary', 'summary') },
    validation: { valid: true, issues: [] },
    localization: {
      locale,
      localized_summary: data.text('comparison localized summary', 'localized'),
    },
  };
  const monolithic = new ScriptedProvider([{ content: JSON.stringify(resultValue) }]);
  const composed = new ScriptedProvider([
    { content: JSON.stringify(resultValue.extraction) },
    { content: JSON.stringify(resultValue.classification) },
    { content: JSON.stringify(resultValue.summary) },
    { content: JSON.stringify(resultValue.validation) },
    { content: JSON.stringify(resultValue.localization) },
  ]);
  const providers = new Map<PublicationBriefApproach, ScriptedProvider>([
    ['monolithic', monolithic],
    ['composed', composed],
  ]);

  const comparison = await comparePublicationBriefApproaches(
    { sourceText, locale },
    { runtimeOptions: approach => runtimeOptions(providers.get(approach)!) },
  );

  assert.deepEqual(comparison.monolithic, resultValue);
  assert.deepEqual(comparison.composed, resultValue);
  assert.equal(monolithic.calls.length, 1);
  assert.equal(composed.calls.length, 5);
  assert.deepEqual(comparison.structure, {
    monolithic: {
      blueprint_executions: 1,
      independently_testable_units: 1,
      cognitive_operations: 5,
    },
    composed: {
      blueprint_executions: 5,
      independently_testable_units: 5,
      cognitive_operations: 5,
    },
  });
  assert.equal(Object.isFrozen(comparison), true);
  assert.equal(Object.isFrozen(comparison.monolithic.extraction.facts), true);
  assert.match(lastPrompt(monolithic), new RegExp(sourceText));
  assert.match(lastPrompt(monolithic), new RegExp(locale));
});

function runtimeOptions(provider: ScriptedProvider): RuntimeOptions {
  return {
    provider,
    maxRetry: 0,
    mcpConfigPath: 'disabled',
    pluginConfigPath: 'disabled',
  };
}

function lastPrompt(provider: ScriptedProvider): string {
  const content = provider.calls.at(-1)?.messages.at(-1)?.content;
  if (typeof content !== 'string') throw new TypeError('Expected text prompt');
  return content;
}
