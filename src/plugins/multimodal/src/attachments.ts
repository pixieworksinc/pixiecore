/**
 * Implements attachments behavior for the multimodal plugin.
 */

import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { InputValidationError } from '../../../core/contracts/errors/index.js';
import type { ResolvedAttachment } from '../../../core/contracts/multimodal/index.js';
import type { FileContentPart, ImageContentPart } from '../../../core/contracts/types/index.js';
import {
  defaultMime,
  extensionForMime,
  isHttpUrl,
  isProviderFileId,
  makeDataUrl,
  mimeFromName,
  parseDataUrl,
} from './encoding.js';

/**
 * Resolves an attachment into validated bytes and metadata.
 */
export async function resolveAttachment(
  part: ImageContentPart | FileContentPart,
  fetcher: typeof globalThis.fetch = globalThis.fetch,
): Promise<ResolvedAttachment> {
  const kind = part.type;
  const source = part.source;
  if (!source) throw new InputValidationError(`${kind} attachment source cannot be empty`);

  if (isProviderFileId(source)) {
    const mediaType = part.mediaType ?? defaultMime(kind);
    return {
      kind,
      source,
      fileId: source,
      mediaType,
      filename: part.filename ?? `${kind}${extensionForMime(mediaType)}`,
      ...(kind === 'image' && part.detail ? { detail: part.detail } : {}),
    };
  }

  const parsed = parseDataUrl(source);
  if (parsed) {
    const mediaType = part.mediaType ?? parsed.mediaType;
    return {
      kind,
      source,
      mediaType,
      filename: part.filename ?? `${kind}${extensionForMime(mediaType)}`,
      data: parsed.data,
      dataUrl: source,
      ...(kind === 'image' && part.detail ? { detail: part.detail } : {}),
    };
  }

  if (isHttpUrl(source)) {
    const pathname = new URL(source).pathname;
    const mediaType = part.mediaType ?? mimeFromName(pathname, kind);
    return {
      kind,
      source,
      url: source,
      mediaType,
      filename: part.filename ?? (basename(pathname) || `${kind}${extensionForMime(mediaType)}`),
      ...(kind === 'image' && part.detail ? { detail: part.detail } : {}),
    };
  }

  try {
    const data = await readFile(source);
    const mediaType = part.mediaType ?? mimeFromName(source, kind);
    return {
      kind,
      source,
      mediaType,
      filename: part.filename ?? basename(source),
      data,
      dataUrl: makeDataUrl(mediaType, data),
      ...(kind === 'image' && part.detail ? { detail: part.detail } : {}),
    };
  } catch (cause) {
    throw new InputValidationError(
      `Unable to read ${kind} attachment: ${source}`,
      'input_validation_error',
      { cause },
    );
  }
}

/**
 * Returns immutable bytes for a resolved attachment.
 */
export async function attachmentBytes(
  attachment: ResolvedAttachment,
  fetcher: typeof globalThis.fetch = globalThis.fetch,
): Promise<Uint8Array> {
  if (attachment.data) return attachment.data;
  if (!attachment.url) {
    throw new InputValidationError(
      `Attachment ${attachment.source} does not contain readable data`,
    );
  }
  let response: Response;
  try {
    response = await fetcher(attachment.url);
  } catch (cause) {
    throw new InputValidationError(
      `Unable to fetch attachment: ${attachment.url}`,
      'input_validation_error',
      { cause },
    );
  }
  if (!response.ok) {
    throw new InputValidationError(
      `Unable to fetch attachment (${response.status}): ${attachment.url}`,
    );
  }
  return new Uint8Array(await response.arrayBuffer());
}
