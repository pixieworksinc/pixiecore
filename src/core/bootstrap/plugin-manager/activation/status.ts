/**
 * Provides status bootstrapping behavior for PixieCore.
 */

import type {
  PluginManifestSchema,
  PluginOrigin,
  PluginStatus,
  PluginStatusDiagnostic,
  PluginStatusSnapshot,
  PluginStatusState,
} from '../../../contracts/plugin/management.js';
import type { NormalizedPluginDescriptor } from '../model/definition.js';
import { compareCodePoints } from '../model/validation.js';

const EMPTY_DEPENDENCIES: Readonly<Record<string, string>> = Object.freeze({});
const ORIGIN_ORDER: Readonly<Record<PluginOrigin, number>> = Object.freeze({
  core: 0,
  'managed-custom': 1,
  legacy: 2,
});

/** Loader-independent inventory data recorded by a catalog or policy resolver. */
export interface PluginStatusInput {
  readonly id?: string | undefined;
  readonly schema?: PluginManifestSchema | undefined;
  readonly name?: string | undefined;
  readonly version?: string | undefined;
  readonly origin: PluginOrigin;
  readonly state: PluginStatusState;
  readonly enabled: boolean;
  readonly locked?: boolean | undefined;
  readonly activated?: boolean | undefined;
  readonly manifestPath?: string | undefined;
  readonly rootPath?: string | undefined;
  readonly ordinal: number;
  readonly requires?: Readonly<Record<string, string>> | undefined;
  readonly optionalRequires?: Readonly<Record<string, string>> | undefined;
  readonly conflicts?: Readonly<Record<string, string>> | undefined;
  readonly diagnostics?: readonly PluginStatusDiagnostic[] | undefined;
}

/**
 * Configures plugin descriptor status behavior.
 */
export interface PluginDescriptorStatusOptions {
  readonly state?: PluginStatusState | undefined;
  readonly enabled?: boolean | undefined;
  readonly locked?: boolean | undefined;
  readonly diagnostics?: readonly PluginStatusDiagnostic[] | undefined;
}

interface MutablePluginStatus {
  id: string | undefined;
  schema: PluginManifestSchema | undefined;
  name: string | undefined;
  version: string | undefined;
  origin: PluginOrigin;
  state: PluginStatusState;
  enabled: boolean;
  locked: boolean;
  activated: boolean;
  manifestPath: string | undefined;
  rootPath: string | undefined;
  ordinal: number;
  requires: Readonly<Record<string, string>>;
  optionalRequires: Readonly<Record<string, string>>;
  conflicts: Readonly<Record<string, string>>;
  diagnostics: PluginStatusDiagnostic[];
}

/**
 * In-memory status projection shared by catalogs and the activation engine.
 * Snapshot reads copy already-recorded data and never perform I/O or imports.
 */
export class PluginStatusTracker {
  private readonly entries = new Map<string, MutablePluginStatus>();
  private configPath: string | undefined;
  private roots: string[] = [];
  private readonly diagnostics: PluginStatusDiagnostic[] = [];

  /**
   * Configures according to the PluginStatusTracker contract.
   */
  configure(configPath: string | undefined, roots: readonly string[]): void {
    this.configPath = configPath;
    this.roots = [...roots];
  }

  /**
   * Registers diagnostic with the PluginStatusTracker.
   */
  addDiagnostic(diagnostic: PluginStatusDiagnostic): void {
    this.diagnostics.push(copyDiagnostic(diagnostic));
  }

  /**
   * Records according to the PluginStatusTracker contract.
   */
  record(input: PluginStatusInput): void {
    const key = statusKey(input.origin, input.manifestPath, input.id, input.ordinal);
    const previous = this.entries.get(key);
    this.entries.set(key, {
      id: supplied(input.id, previous?.id),
      schema: supplied(input.schema, previous?.schema),
      name: supplied(input.name, previous?.name),
      version: supplied(input.version, previous?.version),
      origin: input.origin,
      state: input.state,
      enabled: input.enabled,
      locked: input.locked ?? previous?.locked ?? input.origin === 'core',
      activated: input.activated ?? activationForState(input.state, previous?.activated),
      manifestPath: supplied(input.manifestPath, previous?.manifestPath),
      rootPath: supplied(input.rootPath, previous?.rootPath),
      ordinal: input.ordinal,
      requires: copyDependencies(input.requires ?? previous?.requires ?? EMPTY_DEPENDENCIES),
      optionalRequires: copyDependencies(
        input.optionalRequires ?? previous?.optionalRequires ?? EMPTY_DEPENDENCIES,
      ),
      conflicts: copyDependencies(input.conflicts ?? previous?.conflicts ?? EMPTY_DEPENDENCIES),
      diagnostics: input.diagnostics === undefined
        ? [...(previous?.diagnostics ?? [])]
        : input.diagnostics.map(copyDiagnostic),
    });
  }

  /**
   * Records descriptor according to the PluginStatusTracker contract.
   */
  recordDescriptor(
    descriptor: NormalizedPluginDescriptor,
    options: PluginDescriptorStatusOptions = {},
  ): void {
    this.record({
      id: descriptor.id,
      schema: descriptor.schema,
      name: descriptor.name,
      version: descriptor.version,
      origin: descriptor.origin,
      state: options.state ?? 'resolved',
      enabled: options.enabled ?? true,
      locked: options.locked ?? descriptor.origin === 'core',
      manifestPath: descriptor.manifestPath,
      rootPath: descriptor.rootPath,
      ordinal: descriptor.ordinal,
      requires: descriptor.requires,
      optionalRequires: descriptor.optionalRequires,
      conflicts: descriptor.conflicts,
      diagnostics: options.diagnostics,
    });
  }

  /**
   * Marks loaded according to the PluginStatusTracker contract.
   */
  markLoaded(descriptor: NormalizedPluginDescriptor): void {
    this.transition(descriptor, 'loaded');
  }

  /**
   * Marks activated according to the PluginStatusTracker contract.
   */
  markActivated(descriptor: NormalizedPluginDescriptor): void {
    this.transition(descriptor, 'activated');
  }

  /**
   * Marks failed according to the PluginStatusTracker contract.
   */
  markFailed(descriptor: NormalizedPluginDescriptor, error: unknown): void {
    this.transition(descriptor, 'failed', {
      code: 'plugin-load-failed',
      message: error instanceof Error ? error.message : String(error),
      pluginId: descriptor.id,
      manifestPath: descriptor.manifestPath,
    });
  }

  /** Marks every successfully activated plugin disposed after teardown was attempted. */
  disposeActivated(): void {
    for (const entry of this.entries.values()) {
      if (!entry.activated) continue;
      entry.state = 'disposed';
      entry.activated = false;
    }
  }

  /**
   * Returns snapshot from the PluginStatusTracker state.
   */
  getSnapshot(): PluginStatusSnapshot {
    const plugins = [...this.entries.values()]
      .sort(compareEntries)
      .map(freezeStatus);
    return Object.freeze({
      configPath: this.configPath,
      roots: Object.freeze([...this.roots]),
      plugins: Object.freeze(plugins),
      diagnostics: Object.freeze(this.diagnostics.map(copyDiagnostic)),
    });
  }

  /**
   * Transitions according to the PluginStatusTracker contract.
   */
  private transition(
    descriptor: NormalizedPluginDescriptor,
    state: PluginStatusState,
    diagnostic?: PluginStatusDiagnostic,
  ): void {
    const key = statusKey(
      descriptor.origin,
      descriptor.manifestPath,
      descriptor.id,
      descriptor.ordinal,
    );
    let entry = this.entries.get(key);
    if (!entry) {
      this.recordDescriptor(descriptor, { state });
      entry = this.entries.get(key);
    }
    if (!entry) return;
    entry.state = state;
    entry.activated = activationForState(state, entry.activated);
    if (diagnostic) entry.diagnostics.push(copyDiagnostic(diagnostic));
  }
}

function statusKey(
  origin: PluginOrigin,
  manifestPath: string | undefined,
  id: string | undefined,
  ordinal: number,
): string {
  if (manifestPath !== undefined) return `${origin}\0path:${manifestPath}`;
  if (id !== undefined) return `${origin}\0id:${id}`;
  return `${origin}\0ordinal:${ordinal}`;
}

function supplied<T>(value: T | undefined, previous: T | undefined): T | undefined {
  return value === undefined ? previous : value;
}

function activationForState(state: PluginStatusState, previous = false): boolean {
  if (state === 'activated') return true;
  if (state === 'failed' || state === 'deactivated' || state === 'disposed') return false;
  return previous;
}

function copyDependencies(
  dependencies: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  return Object.freeze({ ...dependencies });
}

function copyDiagnostic(diagnostic: PluginStatusDiagnostic): PluginStatusDiagnostic {
  return Object.freeze({
    code: diagnostic.code,
    message: diagnostic.message,
    pluginId: diagnostic.pluginId,
    manifestPath: diagnostic.manifestPath,
  });
}

function compareEntries(left: MutablePluginStatus, right: MutablePluginStatus): number {
  return ORIGIN_ORDER[left.origin] - ORIGIN_ORDER[right.origin]
    || left.ordinal - right.ordinal
    || compareCodePoints(left.id ?? '', right.id ?? '')
    || compareCodePoints(left.manifestPath ?? '', right.manifestPath ?? '');
}

function freezeStatus(entry: MutablePluginStatus): PluginStatus {
  return Object.freeze({
    id: entry.id,
    schema: entry.schema,
    name: entry.name,
    version: entry.version,
    origin: entry.origin,
    state: entry.state,
    enabled: entry.enabled,
    locked: entry.locked,
    activated: entry.activated,
    manifestPath: entry.manifestPath,
    rootPath: entry.rootPath,
    ordinal: entry.ordinal,
    requires: copyDependencies(entry.requires),
    optionalRequires: copyDependencies(entry.optionalRequires),
    conflicts: copyDependencies(entry.conflicts),
    diagnostics: Object.freeze(entry.diagnostics.map(copyDiagnostic)),
  });
}
