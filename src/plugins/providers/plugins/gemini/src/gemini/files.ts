/**
 * Implements files behavior for the providers plugin.
 */

import { LLMAPIError } from '../../../../../../core/contracts/errors/index.js';
import type { ResolvedAttachment } from '../../../../../../core/contracts/multimodal/index.js';
import { objectValue } from '../../../../providers.js';
import { geminiUploadUrl, geminiUrl } from './urls.js';

interface UploadedGeminiFile {
  readonly name?: string;
  readonly uri: string;
  readonly mediaType: string;
}

type Request = (url: string, init: RequestInit) => Promise<Response>;
type RequestJson = (url: string, init: RequestInit) => Promise<unknown>;

/**
 * Encapsulates gemini file store behavior and lifecycle.
 */
export class GeminiFileStore {
  private readonly uploaded = new Map<string, Promise<UploadedGeminiFile>>();
  private readonly uploadedNames = new Set<string>();

  /**
   * Creates a GeminiFileStore and establishes its initial state.
   */
  constructor(
    private readonly apiKey: string,
    private readonly request: Request,
    private readonly requestJson: RequestJson,
  ) {}

  /**
   * Uploads according to the GeminiFileStore contract.
   */
  upload(
    attachment: ResolvedAttachment,
    bytes: Uint8Array,
  ): Promise<UploadedGeminiFile> {
    const key = `${attachment.mediaType}:${attachment.source}`;
    const existing = this.uploaded.get(key);
    if (existing) return existing;
    const upload = this.performUpload(attachment, bytes);
    this.uploaded.set(key, upload);
    upload.catch(() => this.uploaded.delete(key));
    return upload;
  }

  /**
   * Releases resources owned by the GeminiFileStore.
   */
  async close(): Promise<void> {
    await Promise.all([...this.uploadedNames].map(async name => {
      try {
        await this.request(geminiUrl(name, this.apiKey), { method: 'DELETE' });
      } catch { /* Best-effort cleanup for files uploaded by this instance. */ }
    }));
    this.uploaded.clear();
    this.uploadedNames.clear();
  }

  /**
   * Performs upload according to the GeminiFileStore contract.
   */
  private async performUpload(
    attachment: ResolvedAttachment,
    bytes: Uint8Array,
  ): Promise<UploadedGeminiFile> {
    const started = await this.request(geminiUploadUrl(this.apiKey), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-upload-protocol': 'resumable',
        'x-goog-upload-command': 'start',
        'x-goog-upload-header-content-length': String(bytes.byteLength),
        'x-goog-upload-header-content-type': attachment.mediaType,
      },
      body: JSON.stringify({ file: { display_name: attachment.filename } }),
    });
    const uploadUrl = started.headers.get('x-goog-upload-url');
    if (!uploadUrl) {
      throw new LLMAPIError('gemini_native Files API did not return an upload URL');
    }
    const data = objectValue(await this.requestJson(uploadUrl, {
      method: 'POST',
      headers: {
        'content-length': String(bytes.byteLength),
        'x-goog-upload-offset': '0',
        'x-goog-upload-command': 'upload, finalize',
      },
      body: Buffer.from(bytes),
    }));
    const file = objectValue(data.file ?? data);
    if (typeof file.uri !== 'string') {
      throw new LLMAPIError('gemini_native Files API response did not include a file URI');
    }
    const uploadedFile: UploadedGeminiFile = {
      ...(typeof file.name === 'string' ? { name: file.name } : {}),
      uri: file.uri,
      mediaType: typeof file.mimeType === 'string' ? file.mimeType : attachment.mediaType,
    };
    if (uploadedFile.name) this.uploadedNames.add(uploadedFile.name);
    return uploadedFile;
  }
}
