import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createProvider, getRuntimeEnvironment, PromptRuntime } from '../../src/index.js';
import { withEnvironment } from '../helpers/environment.js';
import { withTempDirectory } from '../helpers/temp.js';

test('one resolved .env snapshot configures runtime, providers, plugins, and logging without mutating process.env', async () => {
  await withTempDirectory(async directory => {
    const pluginsDirectory = join(directory, 'plugins');
    const environmentFile = join(directory, 'runtime.env');
    await mkdir(pluginsDirectory);
    await writeFile(environmentFile, [
      'PROMPT_RUNTIME_PROVIDER=openai',
      'PROMPT_RUNTIME_TEMPERATURE=0.31',
      `PROMPT_RUNTIME_PLUGINS_DIR=${pluginsDirectory}`,
      'PROMPT_RUNTIME_LOG_LEVEL=WARNING',
      'OPENAI_API_KEY=from-dotenv-secret',
      'OPENAI_MODEL=from-dotenv-model',
    ].join('\n'), 'utf8');

    await withEnvironment({
      PROMPT_RUNTIME_ENV_FILE: environmentFile,
      PROMPT_RUNTIME_PROVIDER: undefined,
      PROMPT_RUNTIME_TEMPERATURE: undefined,
      PROMPT_RUNTIME_PLUGINS_DIR: undefined,
      PROMPT_RUNTIME_LOG_LEVEL: undefined,
      OPENAI_API_KEY: undefined,
      OPENAI_MODEL: undefined,
    }, async () => {
      const environment = getRuntimeEnvironment();
      assert.equal(environment.OPENAI_API_KEY, 'from-dotenv-secret');
      assert.equal(process.env.OPENAI_API_KEY, undefined);

      let request: RequestInit | undefined;
      const runtime = new PromptRuntime({
        mcpConfigPath: 'disabled',
        logToConsole: false,
        fetch: async (_url, init) => {
          request = init;
          return Response.json({ choices: [{ message: { content: '{"result":"ok"}' } }] });
        },
      });
      try {
        const result = await runtime.executeYaml(`
name: Environment snapshot
version: '1.0'
role: assistant
prompt: Return the result
output_schema: '{"type":"object","properties":{"result":{"type":"string"}},"required":["result"]}'
`);
        assert.deepEqual(result, { result: 'ok' });
        assert.equal(runtime.config.temperature, 0.31);
        assert.equal(runtime.loggingConfig.logLevel, 'WARNING');
        assert.deepEqual(runtime.pluginManager.getPluginDirectories(), [resolve(pluginsDirectory)]);
        assert.equal(runtime.provider.model, 'from-dotenv-model');
        assert.equal(new Headers(request?.headers).get('authorization'), 'Bearer from-dotenv-secret');
        assert.equal((JSON.parse(String(request?.body)) as { model: string }).model, 'from-dotenv-model');
      } finally { await runtime.close(); }
    });
  });
});

test('documented legacy model and deployment aliases remain accepted by provider factories', () => {
  const fetcher: typeof fetch = async () => Response.json({ choices: [{ message: { content: '{}' } }] });
  const gemini = createProvider('gemini_native', {
    environment: { GEMINI_NATIVE_API_KEY: 'key', GEMINI_MODEL: 'legacy-gemini' },
    fetch: fetcher,
  });
  assert.equal(gemini.model, 'legacy-gemini');

  const azure = createProvider('azure_openai', {
    environment: {
      AZURE_OPENAI_API_KEY: 'key',
      AZURE_OPENAI_ENDPOINT: 'https://example.openai.azure.com',
      AZURE_OPENAI_DEPLOYMENT: 'legacy-deployment',
    },
    fetch: fetcher,
  });
  assert.equal(azure.model, 'legacy-deployment');
});
