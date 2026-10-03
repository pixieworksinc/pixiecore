/**
 * Defines multimodal contracts shared across PixieCore boundaries.
 */

import type {
  FileContentPart,
  ImageContentPart,
  Message,
  MessageContent,
  MessageContentPart,
  Provider,
} from '../types/index.js';

/** Public normalized attachment value shared across multimodal consumers. */
export interface ResolvedAttachment {
  readonly kind: 'image' | 'file';
  readonly source: string;
  readonly mediaType: string;
  readonly filename: string;
  readonly data?: Uint8Array;
  readonly dataUrl?: string;
  readonly url?: string;
  readonly fileId?: string;
  readonly detail?: 'auto' | 'low' | 'high';
}

/**
 * Describes the parsed data url contract.
 */
export interface ParsedDataUrl {
  readonly mediaType: string;
  readonly data: Uint8Array;
}

/** Scope-local multimodal capabilities supplied by the multimodal core plugin. */
export interface MultimodalServicePort {
  /**
   * Resolves an attachment into validated bytes and metadata.
   */
  resolveAttachment(
    part: ImageContentPart | FileContentPart,
    fetcher?: typeof globalThis.fetch,
  ): Promise<ResolvedAttachment>;
  /**
   * Returns immutable bytes for a resolved attachment.
   */
  attachmentBytes(
    attachment: ResolvedAttachment,
    fetcher?: typeof globalThis.fetch,
  ): Promise<Uint8Array>;
  /**
   * Enhances messages with multimodal for the owning PixieCore boundary.
   */
  enhanceMessagesWithMultimodal(
    messages: readonly Message[],
    inputs: Readonly<Record<string, unknown>>,
    provider: Provider,
  ): Message[];
  /**
   * Returns normalized multimodal content parts.
   */
  contentParts(content: MessageContent): MessageContentPart[];
  /**
   * Returns the text represented by normalized content parts.
   */
  contentText(content: MessageContent): string;
  /**
   * Normalizes attachment input while preserving caller-owned input.
   */
  normalizeAttachmentInput(
    value: unknown,
    name: 'image_path' | 'file_path',
  ): string[];
  /**
   * Encodes bytes as a validated data URL.
   */
  makeDataUrl(mediaType: string, data: Uint8Array): string;
  /**
   * Infers a supported MIME type from a file name.
   */
  mimeFromName(name: string, kind: 'image' | 'file'): string;
  /**
   * Decodes and validates a data URL.
   */
  parseDataUrl(value: string): ParsedDataUrl | undefined;
  /**
   * Extracts ordered text content from a PDF attachment.
   */
  extractPdfText(
    attachment: ResolvedAttachment,
    fetcher?: typeof globalThis.fetch,
  ): Promise<string>;
}
