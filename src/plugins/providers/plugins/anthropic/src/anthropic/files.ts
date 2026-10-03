/**
 * Implements files behavior for the providers plugin.
 */

import { LLMAPIError } from '../../../../../../core/contracts/errors/index.js';
import type { ResolvedAttachment } from '../../../../../../core/contracts/multimodal/index.js';
import { objectValue, type Fetcher, type ProviderServices } from '../../../../providers.js';

interface UploadedAnthropicFile {
  readonly id: string;
}

type Request = (url: string, init: RequestInit) => Promise<Response>;
type RequestJson = (url: string, init: RequestInit) => Promise<unknown>;

/**
 * Encapsulates anthropic file store behavior and lifecycle.
 */
export class AnthropicFileStore {
  private readonly uploaded = new Map<string, Promise<UploadedAnthropicFile>>();
  private readonly uploadedIds = new Set<string>();

  /**
   * Creates a AnthropicFileStore and establishes its initial state.
   */
  constructor(
    private readonly services: ProviderServices,
    private readonly fetcher: Fetcher,
    private readonly request: Request,
    private readonly requestJson: RequestJson,
    private readonly headers: () => Record<string, string>,
  ) {}

  /**
   * Uploads according to the AnthropicFileStore contract.
   */
  upload(attachment: ResolvedAttachment): Promise<UploadedAnthropicFile> {
    const key = `${attachment.mediaType}:${attachment.source}`;
    const existing = this.uploaded.get(key);
    if (existing) return existing;
    const upload = this.performUpload(attachment);
    this.uploaded.set(key, upload);
    upload.catch(() => this.uploaded.delete(key));
    return upload;
  }

  /**
   * Releases resources owned by the AnthropicFileStore.
   */
  async close(): Promise<void> {
    await Promise.all([...this.uploadedIds].map(async id => {
      try {
        await this.request(`https://api.anthropic.com/v1/files/${encodeURIComponent(id)}`, {
          method: 'DELETE',
          headers: this.headers(),
        });
      } catch { /* Best-effort cleanup for files uploaded by this instance. */ }
    }));
    this.uploaded.clear();
    this.uploadedIds.clear();
  }

  /**
   * Performs upload according to the AnthropicFileStore contract.
   */
  private async performUpload(attachment: ResolvedAttachment): Promise<UploadedAnthropicFile> {
    const bytes = await this.services.multimodal.attachmentBytes(attachment, this.fetcher);
    const form = new FormData();
    form.append(
      'file',
      new Blob([Buffer.from(bytes)], { type: attachment.mediaType }),
      attachment.filename,
    );
    const data = objectValue(await this.requestJson(
      'https://api.anthropic.com/v1/files',
      {
        method: 'POST',
        headers: this.headers(),
        body: form,
      },
    ));
    if (typeof data.id !== 'string') {
      throw new LLMAPIError('anthropic Files API response did not include a file ID');
    }
    this.uploadedIds.add(data.id);
    return { id: data.id };
  }
}
