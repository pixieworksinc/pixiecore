/**
 * Defines rag contracts shared across PixieCore boundaries.
 */

import type { JsonObject, RegisteredTool } from '../types/index.js';

/**
 * Describes the rag chunk metadata contract.
 */
export interface RagChunkMetadata {
  readonly schema: 'pixiecore.rag-chunk-metadata/v1';
  readonly namespace: string;
  readonly chunk_type: string;
  readonly field: string;
  readonly version: string;
  readonly access_level: string;
  readonly sensitivity: string;
  readonly updated_at: string;
  readonly author: string;
  readonly attributes?: JsonObject;
}

/**
 * Supplies the input required to create create rag chunk metadata.
 */
export interface CreateRagChunkMetadataInput {
  readonly namespace: string;
  readonly chunkType: string;
  readonly field: string;
  readonly version: string;
  readonly accessLevel: string;
  readonly sensitivity: string;
  readonly updatedAt: string;
  readonly author: string;
  readonly attributes?: JsonObject;
}

/**
 * Describes the rag chunk contract.
 */
export interface RagChunk {
  readonly id: string;
  readonly content: string;
  readonly metadata: RagChunkMetadata;
}

/**
 * Describes the rag retrieval scope contract.
 */
export interface RagRetrievalScope {
  readonly namespace: string;
  readonly accessLevels: readonly string[];
  readonly sensitivities: readonly string[];
}

/**
 * Describes the rag authorization request contract.
 */
export interface RagAuthorizationRequest {
  readonly operation: 'index' | 'retrieve';
  readonly namespace: string;
  readonly access_levels: readonly string[];
  readonly sensitivities: readonly string[];
  readonly item_count?: number;
}

/**
 * Defines the rag authorization boundary implemented by adapters.
 */
export interface RagAuthorizationPort {
  /**
   * Checks whether the current principal may access the requested resource.
   */
  authorize(request: RagAuthorizationRequest): boolean | Promise<boolean>;
}

/**
 * Describes the rag store retrieval request contract.
 */
export interface RagStoreRetrievalRequest {
  readonly query: string;
  readonly limit: number;
  readonly scope: RagRetrievalScope;
}

/**
 * Describes the rag retrieval match contract.
 */
export interface RagRetrievalMatch {
  readonly chunk: RagChunk;
  readonly score: number;
}

/**
 * Defines the rag store boundary implemented by adapters.
 */
export interface RagStorePort {
  /**
   * Indexes the supplied content through the owning storage boundary.
   */
  index(chunks: readonly RagChunk[]): void | Promise<void>;
  /**
   * Retrieves authorized content for the supplied query.
   */
  retrieve(request: RagStoreRetrievalRequest): readonly RagRetrievalMatch[] | Promise<readonly RagRetrievalMatch[]>;
}

/**
 * Configures rag retrieval boundary behavior.
 */
export interface RagRetrievalBoundaryOptions {
  readonly store: RagStorePort;
  readonly authorization: RagAuthorizationPort;
  readonly scope: RagRetrievalScope;
  readonly maxResults?: number;
}

/**
 * Configures rag retrieval tool behavior.
 */
export interface RagRetrievalToolOptions {
  readonly name: string;
  readonly description?: string;
}

/**
 * Describes the rag retrieval tool factory contract.
 */
export interface RagRetrievalToolFactory {
  /**
   * Creates tool after validating the supplied contract.
   */
  createTool(options: RagRetrievalToolOptions): RegisteredTool;
}
