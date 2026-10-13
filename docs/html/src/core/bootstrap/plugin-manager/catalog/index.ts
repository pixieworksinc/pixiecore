/**
 * Provides catalog bootstrapping behavior for PixieCore.
 */

import { discoverPluginManifests } from './discovery.js';
import {
  adaptLegacyManifest,
  type LegacyManifestSource,
} from './legacy-manifest-adapter.js';
import type { PluginCatalog, PluginDefinition } from '../model/definition.js';
import type { PluginStatusTracker } from '../activation/status.js';

/** Preserves legacy directory order and per-directory recursive discovery order. */
export class LegacyPluginCatalog implements PluginCatalog {
  /**
   * Creates a LegacyPluginCatalog and establishes its initial state.
   */
  constructor(
    private readonly directories: readonly string[],
    private readonly status?: PluginStatusTracker,
  ) {}

  /**
   * Handles synchronous definitions according to the LegacyPluginCatalog contract.
   */
  synchronousDefinitions(): readonly [] { return []; }

  /**
   * Handles definitions according to the LegacyPluginCatalog contract.
   */
  async *definitions(): AsyncIterable<PluginDefinition> {
    let ordinal = 0;
    for (const [index, rootPath] of this.directories.entries()) {
      for (const manifestPath of await discoverPluginManifests(rootPath)) {
        ordinal++;
        const source: LegacyManifestSource = {
          rootPath,
          manifestPath,
          sourceOrdinal: index + 1,
          ordinal,
        };
        const definition = await adaptLegacyManifest(source);
        this.status?.recordDescriptor(definition.descriptor, {
          state: 'resolved',
          enabled: true,
          locked: false,
        });
        yield definition;
      }
    }
  }
}

/** Preserves source order while separating constructor-time and deferred definitions. */
export class CompositePluginCatalog implements PluginCatalog {
  /**
   * Creates a CompositePluginCatalog and establishes its initial state.
   */
  constructor(private readonly catalogs: readonly PluginCatalog[]) {}

  /**
   * Handles synchronous definitions according to the CompositePluginCatalog contract.
   */
  synchronousDefinitions() {
    return this.catalogs.flatMap(catalog => catalog.synchronousDefinitions());
  }

  /**
   * Handles definitions according to the CompositePluginCatalog contract.
   */
  async *definitions(): AsyncIterable<PluginDefinition> {
    for (const catalog of this.catalogs) {
      for await (const definition of catalog.definitions()) yield definition;
    }
  }
}
