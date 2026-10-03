import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import type { PluginActivationContext } from '../../src/core/contracts/plugin/activation.js';
import { createServiceToken } from '../../src/core/contracts/plugin/activation.js';
import { LegacyPluginCatalog } from '../../src/core/bootstrap/plugin-manager/catalog/index.js';
import { ContributionRegistries } from '../../src/core/bootstrap/plugin-manager/registries/contributions.js';
import { ScopedServiceRegistry } from '../../src/core/bootstrap/plugin-manager/registries/services.js';
import { writePluginFixture } from '../helpers/plugin.js';
import { withTempDirectory } from '../helpers/temp.js';

test('scoped services preserve token typing, collision policy, and scope isolation', () => {
  const first = new ScopedServiceRegistry();
  const second = new ScopedServiceRegistry();
  const token = createServiceToken<string>('test.message');

  first.register(token, 'first');
  assert.equal(first.resolve(token), 'first');
  assert.equal(first.has(token), true);
  assert.equal(second.has(token), false);
  assert.equal(second.resolveOptional(token), undefined);
  assert.throws(() => second.resolve(token), /Plugin service is not registered: test\.message/);
  assert.throws(() => first.register(token, 'duplicate'), /already registered/);

  const replaceable = createServiceToken<number>('test.count', { collisionPolicy: 'replace' });
  first.register(replaceable, 1);
  first.register(replaceable, 2);
  assert.equal(first.resolve(replaceable), 2);

  const collidingId = createServiceToken<string>('test.message', { collisionPolicy: 'replace' });
  assert.throws(() => first.register(collidingId, 'unsafe'), /token id is already registered/);

  if (false) {
    // @ts-expect-error A string service token cannot register a number.
    first.register(token, 42);
  }
});

test('legacy catalog normalizes metadata without importing code before activation', async () => {
  await withTempDirectory(async root => {
    const marker = join(root, 'imported.txt');
    await writePluginFixture(root, 'nested', {
      manifestFileName: 'plugin.yaml',
      manifest: `
name: Legacy Alias
version: '1.2.3'
entry: ./plugin.mjs
components:
  - type: tool
    export: AliasTool
    tool_name: alias
`,
      module: `
import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(marker)}, 'imported');
export const AliasTool = {
  description: 'alias',
  parameters: { type: 'object' },
  execute() { return 'ok'; }
};
`,
    });

    const catalog = new LegacyPluginCatalog([root]);
    const iterator = catalog.definitions()[Symbol.asyncIterator]();
    const next = await iterator.next();
    assert.equal(next.done, false);
    const definition = next.value;
    assert.deepEqual(definition.descriptor, {
      id: 'legacy:1:nested/plugin.yaml',
      schema: 'legacy',
      name: 'Legacy Alias',
      version: '1.2.3',
      origin: 'legacy',
      manifestPath: join(root, 'nested', 'plugin.yaml'),
      rootPath: join(root, 'nested'),
      ordinal: 1,
      requires: {},
      optionalRequires: {},
      conflicts: {},
    });
    await assert.rejects(access(marker), { code: 'ENOENT' });
    const activator = await definition.loadActivator();
    await assert.rejects(access(marker), { code: 'ENOENT' });

    const registries = new ContributionRegistries();
    const services = new ScopedServiceRegistry();
    const owned: unknown[] = [];
    const context: PluginActivationContext = {
      services,
      own: value => { owned.push(value); },
      registerExtension: value => registries.registerExtension(value),
      registerAgentRole: value => registries.registerAgentRole(value),
      registerDecorator: (value, priority) => registries.registerDecorator(value, priority),
      registerTool: value => registries.registerTool(value),
      registerProvider: value => registries.registerProvider(value),
      registerProviderFactory: value => registries.registerProviderFactory(value),
    };
    await activator.activate(context);

    await access(marker);
    assert.equal(await registries.getTool('alias')?.execute({}), 'ok');
    assert.equal(owned.length, 1);
    assert.equal((await iterator.next()).done, true);
  });
});
