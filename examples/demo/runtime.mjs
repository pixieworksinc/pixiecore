/** Own the existing selected host and drain it on container shutdown. */
import {startMockSpecificationHost} from '../integrations/drupal/executable-specification/runtime/mock-server.js';
import {startConfiguredLiveHost} from '../integrations/drupal/executable-specification/runtime/live-server.js';
import {startAdapterHost} from '../integrations/drupal/executable-specification/runtime/adapter-server.js';
const mode = process.env.DEMO_MODE || 'mock';
if (!['mock', 'real'].includes(mode)) throw Error('Invalid DEMO_MODE');
/** @type {Array<{close(): Promise<void>}>} */
const hosts = [];
try {
  hosts.push(mode === 'real'
    ? await startConfiguredLiveHost(process.env.PIXIECORE_DEMO_CONFIG)
    : await startMockSpecificationHost(3087));
  // The adapter is always an offline fixture rehearsal, including in Core real mode.
  hosts.push(await startAdapterHost(3088));
} catch (error) {
  await Promise.allSettled(hosts.map(host => host.close()));
  throw error;
}
console.log(`PixieCore ${mode} host ready.`);
console.log('Customer adapter offline fixture host ready.');
let closing = false;
async function stop() {
  if (closing) return;
  closing = true;
  const deadline = setTimeout(() => process.exit(1), 5000);
  try {
    await Promise.all(hosts.map(host => host.close()));
    clearTimeout(deadline);
    process.exit(0);
  } catch {
    console.error('Demo host shutdown failed.');
    process.exit(1);
  }
}
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
