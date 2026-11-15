/** CI-only live protocol test. No provider key is read and no provider connection exists. */
import {startLiveSpecificationHost} from '../integrations/drupal/executable-specification/runtime/live-server.js';
import {readFileSync} from 'node:fs';
const outputs = [{discount: 0.15, final_price: 1020}, {discount: 0.2, final_price: 960}];
const provider = {
  name: 'openai', model: 'gpt-6-luna', supportsTools: false, supportsMultimodal: false,
  supportsVision: () => false, supportsFileInput: () => false,
  getModelList: async () => { throw Error('No model listing in CI'); },
  generate: async () => {
    if (!outputs.length) throw Error('No more CI fixtures');
    return {content: JSON.stringify(outputs.shift()), usage: {inputTokens: 500, outputTokens: 20}};
  },
};
const config = {
  expiresAt: new Date(Date.now() + 300000).toISOString(), statePath: '/state/private/pixiecore-live-ci',
  templatePath: '/runtime/examples/integrations/drupal/pixiecore_specification/blueprints/customer-discount/customer-discount.yaml',
  apiKeyPath: '/nonexistent-ci-key', transportTokenPath: '/run/secrets/runtime_token',
};
const host = await startLiveSpecificationHost({config, provider,
  token: readFileSync(config.transportTokenPath, 'utf8').trim(), templatePath: config.templatePath});
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { void host.close(); });
