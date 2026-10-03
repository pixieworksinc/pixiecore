/**
 * Defines application-boundary errors and value-free diagnostics.
 */

import { diagnosticMessage } from '../../component/diagnostics/index.js';
import { PixieCoreError } from '../../contracts/errors/index.js';
import type {
  ApplicationMappingStage,
  ApplicationNodeDefinition,
  ApplicationNodeErrorOptions,
} from '../../contracts/application/index.js';

/** Reports application mapping failures. */
export class ApplicationMappingError extends PixieCoreError {
  readonly inputFields: readonly string[];
  readonly sourceNodeIds: readonly string[];

  /** Creates a mapping error with value-free failure context. */
  constructor(
    message: string,
    readonly stage: ApplicationMappingStage,
    readonly nodeId: string,
    inputFields: readonly string[],
    sourceNodeIds: readonly string[],
    options?: ErrorOptions,
  ) {
    super(message, 'application_mapping_error', options);
    this.inputFields = Object.freeze([...inputFields].sort());
    this.sourceNodeIds = Object.freeze([...sourceNodeIds].sort());
  }
}

/** Reports invalid application contracts. */
export class ApplicationContractError extends PixieCoreError {
  /** Creates an application contract error. */
  constructor(message: string, options?: ErrorOptions) {
    super(message, 'application_contract_error', options);
  }
}

/** Reports a failed code-first application node without retaining values. */
export class ApplicationNodeError extends PixieCoreError {
  readonly inputFields: readonly string[];
  readonly suggestions: readonly string[];

  /** Creates a node error with replay and repair guidance. */
  constructor(
    label: string,
    readonly node: ApplicationNodeDefinition,
    inputFields: readonly string[],
    cause: unknown,
    options: ApplicationNodeErrorOptions = {},
  ) {
    const suggestions = options.suggestions ?? [
      'Inspect the preserved cause and validate the listed mapping fields against the Blueprint contracts.',
    ];
    const fields = Object.freeze([...new Set(inputFields)].sort());
    super(diagnosticMessage(`${label} node failed`, {
      node: node.id,
      blueprint: { path: node.blueprintPath, version: node.blueprintVersion },
      fields,
      ...(options.replayCommand === undefined
        ? {}
        : { replayCommand: options.replayCommand }),
      suggestions,
    }), options.code ?? 'application_node_error', { cause });
    this.name = options.name ?? 'ApplicationNodeError';
    this.inputFields = fields;
    this.suggestions = Object.freeze([...new Set(suggestions)].sort());
  }
}

/** Builds a value-free diagnostic for an application node or mapping. */
export function applicationDiagnostic(
  message: string,
  definition: ApplicationNodeDefinition | undefined,
  fields: readonly string[],
  suggestions: readonly string[],
  nodeId = definition?.id,
): string {
  return diagnosticMessage(message, {
    ...(nodeId === undefined ? {} : { node: nodeId || '<blank>' }),
    ...(definition?.blueprintPath
      ? {
          blueprint: {
            path: definition.blueprintPath,
            ...(definition.blueprintVersion
              ? { version: definition.blueprintVersion }
              : {}),
          },
        }
      : {}),
    fields,
    suggestions,
  });
}
