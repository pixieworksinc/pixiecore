/**
 * Implements encoding behavior for the multimodal plugin.
 */

import { extname } from 'node:path';
import { InputValidationError } from '../../../core/contracts/errors/index.js';

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.bmp': 'image/bmp',
  '.csv': 'text/csv',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.gif': 'image/gif',
  '.htm': 'text/html',
  '.html': 'text/html',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
  '.md': 'text/markdown',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.rtf': 'application/rtf',
  '.svg': 'image/svg+xml',
  '.text': 'text/plain',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.tsv': 'text/tab-separated-values',
  '.txt': 'text/plain',
  '.webp': 'image/webp',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xml': 'application/xml',
};

const EXTENSION_BY_MIME: Readonly<Record<string, string>> = {
  'application/json': '.json',
  'application/pdf': '.pdf',
  'image/gif': '.gif',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'text/csv': '.csv',
  'text/markdown': '.md',
  'text/plain': '.txt',
};

/**
 * Encodes bytes as a validated data URL.
 */
export function makeDataUrl(mediaType: string, data: Uint8Array): string {
  return `data:${mediaType};base64,${Buffer.from(data).toString('base64')}`;
}

/**
 * Infers a supported MIME type from a file name.
 */
export function mimeFromName(name: string, kind: 'image' | 'file'): string {
  return MIME_BY_EXTENSION[extname(name).toLowerCase()] ?? defaultMime(kind);
}

/**
 * Decodes and validates a data URL.
 */
export function parseDataUrl(
  value: string,
): { mediaType: string; data: Uint8Array } | undefined {
  if (!value.startsWith('data:')) return undefined;
  const comma = value.indexOf(',');
  if (comma < 0) {
    throw new InputValidationError('Attachment data URL must contain a data payload');
  }
  const metadata = value.slice(5, comma).split(';');
  const mediaType = metadata.shift()?.toLowerCase();
  if (!mediaType || !metadata.some(item => item.toLowerCase() === 'base64')) {
    throw new InputValidationError('Attachment data URL must use base64 encoding');
  }
  const encoded = value.slice(comma + 1).replace(/\s/g, '');
  if (!encoded || encoded.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    throw new InputValidationError('Attachment data URL contains invalid base64 data');
  }
  const data = Buffer.from(encoded, 'base64');
  if (data.toString('base64').replace(/=+$/, '') !== encoded.replace(/=+$/, '')) {
    throw new InputValidationError('Attachment data URL contains invalid base64 data');
  }
  return { mediaType, data };
}

/**
 * Handles default mime for the owning PixieCore boundary.
 */
export function defaultMime(kind: 'image' | 'file'): string {
  return kind === 'image' ? 'image/jpeg' : 'application/octet-stream';
}

/**
 * Handles extension for mime for the owning PixieCore boundary.
 */
export function extensionForMime(mediaType: string): string {
  return EXTENSION_BY_MIME[mediaType] ?? '';
}

/**
 * Reports whether http url.
 */
export function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

/**
 * Reports whether provider file id.
 */
export function isProviderFileId(value: string): boolean {
  return /^(?:file-|file_)[A-Za-z0-9_-]+$/.test(value);
}
