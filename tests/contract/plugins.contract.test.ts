import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import test from 'node:test';
import {
  ConfigurationError,
  PluginLoadError,
  PluginManager,
} from '../../src/index.js';
import type { Provider, ProviderFactory } from '../../src/index.js';
import { withEnvironment } from '../helpers/environment.js';
import {
  buildLifecyclePluginModule,
  buildLegacyPluginManifest,
  writePluginFixture,
} from '../helpers/plugin.js';
import { withTempDirectory } from '../helpers/temp.js';

test('PluginManager always exposes built-in roles, decorators, and provider factories', async () => {
  const manager = new PluginManager();
  assert.equal(manager.getAgentRole('assistant'), manager.getAgentRole('default'));
  assert.deepEqual(manager.getDecorators().map(item => item.priority), [10, 20, 30]);
  assert.deepEqual(
    [...manager.providers.keys()].sort(),
    ['anthropic', 'apisix', 'azure_native', 'azure_openai', 'gemini_native', 'gemini_openai', 'openai'],
  );
  await manager.close();
  await manager.close();
});

test('PluginManager exposes a deeply frozen core status snapshot before load', async () => {
  const manager = new PluginManager(undefined, {}, { pluginConfigPath: 'disabled' });
  try {
    const snapshot = manager.getPluginStatus();
    assert.equal(snapshot.configPath, undefined);
    assert.deepEqual(snapshot.roots, []);
    const activatedIds = new Set([
      'pixiecore.recipe',
      'pixiecore.logging',
      'pixiecore.multimodal',
      'pixiecore.permissions',
      'pixiecore.providers',
      'pixiecore.providers.openai',
      'pixiecore.providers.anthropic',
      'pixiecore.providers.azure',
      'pixiecore.providers.gemini',
      'pixiecore.providers.apisix',
      'pixiecore.providers.apisix.ai-prompt-guard',
      'pixiecore.providers.apisix.ai-proxy-multi',
      'pixiecore.providers.apisix.ai-rag',
      'pixiecore.providers.apisix.ai-rate-limiting',
      'pixiecore.roles',
      'pixiecore.self-evaluation',
      'pixiecore.validation',
    ]);
    assert.equal(snapshot.plugins.length, 24);
    for (const plugin of snapshot.plugins) {
      const activated = activatedIds.has(plugin.id ?? '');
      assert.equal(plugin.activated, activated);
      assert.equal(plugin.state, activated ? 'activated' : 'enabled');
    }
    assert.equal(snapshot.plugins.every(plugin => plugin.origin === 'core'), true);
    for (const plugin of snapshot.plugins) {
      assert.match(plugin.id ?? '', /^pixiecore\./);
      assert.equal(plugin.enabled, true);
      assert.equal(plugin.locked, true);
      assert.equal(Object.isFrozen(plugin), true);
      assert.equal(Object.isFrozen(plugin.requires), true);
      assert.equal(Object.isFrozen(plugin.optionalRequires), true);
      assert.equal(Object.isFrozen(plugin.conflicts), true);
      assert.equal(Object.isFrozen(plugin.diagnostics), true);
    }
    assert.equal(Object.isFrozen(snapshot), true);
    assert.equal(Object.isFrozen(snapshot.roots), true);
    assert.equal(Object.isFrozen(snapshot.plugins), true);
    assert.equal(Object.isFrozen(snapshot.diagnostics), true);
    assert.notEqual(snapshot, manager.getPluginStatus());
    assert.deepEqual(snapshot, manager.getPluginStatus());
  } finally {
    await manager.close();
  }
});

test('PluginManager third constructor options preserve positional compatibility and disabled wins', async () => {
  await withTempDirectory(async root => {
    const manager = new PluginManager(
      undefined,
      { PIXIECORE_PLUGIN_CONFIG: join(root, 'missing-managed-state.yml') },
      { pluginConfigPath: 'disabled' },
    );
    try {
      assert.deepEqual(manager.getPluginDirectories(), []);
      await manager.load();
      assert.equal(manager.getPluginStatus().configPath, undefined);
      assert.deepEqual(manager.getPluginStatus().roots, []);
    } finally {
      await manager.close();
    }
  });
});

test('component manifests load all four plugin kinds and sort decorators stably', async () => {
  await withTempDirectory(async root => {
    await writePluginFixture(root, 'suite', { manifest: `
name: Component Suite
version: 1.0.0
module: ./plugin.mjs
components:
  - type: agent_role
    class: AnalystRole
    roles_supported: [analyst, reviewer]
  - type: decorator
    class: EarlyDecorator
    priority: 15
  - type: decorator
    export: LaterAtSamePriority
    priority: 15
  - type: tool
    class: ReverseTool
    tool_name: reverse
  - type: provider
    class: CustomProvider
    provider_name: custom
`, module: `
export class AnalystRole {
  apply(prompt) { return { messages: [{ role: 'user', content: 'analyst:' + prompt }] }; }
}
export class EarlyDecorator { validate(context) { return { ...context, output: String(context.output ?? '') + 'A' }; } }
export class LaterAtSamePriority { validate(context) { return { ...context, output: String(context.output ?? '') + 'B' }; } }
export class ReverseTool {
  description = 'Reverse text';
  parameters = [{ name: 'text', type: 'string', required: true }];
  execute({ text }) { return [...text].reverse().join(''); }
}
export class CustomProvider {
  name = 'custom'; model = 'custom-1'; supportsTools = true; supportsMultimodal = true;
  supportsVision() { return true; }
  supportsFileInput() { return true; }
  async getModelList() { return [this.model]; }
  async generate() { return { content: '{"result":"custom"}' }; }
}
` });
    const manager = new PluginManager(root);
    await manager.load();
    assert.equal(manager.getAgentRole('analyst'), manager.getAgentRole('reviewer'));
    const customPriorities = manager.getDecorators().map(item => item.priority);
    assert.deepEqual(customPriorities, [10, 15, 15, 20, 30]);
    let decoratorContext: any = { output: '' };
    for (const decorator of manager.getDecorators().filter(item => item.priority === 15)) {
      decoratorContext = await decorator.validate(decoratorContext) ?? decoratorContext;
    }
    assert.equal(decoratorContext.output, 'AB');
    assert.equal(await manager.getTool('reverse')?.execute({ text: 'abc' }), 'cba');
    assert.deepEqual(manager.getTool('reverse')?.parameters, {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
    });
    const provider = await manager.createProvider('custom');
    assert.equal((await provider.generate({ messages: [] })).content, '{"result":"custom"}');
    await manager.close();
  });
});

test('later plugin directories override earlier role, tool, and provider names', async () => {
  await withTempDirectory(async root => {
    const first = join(root, 'first');
    const second = join(root, 'second');
    for (const [directory, marker] of [[first, 'first'], [second, 'second']] as const) {
      await writePluginFixture(directory, 'override', {
        manifest: buildLegacyPluginManifest({ name: marker }),
        module: `
const marker = ${JSON.stringify(marker)};
export default {
  agentRoles: [{ supportedRoles: ['override'], apply(prompt) { return { messages: [{ role: 'user', content: marker + ':' + prompt }] }; } }],
  tools: [{ name: 'same', description: marker, parameters: { type: 'object' }, execute() { return marker; } }],
  providers: [{ name: 'same', create() { return {
    name: 'same', model: marker, supportsTools: true, supportsMultimodal: true,
    supportsVision() { return true; }, supportsFileInput() { return true; },
    async getModelList() { return [marker]; }, async generate() { return { content: '{}' }; }
  }; } }],
};
`,
      });
    }
    const manager = new PluginManager([first, second]);
    await manager.load();
    const role = manager.getAgentRole('override');
    assert.ok(role);
    assert.equal((await role.apply('prompt', {} as never, {})).messages[0]?.content, 'second:prompt');
    assert.equal(await manager.getTool('same')?.execute({}), 'second');
    assert.equal((await manager.createProvider('same')).model, 'second');
    await manager.close();
  });
});

test('plugin directories support environment lists, explicit override, and missing paths', async () => {
  await withTempDirectory(async root => {
    const one = join(root, 'one');
    const two = join(root, 'two');
    await mkdir(one); await mkdir(two);
    await withEnvironment({ PROMPT_RUNTIME_PLUGINS_DIR: `${one}${delimiter}${two}` }, async () => {
      const fromEnvironment = new PluginManager();
      assert.deepEqual(fromEnvironment.getPluginDirectories(), [one, two]);
      await fromEnvironment.load();
      await fromEnvironment.close();

      const explicit = new PluginManager(join(root, 'missing'));
      assert.deepEqual(explicit.getPluginDirectories(), [join(root, 'missing')]);
      await explicit.load();
      await explicit.close();
    });
  });
  assert.throws(() => new PluginManager(42 as never), ConfigurationError);
});

test('malformed plugins surface errors and close resources loaded earlier exactly once', async () => {
  await withTempDirectory(async root => {
    const closeMarker = join(root, 'closed.txt');
    await writePluginFixture(root, 'a_good', {
      manifest: buildLegacyPluginManifest({ name: 'Good' }),
      module: buildLifecyclePluginModule(closeMarker, 'closed'),
    });
    await writePluginFixture(root, 'b_bad', { manifest: '' });
    const manager = new PluginManager(root);
    await assert.rejects(manager.load(), error => error instanceof PluginLoadError && /Empty plugin file/.test(error.message));
    await manager.close();
    assert.equal(await readFile(closeMarker, 'utf8'), 'closed\n');
  });
});

test('component manifests reject missing type-specific fields and unknown providers', async () => {
  await withTempDirectory(async root => {
    await writePluginFixture(root, 'bad', { manifest: `
name: Bad component
module: ./plugin.mjs
components:
  - type: agent_role
    class: Role
`, module: 'export class Role { apply() { return { messages: [] }; } }\n' });
    const manager = new PluginManager(root);
    await assert.rejects(manager.load(), error => error instanceof PluginLoadError && /roles_supported/.test(error.message));
  });
  const manager = new PluginManager();
  await assert.rejects(manager.createProvider('missing'), error => error instanceof ConfigurationError && /Unknown provider/.test(error.message));
  await manager.close();
});

test('load is idempotent and provider overrides replace built-in metadata', async () => {
  await withTempDirectory(async root => {
    await writePluginFixture(root, 'once', {
      manifest: buildLegacyPluginManifest({ name: 'Once' }),
      module: `
export default {
  decorators: [{ priority: 40, validate(context) { return context; } }],
};
`,
    });
    const manager = new PluginManager(root);
    assert.equal(manager.isBuiltInProvider('openai'), true);
    manager.registerProvider({
      name: 'openai',
      create: () => ({
        name: 'openai', model: 'custom', supportsTools: true, supportsMultimodal: true,
        supportsVision: () => true, supportsFileInput: () => true,
        getModelList: async () => ['custom'], generate: async () => ({ content: '{}' }),
      }),
    });
    assert.equal(manager.isBuiltInProvider('openai'), false);

    await Promise.all([manager.load(), manager.load()]);
    await manager.load();
    assert.equal(manager.getDecorators().filter(item => item.priority === 40).length, 1);
    await manager.close();
  });
});

test('manager-owned providers close before their factories and repeated close is a no-op', async () => {
  const events: string[] = [];
  const manager = new PluginManager();
  manager.registerProvider({
    name: 'owned',
    create: () => ({
      name: 'owned', model: 'owned', supportsTools: true, supportsMultimodal: true,
      supportsVision: () => true, supportsFileInput: () => true,
      getModelList: async () => ['owned'], generate: async () => ({ content: '{}' }),
      close: () => { events.push('provider'); },
    }),
    close: () => { events.push('factory'); },
  });
  await manager.createProvider('owned');

  await manager.close();
  await manager.close();

  assert.deepEqual(events, ['provider', 'factory']);
});

test('closed managers reject facade mutations and provider creation before side effects', async () => {
  const manager = new PluginManager();
  let factoryCalls = 0;
  manager.registerProvider({
    name: 'guarded',
    create: () => {
      factoryCalls++;
      return {
        name: 'guarded', model: 'guarded', supportsTools: true, supportsMultimodal: true,
        supportsVision: () => true, supportsFileInput: () => true,
        getModelList: async () => ['guarded'], generate: async () => ({ content: '{}' }),
      };
    },
  });
  await manager.close();
  const rolesBefore = manager.agentRoles.size;
  const decoratorsBefore = manager.getDecorators().length;
  const toolsBefore = manager.tools.size;
  const providersBefore = manager.providers.size;

  assert.throws(
    () => manager.registerAgentRole({ supportedRoles: ['late'], apply: () => ({ messages: [] }) }),
    error => error instanceof PluginLoadError && error.message === 'Plugin manager is closed',
  );
  assert.throws(
    () => manager.registerDecorator({ validate: () => undefined }),
    error => error instanceof PluginLoadError && error.message === 'Plugin manager is closed',
  );
  assert.throws(
    () => manager.registerTool({
      name: 'late', description: 'late', parameters: { type: 'object' }, execute: () => undefined,
    }),
    error => error instanceof PluginLoadError && error.message === 'Plugin manager is closed',
  );
  assert.throws(
    () => manager.registerProvider({
      name: 'late', model: 'late', supportsTools: true, supportsMultimodal: true,
      supportsVision: () => true, supportsFileInput: () => true,
      getModelList: async () => ['late'], generate: async () => ({ content: '{}' }),
    }),
    error => error instanceof PluginLoadError && error.message === 'Plugin manager is closed',
  );
  await assert.rejects(
    manager.createProvider('guarded'),
    error => error instanceof PluginLoadError && error.message === 'Plugin manager is closed',
  );
  await assert.rejects(
    manager.load(),
    error => error instanceof PluginLoadError && error.message === 'Plugin manager is closed',
  );

  assert.equal(factoryCalls, 0);
  assert.equal(manager.agentRoles.size, rolesBefore);
  assert.equal(manager.getDecorators().length, decoratorsBefore);
  assert.equal(manager.tools.size, toolsBefore);
  assert.equal(manager.providers.size, providersBefore);
});

test('public registry snapshots cannot bypass lifecycle-aware registration', async () => {
  const manager = new PluginManager();
  const provider: Provider = {
    name: 'direct-map',
    model: 'direct-map',
    supportsTools: true,
    supportsMultimodal: true,
    supportsVision: () => true,
    supportsFileInput: () => true,
    getModelList: async () => ['direct-map'],
    generate: async () => ({ content: '{}' }),
  };
  const snapshot = manager.providers;
  (snapshot as Map<string, ProviderFactory>).clear();
  try {
    assert.ok(manager.getProvider('openai'));
    assert.equal(manager.getProvider(provider.name), undefined);
    manager.registerProvider(provider);
    assert.equal(snapshot.has(provider.name), false);
    assert.equal(manager.isBuiltInProvider(provider.name), false);
    assert.equal((await manager.createProvider(provider.name)).model, 'direct-map');
  } finally {
    await manager.close();
  }
});

test('startup errors remain primary when cleanup also fails', async () => {
  await withTempDirectory(async root => {
    await writePluginFixture(root, 'a_cleanup_failure', {
      manifest: buildLegacyPluginManifest({ name: 'Cleanup failure' }),
      module: `
export default {
  tools: [{ name: 'loaded', description: '', parameters: {}, execute() {} }],
  close() { throw new Error('secondary cleanup failure'); },
};
`,
    });
    await writePluginFixture(root, 'b_bad', { manifest: '' });
    const manager = new PluginManager(root);

    await assert.rejects(
      manager.load(),
      error => error instanceof PluginLoadError
        && /Empty plugin file/.test(error.message)
        && !/secondary cleanup failure/.test(error.message),
    );
    await manager.close();
  });
});

test('load-failure cleanup remains idempotent through the composed public facade', async () => {
  await withTempDirectory(async root => {
    await writePluginFixture(root, 'bad', { manifest: '' });
    const manager = new PluginManager(root);

    await assert.rejects(manager.load(), PluginLoadError);
    await manager.close();
    await manager.close();
  });
});
