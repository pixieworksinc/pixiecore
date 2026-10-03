/**
 * Provides the immutable catalog of trusted core plugin definitions.
 */

import { createRequire } from 'node:module';
import { basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PluginLoadError } from '../../contracts/errors/index.js';
import type { SynchronousPluginActivator } from '../../contracts/plugin/activation.js';
import { CORE_PLUGIN_CATALOG } from '../generated/core-plugin-catalog.generated.js';
import type {
  PluginCatalog,
  PluginDefinition,
  StaticCorePluginCatalogEntry,
  SynchronousPluginDefinition,
} from '../../bootstrap/plugin-manager/model/definition.js';
import {
  CORE_PLUGIN_ID_PATTERN,
  SEMVER_2_PATTERN,
  trustedPluginManifestFields,
  PIXIECORE_PLUGIN_MANIFEST_SCHEMA,
} from '../../bootstrap/plugin-manager/model/constants.js';

interface SemverApi {
  /** Returns the canonical SemVer string, or null for invalid input. */
  valid(version: string): string | null;
}

const semver = createRequire(import.meta.url)('semver') as SemverApi;

/** Trusted, build-validated definitions that activate synchronously per manager scope. */
export class StaticCorePluginCatalog implements PluginCatalog {
  private readonly coreDefinitions: readonly SynchronousPluginDefinition[];

  /** Creates an immutable catalog after validating every trusted entry. */
  constructor(entries: readonly StaticCorePluginCatalogEntry[]) {
    const ids = new Set<string>();
    this.coreDefinitions = Object.freeze(entries.map((entry, index) => {
      validateEntry(entry);
      if (ids.has(entry.manifest.id)) {
        throw new PluginLoadError(`Duplicate core plugin id: ${entry.manifest.id}`);
      }
      ids.add(entry.manifest.id);
      return createDefinition(entry, index + 1);
    }));
  }

  /** Returns every trusted core definition without filesystem discovery. */
  synchronousDefinitions(): readonly SynchronousPluginDefinition[] {
    return this.coreDefinitions;
  }

  /** Yields no deferred definitions because all core entries are synchronous. */
  async *definitions(): AsyncIterable<PluginDefinition> {
    // Core foundation plugins are constructor-visible and have no deferred definitions.
  }
}

/**
 * Creates core plugin catalog after validating the supplied contract.
 */
export function createCorePluginCatalog(): StaticCorePluginCatalog {
  return new StaticCorePluginCatalog(CORE_PLUGIN_CATALOG);
}

function createDefinition(
  entry: StaticCorePluginCatalogEntry,
  ordinal: number,
): SynchronousPluginDefinition {
  const manifestPath = fileURLToPath(entry.manifestUrl);
  const descriptor = Object.freeze({
    id: entry.manifest.id,
    ...(entry.parentId === undefined ? {} : { parentId: entry.parentId }),
    schema: entry.manifest.schema,
    name: entry.manifest.name,
    version: entry.manifest.version,
    origin: 'core' as const,
    manifestPath,
    rootPath: dirname(manifestPath),
    ordinal,
    requires: Object.freeze({ ...entry.manifest.requires }),
    optionalRequires: Object.freeze({ ...entry.manifest.optional_requires }),
    conflicts: Object.freeze({ ...entry.manifest.conflicts }),
  });
  return Object.freeze({
    descriptor,
    components: entry.manifest.components,
    /**
     * Loads activator and normalizes it for the containing class.
     */
    loadActivator(): SynchronousPluginActivator {
      const activator = entry.createActivator();
      if (!activator || typeof activator.activate !== 'function') {
        throw new PluginLoadError(`Core plugin activator factory returned an invalid value: ${descriptor.id}`);
      }
      return activator;
    },
  });
}

function validateEntry(entry: StaticCorePluginCatalogEntry): void {
  const manifest = entry.manifest as StaticCorePluginCatalogEntry['manifest']
    & Record<string, unknown>;
  if (manifest.schema !== PIXIECORE_PLUGIN_MANIFEST_SCHEMA) {
    throw new PluginLoadError(`Core plugin manifest has an invalid schema: ${manifest.id}`);
  }
  if (!CORE_PLUGIN_ID_PATTERN.test(manifest.id)) {
    throw new PluginLoadError(`Core plugin id must use the reserved pixiecore namespace: ${manifest.id}`);
  }
  if (entry.parentId !== undefined && !manifest.id.startsWith(`${entry.parentId}.`)) {
    throw new PluginLoadError(
      `Nested core plugin id must begin with ${entry.parentId}.: ${manifest.id}`,
    );
  }
  if (!SEMVER_2_PATTERN.test(manifest.version) || !semver.valid(manifest.version)) {
    throw new PluginLoadError(`Core plugin has an invalid SemVer version: ${manifest.id}`);
  }
  const manifestPath = fileURLToPath(entry.manifestUrl);
  const expectedEntry = `./${basename(manifestPath, '.yaml')}.js`;
  if (manifest.entry !== expectedEntry) {
    throw new PluginLoadError(`Core plugin entry must be ${expectedEntry}: ${manifest.id}`);
  }
  const trustedField = trustedPluginManifestFields(manifest)[0];
  if (trustedField !== undefined) {
    throw new PluginLoadError(`Core plugin manifest may not define trusted field ${trustedField}: ${manifest.id}`);
  }
}
