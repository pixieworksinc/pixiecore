import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repositoryRoot = resolve('.');
const sourceCliPath = resolve('src/core/kernel/cli/index.ts');
const compiledCliPath = resolve('dist/core/kernel/cli/index.js');

/**
 * Returns the Node.js arguments for a process-isolated CLI test.
 *
 * Full test runs compile the runtime once and reuse it across child processes.
 * Focused tests remain self-contained by falling back to the TypeScript source
 * when the compiled runtime is absent or older than production source files.
 */
export function testCliNodeArguments(args: readonly string[]): string[] {
  if (compiledRuntimeIsCurrent()) return [compiledCliPath, ...args];
  return ['--import', 'tsx', sourceCliPath, ...args];
}

/** Determines whether the compiled CLI reflects the current production tree. */
function compiledRuntimeIsCurrent(): boolean {
  if (!existsSync(compiledCliPath)) return false;
  return statSync(compiledCliPath).mtimeMs >= newestProductionSourceMtime(
    join(repositoryRoot, 'src'),
  );
}

/** Finds the latest TypeScript or YAML modification below a production tree. */
function newestProductionSourceMtime(directory: string): number {
  let newest = 0;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'tests') newest = Math.max(newest, newestProductionSourceMtime(path));
      continue;
    }
    if (!entry.isFile() || !/\.(?:ts|yaml)$/u.test(entry.name)) continue;
    newest = Math.max(newest, statSync(path).mtimeMs);
  }
  return newest;
}
