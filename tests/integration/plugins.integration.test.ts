import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { PromptRuntime, RolePermissionError } from '../../src/index.js';
import { testData } from '../helpers/test-data.js';
import { withTempDirectory } from '../helpers/temp.js';

const data = testData('plugin integration');

async function createRuntimePlugin(root: string, providerName = 'custom'): Promise<void> {
  const directory = join(root, 'runtime-suite');
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'plugin.yml'), `
name: Runtime Suite
module: ./plugin.mjs
components:
  - type: agent_role
    class: AnalystRole
    roles_supported: [analyst]
  - type: decorator
    class: InputDecorator
    priority: 15
    stage: before
  - type: decorator
    class: ResultDecorator
    priority: 25
  - type: provider
    class: CustomProvider
    provider_name: ${providerName}
`, 'utf8');
  await writeFile(join(directory, 'plugin.mjs'), `
export class AnalystRole {
  apply(prompt) {
    return {
      model: 'role-model',
      temperature: 0.2,
      messages: [
        { role: 'system', content: 'custom analyst system' },
        { role: 'user', content: 'analyze:' + prompt },
      ],
    };
  }
}
export class InputDecorator {
  validate(context) {
    return { ...context, inputs: { ...context.inputs, name: 'prepared-' + context.inputs.name } };
  }
}
export class ResultDecorator {
  validate(context) {
    return { ...context, output: { ...context.output, decorated: true } };
  }
}
export class CustomProvider {
  name = ${JSON.stringify(providerName)};
  model = 'custom-model';
  supportsTools = true;
  supportsMultimodal = true;
  calls = [];
  closeCalls = 0;
  supportsVision() { return true; }
  supportsFileInput() { return true; }
  async getModelList() { return [this.model]; }
  async generate(request) {
    this.calls.push(request);
    return { content: '{"result":"ok","errors":[]}' };
  }
  async close() { this.closeCalls++; }
}
`, 'utf8');
}

const blueprint = `
name: Plugin runtime
version: '1.0'
role: analyst
prompt: "{{ name }}"
input_placeholders:
  - name: name
    type: string
    required: true
permissions:
  allow_roles: [admin]
  deny_roles: [blocked]
  allow_scopes: [read, write]
examples:
  - input: { name: Example }
    output: { result: example }
output_schema:
  type: object
  properties:
    result: { type: string }
    errors: { type: array }
  required: [result]
`;

test('PromptRuntime executes custom role, ordered decorator, permissions, and provider together', async () => {
  await withTempDirectory(async root => {
    const name = data.person('custom plugin name');
    await createRuntimePlugin(root);
    const runtime = new PromptRuntime({ provider: 'custom', pluginsDir: root, mcpConfigPath: 'disabled' });
    const result = await runtime.executeYaml(blueprint, {
      name,
      user_role: 'admin',
      user_scopes: new Set(['read', 'write', 'extra']),
    });
    assert.deepEqual(result, { result: 'ok', errors: [], decorated: true });
    assert.equal(runtime.providerName, 'custom');
    assert.equal(runtime.model, 'custom-model');

    const provider = runtime.provider as typeof runtime.provider & { calls: any[]; closeCalls: number };
    assert.equal(provider.calls.length, 1);
    assert.equal(provider.calls[0]?.model, 'role-model');
    assert.equal(provider.calls[0]?.temperature, 0.2);
    assert.deepEqual(provider.calls[0]?.messages.map((message: { role: string }) => message.role), ['system', 'user', 'user']);
    assert.match(provider.calls[0]?.messages[1]?.content, /input:/);
    assert.equal(provider.calls[0]?.messages[2]?.content, `analyze:prepared-${name}`);

    await assert.rejects(runtime.executeYaml(blueprint, {
      name,
      user_role: 'blocked',
      user_scopes: ['read', 'write'],
    }), RolePermissionError);
    assert.equal(provider.calls.length, 1, 'permission denial must occur before a provider call');

    await runtime.close();
    await runtime.close();
    assert.equal(provider.closeCalls, 1);
  });
});

test('a user provider plugin can override a built-in provider without built-in credentials', async () => {
  await withTempDirectory(async root => {
    const name = data.person('overridden provider name');
    await createRuntimePlugin(root, 'openai');
    const runtime = new PromptRuntime({ provider: 'openai', pluginsDir: root, mcpConfigPath: 'disabled' });
    try {
      const result = await runtime.executeYaml(blueprint, {
        name,
        user_role: 'admin',
        user_scopes: ['read', 'write'],
      });
      assert.equal(result.result, 'ok');
      assert.equal(runtime.model, 'custom-model');
    } finally { await runtime.close(); }
  });
});
