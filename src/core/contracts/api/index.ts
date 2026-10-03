/**
 * Defines api contracts shared across PixieCore boundaries.
 */

import type { IncomingMessage, Server } from 'node:http';
import type {
  LoggerPort,
  LoggingOptions,
} from '../logging/index.js';
import type { ExecuteOptions, RuntimeOptions } from '../types/index.js';

/**
 * Describes the api message contract.
 */
export interface ApiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Describes the api uploaded file contract.
 */
export interface ApiUploadedFile {
  filename: string;
  content: string;
}

/** Authentication result constructed by trusted server-side code. */
export interface ApiCallerIdentity {
  readonly role?: string;
  readonly userId?: string;
  readonly scopes?: readonly string[];
}

/** Resolves an authenticated caller from request metadata, never from its body. */
export type ApiCallerResolver = (
  request: IncomingMessage,
) => ApiCallerIdentity | undefined | Promise<ApiCallerIdentity | undefined>;

/**
 * Describes the execute request contract.
 */
export interface ExecuteRequest {
  blueprint: string;
  inputs?: Record<string, unknown>;
  messages?: ApiMessage[];
  files?: {
    file_path?: ApiUploadedFile[];
    image_path?: ApiUploadedFile[];
  };
}

/**
 * Describes the api runtime contract.
 */
export interface ApiRuntime {
  readonly providerName: string;
  readonly model: string;
  /**
   * Executes yaml through its public boundary.
   */
  executeYaml(
    yaml: string,
    inputs?: Record<string, unknown>,
    options?: ExecuteOptions,
  ): Promise<Record<string, unknown>>;
  /**
   * Releases resources owned by the implementation.
   */
  close(): void | Promise<void>;
}

/**
 * Configures api behavior.
 */
export interface ApiOptions<Logger extends LoggerPort = LoggerPort> extends RuntimeOptions {
  runtime?: ApiRuntime;
  apiLogger?: Logger;
  maxFileSize?: number;
  maxRequestSize?: number;
  corsOrigins?: readonly string[];
  tempRoot?: string;
  callerResolver?: ApiCallerResolver;
  /** Remote conversation roles accepted from the request body. Defaults to `user`. */
  remoteMessageRoles?: readonly ApiMessage['role'][];
}

/**
 * Describes the type core api server contract.
 */
export interface PixieCoreApiServer<Logger extends LoggerPort = LoggerPort> extends Server {
  readonly runtime: ApiRuntime;
  readonly apiLogger: Logger;
  /**
   * Closes resources for the owning PixieCore boundary.
   */
  closeResources(): Promise<void>;
}

/**
 * Carries api request state across a boundary.
 */
export interface ApiRequestContext<Logger extends LoggerPort = LoggerPort> {
  readonly runtime: ApiRuntime;
  readonly apiLogger: Logger;
  readonly maxFileSize: number;
  readonly maxRequestSize: number;
  readonly corsOrigins: readonly string[];
  readonly tempRoot?: string;
  readonly callerResolver?: ApiCallerResolver;
  readonly remoteMessageRoles: ReadonlySet<ApiMessage['role']>;
}

/** Composition supplied by a public facade after it has selected one runtime scope. */
export interface ApiServerCompositionPort {
  readonly environment: NodeJS.ProcessEnv;
  readonly runtime: ApiRuntime;
  /** Resolves logging configuration for the selected runtime scope. */
  readonly getLoggingConfig: (
    options: RuntimeOptions,
    environment: NodeJS.ProcessEnv,
  ) => LoggingOptions;
  /** Present only when the selected runtime does not own the bootstrap scope. */
  readonly closeBootstrap?: () => void | Promise<void>;
}

/** Stateless HTTP server factory registered by the API core plugin. */
export interface ApiServicePort {
  /**
   * Creates server after validating the supplied contract.
   */
  createServer(
    options: ApiOptions,
    composition: ApiServerCompositionPort,
  ): PixieCoreApiServer;
}
