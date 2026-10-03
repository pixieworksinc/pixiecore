import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface PluginFixtureOptions {
  readonly manifest: string;
  readonly module?: string;
  readonly manifestFileName?: string;
  readonly moduleFileName?: string;
}

export interface LegacyPluginManifestFixtureOptions {
  readonly name: string;
  readonly version?: string;
  readonly module?: string;
}

export interface ManagedPluginManifestV1FixtureOptions {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly entry?: string;
  readonly description?: string;
  readonly requires?: Readonly<Record<string, string>>;
  readonly optionalRequires?: Readonly<Record<string, string>>;
  readonly conflicts?: Readonly<Record<string, string>>;
}

export interface ManagedPluginStateV1FixtureOptions {
  readonly roots: readonly string[];
  readonly enabled?: readonly string[];
  readonly disabled?: readonly string[];
}

/** Writes one plugin directory while allowing malformed manifests to be tested. */
export async function writePluginFixture(
  root: string,
  directory: string,
  options: PluginFixtureOptions,
): Promise<string> {
  const path = join(root, directory);
  await mkdir(path, { recursive: true });
  await writeFile(join(path, options.manifestFileName ?? 'plugin.yml'), options.manifest, 'utf8');
  if (options.module !== undefined) {
    await writeFile(join(path, options.moduleFileName ?? 'plugin.mjs'), options.module, 'utf8');
  }
  return path;
}

/** Builds the unversioned root-module manifest accepted by the legacy adapter. */
export function buildLegacyPluginManifest(options: LegacyPluginManifestFixtureOptions): string {
  return [
    `name: ${JSON.stringify(options.name)}`,
    ...(options.version === undefined ? [] : [`version: ${JSON.stringify(options.version)}`]),
    `module: ${options.module ?? './plugin.mjs'}`,
    '',
  ].join('\n');
}

/** Builds the canonical identity and entry fields for a managed v1 plugin. */
export function buildManagedPluginManifestV1(options: ManagedPluginManifestV1FixtureOptions): string {
  return [
    'schema: pixiecore.plugin/v1',
    `id: ${JSON.stringify(options.id)}`,
    `name: ${JSON.stringify(options.name)}`,
    `version: ${JSON.stringify(options.version)}`,
    ...(options.description === undefined
      ? []
      : [`description: ${JSON.stringify(options.description)}`]),
    `entry: ${JSON.stringify(options.entry ?? './plugin.mjs')}`,
    ...managedDependencyMap('requires', options.requires),
    ...managedDependencyMap('optional_requires', options.optionalRequires),
    ...managedDependencyMap('conflicts', options.conflicts),
    '',
  ].join('\n');
}

/** Builds the explicit, versioned activation state used by managed-plugin tests. */
export function buildManagedPluginStateV1(options: ManagedPluginStateV1FixtureOptions): string {
  return [
    'schema: pixiecore.plugins/v1',
    ...yamlStringList('roots', options.roots),
    ...yamlStringList('enabled', options.enabled ?? []),
    ...yamlStringList('disabled', options.disabled ?? []),
    '',
  ].join('\n');
}

/** Builds a closable plugin that appends one lifecycle marker during cleanup. */
export function buildLifecyclePluginModule(markerPath: string, marker: string): string {
  return `
import { appendFile } from 'node:fs/promises';
export default {
  tools: [{ name: 'noop', description: 'noop', parameters: { type: 'object' }, execute() {} }],
  async close() { await appendFile(${JSON.stringify(markerPath)}, ${JSON.stringify(`${marker}\n`)}); },
};
`;
}

function managedDependencyMap(
  field: string,
  dependencies: Readonly<Record<string, string>> | undefined,
): string[] {
  if (dependencies === undefined) return [];
  const entries = Object.entries(dependencies);
  if (entries.length === 0) return [`${field}: {}`];
  return [
    `${field}:`,
    ...entries.map(([id, range]) => `  ${JSON.stringify(id)}: ${JSON.stringify(range)}`),
  ];
}

function yamlStringList(field: string, values: readonly string[]): string[] {
  return values.length === 0
    ? [`${field}: []`]
    : [`${field}:`, ...values.map(value => `  - ${JSON.stringify(value)}`)];
}
