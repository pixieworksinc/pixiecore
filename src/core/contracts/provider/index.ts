/**
 * Defines provider support contracts shared across PixieCore boundaries.
 */

import type { LoggingServicePort } from '../logging/index.js';
import type { MultimodalServicePort } from '../multimodal/index.js';
import type { Provider } from '../types/index.js';

/**
 * Defines the supported provider fetcher values.
 */
export type ProviderFetcher = typeof globalThis.fetch;
/**
 * Defines the supported provider header factory values.
 */
export type ProviderHeaderFactory = () => Promise<Record<string, string>>;

/** Runtime services shared by bundled provider families. */
export interface ProviderRuntimeServices {
  readonly logging: LoggingServicePort;
  readonly multimodal: MultimodalServicePort;
}

/** Declares capabilities exposed by an OpenAI-compatible route. */
export interface OpenAICompatibleProviderCapabilities {
  readonly tools: boolean;
  readonly vision: boolean;
  readonly fileInput: boolean;
}

/**
 * Describes the open ai compatible provider config contract.
 */
export interface OpenAICompatibleProviderConfig {
  readonly name: string;
  readonly model: string;
  readonly completionUrl: string;
  readonly modelsUrl?: string;
  readonly headers: ProviderHeaderFactory;
  readonly modelListFallback?: readonly string[];
  /** Overrides capabilities when a gateway route exposes only a subset. */
  readonly capabilities?: OpenAICompatibleProviderCapabilities;
  /** Overrides network transport for testing or host-managed HTTP policy. */
  readonly fetch?: ProviderFetcher;
  readonly timeout?: number;
}

/** Internal parent-plugin service used by OpenAI-compatible provider families. */
export interface ProviderSupportServicePort {
  /**
   * Creates open ai compatible after validating the supplied contract.
   */
  createOpenAICompatible(config: OpenAICompatibleProviderConfig): Provider;
  /**
   * Joins url for the owning PixieCore boundary.
   */
  joinUrl(baseUrl: string, path: string, query?: Readonly<Record<string, string>>): string;
}
