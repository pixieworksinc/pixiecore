/**
 * Preloads Blueprint contracts and validates application edge mappings.
 */

import type {
  ApplicationMappingRequest,
  ApplicationNodeDefinition,
} from '../../contracts/application/index.js';
import type { Blueprint } from '../../contracts/types/index.js';
import {
  BlueprintValidator,
  InputSchemaValidator,
  InputValidator,
  OutputValidator,
} from '../../../plugins/validation/validation.js';
import { ApplicationMappingError, applicationDiagnostic } from './errors.js';

interface LoadedApplicationNode {
  readonly definition: Readonly<ApplicationNodeDefinition>;
  readonly blueprint: Blueprint;
}

/** Preloads a fixed graph and validates mapped edges without retaining values. */
export class ApplicationSchemaBoundary {
  /** Creates a schema boundary over preloaded nodes. */
  private constructor(private readonly nodes: ReadonlyMap<string, LoadedApplicationNode>) {}

  /** Loads and pins every node definition before application execution. */
  static async create(
    definitions: readonly ApplicationNodeDefinition[],
  ): Promise<ApplicationSchemaBoundary> {
    const nodes = new Map<string, LoadedApplicationNode>();
    const validator = new BlueprintValidator({ warn: () => undefined });

    for (const definition of definitions) {
      validateDefinition(definition, nodes);
      let blueprint: Blueprint;
      try {
        blueprint = await validator.validateFile(definition.blueprintPath);
      } catch (cause) {
        throw definitionError(definition, 'could not be loaded', cause);
      }
      if (blueprint.version !== definition.blueprintVersion) {
        throw definitionError(
          definition,
          `declares version ${definition.blueprintVersion} but the Blueprint is ${blueprint.version}`,
        );
      }
      nodes.set(definition.id, {
        definition: Object.freeze({ ...definition }),
        blueprint,
      });
    }

    return new ApplicationSchemaBoundary(nodes);
  }

  /** Validates source outputs and normalized target inputs for one mapping. */
  validateMapping(request: ApplicationMappingRequest): Record<string, unknown> {
    const target = this.requireNode(request.targetNodeId);
    const inputFields = Object.keys(request.inputs);
    const sources = request.sources ?? [];
    const sourceNodeIds = sources.map(source => source.nodeId);
    const seenSources = new Set<string>();

    for (const source of sources) {
      if (seenSources.has(source.nodeId)) {
        throw new ApplicationMappingError(
          applicationDiagnostic(
            `Application mapping to ${target.definition.id} repeats source node ${source.nodeId}`,
            target.definition,
            inputFields,
            ['Remove the duplicate source mapping before executing the target node.'],
          ),
          'source-output',
          target.definition.id,
          inputFields,
          sourceNodeIds,
        );
      }
      seenSources.add(source.nodeId);
      const loadedSource = this.requireNode(
        source.nodeId,
        target.definition.id,
        inputFields,
        sourceNodeIds,
        target.definition,
      );
      try {
        new OutputValidator(loadedSource.blueprint.output_schema).validate(source.output);
      } catch (cause) {
        throw new ApplicationMappingError(
          applicationDiagnostic(
            `Application mapping source output is invalid: ${source.nodeId} -> ${target.definition.id}`,
            target.definition,
            inputFields,
            [`Validate node ${source.nodeId} output against its pinned output_schema.`],
          ),
          'source-output',
          target.definition.id,
          inputFields,
          sourceNodeIds,
          { cause },
        );
      }
    }

    try {
      const normalized = new InputValidator(target.blueprint.input_placeholders, true)
        .validate({ ...request.inputs });
      return target.blueprint.input_schema === undefined
        ? normalized
        : new InputSchemaValidator(target.blueprint.input_schema).validate(normalized);
    } catch (cause) {
      throw new ApplicationMappingError(
        applicationDiagnostic(
          `Application mapping target input is invalid: ${target.definition.id}`,
          target.definition,
          inputFields,
          ['Align the listed mapping fields with the target input placeholders and input_schema.'],
        ),
        'target-input',
        target.definition.id,
        inputFields,
        sourceNodeIds,
        { cause },
      );
    }
  }

  /** Resolves a preloaded node or reports an unknown mapping reference. */
  private requireNode(
    id: string,
    targetNodeId = id,
    inputFields: readonly string[] = [],
    sourceNodeIds: readonly string[] = [],
    targetDefinition?: ApplicationNodeDefinition,
  ): LoadedApplicationNode {
    const node = this.nodes.get(id);
    if (node) return node;
    throw new ApplicationMappingError(
      applicationDiagnostic(
        `Application mapping references unknown node: ${id}`,
        targetDefinition,
        inputFields,
        ['Declare the referenced node and pin its Blueprint version before application preflight.'],
        targetNodeId,
      ),
      'definition',
      targetNodeId,
      inputFields,
      sourceNodeIds,
    );
  }
}

/** Creates a schema boundary after validating all supplied definitions. */
export function createApplicationSchemaBoundary(
  definitions: readonly ApplicationNodeDefinition[],
): Promise<ApplicationSchemaBoundary> {
  return ApplicationSchemaBoundary.create(definitions);
}

function validateDefinition(
  definition: ApplicationNodeDefinition,
  nodes: ReadonlyMap<string, LoadedApplicationNode>,
): void {
  if (!definition.id.trim()) throw definitionError(definition, 'requires a non-blank id');
  if (!definition.blueprintPath.trim()) {
    throw definitionError(definition, 'requires a non-blank Blueprint path');
  }
  if (!definition.blueprintVersion.trim()) {
    throw definitionError(definition, 'requires a non-blank Blueprint version');
  }
  if (nodes.has(definition.id)) throw definitionError(definition, 'has a duplicate node id');
}

function definitionError(
  definition: ApplicationNodeDefinition,
  detail: string,
  cause?: unknown,
): ApplicationMappingError {
  return new ApplicationMappingError(
    applicationDiagnostic(
      `Application node definition ${definition.id || '<blank>'} ${detail}`,
      definition,
      [],
      ['Correct the node definition or its pinned Blueprint before application execution.'],
    ),
    'definition',
    definition.id,
    [],
    [],
    cause === undefined ? undefined : { cause },
  );
}
