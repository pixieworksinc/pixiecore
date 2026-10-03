/**
 * Verifies Apache APISIX provider plugin identity and activation boundaries.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import YAML from 'yaml';
import {
  createApisixProviderFactory,
  createCorePluginActivator,
} from '../../apisix.js';

test('APISIX plugin exposes a fresh synchronous activator and canonical provider factory', async () => {
  const manifest = YAML.parse(await readFile(
    new URL('../../apisix.yaml', import.meta.url),
    'utf8',
  )) as { id: string; components: Array<Record<string, unknown>> };
  assert.equal(manifest.id, 'pixiecore.providers.apisix');
  assert.equal(manifest.components[0]?.provider_name, 'apisix');
  assert.notEqual(createCorePluginActivator(), createCorePluginActivator());
  assert.equal(typeof createCorePluginActivator().activate, 'function');
  assert.equal(typeof createApisixProviderFactory, 'function');
});
