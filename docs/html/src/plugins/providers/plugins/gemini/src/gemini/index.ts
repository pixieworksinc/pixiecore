/**
 * Implements gemini behavior for the providers plugin.
 */

import type { ResolvedAttachment } from '../../../../../../core/contracts/multimodal/index.js';
import type {
  FileContentPart,
  GenerateRequest,
  GenerateResponse,
  ImageContentPart,
} from '../../../../../../core/contracts/types/index.js';
import { buildGeminiRequestBody, parseGeminiResponse } from './codec.js';
import { GeminiFileStore } from './files.js';
import { geminiUrl } from './urls.js';
import {
  assertImageSupported,
  HttpTransport,
  objectValue,
  uniqueStrings,
  type Fetcher,
} from '../../../../providers.js';
import type { ProviderServices } from '../../../../providers.js';

export const DEFAULT_GEMINI_INLINE_LIMIT = 20 * 1024 * 1024;

/**
 * Provides gemini operations through a stable contract.
 */
export class GeminiProvider {
  readonly name = 'gemini_native';
  readonly supportsTools = true;
  readonly supportsMultimodal = true;
  private readonly transport: HttpTransport;
  private readonly files: GeminiFileStore;

  /**
   * Creates a GeminiProvider and establishes its initial state.
   */
  constructor(
    readonly model: string,
    private readonly apiKey: string,
    private readonly inlineFileLimit: number,
    private readonly services: ProviderServices,
    private readonly fetcher: Fetcher = globalThis.fetch,
    timeout = 60,
  ) {
    this.transport = new HttpTransport(this.name, services, this.fetcher, timeout);
    this.files = new GeminiFileStore(
      this.apiKey,
      (url, init) => this.transport.request(url, init),
      (url, init) => this.transport.requestJson(url, init),
    );
  }

  /** Reports whether the provider accepts visual content. */
  supportsVision(): boolean { return true; }

  /** Reports whether the provider accepts file attachments. */
  supportsFileInput(): boolean { return true; }

  /**
   * Returns model list from the GeminiProvider state.
   */
  async getModelList(signal?: AbortSignal): Promise<string[]> {
    try {
      const data = objectValue(await this.transport.getJson(
        geminiUrl('models', this.apiKey),
        {},
        signal,
      ));
      const models = Array.isArray(data.models)
        ? data.models
            .map(item => objectValue(item).name)
            .filter((name): name is string => typeof name === 'string')
            .map((modelName: string) => modelName.replace(/^models\//, ''))
        : [];
      return uniqueStrings(models.length ? models : geminiFallbackModels(this.model));
    } catch {
      return geminiFallbackModels(this.model);
    }
  }

  /**
   * Creates the requested operation according to the GeminiProvider contract.
   */
  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    const body = await buildGeminiRequestBody(
      request,
      part => this.toGeminiAttachment(part),
      this.services.multimodal,
    );
    const url = geminiUrl(
      `models/${encodeURIComponent(request.model ?? this.model)}:generateContent`,
      this.apiKey,
    );
    const raw = await this.transport.postJson(url, {}, body, request.signal);
    return parseGeminiResponse(raw);
  }

  /**
   * Releases resources owned by the GeminiProvider.
   */
  async close(): Promise<void> {
    await this.files.close();
  }

  /**
   * Handles to gemini attachment according to the GeminiProvider contract.
   */
  private async toGeminiAttachment(
    part: ImageContentPart | FileContentPart,
  ): Promise<Record<string, unknown>> {
    const attachment = await this.services.multimodal.resolveAttachment(part, this.fetcher);
    if (part.type === 'image') assertImageSupported(attachment, this.name);
    if (attachment.url) {
      return { fileData: { mimeType: attachment.mediaType, fileUri: attachment.url } };
    }
    if (attachment.fileId) {
      return { fileData: { mimeType: attachment.mediaType, fileUri: attachment.fileId } };
    }
    const bytes = await this.services.multimodal.attachmentBytes(attachment, this.fetcher);
    if (bytes.byteLength <= this.inlineFileLimit) {
      return {
        inlineData: {
          mimeType: attachment.mediaType,
          data: Buffer.from(bytes).toString('base64'),
        },
      };
    }
    const uploaded = await this.files.upload(attachment, bytes);
    return { fileData: { mimeType: uploaded.mediaType, fileUri: uploaded.uri } };
  }
}

export { cleanGeminiSchema } from './codec.js';

function geminiFallbackModels(model: string): string[] {
  return uniqueStrings([model, 'gemini-2.5-flash', 'gemini-1.5-pro']);
}
