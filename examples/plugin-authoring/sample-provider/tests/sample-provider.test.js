import assert from 'node:assert/strict';
import test from 'node:test';
import { SampleProviderProviderFactory } from '../sample-provider.js';

test('sample provider is created without network access', async () => {
  const provider = SampleProviderProviderFactory.create({});
  assert.equal(provider.name, 'sample_provider');
  assert.deepEqual(await provider.getModelList(), ['sample-model']);
});
