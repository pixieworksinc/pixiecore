/**
 * Provides manifest bootstrapping behavior for PixieCore.
 */

import { createRequire } from 'node:module';
import {
  readFile,
  realpath,
  stat,
} from 'node:fs/promises';
import {
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from 'node:path';
import YAML from 'yaml';
import { PluginLoadError } from '../../../contracts/errors/index.js';
import { errorMessage } from '../../../component/diagnostics/index.js';
import type {
  NormalizedPluginDescriptor,
  PluginDefinition,
} from '../model/definition.js';
import {
  createManagedPluginActivator,
  type ManagedModuleComponent,
} from './module-loader.js';
import {
  MANAGED_PLUGIN_ID_PATTERN,
  RESERVED_PLUGIN_ID_PATTERN,
  SEMVER_2_PATTERN,
  trustedPluginManifestFields,
  PIXIECORE_PLUGIN_MANIFEST_SCHEMA,
  unknownPluginManifestFields,
} from '../model/constants.js';
import {
  asError,
  isRecord,
  type UnknownRecord,
} from '../model/validation.js';

interface SemverRuntime {
  /**
   * Returns the canonical value when the input is valid, otherwise null.
   */
  valid(version: string): string | null;
  /**
   * Checks whether the supplied value falls within the permitted range.
   */
  validRange(range: string): string | null;
}

const require = createRequire(import.meta.url);
const semver = require('semver') as SemverRuntime;

/**
 * Describes the managed manifest source contract.
 */
export interface ManagedManifestSource {
  /** Managed discovery root that produced this candidate. */
  readonly rootPath: string;
  readonly manifestPath: string;
  /** Canonical manifest of the containing plugin unit, when structurally nested. */
  readonly parentManifestPath?: string;
  readonly ordinal: number;
}

/**
 * Defines the supported managed manifest diagnostic code values.
 */
export type ManagedManifestDiagnosticCode =
  | 'managed-manifest-read-error'
  | 'managed-manifest-empty'
  | 'managed-manifest-yaml-error'
  | 'managed-manifest-envelope-error'
  | 'managed-manifest-trust-field'
  | 'managed-manifest-schema'
  | 'managed-manifest-id'
  | 'managed-manifest-parent-id'
  | 'managed-manifest-reserved-id'
  | 'managed-manifest-name'
  | 'managed-manifest-version'
  | 'managed-manifest-entry';

/** Stable inventory diagnostic; fatal issues apply even to disabled entries. */
export interface ManagedManifestDiagnostic {
  readonly code: ManagedManifestDiagnosticCode;
  readonly message: string;
  readonly fatal: boolean;
}

/**
 * Import-free first-pass representation. `raw` is retained so complete
 * validation can happen only after policy selects this plugin.
 */
export interface ManagedManifestEnvelope {
  readonly source: ManagedManifestSource;
  readonly raw: Readonly<UnknownRecord> | undefined;
  readonly schema: string | undefined;
  readonly id: string | undefined;
  readonly name: string | undefined;
  readonly version: string | undefined;
  readonly entry: string | undefined;
  readonly diagnostics: readonly ManagedManifestDiagnostic[];
}

/**
 * Describes the managed agent role component contract.
 */
export interface ManagedAgentRoleComponent extends ManagedModuleComponent {
  readonly type: 'agent_role';
  readonly roles_supported: readonly string[];
}

/**
 * Describes the managed decorator component contract.
 */
export interface ManagedDecoratorComponent extends ManagedModuleComponent {
  readonly type: 'decorator';
  readonly priority: number;
}

/**
 * Describes the managed tool component contract.
 */
export interface ManagedToolComponent extends ManagedModuleComponent {
  readonly type: 'tool';
  readonly tool_name: string;
}

/**
 * Describes the managed provider component contract.
 */
export interface ManagedProviderComponent extends ManagedModuleComponent {
  readonly type: 'provider';
  readonly provider_name: string;
}

/** Describes one managed extension-point component. */
export interface ManagedExtensionComponent extends ManagedModuleComponent {
  readonly type: 'extension';
  readonly extension_point: string;
}

/**
 * Defines the supported validated managed component values.
 */
export type ValidatedManagedComponent =
  | ManagedAgentRoleComponent
  | ManagedDecoratorComponent
  | ManagedToolComponent
  | ManagedProviderComponent
  | ManagedExtensionComponent;

/**
 * Describes the validated managed manifest contract.
 */
export interface ValidatedManagedManifest {
  readonly source: ManagedManifestSource;
  readonly raw: Readonly<UnknownRecord>;
  readonly schema: 'pixiecore.plugin/v1';
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string | undefined;
  readonly manifestPath: string;
  /** Canonical real plugin directory, always the manifest's parent. */
  readonly rootPath: string;
  readonly entry: string;
  readonly entryPath: string;
  readonly requires: Readonly<Record<string, string>>;
  readonly optionalRequires: Readonly<Record<string, string>>;
  readonly conflicts: Readonly<Record<string, string>>;
  readonly components: readonly ValidatedManagedComponent[] | undefined;
  readonly descriptor: NormalizedPluginDescriptor;
}

/** Reads YAML and validates only its canonical envelope and identity fields. */
export async function readManagedManifestEnvelope(
  source: ManagedManifestSource,
  parentId?: string,
): Promise<ManagedManifestEnvelope> {
  let text: string;
  try {
    text = await readFile(source.manifestPath, 'utf8');
  } catch (error) {
    return envelopeWithoutRecord(source, diagnostic(
      'managed-manifest-read-error',
      `Failed to read managed plugin manifest ${source.manifestPath}: ${errorMessage(error)}`,
    ));
  }

  if (!text.trim()) {
    return envelopeWithoutRecord(source, diagnostic(
      'managed-manifest-empty',
      `Empty managed plugin manifest: ${source.manifestPath}`,
    ));
  }

  let parsed: unknown;
  try {
    parsed = YAML.parse(text, { maxAliasCount: 0, uniqueKeys: true });
  } catch (error) {
    return envelopeWithoutRecord(source, diagnostic(
      'managed-manifest-yaml-error',
      `Failed to parse managed plugin manifest ${source.manifestPath}: ${errorMessage(error)}`,
    ));
  }

  if (!isRecord(parsed)) {
    return envelopeWithoutRecord(source, diagnostic(
      'managed-manifest-envelope-error',
      `Managed plugin manifest must be an object: ${source.manifestPath}`,
    ));
  }

  const diagnostics: ManagedManifestDiagnostic[] = [];
  for (const field of trustedPluginManifestFields(parsed)) {
    diagnostics.push(diagnostic(
      'managed-manifest-trust-field',
      `Managed plugin manifest may not define trusted field ${field}: ${source.manifestPath}`,
      true,
    ));
  }

  const schema = envelopeString(
    parsed.schema,
    'managed-manifest-schema',
    `Managed plugin manifest requires schema pixiecore.plugin/v1: ${source.manifestPath}`,
    diagnostics,
  );
  if (schema !== undefined && schema !== PIXIECORE_PLUGIN_MANIFEST_SCHEMA) {
    diagnostics.push(diagnostic(
      'managed-manifest-schema',
      `Managed plugin manifest requires schema pixiecore.plugin/v1: ${source.manifestPath}`,
    ));
  }

  const id = envelopeString(
    parsed.id,
    'managed-manifest-id',
    `Managed plugin manifest requires a non-empty id: ${source.manifestPath}`,
    diagnostics,
  );
  if (id !== undefined && !MANAGED_PLUGIN_ID_PATTERN.test(id)) {
    diagnostics.push(diagnostic(
      'managed-manifest-id',
      `Managed plugin id must match ${MANAGED_PLUGIN_ID_PATTERN.source}: ${source.manifestPath}`,
    ));
  }
  if (id !== undefined && RESERVED_PLUGIN_ID_PATTERN.test(id)) {
    diagnostics.push(diagnostic(
      'managed-manifest-reserved-id',
      `Managed plugin id uses the reserved pixiecore namespace: ${id}`,
      true,
    ));
  }
  if (source.parentManifestPath !== undefined
      && (parentId === undefined || id === undefined || !id.startsWith(`${parentId}.`))) {
    diagnostics.push(diagnostic(
      'managed-manifest-parent-id',
      parentId === undefined
        ? `Nested managed plugin requires a parent with a valid id: ${source.manifestPath}`
        : `Nested managed plugin id must begin with ${parentId}.: ${source.manifestPath}`,
      true,
    ));
  }

  const name = envelopeString(
    parsed.name,
    'managed-manifest-name',
    `Managed plugin manifest requires a non-empty name: ${source.manifestPath}`,
    diagnostics,
  );
  const version = envelopeString(
    parsed.version,
    'managed-manifest-version',
    `Managed plugin manifest requires a non-empty version: ${source.manifestPath}`,
    diagnostics,
  );
  const entry = envelopeString(
    parsed.entry,
    'managed-manifest-entry',
    `Managed plugin manifest requires a non-empty entry: ${source.manifestPath}`,
    diagnostics,
  );

  return Object.freeze({
    source,
    raw: parsed,
    schema,
    id,
    name,
    version,
    entry,
    diagnostics: Object.freeze(diagnostics),
  });
}

/** Returns the deterministic first envelope error for catalog policy handling. */
export function managedManifestEnvelopeError(
  envelope: ManagedManifestEnvelope,
  fatalOnly = false,
): PluginLoadError | undefined {
  const issue = fatalOnly
    ? envelope.diagnostics.find(item => item.fatal)
    : envelope.diagnostics[0];
  return issue === undefined ? undefined : new PluginLoadError(issue.message);
}

/**
 * Validates managed manifest has no fatal diagnostics and rejects unsupported input.
 */
export function assertManagedManifestHasNoFatalDiagnostics(
  envelope: ManagedManifestEnvelope,
): void {
  const error = managedManifestEnvelopeError(envelope, true);
  if (error) throw error;
}

/** Performs selected-only schema, dependency, component, and real-path checks. */
export async function validateManagedManifest(
  envelope: ManagedManifestEnvelope,
): Promise<ValidatedManagedManifest> {
  const envelopeError = managedManifestEnvelopeError(envelope);
  if (envelopeError) throw envelopeError;
  if (!envelope.raw
      || !envelope.id
      || !envelope.name
      || !envelope.version
      || !envelope.entry) {
    throw new PluginLoadError(`Managed plugin manifest has an invalid envelope: ${envelope.source.manifestPath}`);
  }

  const unknownField = unknownPluginManifestFields(envelope.raw)[0];
  if (unknownField !== undefined) {
    throw new PluginLoadError(
      `Managed plugin manifest contains unknown field ${unknownField}: ${envelope.source.manifestPath}`,
    );
  }
  if (!isExactSemVer(envelope.version)) {
    throw new PluginLoadError(
      `Managed plugin version must be SemVer 2.0: ${envelope.source.manifestPath}`,
    );
  }
  const description = optionalString(
    envelope.raw.description,
    'description',
    envelope.source.manifestPath,
  );
  const requires = dependencyMap(
    envelope.raw.requires,
    'requires',
    envelope.source.manifestPath,
  );
  const optionalRequires = dependencyMap(
    envelope.raw.optional_requires,
    'optional_requires',
    envelope.source.manifestPath,
  );
  const conflicts = dependencyMap(
    envelope.raw.conflicts,
    'conflicts',
    envelope.source.manifestPath,
  );

  const paths = await resolveManagedPaths(envelope.source.manifestPath, envelope.entry);
  const components = await validateComponents(
    envelope.raw.components,
    paths.rootPath,
    envelope.source.manifestPath,
    paths.entryPath,
  );
  const descriptor: NormalizedPluginDescriptor = Object.freeze({
    id: envelope.id,
    schema: PIXIECORE_PLUGIN_MANIFEST_SCHEMA,
    name: envelope.name,
    version: envelope.version,
    origin: 'managed-custom',
    manifestPath: envelope.source.manifestPath,
    rootPath: paths.rootPath,
    ordinal: envelope.source.ordinal,
    requires,
    optionalRequires,
    conflicts,
  });

  return Object.freeze({
    source: envelope.source,
    raw: envelope.raw,
    schema: PIXIECORE_PLUGIN_MANIFEST_SCHEMA,
    id: envelope.id,
    name: envelope.name,
    version: envelope.version,
    description,
    manifestPath: envelope.source.manifestPath,
    rootPath: paths.rootPath,
    entry: envelope.entry,
    entryPath: paths.entryPath,
    requires,
    optionalRequires,
    conflicts,
    components,
    descriptor,
  });
}

/** Adapts an already-selected and validated manifest without importing it. */
export function managedDefinitionFromManifest(
  manifest: ValidatedManagedManifest,
): PluginDefinition {
  return Object.freeze({
    descriptor: manifest.descriptor,
    loadActivator: () => createManagedPluginActivator(manifest),
  });
}

/**
 * Reports whether exact sem ver.
 */
export function isExactSemVer(value: string): boolean {
  return SEMVER_2_PATTERN.test(value) && semver.valid(value) !== null;
}

/**
 * Reports whether npm compatible version range.
 */
export function isNpmCompatibleVersionRange(value: string): boolean {
  return Boolean(value.trim()) && semver.validRange(value) !== null;
}

function envelopeWithoutRecord(
  source: ManagedManifestSource,
  issue: ManagedManifestDiagnostic,
): ManagedManifestEnvelope {
  return Object.freeze({
    source,
    raw: undefined,
    schema: undefined,
    id: undefined,
    name: undefined,
    version: undefined,
    entry: undefined,
    diagnostics: Object.freeze([issue]),
  });
}

function diagnostic(
  code: ManagedManifestDiagnosticCode,
  message: string,
  fatal = false,
): ManagedManifestDiagnostic {
  return Object.freeze({ code, message, fatal });
}

function envelopeString(
  value: unknown,
  code: ManagedManifestDiagnosticCode,
  message: string,
  diagnostics: ManagedManifestDiagnostic[],
): string | undefined {
  if (typeof value === 'string' && value.trim()) return value;
  diagnostics.push(diagnostic(code, message));
  return undefined;
}

function optionalString(value: unknown, field: string, path: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim()) {
    throw new PluginLoadError(`Managed plugin ${field} must be a non-empty string: ${path}`);
  }
  return value;
}

function requiredString(value: unknown, field: string, path: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new PluginLoadError(`Managed plugin requires non-empty ${field}: ${path}`);
  }
  return value;
}

function dependencyMap(
  value: unknown,
  field: string,
  path: string,
): Readonly<Record<string, string>> {
  if (value === undefined) return Object.freeze({});
  if (!isRecord(value)) {
    throw new PluginLoadError(`Managed plugin ${field} must be an object: ${path}`);
  }
  const result: Record<string, string> = {};
  for (const id of Object.keys(value).sort()) {
    if (!MANAGED_PLUGIN_ID_PATTERN.test(id)) {
      throw new PluginLoadError(`Managed plugin ${field} contains invalid plugin id ${id}: ${path}`);
    }
    const range = requiredString(value[id], `${field}.${id}`, path);
    if (!isNpmCompatibleVersionRange(range)) {
      throw new PluginLoadError(
        `Managed plugin ${field}.${id} must be an npm-compatible version range: ${path}`,
      );
    }
    result[id] = range;
  }
  return Object.freeze(result);
}

async function resolveManagedPaths(
  manifestPath: string,
  entry: string,
): Promise<{ readonly rootPath: string; readonly entryPath: string }> {
  const pluginDirectory = dirname(resolve(manifestPath));
  let rootPath: string;
  let realManifestPath: string;
  try {
    [rootPath, realManifestPath] = await Promise.all([
      realpath(pluginDirectory),
      realpath(manifestPath),
    ]);
  } catch (error) {
    throw new PluginLoadError(
      `Failed to resolve managed plugin root for ${manifestPath}: ${errorMessage(error)}`,
      { cause: asError(error) },
    );
  }
  assertPathInsideRoot(realManifestPath, rootPath, 'manifest', manifestPath);
  return {
    rootPath,
    entryPath: await resolveModulePath(entry, rootPath, manifestPath, 'entry'),
  };
}

async function validateComponents(
  value: unknown,
  rootPath: string,
  manifestPath: string,
  entryPath: string,
): Promise<readonly ValidatedManagedComponent[] | undefined> {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0) {
    throw new PluginLoadError(`Managed plugin components must be a non-empty array: ${manifestPath}`);
  }
  const components: ValidatedManagedComponent[] = [];
  for (const [index, raw] of value.entries()) {
    components.push(await validateComponent(raw, index, rootPath, manifestPath, entryPath));
  }
  return Object.freeze(components);
}

async function validateComponent(
  value: unknown,
  index: number,
  rootPath: string,
  manifestPath: string,
  entryPath: string,
): Promise<ValidatedManagedComponent> {
  if (!isRecord(value)) {
    throw new PluginLoadError(`Managed plugin component ${index} must be an object: ${manifestPath}`);
  }
  const type = requiredString(value.type, `components[${index}].type`, manifestPath);
  const exported = requiredString(value.export, `components[${index}].export`, manifestPath);
  const configuredModule = optionalString(
    value.module,
    `components[${index}].module`,
    manifestPath,
  );
  const modulePath = configuredModule === undefined
    ? entryPath
    : await resolveModulePath(
      configuredModule,
      rootPath,
      manifestPath,
      `components[${index}].module`,
    );

  if (type === 'agent_role') {
    assertOnlyFields(
      value,
      new Set(['type', 'export', 'module', 'roles_supported']),
      `component ${index}`,
      manifestPath,
    );
    const roles = stringArray(
      value.roles_supported,
      `components[${index}].roles_supported`,
      manifestPath,
    );
    return Object.freeze({
      type,
      export: exported,
      modulePath,
      roles_supported: Object.freeze(roles),
    });
  }
  if (type === 'decorator') {
    assertOnlyFields(
      value,
      new Set(['type', 'export', 'module', 'priority', 'stage']),
      `component ${index}`,
      manifestPath,
    );
    if (typeof value.priority !== 'number' || !Number.isFinite(value.priority)) {
      throw new PluginLoadError(
        `Managed plugin component ${index} decorator requires a finite priority: ${manifestPath}`,
      );
    }
    const stage = decoratorStage(value.stage, index, manifestPath);
    return Object.freeze({
      type,
      export: exported,
      modulePath,
      priority: value.priority,
      ...(stage === undefined ? {} : { stage }),
    });
  }
  if (type === 'tool') {
    assertOnlyFields(
      value,
      new Set(['type', 'export', 'module', 'tool_name']),
      `component ${index}`,
      manifestPath,
    );
    return Object.freeze({
      type,
      export: exported,
      modulePath,
      tool_name: requiredString(value.tool_name, `components[${index}].tool_name`, manifestPath),
    });
  }
  if (type === 'provider') {
    assertOnlyFields(
      value,
      new Set(['type', 'export', 'module', 'provider_name']),
      `component ${index}`,
      manifestPath,
    );
    return Object.freeze({
      type,
      export: exported,
      modulePath,
      provider_name: requiredString(
        value.provider_name,
        `components[${index}].provider_name`,
        manifestPath,
      ),
    });
  }
  if (type === 'extension') {
    assertOnlyFields(
      value,
      new Set(['type', 'export', 'module', 'extension_point']),
      `component ${index}`,
      manifestPath,
    );
    return Object.freeze({
      type,
      export: exported,
      modulePath,
      extension_point: requiredString(
        value.extension_point,
        `components[${index}].extension_point`,
        manifestPath,
      ),
    });
  }
  throw new PluginLoadError(
    `Managed plugin component ${index} has unsupported type ${type}: ${manifestPath}`,
  );
}

function assertOnlyFields(
  value: UnknownRecord,
  allowed: ReadonlySet<string>,
  subject: string,
  path: string,
): void {
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) {
      throw new PluginLoadError(
        `Managed plugin ${subject} contains unknown field ${field}: ${path}`,
      );
    }
  }
}

function stringArray(value: unknown, field: string, path: string): string[] {
  if (!Array.isArray(value)
      || value.length === 0
      || value.some(item => typeof item !== 'string' || !item.trim())) {
    throw new PluginLoadError(
      `Managed plugin ${field} must be a non-empty array of non-empty strings: ${path}`,
    );
  }
  return [...new Set(value as string[])];
}

function decoratorStage(
  value: unknown,
  index: number,
  path: string,
): 'before' | 'after' | 'both' | undefined {
  if (value === undefined) return undefined;
  if (value === 'before' || value === 'after' || value === 'both') return value;
  throw new PluginLoadError(
    `Managed plugin component ${index} decorator stage must be before, after, or both: ${path}`,
  );
}

async function resolveModulePath(
  specifier: string,
  rootPath: string,
  manifestPath: string,
  field: string,
): Promise<string> {
  const candidate = resolve(dirname(manifestPath), specifier);
  let modulePath: string;
  try {
    modulePath = await realpath(candidate);
    const metadata = await stat(modulePath);
    if (!metadata.isFile()) throw new Error('resolved path is not a file');
  } catch (error) {
    throw new PluginLoadError(
      `Managed plugin ${field} module does not exist or is not a file: ${candidate}`,
      { cause: asError(error) },
    );
  }
  assertPathInsideRoot(modulePath, rootPath, field, manifestPath);
  return modulePath;
}

function assertPathInsideRoot(
  path: string,
  rootPath: string,
  field: string,
  manifestPath: string,
): void {
  const child = relative(rootPath, path);
  if (child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)) {
    throw new PluginLoadError(
      `Managed plugin ${field} path escapes its plugin root: ${manifestPath}`,
    );
  }
}
