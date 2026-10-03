/**
 * Provides discovery bootstrapping behavior for PixieCore.
 */

import { readdir, realpath, stat } from 'node:fs/promises';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';
import { errorMessage } from '../../../component/diagnostics/index.js';
import { PluginLoadError } from '../../../contracts/errors/index.js';
import { asError, compareCodePoints } from '../model/validation.js';

const LEGACY_MANAGED_PLUGIN_MANIFEST_FILENAME = 'plugin.yml';

/**
 * Carries managed plugin discovery state across a boundary.
 */
export interface ManagedPluginDiscoveryContext {
  /** Absolute roots from the activation state; relative inputs are still normalized defensively. */
  readonly roots: readonly string[];
  /** Legacy plugin directories. Their canonical subtrees remain exclusively legacy-owned. */
  readonly legacyDirectories: readonly string[];
}

/**
 * Describes the managed plugin manifest source contract.
 */
export interface ManagedPluginManifestSource {
  readonly rootPath: string;
  readonly manifestPath: string;
  /** Canonical manifest of the containing plugin unit, when discovered below its plugins/ slot. */
  readonly parentManifestPath?: string;
  readonly sourceOrdinal: number;
  readonly ordinal: number;
}

/**
 * Describes the managed plugin discovery contract.
 */
export interface ManagedPluginDiscovery {
  /** Existing, canonical, deduplicated roots after legacy-root exclusion. */
  readonly roots: readonly string[];
  /** Canonical, deduplicated manifests in root then recursive lexical order. */
  readonly manifests: readonly ManagedPluginManifestSource[];
}

/** Discovers canonical managed manifests without reading YAML or importing plugin code. */
export async function discoverManagedPlugins(
  context: ManagedPluginDiscoveryContext,
): Promise<ManagedPluginDiscovery> {
  const legacyRoots = await canonicalExistingPaths(context.legacyDirectories, 'legacy plugin root');
  const canonicalRoots: string[] = [];
  const seenRoots = new Set<string>();

  for (const configuredRoot of context.roots) {
    const rootPath = await canonicalManagedRoot(configuredRoot);
    if (rootPath === undefined
        || legacyRoots.some(legacyRoot => containsPath(legacyRoot, rootPath))
        || seenRoots.has(rootPath)) continue;
    seenRoots.add(rootPath);
    canonicalRoots.push(rootPath);
  }

  const manifests: ManagedPluginManifestSource[] = [];
  const seenManifests = new Set<string>();
  for (const [index, rootPath] of canonicalRoots.entries()) {
    const discovered = await discoverRootManifests(rootPath, legacyRoots);
    for (const candidate of discovered) {
      if (seenManifests.has(candidate.manifestPath)) continue;
      seenManifests.add(candidate.manifestPath);
      manifests.push(Object.freeze({
        rootPath,
        manifestPath: candidate.manifestPath,
        ...(candidate.parentManifestPath === undefined
          ? {}
          : { parentManifestPath: candidate.parentManifestPath }),
        sourceOrdinal: index + 1,
        ordinal: manifests.length + 1,
      }));
    }
  }

  return Object.freeze({
    roots: Object.freeze(canonicalRoots),
    manifests: Object.freeze(manifests),
  });
}

async function canonicalExistingPaths(
  paths: readonly string[],
  description: string,
): Promise<string[]> {
  const canonical: string[] = [];
  const seen = new Set<string>();
  for (const path of paths) {
    try {
      const realPath = await realpath(resolve(path));
      if (!seen.has(realPath)) {
        seen.add(realPath);
        canonical.push(realPath);
      }
    } catch (error) {
      if (isMissingPathError(error)) continue;
      throw discoveryError(`Failed to resolve ${description} ${path}`, error);
    }
  }
  return canonical;
}

async function canonicalManagedRoot(configuredRoot: string): Promise<string | undefined> {
  let rootPath: string;
  try {
    rootPath = await realpath(resolve(configuredRoot));
  } catch (error) {
    if (isMissingPathError(error)) return undefined;
    throw discoveryError(`Failed to resolve managed plugin root ${configuredRoot}`, error);
  }

  try {
    if (!(await stat(rootPath)).isDirectory()) {
      throw new PluginLoadError(`Managed plugin root is not a directory: ${configuredRoot}`);
    }
  } catch (error) {
    if (error instanceof PluginLoadError) throw error;
    if (isMissingPathError(error)) return undefined;
    throw discoveryError(`Failed to inspect managed plugin root ${configuredRoot}`, error);
  }
  return rootPath;
}

async function discoverRootManifests(
  rootPath: string,
  legacyRoots: readonly string[],
): Promise<Array<{
  readonly manifestPath: string;
  readonly parentManifestPath?: string;
}>> {
  const found: Array<{
    readonly manifestPath: string;
    readonly parentManifestPath?: string;
  }> = [];
  const visitedDirectories = new Set<string>();
  const visit = async (
    directory: string,
    parentManifestPath?: string,
  ): Promise<void> => {
    let canonicalDirectory: string;
    try {
      canonicalDirectory = await realpath(directory);
    } catch (error) {
      throw discoveryError(`Failed to resolve managed plugin directory ${directory}`, error);
    }
    if (visitedDirectories.has(canonicalDirectory)
        || legacyRoots.some(legacyRoot => containsPath(legacyRoot, canonicalDirectory))) return;
    visitedDirectories.add(canonicalDirectory);

    let entries;
    try {
      entries = await readdir(canonicalDirectory, { withFileTypes: true });
    } catch (error) {
      throw discoveryError(`Failed to read managed plugin directory ${canonicalDirectory}`, error);
    }
    entries.sort((left, right) => compareCodePoints(left.name, right.name));
    const canonicalManifestFilename = `${basename(canonicalDirectory)}.yaml`;
    const selectedManifestFilename = entries.some(
      entry => entry.isFile() && entry.name === canonicalManifestFilename,
    )
      ? canonicalManifestFilename
      : LEGACY_MANAGED_PLUGIN_MANIFEST_FILENAME;
    const selectedManifest = entries.find(
      entry => entry.isFile() && entry.name === selectedManifestFilename,
    );

    let currentManifestPath = parentManifestPath;
    if (selectedManifest) {
      const path = resolve(canonicalDirectory, selectedManifest.name);
      try {
        const manifestPath = await realpath(path);
        if (!legacyRoots.some(legacyRoot => containsPath(legacyRoot, manifestPath))) {
          found.push({
            manifestPath,
            ...(parentManifestPath === undefined ? {} : { parentManifestPath }),
          });
          currentManifestPath = manifestPath;
        }
      } catch (error) {
        throw discoveryError(`Failed to resolve managed plugin manifest ${path}`, error);
      }
    }

    for (const entry of entries) {
      if (selectedManifest && entry.name !== 'plugins') continue;
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const path = resolve(canonicalDirectory, entry.name);
      try {
        const childPath = await realpath(path);
        if (!(await stat(childPath)).isDirectory()) continue;
        await visit(childPath, currentManifestPath);
      } catch (error) {
        throw discoveryError(`Failed to resolve managed plugin directory ${path}`, error);
      }
    }
  };

  await visit(rootPath);
  return found;
}

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error
    && 'code' in error
    && (error.code === 'ENOENT' || error.code === 'ENOTDIR');
}

function containsPath(parent: string, candidate: string): boolean {
  const nested = relative(parent, candidate);
  return nested === ''
    || (!isAbsolute(nested) && nested !== '..' && !nested.startsWith(`..${sep}`));
}

function discoveryError(message: string, error: unknown): PluginLoadError {
  return new PluginLoadError(`${message}: ${errorMessage(error)}`, { cause: asError(error) });
}
