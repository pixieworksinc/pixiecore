/** Options accepted by side-effect-free core plugin catalog generation. */
export interface CorePluginCatalogOptions {
  readonly root?: string;
  readonly mode?: 'write' | 'check';
}

/** Result shared by the generator CLI and direct tests. */
export interface CorePluginCatalogResult {
  readonly exitCode: 0 | 1;
  readonly output: string;
}

/** Runs catalog generation without process or console side effects. */
export function runCorePluginCatalog(
  options?: CorePluginCatalogOptions,
): Promise<CorePluginCatalogResult>;
