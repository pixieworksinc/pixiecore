import assert from 'node:assert/strict';
import { access, realpath, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import {
  assertManagedManifestHasNoFatalDiagnostics,
  isExactSemVer,
  isNpmCompatibleVersionRange,
  managedDefinitionFromManifest,
  readManagedManifestEnvelope,
  validateManagedManifest,
  type ManagedManifestSource,
} from '../../src/core/bootstrap/plugin-manager/managed/manifest.js';
import { ManagedPluginCatalog } from '../../src/core/bootstrap/plugin-manager/managed/catalog.js';
import {
  resolveManagedPluginDependencies,
  type ManagedResolutionCandidate,
} from '../../src/core/bootstrap/plugin-manager/dependency/resolver.js';
import type { NormalizedPluginDescriptor } from '../../src/core/bootstrap/plugin-manager/model/definition.js';
import { ScopedServiceRegistry } from '../../src/core/bootstrap/plugin-manager/registries/services.js';
import { PluginLoadError } from '../../src/core/contracts/errors/index.js';
import type { PluginActivationContext } from '../../src/core/contracts/plugin/activation.js';
import type {
  AgentRolePlugin,
  OutputDecorator,
  ProviderFactory,
  RegisteredTool,
} from '../../src/core/contracts/types/index.js';
import {
  buildManagedPluginManifestV1,
  buildManagedPluginStateV1,
  writePluginFixture,
} from '../helpers/plugin.js';
import { testData } from '../helpers/test-data.js';
import { withTempDirectory } from '../helpers/temp.js';

const data = testData('managed manifest negative table');
const MANAGED_PLUGIN_ID_SOURCE = '^[a-z0-9]+(?:[._-][a-z0-9]+)+$';

test('managed envelopes retain disabled-invalid diagnostics and mark trust violations fatal', async () => {
  await withTempDirectory(async root => {
    const pluginRoot = await writePluginFixture(root, 'invalid', {
      manifest: `
schema: pixiecore.plugin/v1
id: Not-Canonical
name: Invalid
version: 1.0.0
entry: ./missing.mjs
enabled: true
`,
    });
    const envelope = await readManagedManifestEnvelope(source(pluginRoot, 1));

    assert.equal(envelope.id, 'Not-Canonical');
    assert.deepEqual(
      envelope.diagnostics.map(item => [item.code, item.fatal]),
      [
        ['managed-manifest-trust-field', true],
        ['managed-manifest-id', false],
      ],
    );
    assert.throws(
      () => assertManagedManifestHasNoFatalDiagnostics(envelope),
      /trusted field enabled/,
    );

    const aliasRoot = await writePluginFixture(root, 'alias', {
      manifest: `
schema: pixiecore.plugin/v1
id: acme.alias
name: &name Alias
version: 1.0.0
entry: ./plugin.mjs
description: *name
`,
    });
    const aliasEnvelope = await readManagedManifestEnvelope(source(aliasRoot, 2));
    assert.equal(aliasEnvelope.diagnostics[0]?.code, 'managed-manifest-yaml-error');
  });
});

test('managed validation is import-free through activator creation and imports on activation', async () => {
  await withTempDirectory(async root => {
    const marker = join(root, 'imported.txt');
    const pluginRoot = await writePluginFixture(root, 'valid', {
      manifest: `
schema: pixiecore.plugin/v1
id: acme.valid
name: Valid plugin
version: 1.2.3
description: A managed plugin
entry: ./plugin.mjs
requires:
  pixiecore.roles: ^1.0.0
optional_requires: {}
conflicts: {}
`,
      module: `
import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(marker)}, 'imported');
export default () => ({
  tools: [{
    name: 'managed-tool',
    description: 'managed',
    parameters: { type: 'object' },
    execute() { return 'ok'; },
  }],
});
`,
    });

    const envelope = await readManagedManifestEnvelope(source(pluginRoot, 7));
    const manifest = await validateManagedManifest(envelope);
    const definition = managedDefinitionFromManifest(manifest);
    assert.equal(definition.descriptor.id, 'acme.valid');
    assert.equal(definition.descriptor.ordinal, 7);
    assert.deepEqual(definition.descriptor.requires, { 'pixiecore.roles': '^1.0.0' });
    await assert.rejects(access(marker), { code: 'ENOENT' });

    const activator = await definition.loadActivator();
    await assert.rejects(access(marker), { code: 'ENOENT' });

    let tool: RegisteredTool | undefined;
    const owned: unknown[] = [];
    const context: PluginActivationContext = {
      services: new ScopedServiceRegistry(),
      own: value => { owned.push(value); },
      registerExtension: () => undefined,
      registerAgentRole: () => undefined,
      registerDecorator: () => undefined,
      registerTool: value => { tool = value; },
      registerProvider: () => undefined,
      registerProviderFactory: () => undefined,
    };
    await activator.activate(context);

    await access(marker);
    assert.equal(await tool?.execute({}), 'ok');
    assert.equal(owned.length, 1);
  });
});

test('managed canonical components activate all four contribution kinds', async () => {
  await withTempDirectory(async root => {
    const marker = join(root, 'components-imported.txt');
    const pluginRoot = await writePluginFixture(root, 'components', {
      manifest: `
schema: pixiecore.plugin/v1
id: acme.components
name: Managed components
version: 1.0.0
entry: ./plugin.mjs
components:
  - type: agent_role
    export: ManagedRole
    roles_supported: [managed]
  - type: decorator
    export: ManagedDecorator
    priority: 12
    stage: after
  - type: tool
    export: ManagedTool
    tool_name: managed-component-tool
  - type: provider
    export: ManagedProvider
    provider_name: managed-component-provider
`,
      module: `
import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(marker)}, 'imported');
export class ManagedRole { apply(prompt) { return { messages: [{ role: 'user', content: 'managed:' + prompt }] }; } }
export class ManagedDecorator { validate(context) { return { ...context, output: 'decorated' }; } }
export class ManagedTool {
  description = 'managed component'; parameters = { type: 'object' };
  execute() { return 'tool result'; }
}
export class ManagedProvider {
  name = 'managed-component-provider'; model = 'managed'; supportsTools = true;
  supportsMultimodal = true; supportsVision() { return true; }
  supportsFileInput() { return true; } async getModelList() { return ['managed']; }
  async generate() { return { content: '{}' }; }
}
`,
    });
    const definition = managedDefinitionFromManifest(
      await validateManagedManifest(await readManagedManifestEnvelope(source(pluginRoot, 1))),
    );
    const activator = await definition.loadActivator();
    await assert.rejects(access(marker), { code: 'ENOENT' });

    let role: AgentRolePlugin | undefined;
    let decorator: OutputDecorator | undefined;
    let tool: RegisteredTool | undefined;
    let provider: ProviderFactory | undefined;
    const context: PluginActivationContext = {
      services: new ScopedServiceRegistry(),
      own: () => undefined,
      registerExtension: () => undefined,
      registerAgentRole: value => { role = value; },
      registerDecorator: value => { decorator = value; },
      registerTool: value => { tool = value; },
      registerProvider: () => undefined,
      registerProviderFactory: value => { provider = value; },
    };
    await activator.activate(context);

    await access(marker);
    assert.deepEqual(role?.supportedRoles, ['managed']);
    assert.equal((await role?.apply('prompt', {} as never, {}))?.messages[0]?.content, 'managed:prompt');
    assert.equal(decorator?.priority, 12);
    assert.equal((await decorator?.validate({} as never) as { output?: string })?.output, 'decorated');
    assert.equal(await tool?.execute({}), 'tool result');
    assert.equal((await provider?.create({}))?.model, 'managed');
  });
});

test('managed full validation rejects aliases, path escapes, and invalid versions or ranges', async () => {
  await withTempDirectory(async root => {
    await writeFile(join(root, 'outside.mjs'), 'export default {};\n');
    const escapedRoot = await writePluginFixture(root, 'escaped', {
      manifest: `
schema: pixiecore.plugin/v1
id: acme.escaped
name: Escaped
version: 1.0.0
entry: ../outside.mjs
`,
    });
    await assert.rejects(
      validateManagedManifest(await readManagedManifestEnvelope(source(escapedRoot, 1))),
      /entry path escapes its plugin root/,
    );

    const absoluteRoot = await writePluginFixture(root, 'absolute-escaped', {
      manifest: `
schema: pixiecore.plugin/v1
id: acme.absolute-escaped
name: Absolute escaped
version: 1.0.0
entry: ${JSON.stringify(join(root, 'outside.mjs'))}
`,
    });
    await assert.rejects(
      validateManagedManifest(await readManagedManifestEnvelope(source(absoluteRoot, 2))),
      /entry path escapes its plugin root/,
    );

    const symlinkRoot = await writePluginFixture(root, 'symlink-escaped', {
      manifest: `
schema: pixiecore.plugin/v1
id: acme.symlink-escaped
name: Symlink escaped
version: 1.0.0
entry: ./linked.mjs
`,
    });
    await symlink(join(root, 'outside.mjs'), join(symlinkRoot, 'linked.mjs'));
    await assert.rejects(
      validateManagedManifest(await readManagedManifestEnvelope(source(symlinkRoot, 3))),
      /entry path escapes its plugin root/,
    );

    const aliasRoot = await writePluginFixture(root, 'alias', {
      manifest: `
schema: pixiecore.plugin/v1
id: acme.alias
name: Alias
version: 1.0.0
entry: ./plugin.mjs
components:
  - type: tool
    export: AliasTool
    class: AliasTool
    tool_name: alias
`,
      module: 'export const AliasTool = {};\n',
    });
    await assert.rejects(
      validateManagedManifest(await readManagedManifestEnvelope(source(aliasRoot, 4))),
      /unknown field class/,
    );

    const coreOnlyComponentRoot = await writePluginFixture(root, 'core-only-component', {
      manifest: `
schema: pixiecore.plugin/v1
id: acme.core-only-component
name: Core-only component
version: 1.0.0
entry: ./plugin.mjs
components:
  - type: service
    export: InternalService
    service_id: acme.internal.service
`,
      module: 'export const InternalService = {};\n',
    });
    await assert.rejects(
      validateManagedManifest(await readManagedManifestEnvelope(source(coreOnlyComponentRoot, 5))),
      /unsupported type service/,
    );
  });

  assert.equal(isExactSemVer('1.2.3-beta.1+build.2'), true);
  assert.equal(isExactSemVer('v1.2.3'), false);
  assert.equal(isExactSemVer('1.2.3-01'), false);
  assert.equal(isNpmCompatibleVersionRange('>=1.0.0 <2'), true);
  assert.equal(isNpmCompatibleVersionRange('latest'), false);
});

test('managed manifest rejection table is exact and import-free', async t => {
  await withTempDirectory(async root => {
    for (const [index, item] of manifestRejectionCases.entries()) {
      await t.test(`${String(index).padStart(2, '0')}: ${item.name}`, async () => {
        const id = `acme.${data.text(`rejection-${index}-id`, 'plugin')}`;
        const name = data.text(`rejection-${index}-name`, 'Plugin');
        const dependencyId = `acme.${data.text(`rejection-${index}-dependency`, 'dependency')}`;
        const invalidId = data.text(`rejection-${index}-invalid-id`, 'Invalid Identity');
        const unknownField = data.text(`rejection-${index}-unknown-field`, 'unknown');
        const directory = data.text(`rejection-${index}-directory`, 'plugin');
        const marker = join(root, data.text(`rejection-${index}-marker`, 'imported.txt'));
        const pluginRoot = await writePluginFixture(root, directory, {
          manifest: item.manifest(buildManagedPluginManifestV1({
            id,
            name,
            version: '1.0.0',
          }), { id, name, dependencyId, invalidId, unknownField }),
          module: importMarkerModule(marker, id),
        });
        const manifestPath = join(pluginRoot, 'plugin.yml');

        await assert.rejects(
          validateManagedManifest(await readManagedManifestEnvelope(source(pluginRoot, index + 1))),
          error => exactPluginLoadError(
            error,
            item.message(manifestPath, { id, name, dependencyId, invalidId, unknownField }),
          ),
        );
        await assertNotImported(marker);
      });
    }
  });
});

test('every trusted manifest field is fatal even for explicitly disabled plugins', async t => {
  await withTempDirectory(async root => {
    for (const [index, field] of TRUST_FIELDS.entries()) {
      await t.test(`${String(index).padStart(2, '0')}: ${field}`, async () => {
        const id = `acme.${data.text(`trust-${index}-id`, 'plugin')}`;
        const marker = join(root, data.text(`trust-${index}-marker`, 'imported.txt'));
        const pluginRoot = await writePluginFixture(root, data.text(`trust-${index}-directory`, 'plugin'), {
          manifest: `${buildManagedPluginManifestV1({
            id,
            name: data.text(`trust-${index}-name`, 'Plugin'),
            version: '1.0.0',
          })}${field}: true\n`,
          module: importMarkerModule(marker, id),
        });
        const canonicalPluginRoot = await realpath(pluginRoot);
        const statePath = join(root, data.text(`trust-${index}-state`, 'state.yml'));
        await writeFile(statePath, buildManagedPluginStateV1({
          roots: [pluginRoot],
          disabled: [id],
        }), 'utf8');
        const catalog = new ManagedPluginCatalog({
          activationState: {
            pluginConfigPath: statePath,
            workingDirectory: root,
            environment: {},
          },
          legacyDirectories: [],
          coreDescriptors: [],
        });

        await assert.rejects(
          consumeDefinitions(catalog),
          error => exactPluginLoadError(
            error,
            `Managed plugin manifest may not define trusted field ${field}: ${join(canonicalPluginRoot, 'plugin.yml')}`,
          ),
        );
        await assertNotImported(marker);
      });
    }
  });
});

test('managed component import failures happen only at the activation boundary', async t => {
  await t.test('missing named export', async () => {
    await withTempDirectory(async root => {
      const id = `acme.${data.text('missing export id', 'plugin')}`;
      const marker = join(root, data.text('missing export marker', 'imported.txt'));
      const missingExport = data.text('missing export name', 'MissingTool');
      const presentExport = data.text('present export name', 'PresentTool');
      const toolName = data.text('missing export tool name', 'tool');
      const pluginRoot = await writePluginFixture(root, data.text('missing export directory', 'plugin'), {
        manifest: `${buildManagedPluginManifestV1({
          id,
          name: data.text('missing export plugin name', 'Plugin'),
          version: '1.0.0',
        })}components:\n  - type: tool\n    export: ${missingExport}\n    tool_name: ${toolName}\n`,
        module: `
import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(marker)}, 'imported');
export const ${presentExport} = { execute() {} };
`,
      });
      const manifestPath = join(pluginRoot, 'plugin.yml');
      const definition = managedDefinitionFromManifest(
        await validateManagedManifest(await readManagedManifestEnvelope(source(pluginRoot, 1))),
      );
      const activator = await definition.loadActivator();
      const activation = recordingActivationContext();
      await assertNotImported(marker);

      await assert.rejects(
        async () => { await activator.activate(activation.context); },
        (error: unknown) => exactPluginLoadError(
          error,
          `Plugin component 0 cannot find export ${missingExport}: ${manifestPath}`,
        ),
      );
      await access(marker);
      assert.deepEqual(activation.events, []);
    });
  });

  await t.test('asynchronous component factory', async () => {
    await withTempDirectory(async root => {
      const id = `acme.${data.text('async factory id', 'plugin')}`;
      const marker = join(root, data.text('async factory marker', 'imported.txt'));
      const exported = data.text('async factory export', 'AsyncTool');
      const toolName = data.text('async factory tool name', 'tool');
      const pluginRoot = await writePluginFixture(root, data.text('async factory directory', 'plugin'), {
        manifest: `${buildManagedPluginManifestV1({
          id,
          name: data.text('async factory plugin name', 'Plugin'),
          version: '1.0.0',
        })}components:\n  - type: tool\n    export: ${exported}\n    tool_name: ${toolName}\n`,
        module: `
import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(marker)}, 'imported');
export async function ${exported}() { return { execute() {} }; }
`,
      });
      const manifestPath = join(pluginRoot, 'plugin.yml');
      const definition = managedDefinitionFromManifest(
        await validateManagedManifest(await readManagedManifestEnvelope(source(pluginRoot, 1))),
      );
      const activator = await definition.loadActivator();
      const activation = recordingActivationContext();
      await assertNotImported(marker);

      await assert.rejects(
        async () => { await activator.activate(activation.context); },
        (error: unknown) => exactPluginLoadError(
          error,
          `Failed to instantiate component 0 from ${manifestPath}: factory must synchronously return an object`,
          cause => cause instanceof Error,
        ),
      );
      await access(marker);
      assert.deepEqual(activation.events, []);
    });
  });
});

test('managed dependency validation rejects a mismatched resolved identity', async () => {
  const selectedId = `acme.${data.text('selected identity', 'plugin')}`;
  const mismatchedId = `acme.${data.text('mismatched identity', 'plugin')}`;
  const descriptor: NormalizedPluginDescriptor = {
    id: mismatchedId,
    schema: 'pixiecore.plugin/v1',
    name: data.text('mismatched identity name', 'Plugin'),
    version: '1.0.0',
    origin: 'managed-custom',
    manifestPath: `/plugins/${selectedId}/plugin.yml`,
    rootPath: `/plugins/${selectedId}`,
    ordinal: data.integer('mismatched identity ordinal', 1, 100),
    requires: {},
    optionalRequires: {},
    conflicts: {},
  };
  const candidate: ManagedResolutionCandidate<string> = {
    id: selectedId,
    ordinal: descriptor.ordinal,
    validate: async () => ({ descriptor, value: selectedId }),
  };

  await assert.rejects(
    resolveManagedPluginDependencies({
      enabled: [selectedId],
      disabled: new Set(),
      inventory: new Map([[selectedId, candidate]]),
      coreDescriptors: [],
    }),
    error => exactPluginLoadError(
      error,
      `Managed plugin validation returned mismatched identity: ${selectedId}`,
    ),
  );
});

interface ManifestCaseValues {
  readonly id: string;
  readonly name: string;
  readonly dependencyId: string;
  readonly invalidId: string;
  readonly unknownField: string;
}

interface ManifestRejectionCase {
  readonly name: string;
  manifest(base: string, values: ManifestCaseValues): string;
  message(path: string, values: ManifestCaseValues): string;
}

const manifestRejectionCases: readonly ManifestRejectionCase[] = [
  {
    name: 'legacy root module alias',
    manifest: base => base.replace('entry: "./plugin.mjs"', 'module: "./plugin.mjs"'),
    message: path => `Managed plugin manifest requires a non-empty entry: ${path}`,
  },
  {
    name: 'legacy component class alias without export',
    manifest: base => `${base}components:\n  - type: tool\n    class: LegacyTool\n    tool_name: legacy-tool\n`,
    message: path => `Managed plugin requires non-empty components[0].export: ${path}`,
  },
  {
    name: '$schema authoring hint',
    manifest: base => `${base}$schema: ./schema.json\n`,
    message: path => `Managed plugin manifest contains unknown field $schema: ${path}`,
  },
  {
    name: 'unknown top-level field',
    manifest: (base, values) => `${base}${values.unknownField}: true\n`,
    message: (path, values) => `Managed plugin manifest contains unknown field ${values.unknownField}: ${path}`,
  },
  {
    name: 'empty plugin id',
    manifest: (base, values) => base.replace(`id: "${values.id}"`, 'id: " "'),
    message: path => `Managed plugin manifest requires a non-empty id: ${path}`,
  },
  {
    name: 'invalid plugin id',
    manifest: (base, values) => base.replace(`id: "${values.id}"`, `id: ${JSON.stringify(values.invalidId)}`),
    message: path => `Managed plugin id must match ${MANAGED_PLUGIN_ID_SOURCE}: ${path}`,
  },
  {
    name: 'empty plugin name',
    manifest: (base, values) => base.replace(`name: "${values.name}"`, 'name: " "'),
    message: path => `Managed plugin manifest requires a non-empty name: ${path}`,
  },
  {
    name: 'non-strict SemVer',
    manifest: base => base.replace('version: "1.0.0"', 'version: "1.0.0-01"'),
    message: path => `Managed plugin version must be SemVer 2.0: ${path}`,
  },
  ...(['requires', 'optional_requires', 'conflicts'] as const).map(field => ({
    name: `${field} must be an object`,
    manifest: (base: string) => `${base}${field}: []\n`,
    message: (path: string) => `Managed plugin ${field} must be an object: ${path}`,
  })),
  {
    name: 'dependency map plugin id',
    manifest: (base, values) => `${base}requires:\n  ${JSON.stringify(values.invalidId)}: "^1.0.0"\n`,
    message: (path, values) => `Managed plugin requires contains invalid plugin id ${values.invalidId}: ${path}`,
  },
  {
    name: 'empty dependency range',
    manifest: (base, values) => `${base}requires:\n  ${values.dependencyId}: ""\n`,
    message: (path, values) => `Managed plugin requires non-empty requires.${values.dependencyId}: ${path}`,
  },
  {
    name: 'non-npm dependency range',
    manifest: (base, values) => `${base}requires:\n  ${values.dependencyId}: latest\n`,
    message: (path, values) => `Managed plugin requires.${values.dependencyId} must be an npm-compatible version range: ${path}`,
  },
];

const TRUST_FIELDS = ['core', 'origin', 'locked', 'enabled', 'disabled'] as const;

async function consumeDefinitions(catalog: ManagedPluginCatalog): Promise<void> {
  for await (const definition of catalog.definitions()) void definition;
}

function importMarkerModule(marker: string, toolName: string): string {
  return `
import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(marker)}, 'imported');
export default {
  tools: [{
    name: ${JSON.stringify(toolName)},
    description: 'managed fixture',
    parameters: { type: 'object' },
    execute() {},
  }],
};
`;
}

function recordingActivationContext(): {
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

async function assertNotImported(marker: string): Promise<void> {
  await assert.rejects(access(marker), { code: 'ENOENT' });
}

function exactPluginLoadError(
  error: unknown,
  message: string,
  validateCause: (cause: unknown) => boolean = cause => cause === undefined,
): boolean {
  assert.ok(error instanceof Error);
  assert.equal(error.constructor, PluginLoadError);
  const pluginError = error as PluginLoadError;
  assert.equal(pluginError.name, 'PluginLoadError');
  assert.equal(pluginError.code, 'plugin_load_error');
  assert.equal(pluginError.message, message);
  assert.ok(validateCause(pluginError.cause));
  return true;
}

function source(rootPath: string, ordinal: number): ManagedManifestSource {
  return {
    rootPath,
    manifestPath: join(rootPath, 'plugin.yml'),
    ordinal,
  };
}
