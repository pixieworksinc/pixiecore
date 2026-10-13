/**
 * Provides catalog bootstrapping behavior for PixieCore.
 */

import { dirname } from 'node:path';
import { ConfigurationError, PluginLoadError } from '../../../contracts/errors/index.js';
import type { PluginStatusDiagnostic, PluginStatusState } from '../../../contracts/plugin/management.js';
import {
  resolveManagedPluginActivationState,
  type ManagedPluginActivationStateContext,
} from '../activation/state.js';
import {
  resolveManagedPluginDependencies,
  type ManagedResolutionCandidate,
} from '../dependency/resolver.js';
import type {
  NormalizedPluginDescriptor,
  PluginCatalog,
  PluginDefinition,
} from '../model/definition.js';
import { discoverManagedPlugins } from './discovery.js';
import {
  assertManagedManifestHasNoFatalDiagnostics,
  managedDefinitionFromManifest,
  readManagedManifestEnvelope,
  validateManagedManifest,
  type ManagedManifestEnvelope,
  type ValidatedManagedManifest,
} from './manifest.js';
import type { PluginStatusTracker } from '../activation/status.js';

/**
 * Configures managed plugin catalog behavior.
 */
export interface ManagedPluginCatalogOptions {
  readonly activationState: ManagedPluginActivationStateContext;
  readonly legacyDirectories: readonly string[];
  readonly coreDescriptors: readonly NormalizedPluginDescriptor[];
  readonly status?: PluginStatusTracker;
}

/** Import-free managed inventory, policy, and graph preparation. */
export class ManagedPluginCatalog implements PluginCatalog {
  private preparation?: Promise<readonly PluginDefinition[]>;

  /**
   * Creates a ManagedPluginCatalog and establishes its initial state.
   */
  constructor(private readonly options: ManagedPluginCatalogOptions) {}

  /**
   * Handles synchronous definitions according to the ManagedPluginCatalog contract.
   */
  synchronousDefinitions(): readonly [] { return []; }

  /**
   * Handles definitions according to the ManagedPluginCatalog contract.
   */
  async *definitions(): AsyncIterable<PluginDefinition> {
    for (const definition of await this.prepare()) yield definition;
  }

  /**
   * Prepares according to the ManagedPluginCatalog contract.
   */
  private prepare(): Promise<readonly PluginDefinition[]> {
    return this.preparation ??= this.prepareOnce();
  }

  /**
   * Prepares once according to the ManagedPluginCatalog contract.
   */
  private async prepareOnce(): Promise<readonly PluginDefinition[]> {
    const state = await resolveManagedPluginActivationState(this.options.activationState);
    if (!state) {
      this.options.status?.configure(undefined, []);
      return Object.freeze([]);
    }

    const coreIds = new Set(this.options.coreDescriptors.map(descriptor => descriptor.id));
    for (const id of state.disabled) {
      if (coreIds.has(id)) throw new ConfigurationError(`Core plugin cannot be disabled: ${id}`);
    }

    const discovery = await discoverManagedPlugins({
      roots: state.roots,
      legacyDirectories: this.options.legacyDirectories,
    });
    this.options.status?.configure(state.configPath, discovery.roots);

    const envelopes: ManagedManifestEnvelope[] = [];
    const envelopeByManifestPath = new Map<string, ManagedManifestEnvelope>();
    for (const source of discovery.manifests) {
      const parent = source.parentManifestPath === undefined
        ? undefined
        : envelopeByManifestPath.get(source.parentManifestPath);
      const envelope = await readManagedManifestEnvelope(source, parent?.id);
      envelopes.push(envelope);
      envelopeByManifestPath.set(source.manifestPath, envelope);
    }

    const enabledIds = new Set(state.enabled);
    const disabledIds = new Set(state.disabled);
    for (const envelope of envelopes) {
      recordEnvelopeStatus(
        this.options.status,
        envelope,
        enabledIds.has(envelope.id ?? ''),
      );
      for (const issue of envelope.diagnostics) {
        if (issue.fatal) {
          this.options.status?.addDiagnostic(
            statusDiagnostic(envelope, issue.code, issue.message),
          );
        }
      }
    }
    for (const envelope of envelopes) assertManagedManifestHasNoFatalDiagnostics(envelope);

    const envelopeByIdentity = new Map<string, ManagedManifestEnvelope>();
    for (const envelope of envelopes) {
      const id = envelope.id;
      if (id === undefined) continue;
      const previous = envelopeByIdentity.get(id);
      if (previous) {
        throwDuplicateManagedId(
          this.options.status,
          previous,
          envelope,
          enabledIds.has(id),
        );
      }
      envelopeByIdentity.set(id, envelope);
    }

    const inventory = new Map<string, ManagedResolutionCandidate<ValidatedManagedManifest>>();
    const envelopeById = new Map<string, ManagedManifestEnvelope>();
    for (const envelope of envelopes) {
      const id = canonicalEnvelopeId(envelope);
      if (id === undefined) continue;
      envelopeById.set(id, envelope);
      const parentId = envelope.source.parentManifestPath === undefined
        ? undefined
        : envelopeByManifestPath.get(envelope.source.parentManifestPath)?.id;
      inventory.set(id, candidateFor(envelope, this.options.status, parentId));
    }

    recordStaleDisabledStatuses(
      this.options.status,
      state.disabled,
      envelopeByIdentity,
      coreIds,
      envelopes.length,
    );

    let resolved;
    try {
      resolved = await resolveManagedPluginDependencies({
        enabled: state.enabled,
        disabled: disabledIds,
        inventory,
        coreDescriptors: this.options.coreDescriptors,
      });
    } catch (error) {
      this.options.status?.addDiagnostic({
        code: 'managed-resolution-failed',
        message: error instanceof Error ? error.message : String(error),
        pluginId: undefined,
        manifestPath: undefined,
      });
      throw error;
    }

    const selectedIds = new Set(resolved.map(item => item.descriptor.id));
    for (const item of resolved) {
      this.options.status?.recordDescriptor(item.descriptor, {
        state: 'resolved',
        enabled: true,
        locked: false,
      });
    }
    for (const [id, envelope] of envelopeById) {
      if (selectedIds.has(id)) continue;
      // Re-recording makes explicit disabled policy authoritative over an
      // otherwise valid, default-disabled inventory entry.
      if (disabledIds.has(id)) recordEnvelopeStatus(this.options.status, envelope, false);
    }

    return Object.freeze(resolved.map(item => managedDefinitionFromManifest(item.value)));
  }
}

function candidateFor(
  envelope: ManagedManifestEnvelope,
  status: PluginStatusTracker | undefined,
  parentId?: string,
): ManagedResolutionCandidate<ValidatedManagedManifest> {
  return Object.freeze({
    id: envelope.id!,
    ...(parentId === undefined ? {} : { parentId }),
    ordinal: envelope.source.ordinal,
    validate: async () => {
      recordEnvelopeStatus(status, envelope, true);
      try {
        const value = await validateManagedManifest(envelope);
        return Object.freeze({ descriptor: value.descriptor, value });
      } catch (error) {
        recordEnvelopeStatus(status, envelope, true, [statusDiagnostic(
          envelope,
          'managed-validation-failed',
          error instanceof Error ? error.message : String(error),
        )], 'failed');
        throw error;
      }
    },
  });
}

function throwDuplicateManagedId(
  status: PluginStatusTracker | undefined,
  previous: ManagedManifestEnvelope,
  duplicate: ManagedManifestEnvelope,
  enabled: boolean,
): never {
  const id = duplicate.id!;
  const message = `Duplicate managed plugin id: ${id} (${previous.source.manifestPath}, ${duplicate.source.manifestPath})`;
  const previousDiagnostic = statusDiagnostic(previous, 'duplicate-managed-plugin-id', message);
  const duplicateDiagnostic = statusDiagnostic(duplicate, 'duplicate-managed-plugin-id', message);
  recordEnvelopeStatus(status, previous, enabled, [previousDiagnostic]);
  recordEnvelopeStatus(status, duplicate, enabled, [duplicateDiagnostic]);
  status?.addDiagnostic(duplicateDiagnostic);
  throw new PluginLoadError(message);
}

function canonicalEnvelopeId(envelope: ManagedManifestEnvelope): string | undefined {
  if (!envelope.id) return undefined;
  if (envelope.diagnostics.some(issue => issue.code === 'managed-manifest-id'
      || issue.code === 'managed-manifest-reserved-id')) return undefined;
  return envelope.id;
}

function recordEnvelopeStatus(
  status: PluginStatusTracker | undefined,
  envelope: ManagedManifestEnvelope,
  enabled: boolean,
  additionalDiagnostics: readonly PluginStatusDiagnostic[] = [],
  stateOverride?: PluginStatusState,
): void {
  if (!status) return;
  const diagnostics = [
    ...envelope.diagnostics.map(issue => statusDiagnostic(envelope, issue.code, issue.message)),
    ...additionalDiagnostics,
  ];
  const state: PluginStatusState = stateOverride ?? (enabled
    ? 'enabled'
    : diagnostics.length > 0
      ? 'invalid-disabled'
      : 'disabled');
  status.record({
    id: envelope.id,
    schema: envelope.schema === 'pixiecore.plugin/v1' ? envelope.schema : undefined,
    name: envelope.name,
    version: envelope.version,
    origin: 'managed-custom',
    state,
    enabled,
    locked: false,
    activated: false,
    manifestPath: envelope.source.manifestPath,
    rootPath: dirname(envelope.source.manifestPath),
    ordinal: envelope.source.ordinal,
    diagnostics,
  });
}

function recordStaleDisabledStatuses(
  status: PluginStatusTracker | undefined,
  disabled: readonly string[],
  inventory: ReadonlyMap<string, ManagedManifestEnvelope>,
  coreIds: ReadonlySet<string>,
  firstOrdinal: number,
): void {
  if (!status) return;
  let offset = 0;
  for (const id of disabled) {
    if (inventory.has(id) || coreIds.has(id)) continue;
    const diagnostic: PluginStatusDiagnostic = Object.freeze({
      code: 'stale-disabled-plugin',
      message: `Disabled managed plugin is not installed: ${id}`,
      pluginId: id,
      manifestPath: undefined,
    });
    status.addDiagnostic(diagnostic);
    status.record({
      id,
      origin: 'managed-custom',
      state: 'disabled',
      enabled: false,
      locked: false,
      activated: false,
      ordinal: firstOrdinal + ++offset,
      diagnostics: [diagnostic],
    });
  }
}

function statusDiagnostic(
  envelope: ManagedManifestEnvelope,
  code: string,
  message: string,
): PluginStatusDiagnostic {
  return Object.freeze({
    code,
    message,
    pluginId: envelope.id,
    manifestPath: envelope.source.manifestPath,
  });
}
