/** Network-free CLI for preparing the PixieAgent real-model acceptance test. */
import { preflight, runOfflineExample } from './harness.js';
import { createOfflineManifest, type OfflineManifest } from './evidence.js';

const mode = process.argv[2] ?? '--preflight';
if (process.argv.length > 3
  || !['--preflight', '--manifest', '--offline', '--rejecting', '--luna-offline', '--luna-rejecting'].includes(mode)) {
  throw new Error('Usage: run.ts [--preflight|--manifest|--offline|--rejecting|--luna-offline|--luna-rejecting]. Live provider execution is disabled.');
}

const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('Network prohibited during offline preparation'); };
let manifest: OfflineManifest | undefined;
try {
  if (mode === '--preflight') {
    const definition = await preflight();
    console.log(JSON.stringify({ mode: 'preflight', agent: definition.id, networkRequests: 0 }));
  }
  if (mode === '--manifest') {
    console.log(JSON.stringify(await createOfflineManifest('luna'), null, 2));
  }
  if (['--offline', '--rejecting', '--luna-offline', '--luna-rejecting'].includes(mode)) {
    const profile = mode.startsWith('--luna-') ? 'luna' : 'fixture';
    manifest = await createOfflineManifest(profile);
    const result = await runOfflineExample(mode.endsWith('rejecting') ? 'rejecting' : 'scripted', profile);
    const after = await createOfflineManifest(profile);
    const sourceUnchanged = JSON.stringify(manifest.source) === JSON.stringify(after.source);
    const report = { manifest, ...result, sourceUnchanged,
      ...(!sourceUnchanged ? { status: 'failed', errorCode: 'source_changed' } : {}) };
    console.log(JSON.stringify(report, null, 2));
    if (report.status === 'failed') process.exitCode = 1;
  }
} catch {
  console.log(JSON.stringify({ status: 'failed', errorCode: 'setup_or_cleanup_failed',
    mode, networkRequests: 0, costUsd: null, ...(manifest ? { manifest } : {}) }));
  process.exitCode = 1;
} finally {
  globalThis.fetch = originalFetch;
}
