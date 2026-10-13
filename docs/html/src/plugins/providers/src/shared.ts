/**
 * Implements shared behavior for the providers plugin.
 */

import { errorMessage } from '../../../core/component/diagnostics/index.js';
import { LLMAPIError, MultimodalNotSupportedError } from '../../../core/contracts/errors/index.js';
import type { ResolvedAttachment } from '../../../core/contracts/multimodal/index.js';
import type {
  ProviderFetcher as Fetcher,
  ProviderHeaderFactory as HeaderProvider,
  ProviderRuntimeServices as ProviderServices,
} from '../../../core/contracts/provider/index.js';

export type { Fetcher, HeaderProvider };

const SUPPORTED_IMAGE_MIMES = new Set(['image/gif', 'image/jpeg', 'image/png', 'image/webp']);

/**
 * Performs provider-neutral HTTP requests for a composed provider.
 */
export class HttpTransport {
  /** Creates a transport with provider-specific diagnostics and shared services. */
  constructor(
    private readonly providerName: string,
    private readonly services: ProviderServices,
    private readonly fetcher: Fetcher = globalThis.fetch,
    private readonly timeoutSeconds = 60,
  ) {}

  /** Sends an HTTP request with timeout, cancellation, and sanitized errors. */
  async request(url: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
    try {
      const timeout = AbortSignal.timeout(this.timeoutSeconds * 1000);
      const response = await this.fetcher(url, {
        ...init,
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      if (!response.ok) {
        const data = objectValue(await readResponseBody(response));
        const apiError = objectValue(data.error);
        const detail = this.services.logging.sanitizeLogMessage(
          String(apiError.message ?? data.message ?? response.statusText),
        );
        throw new LLMAPIError(`${this.providerName} API call failed (${response.status}): ${detail}`);
      }
      return response;
    } catch (error) {
      if (error instanceof LLMAPIError) throw error;
      const detail = this.services.logging.sanitizeLogMessage(errorMessage(error));
      throw new LLMAPIError(`${this.providerName} API call failed: ${detail}`, { cause: error });
    }
  }

  /** Sends an HTTP request and decodes its JSON response. */
  async requestJson(url: string, init: RequestInit, signal?: AbortSignal): Promise<unknown> {
    const response = await this.request(url, init, signal);
    const text = await response.text();
    if (!text) return {};
    try { return JSON.parse(text); }
    catch {
      throw new LLMAPIError(`${this.providerName} API response was not valid JSON`);
    }
  }

  /** Sends a JSON POST request. */
  postJson(url: string, headers: Record<string, string>, body: unknown, signal?: AbortSignal): Promise<unknown> {
    return this.requestJson(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }, signal);
  }

  /** Sends a JSON GET request. */
  getJson(url: string, headers: Record<string, string>, signal?: AbortSignal): Promise<unknown> {
    return this.requestJson(url, { method: 'GET', headers }, signal);
  }
}

/**
 * Validates image supported and rejects unsupported input.
 */
export function assertImageSupported(attachment: ResolvedAttachment, providerName: string): void {
  if (!SUPPORTED_IMAGE_MIMES.has(attachment.mediaType)) {
    throw new MultimodalNotSupportedError(`${providerName} does not support image format ${attachment.mediaType}.`);
  }
}

/**
 * Returns the value as an object when it has an object shape.
 */
export function objectValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/**
 * Parses args for the owning PixieCore boundary.
 */
export function parseArgs(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== 'string') return {};
  try { return objectValue(JSON.parse(value)); }
  catch { return {}; }
}

/**
 * Handles unique strings for the owning PixieCore boundary.
 */
export function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

async function readResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text); }
  catch { return { message: text }; }
}
