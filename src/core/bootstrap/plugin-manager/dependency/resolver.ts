/**
 * Provides resolver bootstrapping behavior for PixieCore.
 */

import { createRequire } from 'node:module';
import { ConfigurationError, PluginLoadError } from '../../../contracts/errors/index.js';
import type { NormalizedPluginDescriptor } from '../model/definition.js';
import { resolveDependencyOrder } from './order.js';
import { compareCodePoints } from '../model/validation.js';

interface SemverApi {
  /**
   * Returns the canonical value when the input is valid, otherwise null.
   */
  valid(version: string): string | null;
  /**
   * Checks whether the supplied value falls within the permitted range.
   */
  validRange(range: string): string | null;
  /**
   * Checks whether the supplied value satisfies the declared constraint.
   */
  satisfies(version: string, range: string): boolean;
}

const semver = createRequire(import.meta.url)('semver') as SemverApi;

/**
 * Describes the managed resolution candidate contract.
 */
export interface ManagedResolutionCandidate<Value> {
  readonly id: string;
  /** Containing managed plugin ID for candidates below a parent plugins/ slot. */
  readonly parentId?: string;
  readonly ordinal: number;
  /**
   * Validates the requested operation and rejects unsupported input.
   */
  validate(): Promise<ManagedResolvedPlugin<Value>>;
}

/**
 * Describes the managed resolved plugin contract.
 */
export interface ManagedResolvedPlugin<Value> {
  readonly descriptor: NormalizedPluginDescriptor;
  readonly value: Value;
}

/**
 * Configures managed dependency resolution behavior.
 */
export interface ManagedDependencyResolutionOptions<Value> {
  readonly enabled: readonly string[];
  readonly disabled: ReadonlySet<string>;
  readonly inventory: ReadonlyMap<string, ManagedResolutionCandidate<Value>>;
  readonly coreDescriptors: readonly NormalizedPluginDescriptor[];
}

/**
 * Selects the complete managed closure and validates its graph before any
 * definition can be yielded to the module-loading engine.
 */
export async function resolveManagedPluginDependencies<Value>(
  options: ManagedDependencyResolutionOptions<Value>,
): Promise<readonly ManagedResolvedPlugin<Value>[]> {
  const coreById = new Map(options.coreDescriptors.map(descriptor => [descriptor.id, descriptor]));
  for (const id of options.disabled) {
    if (coreById.has(id)) {
      throw new ConfigurationError(`Core plugin cannot be disabled: ${id}`);
    }
  }

  const selected = new Set<string>();
  const queue: string[] = [];
  const childrenByParent = managedChildren(options.inventory);
  const disabledByHierarchy = hierarchyDisabledPlugins(options.inventory, options.disabled);
  for (const id of options.enabled) {
    if (coreById.has(id)) continue;
    if (!options.inventory.has(id)) {
      throw new ConfigurationError(`Unknown enabled managed plugin: ${id}`);
    }
    const disabledAncestor = disabledByHierarchy.get(id);
    if (disabledAncestor !== undefined) {
      throw new ConfigurationError(
        `Managed plugin ${id} cannot be enabled because ${disabledAncestor} is disabled`,
      );
    }
    selectCascade(id, selected, queue, childrenByParent, disabledByHierarchy);
  }

  const validated = new Map<string, ManagedResolvedPlugin<Value>>();
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index]!;
    const candidate = options.inventory.get(id);
    if (!candidate) throw missingDependency(id, id);
    const resolved = await candidate.validate();
    if (resolved.descriptor.id !== id || resolved.descriptor.origin !== 'managed-custom') {
      throw new PluginLoadError(`Managed plugin validation returned mismatched identity: ${id}`);
    }
    validateDescriptorVersion(resolved.descriptor);
    validated.set(id, resolved);

    for (const dependencyId of sortedKeys(resolved.descriptor.requires)) {
      if (coreById.has(dependencyId)) continue;
      if (disabledByHierarchy.has(dependencyId)) {
        throw new PluginLoadError(
          `Managed plugin ${id} requires explicitly disabled plugin ${dependencyId}`,
        );
      }
      if (!options.inventory.has(dependencyId)) throw missingDependency(id, dependencyId);
      selectCascade(
        dependencyId,
        selected,
        queue,
        childrenByParent,
        disabledByHierarchy,
      );
    }
  }

  const managedDependencies = new Map<string, string[]>();

  for (const [id, resolved] of validated) {
    const dependencies: string[] = [];
    const parentId = options.inventory.get(id)?.parentId;
    if (parentId !== undefined && selected.has(parentId)) dependencies.push(parentId);
    for (const [dependencyId, range] of sortedEntries(resolved.descriptor.requires)) {
      const dependency = dependencyDescriptor(dependencyId, coreById, validated);
      if (!dependency) throw missingDependency(id, dependencyId);
      assertCompatible(id, dependency, range, 'requires');
      if (dependency.origin === 'managed-custom') dependencies.push(dependency.id);
    }

    for (const [dependencyId, range] of sortedEntries(resolved.descriptor.optionalRequires)) {
      const dependency = dependencyDescriptor(dependencyId, coreById, validated);
      if (!dependency) continue;
      assertCompatible(id, dependency, range, 'optionally requires');
      if (dependency.origin === 'managed-custom') dependencies.push(dependency.id);
    }

    for (const [conflictId, range] of sortedEntries(resolved.descriptor.conflicts)) {
      const conflict = dependencyDescriptor(conflictId, coreById, validated);
      if (!conflict) continue;
      const version = requiredVersion(conflict);
      if (semver.satisfies(version, range)) {
        throw new PluginLoadError(
          `Managed plugin ${id} conflicts with selected plugin ${conflictId}@${version} (${range})`,
        );
      }
    }
    managedDependencies.set(id, dependencies);
  }

  const order = resolveDependencyOrder(
    selected,
    id => managedDependencies.get(id) ?? [],
    (left, right) => compareCandidates(left, right, options.inventory),
  );
  if (order.cyclic.length > 0) {
    throw new PluginLoadError(`Managed plugin dependency cycle: ${order.cyclic.join(' -> ')}`);
  }

  const ordered = order.ordered.map(id => {
    const resolved = validated.get(id);
    if (!resolved) throw new PluginLoadError(`Managed plugin was not validated: ${id}`);
    return resolved;
  });
  return Object.freeze(ordered);
}

function select(id: string, selected: Set<string>, queue: string[]): void {
  if (selected.has(id)) return;
  selected.add(id);
  queue.push(id);
}

function selectCascade<Value>(
  id: string,
  selected: Set<string>,
  queue: string[],
  childrenByParent: ReadonlyMap<string, readonly string[]>,
  disabledByHierarchy: ReadonlyMap<string, string>,
): void {
  if (disabledByHierarchy.has(id) || selected.has(id)) return;
  select(id, selected, queue);
  for (const childId of childrenByParent.get(id) ?? []) {
    selectCascade(childId, selected, queue, childrenByParent, disabledByHierarchy);
  }
}

function managedChildren<Value>(
  inventory: ReadonlyMap<string, ManagedResolutionCandidate<Value>>,
): ReadonlyMap<string, readonly string[]> {
  const children = new Map<string, string[]>();
  for (const candidate of inventory.values()) {
    if (candidate.parentId === undefined) continue;
    const siblings = children.get(candidate.parentId) ?? [];
    siblings.push(candidate.id);
    children.set(candidate.parentId, siblings);
  }
  for (const siblings of children.values()) {
    siblings.sort((left, right) => compareCandidates(left, right, inventory));
  }
  return children;
}

function hierarchyDisabledPlugins<Value>(
  inventory: ReadonlyMap<string, ManagedResolutionCandidate<Value>>,
  explicitlyDisabled: ReadonlySet<string>,
): ReadonlyMap<string, string> {
  const disabled = new Map<string, string>();
  const resolveDisabledAncestor = (id: string, visiting = new Set<string>()): string | undefined => {
    const known = disabled.get(id);
    if (known !== undefined) return known;
    if (explicitlyDisabled.has(id)) {
      disabled.set(id, id);
      return id;
    }
    if (visiting.has(id)) return undefined;
    visiting.add(id);
    const parentId = inventory.get(id)?.parentId;
    const ancestor = parentId === undefined
      ? undefined
      : resolveDisabledAncestor(parentId, visiting);
    visiting.delete(id);
    if (ancestor !== undefined) disabled.set(id, ancestor);
    return ancestor;
  };
  for (const id of inventory.keys()) resolveDisabledAncestor(id);
  return disabled;
}

function dependencyDescriptor<Value>(
  id: string,
  core: ReadonlyMap<string, NormalizedPluginDescriptor>,
  managed: ReadonlyMap<string, ManagedResolvedPlugin<Value>>,
): NormalizedPluginDescriptor | undefined {
  return core.get(id) ?? managed.get(id)?.descriptor;
}

function assertCompatible(
  ownerId: string,
  dependency: NormalizedPluginDescriptor,
  range: string,
  relation: string,
): void {
  const version = requiredVersion(dependency);
  if (!semver.validRange(range)) {
    throw new PluginLoadError(`Managed plugin ${ownerId} has an invalid dependency range: ${range}`);
  }
  if (!semver.satisfies(version, range)) {
    throw new PluginLoadError(
      `Managed plugin ${ownerId} ${relation} ${dependency.id}@${range}, found ${version}`,
    );
  }
}

function validateDescriptorVersion(descriptor: NormalizedPluginDescriptor): void {
  const version = requiredVersion(descriptor);
  if (!semver.valid(version)) {
    throw new PluginLoadError(`Managed plugin has an invalid SemVer version: ${descriptor.id}`);
  }
}

function requiredVersion(descriptor: NormalizedPluginDescriptor): string {
  if (!descriptor.version) {
    throw new PluginLoadError(`Plugin dependency has no version: ${descriptor.id}`);
  }
  return descriptor.version;
}

function missingDependency(ownerId: string, dependencyId: string): PluginLoadError {
  return new PluginLoadError(`Managed plugin ${ownerId} requires missing plugin ${dependencyId}`);
}

function compareCandidates<Value>(
  left: string,
  right: string,
  inventory: ReadonlyMap<string, ManagedResolutionCandidate<Value>>,
): number {
  return (inventory.get(left)?.ordinal ?? Number.MAX_SAFE_INTEGER)
    - (inventory.get(right)?.ordinal ?? Number.MAX_SAFE_INTEGER)
    || compareCodePoints(left, right);
}

function sortedKeys(record: Readonly<Record<string, string>>): string[] {
  return Object.keys(record).sort(compareCodePoints);
}

function sortedEntries(
  record: Readonly<Record<string, string>>,
): Array<readonly [string, string]> {
  return Object.entries(record)
    .sort(([left], [right]) => compareCodePoints(left, right));
}
