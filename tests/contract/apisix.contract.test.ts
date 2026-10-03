/**
 * Verifies APISIX contribution compilation without mutating a gateway.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  APISIX_PLUGIN_EXTENSION_POINT,
  compileApisixPluginConfiguration,
  type ApisixPluginContribution,
} from '../../src/core/kernel/apisix/index.js';
import { ConfigurationError } from '../../src/index.js';

test('APISIX compiler preserves contribution order, skips absent config, and freezes output', () => {
  const source = extensionSource([
    contribution('ai-proxy-multi', { instances: [] }),
    contribution('ai-rate-limiting', undefined),
    contribution('ai-prompt-guard', { deny_patterns: ['secret'] }),
  ]);
  const compiled = compileApisixPluginConfiguration(source, {});
  assert.deepEqual(compiled, [
    { name: 'ai-proxy-multi', config: { instances: [] } },
    { name: 'ai-prompt-guard', config: { deny_patterns: ['secret'] } },
  ]);
  assert.equal(Object.isFrozen(compiled), true);
  assert.equal(Object.isFrozen(compiled[0]?.config), true);
});

test('APISIX compiler rejects duplicate names and non-JSON configuration', () => {
  assert.throws(
    () => compileApisixPluginConfiguration(extensionSource([
      contribution('ai-rag', {}),
      contribution('ai-rag', {}),
    ]), {}),
    error => error instanceof ConfigurationError && /Duplicate APISIX plugin/.test(error.message),
  );
  assert.throws(
    () => compileApisixPluginConfiguration(extensionSource([
      contribution('invalid', { value: BigInt(1) }),
    ]), {}),
    error => error instanceof ConfigurationError && /JSON-compatible/.test(error.message),
  );
  for (const value of [undefined, Number.NaN, () => 'not-json']) {
    assert.throws(
      () => compileApisixPluginConfiguration(extensionSource([
        contribution('invalid', { value }),
      ]), {}),
      error => error instanceof ConfigurationError && /JSON-compatible/.test(error.message),
    );
  }
});

function contribution(
  name: string,
  config: Readonly<Record<string, unknown>> | undefined,
): ApisixPluginContribution {
  return { name, createConfiguration: () => config };
}

function extensionSource(contributions: readonly ApisixPluginContribution[]) {
  return {
    getExtensions<Value>(point: string): readonly Value[] {
      assert.equal(point, APISIX_PLUGIN_EXTENSION_POINT);
      return contributions as readonly Value[];
    },
  };
}
