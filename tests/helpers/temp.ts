import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function withTempDirectory<T>(task: (path: string) => T | Promise<T>, prefix = 'pixiecore-test-'): Promise<T> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  try { return await task(path); }
  finally { await rm(path, { recursive: true, force: true }); }
}
