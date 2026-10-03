/**
 * Coordinates rag responsibilities inside the PixieCore kernel.
 */

import { cloneFrozenJsonObject } from '../../component/json-artifact/index.js';
import { PixieCoreError } from '../../contracts/errors/index.js';
import type {
  CreateRagChunkMetadataInput,
  RagAuthorizationPort,
  RagAuthorizationRequest,
  RagChunk,
  RagChunkMetadata,
  RagRetrievalBoundaryOptions,
  RagRetrievalMatch,
  RagRetrievalScope,
  RagRetrievalToolFactory,
  RagRetrievalToolOptions,
  RagStorePort,
  RagStoreRetrievalRequest,
} from '../../contracts/rag/index.js';
import type { JsonObject, RegisteredTool } from '../../contracts/types/index.js';

export const RAG_CHUNK_METADATA_SCHEMA = 'pixiecore.rag-chunk-metadata/v1' as const;
const CANONICAL_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * Reports rag metadata contract failures.
 */
export class RagMetadataContractError extends PixieCoreError {
  /**
   * Creates a RagMetadataContractError with the supplied failure context.
   */
  constructor(message: string, options?: ErrorOptions) {
    super(message, 'rag_metadata_contract_error', options);
  }
}

/**
 * Reports rag boundary contract failures.
 */
export class RagBoundaryContractError extends PixieCoreError {
  /**
   * Creates a RagBoundaryContractError with the supplied failure context.
   */
  constructor(message: string, options?: ErrorOptions) {
    super(message, 'rag_boundary_contract_error', options);
  }
}

/**
 * Reports rag authorization failures.
 */
export class RagAuthorizationError extends PixieCoreError {
  /**
   * Creates a RagAuthorizationError with the supplied failure context.
   */
  constructor(operation: 'index' | 'retrieve') {
    super(`RAG ${operation} was denied by the server-owned authorization policy`, 'rag_authorization_error');
  }
}

/**
 * Creates rag chunk metadata after validating the supplied contract.
 */
export function createRagChunkMetadata(
  input: CreateRagChunkMetadataInput,
): RagChunkMetadata {
  return Object.freeze({
    schema: RAG_CHUNK_METADATA_SCHEMA,
    namespace: nonBlank(input.namespace, 'namespace'),
    chunk_type: nonBlank(input.chunkType, 'chunkType'),
    field: nonBlank(input.field, 'field'),
    version: nonBlank(input.version, 'version'),
    access_level: nonBlank(input.accessLevel, 'accessLevel'),
    sensitivity: nonBlank(input.sensitivity, 'sensitivity'),
    updated_at: canonicalTimestamp(input.updatedAt, 'updatedAt'),
    author: nonBlank(input.author, 'author'),
    ...(input.attributes === undefined
      ? {}
      : { attributes: cloneAttributes(input.attributes) }),
  });
}

/**
 * Encapsulates rag retrieval boundary behavior and lifecycle.
 */
export class RagRetrievalBoundary implements RagRetrievalToolFactory {
  readonly maxResults: number;
  private readonly store: RagStorePort;
  private readonly authorization: RagAuthorizationPort;
  private readonly scope: RagRetrievalScope;
  private readonly accessLevels: ReadonlySet<string>;
  private readonly sensitivities: ReadonlySet<string>;

  /**
   * Creates a RagRetrievalBoundary and establishes its initial state.
   */
  constructor(options: RagRetrievalBoundaryOptions) {
    if (!options || typeof options !== 'object') {
      throw new RagBoundaryContractError('options must be an object');
    }
    if (!options.store
      || typeof options.store.index !== 'function'
      || typeof options.store.retrieve !== 'function') {
      throw new RagBoundaryContractError('store must implement index and retrieve');
    }
    if (!options.authorization || typeof options.authorization.authorize !== 'function') {
      throw new RagBoundaryContractError('authorization must implement authorize');
    }
    this.scope = scope(options.scope);
    this.accessLevels = new Set(this.scope.accessLevels);
    this.sensitivities = new Set(this.scope.sensitivities);
    this.maxResults = options.maxResults ?? 10;
    if (!Number.isSafeInteger(this.maxResults) || this.maxResults < 1) {
      throw new RagBoundaryContractError('maxResults must be a positive safe integer');
    }
    this.store = options.store;
    this.authorization = options.authorization;
  }

  /**
   * Indexes according to the RagRetrievalBoundary contract.
   */
  async index(chunks: readonly RagChunk[]): Promise<void> {
    if (!Array.isArray(chunks) || chunks.length === 0) {
      throw new RagBoundaryContractError('chunks must contain at least one chunk');
    }
    const validated = chunks.map((chunk, index) => this.chunk(chunk, `chunks[${index}]`));
    if (new Set(validated.map(chunk => chunk.id)).size !== validated.length) {
      throw new RagBoundaryContractError('chunks must not contain duplicate ids');
    }
    await this.authorize('index', validated.length);
    await this.store.index(Object.freeze(validated));
  }

  /**
   * Retrieves according to the RagRetrievalBoundary contract.
   */
  async retrieve(query: string, limit = this.maxResults): Promise<readonly RagRetrievalMatch[]> {
    const validatedQuery = boundaryNonBlank(query, 'query');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > this.maxResults) {
      throw new RagBoundaryContractError(`limit must be an integer from 1 through ${this.maxResults}`);
    }
    await this.authorize('retrieve');
    const request = Object.freeze({
      query: validatedQuery,
      limit,
      scope: this.scope,
    });
    const matches = await this.store.retrieve(request);
    if (!Array.isArray(matches) || matches.length > limit) {
      throw new RagBoundaryContractError('store returned an invalid number of retrieval matches');
    }
    return Object.freeze(matches.map((match, index) => this.match(match, `matches[${index}]`)));
  }

  /**
   * Creates tool according to the RagRetrievalBoundary contract.
   */
  createTool(options: RagRetrievalToolOptions): RegisteredTool {
    if (!options || typeof options !== 'object') {
      throw new RagBoundaryContractError('tool options must be an object');
    }
    const name = boundaryNonBlank(options.name, 'tool name');
    const description = options.description === undefined
      ? 'Retrieve authorized knowledge chunks from an explicit host-provided RAG store.'
      : boundaryNonBlank(options.description, 'tool description');
    const parameters = Object.freeze({
      type: 'object',
      additionalProperties: false,
      required: Object.freeze(['query']),
      properties: Object.freeze({
        query: Object.freeze({ type: 'string', minLength: 1 }),
        limit: Object.freeze({ type: 'integer', minimum: 1, maximum: this.maxResults }),
      }),
    });
    return Object.freeze({
      name,
      description,
      parameters,
      execute: async (args: Record<string, unknown>) => await this.retrieve(
        args.query as string,
        args.limit === undefined ? this.maxResults : args.limit as number,
      ),
    });
  }

  /**
   * Authorizes according to the RagRetrievalBoundary contract.
   */
  private async authorize(operation: 'index' | 'retrieve', itemCount?: number): Promise<void> {
    const request: RagAuthorizationRequest = Object.freeze({
      operation,
      namespace: this.scope.namespace,
      access_levels: this.scope.accessLevels,
      sensitivities: this.scope.sensitivities,
      ...(itemCount === undefined ? {} : { item_count: itemCount }),
    });
    if (await this.authorization.authorize(request) !== true) {
      throw new RagAuthorizationError(operation);
    }
  }

  /**
   * Reports whether the requested operation.
   */
  private match(value: RagRetrievalMatch, label: string): RagRetrievalMatch {
    if (!value || typeof value !== 'object' || typeof value.score !== 'number' || !Number.isFinite(value.score)) {
      throw new RagBoundaryContractError(`${label} must contain a finite score and chunk`);
    }
    return Object.freeze({ chunk: this.chunk(value.chunk, `${label}.chunk`), score: value.score });
  }

  /**
   * Handles chunk according to the RagRetrievalBoundary contract.
   */
  private chunk(value: RagChunk, label: string): RagChunk {
    if (!value || typeof value !== 'object') {
      throw new RagBoundaryContractError(`${label} must be an object`);
    }
    const metadata = chunkMetadata(value.metadata, `${label}.metadata`);
    if (metadata.namespace !== this.scope.namespace
      || !this.accessLevels.has(metadata.access_level)
      || !this.sensitivities.has(metadata.sensitivity)) {
      throw new RagBoundaryContractError(`${label} is outside the server-owned retrieval scope`);
    }
    return Object.freeze({
      id: boundaryNonBlank(value.id, `${label}.id`),
      content: boundaryNonBlank(value.content, `${label}.content`),
      metadata,
    });
  }
}

export type {
  CreateRagChunkMetadataInput,
  RagAuthorizationPort,
  RagAuthorizationRequest,
  RagChunk,
  RagChunkMetadata,
  RagRetrievalBoundaryOptions,
  RagRetrievalMatch,
  RagRetrievalScope,
  RagRetrievalToolFactory,
  RagRetrievalToolOptions,
  RagStorePort,
  RagStoreRetrievalRequest,
} from '../../contracts/rag/index.js';

function scope(value: RagRetrievalScope): RagRetrievalScope {
  if (!value || typeof value !== 'object') {
    throw new RagBoundaryContractError('scope must be an object');
  }
  return Object.freeze({
    namespace: boundaryNonBlank(value.namespace, 'scope.namespace'),
    accessLevels: labels(value.accessLevels, 'scope.accessLevels'),
    sensitivities: labels(value.sensitivities, 'scope.sensitivities'),
  });
}

function labels(value: readonly string[], label: string): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new RagBoundaryContractError(`${label} must contain at least one label`);
  }
  const normalized = value.map((item, index) => boundaryNonBlank(item, `${label}[${index}]`));
  if (new Set(normalized).size !== normalized.length) {
    throw new RagBoundaryContractError(`${label} must not contain duplicates`);
  }
  return Object.freeze([...normalized].sort());
}

function chunkMetadata(value: RagChunkMetadata, label: string): RagChunkMetadata {
  if (!value || typeof value !== 'object' || value.schema !== RAG_CHUNK_METADATA_SCHEMA) {
    throw new RagBoundaryContractError(`${label} must use ${RAG_CHUNK_METADATA_SCHEMA}`);
  }
  return Object.freeze({
    schema: RAG_CHUNK_METADATA_SCHEMA,
    namespace: boundaryNonBlank(value.namespace, `${label}.namespace`),
    chunk_type: boundaryNonBlank(value.chunk_type, `${label}.chunk_type`),
    field: boundaryNonBlank(value.field, `${label}.field`),
    version: boundaryNonBlank(value.version, `${label}.version`),
    access_level: boundaryNonBlank(value.access_level, `${label}.access_level`),
    sensitivity: boundaryNonBlank(value.sensitivity, `${label}.sensitivity`),
    updated_at: boundaryTimestamp(value.updated_at, `${label}.updated_at`),
    author: boundaryNonBlank(value.author, `${label}.author`),
    ...(value.attributes === undefined ? {} : { attributes: cloneBoundaryAttributes(value.attributes, `${label}.attributes`) }),
  });
}

function cloneBoundaryAttributes(value: JsonObject, label: string): JsonObject {
  return cloneFrozenJsonObject(
    value,
    label,
    message => new RagBoundaryContractError(message),
  ) as JsonObject;
}

function boundaryTimestamp(value: string, label: string): string {
  try {
    return canonicalTimestamp(value, label);
  }
  catch (cause) {
    throw new RagBoundaryContractError(`${label} must be a canonical UTC ISO 8601 timestamp`, { cause });
  }
}

function boundaryNonBlank(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new RagBoundaryContractError(`${label} must be a non-blank string`);
  }
  return value;
}

function nonBlank(value: string, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new RagMetadataContractError(`${path} must be a non-blank string`);
  }
  return value;
}

function canonicalTimestamp(value: string, path: string): string {
  nonBlank(value, path);
  const parsed = new Date(value);
  if (
    !CANONICAL_TIMESTAMP.test(value)
    || Number.isNaN(parsed.getTime())
    || parsed.toISOString() !== value
  ) {
    throw new RagMetadataContractError(`${path} must be a canonical UTC ISO 8601 timestamp`);
  }
  return value;
}

function cloneAttributes(value: JsonObject): JsonObject {
  return cloneFrozenJsonObject(
    value,
    'attributes',
    message => new RagMetadataContractError(message),
  ) as JsonObject;
}
