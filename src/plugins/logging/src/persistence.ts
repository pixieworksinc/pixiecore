/**
 * Implements persistence behavior for the logging plugin.
 */

import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import type { LogLevel } from './types.js';

/**
 * Creates every parent directory required by configured log destinations.
 */
export function ensureLogDirectories(paths: readonly string[]): void {
  for (const path of paths) mkdirSync(dirname(path), { recursive: true });
}

/**
 * Creates or updates log file for the owning PixieCore boundary.
 */
export function touchLogFile(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  closeSync(openSync(path, 'a', 0o600));
}

/**
 * Appends rotating for the owning PixieCore boundary.
 */
export function appendRotating(
  path: string,
  content: string,
  maxBytes: number,
  backupCount: number,
): void {
  const incoming = Buffer.byteLength(content);
  if (existsSync(path) && statSync(path).size + incoming > maxBytes) {
    rotate(path, backupCount);
  }
  appendFileSync(path, content, { encoding: 'utf8', mode: 0o600 });
}

/**
 * Writes console for the owning PixieCore boundary.
 */
export function writeConsole(level: LogLevel, line: string): void {
  if (level === 'CRITICAL' || level === 'ERROR') {
    console.error(line);
    return;
  }
  if (level === 'WARNING') {
    console.warn(line);
    return;
  }
  console.log(line);
}

function rotate(path: string, backupCount: number): void {
  if (backupCount === 0) {
    writeFileSync(path, '', { mode: 0o600 });
    return;
  }
  const oldest = `${path}.${backupCount}`;
  if (existsSync(oldest)) unlinkSync(oldest);
  for (let index = backupCount - 1; index >= 1; index--) {
    const source = `${path}.${index}`;
    if (existsSync(source)) renameSync(source, `${path}.${index + 1}`);
  }
  if (existsSync(path)) renameSync(path, `${path}.1`);
}
