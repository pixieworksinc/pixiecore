/**
 * Provides distribution bootstrapping behavior for PixieCore.
 */

import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import {
  lstat,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { PluginLoadError } from '../../../contracts/errors/index.js';
import {
  canonicalJson,
  signDistributionValue,
  verifyDistributionValue,
  type DistributionSignature,
} from '../../distribution-signatures.js';
import { validatePluginProject } from './index.js';
import { collectFiles } from './file-tree.js';
import { asError, isRecord } from '../model/validation.js';

export const PLUGIN_DISTRIBUTION_SCHEMA = 'pixiecore.plugin-package/v1' as const;
export const PLUGIN_DISTRIBUTION_FILENAME = 'pixiecore.plugin.json';

/**
 * Describes the plugin provenance contract.
 */
export interface PluginProvenance {
  readonly source?: string;
  readonly commit?: string;
}

/**
 * Defines the supported plugin signature values.
 */
export type PluginSignature = DistributionSignature;

/**
 * Describes the plugin distribution metadata contract.
 */
export interface PluginDistributionMetadata {
  readonly schema: typeof PLUGIN_DISTRIBUTION_SCHEMA;
  readonly plugin: {
    readonly id: string;
    readonly version: string;
    readonly manifest: string;
    readonly entry: string;
  };
  readonly compatibility: { readonly pixiecore: string };
  readonly files: Readonly<Record<string, string>>;
  readonly provenance?: PluginProvenance;
  readonly signature?: PluginSignature;
}

/**
 * Describes the verified plugin distribution contract.
 */
export interface VerifiedPluginDistribution {
  readonly rootPath: string;
  readonly metadata: PluginDistributionMetadata;
  readonly signature: 'absent' | 'verified' | 'present-unverified';
}

interface SemverRuntime {
  /**
   * Checks whether the supplied value satisfies the declared constraint.
   */
  satisfies(version: string, range: string): boolean;
  /**
   * Checks whether the supplied value falls within the permitted range.
   */
  validRange(range: string): string | null;
}

const semver = createRequire(import.meta.url)('semver') as SemverRuntime;

/**
 * Creates plugin distribution metadata after validating the supplied contract.
 */
export async function createPluginDistributionMetadata(
  directory: string,
  options: {
    readonly pixiecoreVersion: string;
    readonly pixiecoreRange?: string;
    readonly provenance?: PluginProvenance;
  },
): Promise<PluginDistributionMetadata> {
  const project = await validatePluginProject(directory, { inspectExports: false });
  const pixiecoreRange = options.pixiecoreRange ?? `^${options.pixiecoreVersion}`;
  if (!semver.validRange(pixiecoreRange)) {
    throw new PluginLoadError(`Invalid PixieCore compatibility range: ${pixiecoreRange}`);
  }
  const files = await productionFiles(project.rootPath);
  const hashes: Record<string, string> = {};
  for (const path of files) {
    hashes[relativePath(project.rootPath, path)] = await sha256File(path);
  }
  const metadata: PluginDistributionMetadata = Object.freeze({
    schema: PLUGIN_DISTRIBUTION_SCHEMA,
    plugin: Object.freeze({
      id: project.manifest.id,
      version: project.manifest.version,
      manifest: relativePath(project.rootPath, project.manifest.manifestPath),
      entry: relativePath(project.rootPath, project.manifest.entryPath),
    }),
    compatibility: Object.freeze({ pixiecore: pixiecoreRange }),
    files: Object.freeze(hashes),
    ...(options.provenance === undefined
      ? {}
      : { provenance: Object.freeze(validateProvenance(options.provenance)) }),
  });
  await atomicJsonWrite(join(project.rootPath, PLUGIN_DISTRIBUTION_FILENAME), metadata);
  return metadata;
}

/**
 * Signs plugin distribution for the owning PixieCore boundary.
 */
export async function signPluginDistribution(
  directory: string,
  privateKeyPath: string,
): Promise<PluginDistributionMetadata> {
  const rootPath = resolve(directory);
  const metadata = await readMetadata(rootPath);
  const unsigned = withoutSignature(metadata);
  let signature: PluginSignature;
  try {
    signature = await signDistributionValue(unsigned, resolve(privateKeyPath), 'Plugin distribution');
  } catch (cause) {
    throw new PluginLoadError(asError(cause).message, { cause });
  }
  const signed = Object.freeze({ ...unsigned, signature });
  await atomicJsonWrite(join(rootPath, PLUGIN_DISTRIBUTION_FILENAME), signed);
  return signed;
}

/**
 * Validates plugin distribution and rejects unsupported input.
 */
export async function verifyPluginDistribution(
  directory: string,
  options: {
    readonly pixiecoreVersion: string;
    readonly publicKeyPath?: string;
    readonly requireSignature?: boolean;
  },
): Promise<VerifiedPluginDistribution> {
  const rootPath = resolve(directory);
  const metadata = await readMetadata(rootPath);
  validateMetadataEnvelope(metadata);
  const project = await validatePluginProject(rootPath, { inspectExports: false });
  if (metadata.plugin.id !== project.manifest.id
      || metadata.plugin.version !== project.manifest.version
      || metadata.plugin.manifest !== relativePath(rootPath, project.manifest.manifestPath)
      || metadata.plugin.entry !== relativePath(rootPath, project.manifest.entryPath)) {
    throw new PluginLoadError('Plugin distribution metadata does not match the plugin manifest');
  }
  if (!semver.satisfies(options.pixiecoreVersion, metadata.compatibility.pixiecore)) {
    throw new PluginLoadError(
      `Plugin ${metadata.plugin.id} requires PixieCore ${metadata.compatibility.pixiecore}; current ${options.pixiecoreVersion}`,
    );
  }
  for (const [path, expected] of Object.entries(metadata.files)) {
    const absolute = safeDistributionPath(rootPath, path);
    const actual = await sha256File(absolute).catch(cause => {
      throw new PluginLoadError(`Cannot hash distributed plugin file: ${path}`, { cause });
    });
    if (actual !== expected) throw new PluginLoadError(`Plugin file integrity mismatch: ${path}`);
  }
  const currentFiles = (await productionFiles(rootPath)).map(path => relativePath(rootPath, path));
  const declaredFiles = Object.keys(metadata.files).sort();
  if (canonicalJson(currentFiles) !== canonicalJson(declaredFiles)) {
    throw new PluginLoadError('Plugin distribution file inventory does not match metadata');
  }

  let signature: VerifiedPluginDistribution['signature'];
  try {
    signature = await verifyDistributionValue(withoutSignature(metadata), metadata.signature, {
      ...(options.publicKeyPath === undefined ? {} : { publicKeyPath: resolve(options.publicKeyPath) }),
      ...(options.requireSignature === undefined ? {} : { requireSignature: options.requireSignature }),
      label: 'plugin distribution',
    });
  } catch (cause) {
    throw new PluginLoadError(asError(cause).message, { cause });
  }
  return Object.freeze({ rootPath, metadata, signature });
}

/**
 * Creates plugin catalog after validating the supplied contract.
 */
export async function createPluginCatalog(
  root: string,
  options: { readonly pixiecoreVersion: string; readonly publicKeyPath?: string },
): Promise<Readonly<{
  schema: 'pixiecore.plugin-catalog/v1';
  plugins: readonly PluginDistributionMetadata[];
}>> {
  const metadataPaths = await findMetadataFiles(resolve(root));
  const verified: PluginDistributionMetadata[] = [];
  for (const metadataPath of metadataPaths) {
    verified.push((await verifyPluginDistribution(dirname(metadataPath), options)).metadata);
  }
  verified.sort((left, right) => left.plugin.id.localeCompare(right.plugin.id));
  const ids = new Set<string>();
  for (const metadata of verified) {
    if (ids.has(metadata.plugin.id)) {
      throw new PluginLoadError(`Duplicate plugin catalog id: ${metadata.plugin.id}`);
    }
    ids.add(metadata.plugin.id);
  }
  return Object.freeze({
    schema: 'pixiecore.plugin-catalog/v1',
    plugins: Object.freeze(verified),
  });
}

async function productionFiles(rootPath: string): Promise<string[]> {
  return collectFiles(rootPath, {
    skipEntry: entry => [
      'node_modules',
      '.git',
      'tests',
      PLUGIN_DISTRIBUTION_FILENAME,
    ].includes(entry.name),
    includeFile: entry => !isTypeScriptSource(entry.name),
    rejectSymbolicLink: path => new PluginLoadError(
      `Plugin distribution may not contain symbolic links: ${path}`,
    ),
  });
}

function isTypeScriptSource(name: string): boolean {
  return /\.(?:ts|mts|cts)$/.test(name) && !/\.d\.(?:ts|mts|cts)$/.test(name);
}

async function findMetadataFiles(root: string): Promise<string[]> {
  return collectFiles(root, {
    skipEntry: entry => entry.name === 'node_modules' || entry.name === '.git',
    includeFile: entry => entry.name === PLUGIN_DISTRIBUTION_FILENAME,
  });
}

async function readMetadata(rootPath: string): Promise<PluginDistributionMetadata> {
  const path = join(rootPath, PLUGIN_DISTRIBUTION_FILENAME);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'));
  } catch (cause) {
    throw new PluginLoadError(`Failed to read plugin distribution metadata: ${path}`, { cause });
  }
  validateMetadataEnvelope(parsed);
  return parsed;
}

function validateMetadataEnvelope(value: unknown): asserts value is PluginDistributionMetadata {
  if (!isRecord(value) || value.schema !== PLUGIN_DISTRIBUTION_SCHEMA
      || !isRecord(value.plugin) || !isRecord(value.compatibility)
      || !isRecord(value.files)) {
    throw new PluginLoadError(`Plugin distribution metadata requires schema ${PLUGIN_DISTRIBUTION_SCHEMA}`);
  }
  assertOnlyKeys(value, [
    'schema',
    'plugin',
    'compatibility',
    'files',
    'provenance',
    'signature',
  ], 'metadata');
  assertOnlyKeys(value.plugin, ['id', 'version', 'manifest', 'entry'], 'plugin');
  assertOnlyKeys(value.compatibility, ['pixiecore'], 'compatibility');
  for (const field of ['id', 'version', 'manifest', 'entry']) {
    if (typeof value.plugin[field] !== 'string' || !value.plugin[field]) {
      throw new PluginLoadError(`Plugin distribution metadata requires plugin.${field}`);
    }
  }
  if (typeof value.compatibility.pixiecore !== 'string'
      || !semver.validRange(value.compatibility.pixiecore)) {
    throw new PluginLoadError('Plugin distribution metadata requires a valid compatibility.pixiecore range');
  }
  if (Object.keys(value.files).length === 0) {
    throw new PluginLoadError('Plugin distribution metadata requires at least one file');
  }
  for (const [path, digest] of Object.entries(value.files)) {
    if (!path || typeof digest !== 'string' || !/^sha256-[A-Za-z0-9+/]{43}=$/.test(digest)) {
      throw new PluginLoadError(`Plugin distribution metadata has an invalid digest: ${path}`);
    }
  }
  if (value.provenance !== undefined) {
    if (!isRecord(value.provenance)) {
      throw new PluginLoadError('Plugin distribution metadata has invalid provenance');
    }
    assertOnlyKeys(value.provenance, ['source', 'commit'], 'provenance');
    validateProvenance(value.provenance as PluginProvenance);
  }
  if (value.signature !== undefined) {
    if (!isRecord(value.signature) || value.signature.algorithm !== 'Ed25519'
        || typeof value.signature.keyId !== 'string'
        || !/^[0-9a-f]{64}$/.test(value.signature.keyId)
        || typeof value.signature.value !== 'string'
        || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.signature.value)) {
      throw new PluginLoadError('Plugin distribution metadata has an invalid signature');
    }
    assertOnlyKeys(value.signature, ['algorithm', 'keyId', 'value'], 'signature');
  }
}

function assertOnlyKeys(
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  label: string,
): void {
  const unexpected = Object.keys(value).find(key => !allowed.includes(key));
  if (unexpected !== undefined) {
    throw new PluginLoadError(
      `Plugin distribution ${label} has unknown field: ${unexpected}`,
    );
  }
}

function validateProvenance(value: PluginProvenance): PluginProvenance {
  if (value.source !== undefined && !value.source.trim()) {
    throw new PluginLoadError('Plugin provenance source must be non-empty');
  }
  if (value.commit !== undefined && !/^[0-9a-f]{7,64}$/i.test(value.commit)) {
    throw new PluginLoadError('Plugin provenance commit must be a hexadecimal revision');
  }
  return {
    ...(value.source === undefined ? {} : { source: value.source }),
    ...(value.commit === undefined ? {} : { commit: value.commit }),
  };
}

function withoutSignature(metadata: PluginDistributionMetadata): PluginDistributionMetadata {
  const { signature: _signature, ...unsigned } = metadata;
  return unsigned;
}

function safeDistributionPath(rootPath: string, path: string): string {
  const absolute = resolve(rootPath, path);
  const nested = relative(rootPath, absolute);
  if (!nested || nested === '..' || nested.startsWith(`..${sep}`)) {
    throw new PluginLoadError(`Plugin distribution path escapes its root: ${path}`);
  }
  return absolute;
}

function relativePath(root: string, path: string): string {
  return relative(root, path).replaceAll('\\', '/');
}

async function sha256File(path: string): Promise<string> {
  const stat = await lstat(path);
  if (!stat.isFile()) throw new PluginLoadError(`Plugin distribution entry is not a file: ${path}`);
  return `sha256-${createHash('sha256').update(await readFile(path)).digest('base64')}`;
}

async function atomicJsonWrite(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.pixiecore-${process.pid}-${Date.now()}`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o644,
    });
    await rename(temporary, path);
  } catch (cause) {
    await unlink(temporary).catch(() => undefined);
    throw new PluginLoadError(`Failed to write plugin distribution metadata: ${path}`, { cause });
  }
}
