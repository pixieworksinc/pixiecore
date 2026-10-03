/**
 * Provides authoring bootstrapping behavior for PixieCore.
 */

import { spawn } from 'node:child_process';
import {
  access,
  mkdtemp,
  mkdir,
  rm,
  symlink,
  readFile,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import YAML from 'yaml';
import { PluginLoadError } from '../../../contracts/errors/index.js';
import type { ValidatedManagedManifest } from '../managed/manifest.js';
import {
  readManagedManifestEnvelope,
  validateManagedManifest,
} from '../managed/manifest.js';
import { importPluginModulePath } from '../catalog/module-loader.js';
import { PluginHost } from '../manager.js';
import { collectFiles } from './file-tree.js';
import { asError } from '../model/validation.js';

export const PLUGIN_TEMPLATE_KINDS = [
  'agent_role',
  'decorator',
  'tool',
  'provider',
  'extension',
] as const;

/**
 * Defines the supported plugin template kind values.
 */
export type PluginTemplateKind = typeof PLUGIN_TEMPLATE_KINDS[number];

/**
 * Configures create plugin project behavior.
 */
export interface CreatePluginProjectOptions {
  readonly directory: string;
  readonly id: string;
  readonly kind: PluginTemplateKind;
  readonly name?: string;
  readonly extensionPoint?: string;
}

/**
 * Describes the plugin project validation contract.
 */
export interface PluginProjectValidation {
  readonly rootPath: string;
  readonly manifest: ValidatedManagedManifest;
  readonly exports: readonly string[];
}

const PLUGIN_ID = /^[a-z0-9]+(?:[._-][a-z0-9]+)+$/;
const SOURCE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Creates plugin project after validating the supplied contract.
 */
export async function createPluginProject(
  options: CreatePluginProjectOptions,
): Promise<string> {
  const directory = resolve(options.directory);
  const sourceName = basename(directory);
  validateCreateOptions(sourceName, options.id, options.kind, options.extensionPoint);
  await assertDirectoryAbsent(directory);

  const displayName = options.name?.trim() || titleCase(sourceName);
  const template = pluginTemplate(
    sourceName,
    options.id,
    displayName,
    options.kind,
    options.extensionPoint,
  );
  try {
    await Promise.all([
      mkdir(join(directory, 'src'), { recursive: true }),
      mkdir(join(directory, 'tests'), { recursive: true }),
    ]);
    await Promise.all(Object.entries(template.files).map(([path, content]) => (
      writeFile(join(directory, path), content, { encoding: 'utf8', flag: 'wx' })
    )));
    return directory;
  } catch (error) {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    throw new PluginLoadError(`Failed to create plugin project ${directory}`, { cause: asError(error) });
  }
}

/**
 * Validates plugin project and rejects unsupported input.
 */
export async function validatePluginProject(
  directory: string,
  options: { readonly inspectExports?: boolean } = {},
): Promise<PluginProjectValidation> {
  const rootPath = resolve(directory);
  const sourceName = basename(rootPath);
  if (!SOURCE_NAME.test(sourceName)) {
    throw new PluginLoadError(`Plugin directory name must be lowercase kebab-case: ${sourceName}`);
  }
  const requiredPaths = [
    join(rootPath, `${sourceName}.ts`),
    join(rootPath, `${sourceName}.yaml`),
    join(rootPath, 'src'),
    join(rootPath, 'tests'),
  ];
  for (const path of requiredPaths) {
    await access(path).catch(cause => {
      throw new PluginLoadError(`Plugin project is missing required path: ${path}`, { cause });
    });
  }
  const testFiles = await collectTestFiles(join(rootPath, 'tests'));
  if (testFiles.length === 0) {
    throw new PluginLoadError(`Plugin project requires at least one tests/**/*.test file: ${rootPath}`);
  }
  await validateAuthoringImports(rootPath);

  const manifestPath = join(rootPath, `${sourceName}.yaml`);
  const envelope = await readManagedManifestEnvelope({
    rootPath,
    manifestPath,
    ordinal: 1,
  });
  const manifest = await validateManagedManifest(envelope);
  const exports = options.inspectExports === false
    ? []
    : await inspectPluginExports(manifest);
  return Object.freeze({
    rootPath,
    manifest,
    exports: Object.freeze(exports),
  });
}

/**
 * Tests plugin project for the owning PixieCore boundary.
 */
export async function testPluginProject(directory: string): Promise<void> {
  const project = await validatePluginProject(directory);
  const testFiles = await collectTestFiles(join(project.rootPath, 'tests'));
  await runNodeTests(testFiles, project.rootPath);
  await testTemporaryConsumerActivation(project);
}

async function inspectPluginExports(manifest: ValidatedManagedManifest): Promise<string[]> {
  const modulePaths = new Set(
    manifest.components?.map(component => component.modulePath) ?? [manifest.entryPath],
  );
  const exports = new Set<string>();
  for (const modulePath of modulePaths) {
    const loaded = await importPluginModulePath(modulePath, `validate-${Date.now()}`);
    for (const name of Object.keys(loaded)) exports.add(name);
    for (const component of manifest.components ?? []) {
      if (component.modulePath === modulePath && !Object.hasOwn(loaded, component.export)) {
        throw new PluginLoadError(
          `Plugin module ${modulePath} does not export ${component.export}`,
        );
      }
    }
    if (manifest.components === undefined && !Object.hasOwn(loaded, 'default')) {
      throw new PluginLoadError(`Plugin module ${modulePath} does not export default`);
    }
  }
  return [...exports].sort();
}

async function collectTestFiles(directory: string): Promise<string[]> {
  return collectFiles(directory, {
    includeFile: entry => /\.test\.(?:[cm]?js|ts)$/.test(entry.name),
  });
}

async function validateAuthoringImports(rootPath: string): Promise<void> {
  const files = await collectSourceFiles(rootPath);
  const specifierPattern = /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)['"]([^'"]+)['"]/g;
  for (const path of files) {
    const source = await readFile(path, 'utf8');
    for (const match of source.matchAll(specifierPattern)) {
      const specifier = match[1]!;
      if (specifier === '@pixieworks/pixiecore/plugin'
          || specifier === '@pixieworks/pixiecore/apisix'
          || !specifier.startsWith('@pixieworks/pixiecore/')) continue;
      throw new PluginLoadError(
        `Plugin source may not import non-authoring PixieCore subpath ${specifier}: ${path}`,
      );
    }
  }
}

async function collectSourceFiles(rootPath: string): Promise<string[]> {
  return collectFiles(rootPath, {
    skipEntry: entry => ['node_modules', '.git', 'tests'].includes(entry.name),
    includeFile: entry => /\.(?:[cm]?[jt]s)$/.test(entry.name),
  });
}

async function testTemporaryConsumerActivation(
  project: PluginProjectValidation,
): Promise<void> {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'pixiecore-plugin-test-'));
  const configPath = join(temporaryRoot, 'pixiecore.plugins.yml');
  const linkPath = join(temporaryRoot, 'plugins', ...project.manifest.id.split('.'));
  let manager: PluginHost | undefined;
  try {
    await mkdir(join(linkPath, '..'), { recursive: true });
    await symlink(project.rootPath, linkPath, 'dir');
    await writeFile(configPath, YAML.stringify({
      schema: 'pixiecore.plugins/v1',
      enabled: [project.manifest.id],
      disabled: [],
    }));
    manager = new PluginHost(undefined, {}, { pluginConfigPath: configPath });
    await manager.load();
  } finally {
    await manager?.close().catch(() => undefined);
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

function runNodeTests(files: readonly string[], cwd: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const environment = { ...process.env };
    delete environment.NODE_TEST_CONTEXT;
    const child = spawn(process.execPath, ['--test', ...files], {
      cwd,
      env: environment,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(new PluginLoadError(
        `Plugin tests failed${signal ? ` with signal ${signal}` : ` with exit code ${code}`}`,
      ));
    });
  });
}

async function assertDirectoryAbsent(directory: string): Promise<void> {
  try {
    await access(directory);
  } catch {
    return;
  }
  throw new PluginLoadError(`Plugin project directory already exists: ${directory}`);
}

function validateCreateOptions(
  sourceName: string,
  id: string,
  kind: string,
  extensionPoint: string | undefined,
): asserts kind is PluginTemplateKind {
  if (!SOURCE_NAME.test(sourceName)) {
    throw new PluginLoadError(`Plugin directory name must be lowercase kebab-case: ${sourceName}`);
  }
  if (!PLUGIN_ID.test(id) || id.startsWith('pixiecore.')) {
    throw new PluginLoadError(`Plugin id must be namespaced and may not use pixiecore.*: ${id}`);
  }
  if (!PLUGIN_TEMPLATE_KINDS.includes(kind as PluginTemplateKind)) {
    throw new PluginLoadError(`Unknown plugin template kind: ${kind}`);
  }
  if (kind === 'extension'
      && (extensionPoint === undefined || !PLUGIN_ID.test(extensionPoint))) {
    throw new PluginLoadError('Extension plugin requires a namespaced extension point');
  }
}

function titleCase(value: string): string {
  return value.split('-').map(part => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`).join(' ');
}

function pascalCase(value: string): string {
  return value.split('-').map(part => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`).join('');
}

function pluginTemplate(
  sourceName: string,
  id: string,
  displayName: string,
  kind: PluginTemplateKind,
  extensionPoint: string | undefined,
): { readonly files: Readonly<Record<string, string>> } {
  const symbol = `${pascalCase(sourceName)}${templateSuffix(kind)}`;
  const component = templateComponent(kind, symbol, sourceName, extensionPoint);
  const implementation = templateImplementation(kind, symbol, sourceName);
  const javascript = templateJavaScript(kind, symbol, sourceName);
  return {
    files: {
      [`${sourceName}.ts`]: `export { ${symbol} } from './src/index.js';\n`,
      [`${sourceName}.js`]: `export { ${symbol} } from './src/index.js';\n`,
      [`${sourceName}.yaml`]: YAML.stringify({
        schema: 'pixiecore.plugin/v1',
        id,
        name: displayName,
        version: '0.1.0',
        description: `Adds the ${sourceName} ${kind} plugin.`,
        entry: `./${sourceName}.js`,
        requires: {},
        optional_requires: {},
        conflicts: {},
        components: [component],
      }),
      'src/index.ts': implementation,
      'src/index.js': javascript,
      [`tests/${sourceName}.test.js`]: templateTest(kind, symbol, sourceName),
      'package.json': `${JSON.stringify({
        name: `@${id.split('.')[0]}/pixiecore-plugin-${sourceName}`,
        version: '0.1.0',
        private: true,
        type: 'module',
        files: [`${sourceName}.js`, `${sourceName}.yaml`, 'src/**/*.js'],
        peerDependencies: { '@pixieworks/pixiecore': '^0.1.0' },
        devDependencies: { typescript: '^5.9.2' },
        scripts: {
          typecheck: 'tsc --noEmit --module NodeNext --moduleResolution NodeNext --target ES2022 --strict *.ts src/**/*.ts',
          test: 'node --test tests/**/*.test.js',
        },
      }, null, 2)}\n`,
    },
  };
}

function templateSuffix(kind: PluginTemplateKind): string {
  if (kind === 'agent_role') return 'Role';
  if (kind === 'decorator') return 'Decorator';
  if (kind === 'provider') return 'ProviderFactory';
  if (kind === 'extension') return 'Extension';
  return 'Tool';
}

function templateComponent(
  kind: PluginTemplateKind,
  symbol: string,
  sourceName: string,
  extensionPoint: string | undefined,
): Record<string, unknown> {
  if (kind === 'agent_role') return { type: kind, export: symbol, roles_supported: [sourceName] };
  if (kind === 'decorator') return { type: kind, export: symbol, priority: 100, stage: 'after' };
  if (kind === 'provider') return { type: kind, export: symbol, provider_name: sourceName.replaceAll('-', '_') };
  if (kind === 'extension') {
    return { type: kind, export: symbol, extension_point: extensionPoint };
  }
  return { type: kind, export: symbol, tool_name: sourceName.replaceAll('-', '_') };
}

function templateImplementation(kind: PluginTemplateKind, symbol: string, sourceName: string): string {
  if (kind === 'agent_role') return `import type { AgentRolePlugin } from '@pixieworks/pixiecore/plugin';\n\nexport const ${symbol}: AgentRolePlugin = {\n  supportedRoles: ['${sourceName}'],\n  apply(renderedPrompt) {\n    return { messages: [{ role: 'user', content: renderedPrompt }] };\n  },\n};\n`;
  if (kind === 'decorator') return `import type { OutputDecorator } from '@pixieworks/pixiecore/plugin';\n\nexport const ${symbol}: OutputDecorator = {\n  priority: 100,\n  stage: 'after',\n  validate(context) { return context; },\n};\n`;
  if (kind === 'provider') return `import type { ProviderFactory } from '@pixieworks/pixiecore/plugin';\n\nexport const ${symbol}: ProviderFactory = {\n  name: '${sourceName.replaceAll('-', '_')}',\n  create: options => ({\n    name: '${sourceName.replaceAll('-', '_')}', model: options.model ?? 'example-model',\n    supportsTools: false, supportsMultimodal: false,\n    supportsVision: () => false, supportsFileInput: () => false,\n    getModelList: async () => ['example-model'],\n    generate: async () => ({ content: '{}' }),\n  }),\n};\n`;
  if (kind === 'extension') return `export const ${symbol} = { name: '${sourceName}' } as const;\n`;
  return `import type { RegisteredTool } from '@pixieworks/pixiecore/plugin';\n\nexport const ${symbol}: RegisteredTool = {\n  name: '${sourceName.replaceAll('-', '_')}',\n  description: 'Generated PixieCore tool',\n  parameters: { type: 'object', properties: {} },\n  execute: () => ({ ok: true }),\n};\n`;
}

function templateJavaScript(kind: PluginTemplateKind, symbol: string, sourceName: string): string {
  if (kind === 'agent_role') return `export const ${symbol} = { supportedRoles: ['${sourceName}'], apply(renderedPrompt) { return { messages: [{ role: 'user', content: renderedPrompt }] }; } };\n`;
  if (kind === 'decorator') return `export const ${symbol} = { priority: 100, stage: 'after', validate(context) { return context; } };\n`;
  if (kind === 'provider') return `export const ${symbol} = { name: '${sourceName.replaceAll('-', '_')}', create(options) { return { name: '${sourceName.replaceAll('-', '_')}', model: options.model ?? 'example-model', supportsTools: false, supportsMultimodal: false, supportsVision: () => false, supportsFileInput: () => false, getModelList: async () => ['example-model'], generate: async () => ({ content: '{}' }) }; } };\n`;
  if (kind === 'extension') return `export const ${symbol} = { name: '${sourceName}' };\n`;
  return `export const ${symbol} = { name: '${sourceName.replaceAll('-', '_')}', description: 'Generated PixieCore tool', parameters: { type: 'object', properties: {} }, execute: () => ({ ok: true }) };\n`;
}

function templateTest(
  kind: PluginTemplateKind,
  symbol: string,
  sourceName: string,
): string {
  const assertion = kind === 'provider'
    ? `assert.equal(${symbol}.name.length > 0, true);`
    : kind === 'agent_role'
      ? `assert.equal(${symbol}.supportedRoles.length, 1);`
      : kind === 'decorator'
        ? `assert.equal(${symbol}.stage, 'after');`
        : kind === 'extension'
          ? `assert.equal(${symbol}.name, '${sourceName}');`
        : `assert.equal(typeof ${symbol}.execute, 'function');`;
  return `import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport { ${symbol} } from '../${sourceName}.js';\n\ntest('generated plugin exports its component', () => { ${assertion} });\n`;
}
