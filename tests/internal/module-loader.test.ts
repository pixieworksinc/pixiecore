import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { PluginLoadError } from '../../src/core/contracts/errors/index.js';
import type { PluginActivationContext } from '../../src/core/contracts/plugin/activation.js';
import { registerManifestComponent } from '../../src/core/bootstrap/plugin-manager/catalog/legacy-manifest-adapter.js';
import {
  instantiateComponent,
  resolveExport,
} from '../../src/core/bootstrap/plugin-manager/catalog/module-loader.js';
import { ScopedServiceRegistry } from '../../src/core/bootstrap/plugin-manager/registries/services.js';
import { testData } from '../helpers/test-data.js';
import { withTempDirectory } from '../helpers/temp.js';

test('module import failures preserve the path, exact error type, cause, and zero activation effects', async t => {
  const data = testData('module loader import failures');
  await withTempDirectory(async directory => {
    const manifestPath = join(directory, 'plugin.yml');

    await t.test('missing module', async () => {
      const moduleName = `${data.text('missing module', 'missing')}.mjs`;
      const modulePath = join(directory, moduleName);
      const recorder = activationRecorder();

      await assert.rejects(
        registerRoleComponent(manifestPath, `./${moduleName}`, 'MissingRole', data, 0, recorder.context),
        error => expectPluginLoadError(error, pluginError => {
          assert.match(pluginError.message, new RegExp(escapeRegExp(modulePath)));
          assert.equal((pluginError.cause as NodeJS.ErrnoException).code, 'ERR_MODULE_NOT_FOUND');
        }),
      );
      assert.deepEqual(recorder.events, []);
    });

    await t.test('syntax-error module', async () => {
      const moduleName = `${data.text('syntax module', 'syntax')}.mjs`;
      const modulePath = join(directory, moduleName);
      await writeFile(modulePath, 'export const BrokenRole = ;\n', 'utf8');
      const recorder = activationRecorder();

      await assert.rejects(
        registerRoleComponent(manifestPath, `./${moduleName}`, 'BrokenRole', data, 1, recorder.context),
        error => expectPluginLoadError(error, pluginError => {
          assert.match(pluginError.message, new RegExp(escapeRegExp(modulePath)));
          assert.ok(pluginError.cause instanceof SyntaxError);
        }),
      );
      assert.deepEqual(recorder.events, []);
    });
  });
});

test('export resolution selects named, default, hash-suffixed, and dot-suffixed values', () => {
  const data = testData('module loader export resolution');
  const named = { marker: data.text('named marker') };
  const nested = { marker: data.text('nested marker') };
  const defaultExport = { NestedRole: nested };
  const namespace = { NamedRole: named, default: defaultExport };

  assert.equal(resolveExport(namespace, 'NamedRole'), named);
  assert.equal(resolveExport(namespace, 'default'), defaultExport);
  assert.equal(resolveExport(namespace, './plugin.mjs#NamedRole'), named);
  assert.equal(resolveExport(namespace, 'bundle.NestedRole'), nested);
});

test('component instantiation accepts objects, classes, and synchronous factories', async t => {
  const data = testData('module loader successful components');
  const path = join(data.text('plugin root', 'plugins'), 'plugin.yml');

  await t.test('object component', () => {
    const index = data.integer('object index', 1, 100);
    const component = { marker: data.text('object marker') };
    assert.equal(instantiateComponent(component, path, index), component);
  });

  await t.test('class component', () => {
    const index = data.integer('class index', 101, 200);
    const marker = data.text('class marker');
    class RoleComponent {
      readonly marker = marker;
    }

    const component = instantiateComponent(RoleComponent, path, index);
    assert.ok(component instanceof RoleComponent);
    assert.equal(component.marker, marker);
  });

  await t.test('synchronous factory', () => {
    const index = data.integer('factory index', 201, 300);
    const expected = { marker: data.text('factory marker') };
    assert.equal(instantiateComponent(() => expected, path, index), expected);
  });
});

test('invalid component exports fail before activation and retain both instantiation attempts', async t => {
  const data = testData('module loader failed components');
  await withTempDirectory(async directory => {
    const manifestPath = join(directory, 'plugin.yml');
    const moduleName = `${data.text('component module', 'components')}.mjs`;
    const modulePath = join(directory, moduleName);
    const constructorFailure = data.text('constructor failure', 'constructor-failed');
    const factoryFailure = data.text('factory failure', 'factory-failed');
    const primitive = data.integer('primitive export', 2, 1000);
    await writeFile(modulePath, `
export const PrimitiveRole = ${primitive};
export const AsyncRole = async () => ({ apply(prompt) { return prompt; } });
export class ThrowingRole {
  constructor() { throw new Error(${JSON.stringify(constructorFailure)}); }
}
export const ThrowingFactory = () => {
  throw new Error(${JSON.stringify(factoryFailure)});
};
`, 'utf8');

    const cases = [
      {
        name: 'primitive export',
        exportName: 'PrimitiveRole',
        index: data.integer('primitive index', 1, 100),
        verify(error: PluginLoadError, index: number): void {
          assert.equal(
            error.message,
            `Plugin component ${index} export must be an object, class, or factory: ${manifestPath}`,
          );
          assert.equal(error.cause, undefined);
        },
      },
      {
        name: 'async factory',
        exportName: 'AsyncRole',
        index: data.integer('async index', 101, 200),
        verify(error: PluginLoadError, index: number): void {
          assert.equal(
            error.message,
            `Failed to instantiate component ${index} from ${manifestPath}: factory must synchronously return an object`,
          );
          assert.ok(error.cause instanceof TypeError);
        },
      },
      {
        name: 'throwing constructor',
        exportName: 'ThrowingRole',
        index: data.integer('constructor index', 201, 300),
        verify(error: PluginLoadError, index: number): void {
          assert.match(
            error.message,
            new RegExp(`^Failed to instantiate component ${index} from ${escapeRegExp(manifestPath)}:`),
          );
          assert.ok(error.cause instanceof Error);
          assert.equal(error.cause.message, constructorFailure);
        },
      },
      {
        name: 'throwing factory',
        exportName: 'ThrowingFactory',
        index: data.integer('throwing factory index', 301, 400),
        verify(error: PluginLoadError, index: number): void {
          assert.equal(
            error.message,
            `Failed to instantiate component ${index} from ${manifestPath}: ${factoryFailure}`,
          );
          assert.ok(error.cause instanceof TypeError);
        },
      },
    ] as const;

    for (const item of cases) {
      await t.test(item.name, async () => {
        const recorder = activationRecorder();
        await assert.rejects(
          registerRoleComponent(
            manifestPath,
            `./${moduleName}`,
            item.exportName,
            data,
            item.index,
            recorder.context,
          ),
          error => expectPluginLoadError(error, pluginError => item.verify(pluginError, item.index)),
        );
        assert.deepEqual(recorder.events, []);
      });
    }
  });
});

function registerRoleComponent(
  manifestPath: string,
  moduleSpecifier: string,
  exportName: string,
  data: ReturnType<typeof testData>,
  index: number,
  context: PluginActivationContext,
): Promise<void> {
  return registerManifestComponent(
    manifestPath,
    moduleSpecifier,
    {
      type: 'agent_role',
      export: exportName,
      roles_supported: [data.text(`role ${index}`, 'role')],
    },
    index,
    context,
  );
}

function activationRecorder(): {
  readonly context: PluginActivationContext;
  readonly events: string[];
} {
  const events: string[] = [];
  return {
    events,
    context: {
      services: new ScopedServiceRegistry(),
      own: () => { events.push('own'); },
      registerExtension: () => { events.push('extension'); },
      registerAgentRole: () => { events.push('agent-role'); },
      registerDecorator: () => { events.push('decorator'); },
      registerTool: () => { events.push('tool'); },
      registerProvider: () => { events.push('provider'); },
      registerProviderFactory: () => { events.push('provider-factory'); },
    },
  };
}

function expectPluginLoadError(
  error: unknown,
  verify: (error: PluginLoadError) => void,
): boolean {
  assert.ok(error instanceof Error);
  assert.equal(error.constructor, PluginLoadError);
  const pluginError = error as PluginLoadError;
  assert.equal(pluginError.code, 'plugin_load_error');
  verify(pluginError);
  return true;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
