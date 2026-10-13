/**
 * Implements anthropic behavior for the providers plugin.
 */

import { MultimodalNotSupportedError } from '../../../../../../core/contracts/errors/index.js';
import type { ResolvedAttachment } from '../../../../../../core/contracts/multimodal/index.js';
import type {
  FileContentPart,
  GenerateRequest,
  GenerateResponse,
  ImageContentPart,
} from '../../../../../../core/contracts/types/index.js';
import { buildAnthropicRequestBody, parseAnthropicResponse } from './codec.js';
import { AnthropicFileStore } from './files.js';
import {
  assertImageSupported,
  HttpTransport,
  objectValue,
  uniqueStrings,
  type Fetcher,
} from '../../../../providers.js';
import type { ProviderServices } from '../../../../providers.js';

const ANTHROPIC_FILES_BETA = 'files-api-2025-04-14';

/**
 * Provides anthropic operations through a stable contract.
 */
export class AnthropicProvider {
  readonly name = 'anthropic';
  readonly supportsTools = true;
  readonly supportsMultimodal = true;
  private readonly transport: HttpTransport;
  private readonly files: AnthropicFileStore;

  /**
   * Creates a AnthropicProvider and establishes its initial state.
   */
  constructor(
    readonly model: string,
    private readonly apiKey: string,
    private readonly maxOutputTokens: number,
    private readonly enableFilesApi: boolean,
    private readonly services: ProviderServices,
    private readonly fetcher: Fetcher = globalThis.fetch,
    timeout = 60,
  ) {
    this.transport = new HttpTransport(this.name, services, this.fetcher, timeout);
    this.files = new AnthropicFileStore(
      services,
      this.fetcher,
      (url, init) => this.transport.request(url, init),
      (url, init) => this.transport.requestJson(url, init),
      () => this.headers(true),
    );
  }

  /** Reports whether the provider accepts visual content. */
  supportsVision(): boolean { return true; }

  /** Reports whether the provider accepts file attachments. */
  supportsFileInput(): boolean { return true; }

  /**
   * Returns model list from the AnthropicProvider state.
   */
  async getModelList(signal?: AbortSignal): Promise<string[]> {
    try {
      const data = objectValue(
        await this.transport.getJson(
          'https://api.anthropic.com/v1/models',
          this.headers(),
          signal,
        ),
      );
      const models = Array.isArray(data.data)
        ? data.data
            .map(item => objectValue(item).id)
            .filter((id): id is string => typeof id === 'string')
        : [];
      return uniqueStrings(models.length ? models : [this.model]);
    } catch {
      return [this.model];
    }
  }

  /**
   * Creates the requested operation according to the AnthropicProvider contract.
   */
  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    const body = await buildAnthropicRequestBody(
      request,
      this.model,
      this.maxOutputTokens,
      part => this.toAnthropicAttachment(part, request.model ?? this.model),
      this.services.multimodal,
    );
    const raw = await this.transport.postJson(
      'https://api.anthropic.com/v1/messages',
      this.headers(this.enableFilesApi),
      body,
      request.signal,
    );
    return parseAnthropicResponse(raw);
  }

  /**
   * Releases resources owned by the AnthropicProvider.
   */
  async close(): Promise<void> {
    await this.files.close();
  }

  /**
   * Handles headers according to the AnthropicProvider contract.
   */
  private headers(filesBeta = false): Record<string, string> {
    return {
      'x-api-key': this.apiKey,
      'anthropic-version': '2023-06-01',
      ...(filesBeta ? { 'anthropic-beta': ANTHROPIC_FILES_BETA } : {}),
    };
  }

  /**
   * Handles to anthropic attachment according to the AnthropicProvider contract.
   */
  private async toAnthropicAttachment(
    part: ImageContentPart | FileContentPart,
    model: string,
  ): Promise<Record<string, unknown>> {
    const attachment = await this.services.multimodal.resolveAttachment(part, this.fetcher);
    if (part.type === 'image') return this.toAnthropicImage(attachment);
    if (attachment.fileId) return anthropicDocumentFile(attachment.fileId);
    if (attachment.mediaType === 'application/pdf') {
      return this.toAnthropicPdf(attachment, model);
    }
    if (isTextMime(attachment.mediaType)) return this.toAnthropicText(attachment);
    throw new MultimodalNotSupportedError(
      `Anthropic does not support ${attachment.mediaType} as a document input; convert it to text or PDF.`,
    );
  }

  /**
   * Handles to anthropic image according to the AnthropicProvider contract.
   */
  private async toAnthropicImage(
    attachment: ResolvedAttachment,
  ): Promise<Record<string, unknown>> {
    assertImageSupported(attachment, this.name);
    if (attachment.fileId) {
      return { type: 'image', source: { type: 'file', file_id: attachment.fileId } };
    }
    if (attachment.url) {
      return { type: 'image', source: { type: 'url', url: attachment.url } };
    }
    return {
      type: 'image',
      source: {
        type: 'base64',
        media_type: attachment.mediaType,
        data: Buffer.from(
          await this.services.multimodal.attachmentBytes(attachment, this.fetcher),
        ).toString('base64'),
      },
    };
  }

  /**
   * Handles to anthropic pdf according to the AnthropicProvider contract.
   */
  private async toAnthropicPdf(
    attachment: ResolvedAttachment,
    model: string,
  ): Promise<Record<string, unknown>> {
    if (shouldUseAnthropicPdfTextFallback(model)) {
      const text = await this.services.multimodal.extractPdfText(attachment, this.fetcher);
      return { type: 'text', text: `Document ${attachment.filename}:\n\n${text}` };
    }
    if (attachment.url) {
      return { type: 'document', source: { type: 'url', url: attachment.url } };
    }
    if (this.enableFilesApi && !attachment.source.startsWith('data:')) {
      return anthropicDocumentFile((await this.files.upload(attachment)).id);
    }
    return {
      type: 'document',
      source: {
        type: 'base64',
        media_type: 'application/pdf',
        data: Buffer.from(
          await this.services.multimodal.attachmentBytes(attachment, this.fetcher),
        ).toString('base64'),
      },
    };
  }

  /**
   * Handles to anthropic text according to the AnthropicProvider contract.
   */
  private async toAnthropicText(
    attachment: ResolvedAttachment,
  ): Promise<Record<string, unknown>> {
    if (this.enableFilesApi && !attachment.source.startsWith('data:') && !attachment.url) {
      return anthropicDocumentFile((await this.files.upload({
        ...attachment,
        mediaType: 'text/plain',
      })).id);
    }
    const bytes = await this.services.multimodal.attachmentBytes(attachment, this.fetcher);
    return {
      type: 'text',
      text: `Document ${attachment.filename}:\n\n${Buffer.from(bytes).toString('utf8')}`,
    };
  }
}

function anthropicDocumentFile(fileId: string): Record<string, unknown> {
  return { type: 'document', source: { type: 'file', file_id: fileId } };
}

/**
 * Reports whether use anthropic pdf text fallback.
 */
export function shouldUseAnthropicPdfTextFallback(model: string): boolean {
  return /(?:claude-3-haiku-20240307|claude-2|claude-instant)/i.test(model);
}

function isTextMime(mediaType: string): boolean {
  return mediaType.startsWith('text/')
    || mediaType === 'application/json'
    || mediaType === 'application/xml';
}
