/**
 * Inspects and renders value-free application graphs.
 */

import { cloneFrozenJsonValue } from '../../component/json-artifact/index.js';
import type {
  ApplicationGraphDefinition,
  ApplicationGraphEdgeInspection,
  ApplicationGraphInspection,
  ApplicationGraphNodeDefinition,
  ApplicationGraphNodeInspection,
} from '../../contracts/application/index.js';
import type { Blueprint, JsonValue } from '../../contracts/types/index.js';
import { BlueprintValidator } from '../../../plugins/validation/validation.js';
import { ApplicationContractError } from './errors.js';
import { createApplicationSchemaBoundary } from './mapping.js';

export const APPLICATION_GRAPH_INSPECTION_SCHEMA =
  'pixiecore.application-graph-inspection/v1' as const;

/** Loads and validates an inspection-only graph without contacting a provider. */
export async function inspectApplicationGraph(
  definition: ApplicationGraphDefinition,
): Promise<ApplicationGraphInspection> {
  validateGraphHeader(definition);
  const definitions = definition.nodes.map(node => ({
    id: node.id,
    blueprintPath: node.blueprintPath,
    blueprintVersion: node.blueprintVersion,
  }));
  await createApplicationSchemaBoundary(definitions);

  const graphNodes = new Map(definition.nodes.map(node => [node.id, node]));
  validateGraphDependencies(graphNodes);
  const validator = new BlueprintValidator({ warn: () => undefined });
  const nodes = await Promise.all([...graphNodes.values()]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map(async node => {
      const blueprint = await validator.validateFile(node.blueprintPath);
      return Object.freeze({
        id: node.id,
        blueprint_name: blueprint.name,
        blueprint_version: blueprint.version,
        role: blueprint.role,
        depends_on: Object.freeze([...(node.dependsOn ?? [])].sort()),
        input_schema: blueprint.input_schema === undefined
          ? deriveInputSchema(blueprint)
          : freezeSchema(blueprint.input_schema),
        output_schema: freezeSchema(blueprint.output_schema),
      }) as ApplicationGraphNodeInspection;
    }));
  const edges = nodes.flatMap(node => node.depends_on.map(from => (
    Object.freeze({ from, to: node.id }) as ApplicationGraphEdgeInspection
  ))).sort((left, right) => (
    left.from.localeCompare(right.from) || left.to.localeCompare(right.to)
  ));

  return Object.freeze({
    schema: APPLICATION_GRAPH_INSPECTION_SCHEMA,
    name: definition.name,
    version: definition.version,
    nodes: Object.freeze(nodes),
    edges: Object.freeze(edges),
  });
}

/** Renders a validated graph inspection as Mermaid flowchart source. */
export function renderApplicationGraphMermaid(
  inspection: ApplicationGraphInspection,
): string {
  const identifiers = new Map(inspection.nodes.map((node, index) => [node.id, `node_${index}`]));
  const lines = ['flowchart TD'];
  for (const node of inspection.nodes) {
    const inputFields = schemaFields(node.input_schema);
    const outputFields = schemaFields(node.output_schema);
    const label = [
      node.id,
      `${node.role} · ${node.blueprint_version}`,
      `in: ${inputFields.length ? inputFields.join(', ') : '(open)'}`,
      `out: ${outputFields.length ? outputFields.join(', ') : '(open)'}`,
    ].join('\\n').replaceAll('"', '&quot;');
    lines.push(`  ${identifiers.get(node.id)}["${label}"]`);
  }
  for (const edge of inspection.edges) {
    lines.push(`  ${identifiers.get(edge.from)} --> ${identifiers.get(edge.to)}`);
  }
  return lines.join('\n');
}

function validateGraphHeader(definition: ApplicationGraphDefinition): void {
  if (typeof definition.name !== 'string' || !definition.name.trim()) {
    throw new ApplicationContractError('Application graph name must be non-blank');
  }
  if (
    typeof definition.version !== 'string'
    || !/^\d+\.\d+(?:\.\d+)?$/u.test(definition.version)
  ) {
    throw new ApplicationContractError(
      'Application graph version must use major.minor or major.minor.patch',
    );
  }
  if (!Array.isArray(definition.nodes) || definition.nodes.length === 0) {
    throw new ApplicationContractError('Application graph requires at least one node');
  }
}

function validateGraphDependencies(
  nodes: ReadonlyMap<string, ApplicationGraphNodeDefinition>,
): void {
  for (const node of nodes.values()) {
    const dependencies = node.dependsOn ?? [];
    const unique = new Set<string>();
    for (const dependency of dependencies) {
      if (typeof dependency !== 'string' || !dependency.trim()) {
        throw new ApplicationContractError(`Application graph node ${node.id} has a blank dependency`);
      }
      if (!nodes.has(dependency)) {
        throw new ApplicationContractError(
          `Application graph node ${node.id} depends on unknown node ${dependency}`,
        );
      }
      if (dependency === node.id) {
        throw new ApplicationContractError(`Application graph node ${node.id} depends on itself`);
      }
      if (unique.has(dependency)) {
        throw new ApplicationContractError(
          `Application graph node ${node.id} repeats dependency ${dependency}`,
        );
      }
      unique.add(dependency);
    }
  }
  assertAcyclicGraph(nodes);
}

function assertAcyclicGraph(nodes: ReadonlyMap<string, ApplicationGraphNodeDefinition>): void {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string, path: readonly string[]): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      const start = path.indexOf(id);
      const cycle = [...path.slice(start), id];
      throw new ApplicationContractError(`Application graph contains a cycle: ${cycle.join(' -> ')}`);
    }
    visiting.add(id);
    const node = nodes.get(id)!;
    for (const dependency of node.dependsOn ?? []) visit(dependency, [...path, id]);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of [...nodes.keys()].sort()) visit(id, []);
}

function deriveInputSchema(blueprint: Blueprint): JsonValue {
  const placeholders = blueprint.input_placeholders ?? [];
  const properties: Record<string, JsonValue> = {};
  const required: string[] = [];
  for (const placeholder of placeholders) {
    if (typeof placeholder === 'string') {
      properties[placeholder] = { type: 'string' };
      required.push(placeholder);
      continue;
    }
    properties[placeholder.name] = inputTypeSchema(placeholder.type);
    if (placeholder.required) required.push(placeholder.name);
  }
  return freezeSchema({
    type: 'object',
    properties,
    ...(required.length === 0 ? {} : { required }),
    additionalProperties: placeholders.length === 0,
  });
}

function inputTypeSchema(type: string): Record<string, JsonValue> {
  if (type === 'integer') return { type: 'integer' };
  if (type === 'float' || type === 'number') return { type: 'number' };
  if (type === 'boolean') return { type: 'boolean' };
  if (type === 'array') return { type: 'array' };
  if (type === 'object') return { type: 'object' };
  return { type: 'string' };
}

function freezeSchema(value: string | Record<string, unknown>): JsonValue {
  let parsed: unknown;
  try {
    parsed = typeof value === 'string' ? JSON.parse(value) : value;
  } catch (cause) {
    throw new ApplicationContractError('Application graph contains an invalid JSON schema', {
      cause,
    });
  }
  return cloneFrozenJsonValue(
    parsed,
    'schema',
    message => new ApplicationContractError(message),
  ) as JsonValue;
}

function schemaFields(schema: unknown): string[] {
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) return [];
  const properties = (schema as Record<string, unknown>).properties;
  if (properties === null || typeof properties !== 'object' || Array.isArray(properties)) return [];
  return Object.keys(properties).sort();
}
