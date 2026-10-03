/**
 * Provides file tree bootstrapping behavior for PixieCore.
 */

import type { Dirent } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

interface CollectFilesOptions {
  readonly skipEntry?: (entry: Dirent, path: string) => boolean;
  readonly includeFile: (entry: Dirent, path: string) => boolean;
  readonly rejectSymbolicLink?: (path: string) => Error;
}

/** Deterministically walks one owned tree without following symbolic links. */
export async function collectFiles(
  rootPath: string,
  options: CollectFilesOptions,
): Promise<string[]> {
  const files: string[] = [];

  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (options.skipEntry?.(entry, path)) continue;
      if (entry.isSymbolicLink()) {
        if (options.rejectSymbolicLink) throw options.rejectSymbolicLink(path);
        continue;
      }
      if (entry.isDirectory()) {
        await visit(path);
        continue;
      }
      if (entry.isFile() && options.includeFile(entry, path)) files.push(path);
    }
  };

  await visit(rootPath);
  return files.sort((left, right) => (
    relative(rootPath, left).localeCompare(relative(rootPath, right))
  ));
}
