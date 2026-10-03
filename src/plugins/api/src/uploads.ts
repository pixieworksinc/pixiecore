/**
 * Implements uploads behavior for the api plugin.
 */

import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { ApiError } from './errors.js';
import type { ExecuteRequest } from './types.js';

/** Request-scoped upload ownership for the API core plugin. */

interface DecodedUpload {
  readonly field: string;
  readonly filename: string;
  readonly bytes: Buffer;
}

/**
 * Encapsulates api upload session behavior and lifecycle.
 */
export class ApiUploadSession {
  private readonly uploads: readonly DecodedUpload[];
  private temporaryDirectory: string | undefined;

  /**
   * Creates a ApiUploadSession and establishes its initial state.
   */
  constructor(
    files: ExecuteRequest['files'],
    maxFileSize: number,
    private readonly tempRoot?: string,
  ) {
    this.uploads = decodeUploads(files, maxFileSize);
  }

  /**
   * Materializes according to the ApiUploadSession contract.
   */
  async materialize(): Promise<Record<string, string | string[]>> {
    if (this.uploads.length === 0) return {};
    this.temporaryDirectory = await mkdtemp(join(this.tempRoot ?? tmpdir(), 'pixiecore-'));
    const grouped = new Map<string, string[]>();
    for (const upload of this.uploads) {
      const filename = `${randomUUID()}-${safeFilename(upload.filename)}`;
      const path = join(this.temporaryDirectory, filename);
      await writeFile(path, upload.bytes, { mode: 0o600 });
      const paths = grouped.get(upload.field) ?? [];
      paths.push(path);
      grouped.set(upload.field, paths);
    }
    return Object.fromEntries(
      [...grouped].map(([field, paths]) => [field, paths.length === 1 ? paths[0]! : paths]),
    );
  }

  /**
   * Releases resources owned by the ApiUploadSession.
   */
  async close(): Promise<void> {
    if (!this.temporaryDirectory) return;
    const directory = this.temporaryDirectory;
    this.temporaryDirectory = undefined;
    await rm(directory, { recursive: true, force: true });
  }
}

function decodeUploads(files: ExecuteRequest['files'], maxFileSize: number): DecodedUpload[] {
  const result: DecodedUpload[] = [];
  for (const [field, uploads] of Object.entries(files ?? {})) {
    for (const upload of uploads) {
      const bytes = decodeBase64(upload.content);
      if (bytes.length > maxFileSize) {
        throw new ApiError(
          'file_upload_error',
          `File "${upload.filename}" exceeds ${maxFileSize} bytes`,
          400,
        );
      }
      result.push({ field, filename: upload.filename, bytes });
    }
  }
  return result;
}

function decodeBase64(value: string): Buffer {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new ApiError('file_upload_error', 'Invalid base64 content', 400);
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) {
    throw new ApiError('file_upload_error', 'Invalid base64 content', 400);
  }
  return bytes;
}

function safeFilename(value: string): string {
  const normalized = basename(value.replaceAll('\0', ''))
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 180);
  return normalized || 'upload.bin';
}
