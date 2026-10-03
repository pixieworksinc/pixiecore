/**
 * Provides order bootstrapping behavior for PixieCore.
 */

/**
 * Describes the dependency order contract.
 */
export interface DependencyOrder {
  readonly ordered: readonly string[];
  readonly cyclic: readonly string[];
}

/**
 * Orders an already-selected plugin set after caller-specific dependency policy
 * has been applied. Selection, validation, and error wording stay with callers.
 */
export function resolveDependencyOrder(
  selected: ReadonlySet<string>,
  dependenciesFor: (id: string) => Iterable<string>,
  compare: (left: string, right: string) => number,
): DependencyOrder {
  const outgoing = new Map<string, Set<string>>();
  const indegree = new Map<string, number>();
  for (const id of selected) {
    outgoing.set(id, new Set());
    indegree.set(id, 0);
  }

  for (const dependent of selected) {
    for (const dependency of dependenciesFor(dependent)) {
      if (!selected.has(dependency)) continue;
      addDependencyEdge(dependency, dependent, outgoing, indegree);
    }
  }

  const ready = [...selected].filter(id => indegree.get(id) === 0).sort(compare);
  const ordered: string[] = [];
  while (ready.length > 0) {
    const id = ready.shift()!;
    ordered.push(id);
    for (const dependent of outgoing.get(id) ?? []) {
      const remaining = (indegree.get(dependent) ?? 0) - 1;
      indegree.set(dependent, remaining);
      if (remaining !== 0) continue;
      ready.push(dependent);
      ready.sort(compare);
    }
  }

  const cyclic = ordered.length === selected.size
    ? []
    : [...selected].filter(id => (indegree.get(id) ?? 0) > 0).sort(compare);
  return { ordered, cyclic };
}

function addDependencyEdge(
  dependency: string,
  dependent: string,
  outgoing: ReadonlyMap<string, Set<string>>,
  indegree: Map<string, number>,
): void {
  const dependents = outgoing.get(dependency);
  if (!dependents || dependents.has(dependent)) return;
  dependents.add(dependent);
  indegree.set(dependent, (indegree.get(dependent) ?? 0) + 1);
}
