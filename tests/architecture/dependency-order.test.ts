import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveDependencyOrder } from '../../src/core/bootstrap/plugin-manager/dependency/order.js';
import { testData } from '../helpers/test-data.js';

const compareIds = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;
const data = testData('dependency order invariants');

test('dependency ordering deduplicates edges and applies the supplied ready-order comparator', () => {
  const alpha = `alpha_${data.text('dedup alpha', 'plugin')}`;
  const beta = `beta_${data.text('dedup beta', 'plugin')}`;
  const gamma = `gamma_${data.text('dedup gamma', 'plugin')}`;
  const zeta = `zeta_${data.text('dedup zeta', 'plugin')}`;
  const dependencies = new Map<string, readonly string[]>([
    [alpha, []],
    [beta, [alpha, alpha]],
    [gamma, [alpha]],
    [zeta, []],
  ]);

  const result = resolveDependencyOrder(
    new Set([zeta, gamma, beta, alpha]),
    id => dependencies.get(id) ?? [],
    compareIds,
  );

  assert.deepEqual(result.ordered, [alpha, beta, gamma, zeta].sort(compareIds));
  assert.deepEqual(result.cyclic, []);
});

test('dependency ordering reports the sorted cyclic remainder without hiding independent nodes', () => {
  const alpha = data.text('cycle alpha', 'plugin');
  const beta = data.text('cycle beta', 'plugin');
  const zeta = data.text('cycle zeta', 'plugin');
  const dependencies = new Map<string, readonly string[]>([
    [alpha, [beta]],
    [beta, [alpha]],
    [zeta, []],
  ]);

  const result = resolveDependencyOrder(
    new Set([zeta, beta, alpha]),
    id => dependencies.get(id) ?? [],
    compareIds,
  );

  assert.deepEqual(result.ordered, [zeta]);
  assert.deepEqual(result.cyclic, [alpha, beta].sort(compareIds));
});

test('seeded dependency graphs preserve DAG order and report exact cyclic remainders', async t => {
  for (const graph of generatedGraphs()) {
    await t.test(`graph ${String(graph.index).padStart(2, '0')}: ${graph.name}`, () => {
      const result = resolveDependencyOrder(
        new Set(graph.nodes),
        id => graph.dependencies.get(id) ?? [],
        compareIds,
      );

      if (graph.cyclicNodeIndexes.length === 0) {
        assertDagInvariant(result.ordered, result.cyclic, graph);
        return;
      }

      assertCycleInvariant(result.ordered, result.cyclic, graph);
    });
  }
});

interface GeneratedGraph {
  readonly index: number;
  readonly name: string;
  readonly nodes: readonly string[];
  readonly dependencies: ReadonlyMap<string, readonly string[]>;
  readonly cyclicNodeIndexes: readonly number[];
}

interface GraphDefinition {
  readonly name: string;
  readonly dependencyIndexes: readonly (readonly (number | 'external')[])[];
  readonly cyclicNodeIndexes: readonly number[];
}

function generatedGraphs(): readonly GeneratedGraph[] {
  return graphDefinitions.map((definition, index) => createGraph(index, definition));
}

function createGraph(index: number, definition: GraphDefinition): GeneratedGraph {
  const nodes = definition.dependencyIndexes.map((_, nodeIndex) => (
    data.text(`graph-${index}-node-${nodeIndex}`, 'plugin')
  ));
  const external = data.text(`graph-${index}-external`, 'external');
  const dependencies = new Map<string, readonly string[]>(
    definition.dependencyIndexes.map((dependencyIndexes, dependentIndex) => [
      nodes[dependentIndex]!,
      dependencyIndexes.map(dependencyIndex => (
        dependencyIndex === 'external' ? external : nodes[dependencyIndex]!
      )),
    ]),
  );
  return {
    index,
    name: definition.name,
    nodes,
    dependencies,
    cyclicNodeIndexes: definition.cyclicNodeIndexes,
  };
}

function assertDagInvariant(
  ordered: readonly string[],
  cyclic: readonly string[],
  graph: GeneratedGraph,
): void {
  assert.deepEqual(cyclic, []);
  assert.deepEqual([...ordered].sort(compareIds), [...graph.nodes].sort(compareIds));
  assertDependencyPrecedence(ordered, graph);
}

function assertCycleInvariant(
  ordered: readonly string[],
  cyclic: readonly string[],
  graph: GeneratedGraph,
): void {
  const expectedCyclic = graph.cyclicNodeIndexes
    .map(index => graph.nodes[index]!)
    .sort(compareIds);
  const expectedOrdered = graph.nodes
    .filter((_, index) => !graph.cyclicNodeIndexes.includes(index))
    .sort(compareIds);

  assert.deepEqual(cyclic, expectedCyclic);
  assert.deepEqual([...ordered].sort(compareIds), expectedOrdered);
  assertDependencyPrecedence(ordered, graph);
}

function assertDependencyPrecedence(ordered: readonly string[], graph: GeneratedGraph): void {
  const position = new Map(ordered.map((id, index) => [id, index]));
  for (const [dependent, dependencies] of graph.dependencies) {
    const dependentPosition = position.get(dependent);
    if (dependentPosition === undefined) continue;
    for (const dependency of dependencies) {
      const dependencyPosition = position.get(dependency);
      if (dependencyPosition === undefined) continue;
      assert.ok(
        dependencyPosition < dependentPosition,
        `${dependency} must precede ${dependent}`,
      );
    }
  }
}

const graphDefinitions: readonly GraphDefinition[] = [
  {
    name: 'isolated nodes retain a deterministic tie order',
    dependencyIndexes: [[], [], []],
    cyclicNodeIndexes: [],
  },
  {
    name: 'duplicate edges do not duplicate a dependent',
    dependencyIndexes: [[], [0, 0], []],
    cyclicNodeIndexes: [],
  },
  {
    name: 'a chain keeps every dependency before its dependent',
    dependencyIndexes: [[], [0], [1]],
    cyclicNodeIndexes: [],
  },
  {
    name: 'a diamond waits for both dependencies',
    dependencyIndexes: [[], [0], [0], [1, 2]],
    cyclicNodeIndexes: [],
  },
  {
    name: 'a star preserves readiness ties after a shared dependency',
    dependencyIndexes: [[], [0], [0], [0]],
    cyclicNodeIndexes: [],
  },
  {
    name: 'dependencies outside the selected set are ignored',
    dependencyIndexes: [[], ['external', 0], [1]],
    cyclicNodeIndexes: [],
  },
  {
    name: 'two roots precede their shared dependent',
    dependencyIndexes: [[], [], [0, 1]],
    cyclicNodeIndexes: [],
  },
  {
    name: 'independent chains can merge',
    dependencyIndexes: [[], [0], [], [2], [1, 3]],
    cyclicNodeIndexes: [],
  },
  {
    name: 'an isolated node can coexist with a dependency chain',
    dependencyIndexes: [[], [0], [], [1]],
    cyclicNodeIndexes: [],
  },
  {
    name: 'a self-cycle remains after an independent node resolves',
    dependencyIndexes: [[0], []],
    cyclicNodeIndexes: [0],
  },
  {
    name: 'a two-node cycle remains sorted',
    dependencyIndexes: [[1], [0], []],
    cyclicNodeIndexes: [0, 1],
  },
  {
    name: 'a three-node cycle remains sorted',
    dependencyIndexes: [[2], [0], [1], []],
    cyclicNodeIndexes: [0, 1, 2],
  },
  {
    name: 'a self-cycle retains its blocked downstream dependent',
    dependencyIndexes: [[0], [0], []],
    cyclicNodeIndexes: [0, 1],
  },
  {
    name: 'a two-node cycle retains its blocked downstream chain',
    dependencyIndexes: [[1], [0], [1], [2], []],
    cyclicNodeIndexes: [0, 1, 2, 3],
  },
  {
    name: 'disjoint cycles retain every unresolved node',
    dependencyIndexes: [[1], [0], [3], [2], []],
    cyclicNodeIndexes: [0, 1, 2, 3],
  },
  {
    name: 'an independent chain resolves beside a separate cycle',
    dependencyIndexes: [[1], [0], [], [2], [3]],
    cyclicNodeIndexes: [0, 1],
  },
];
