/** Own the existing selected host and drain it on container shutdown. */
import {startMockSpecificationHost} from '../integrations/drupal/executable-specification/runtime/mock-server.js';
import {startConfiguredLiveHost} from '../integrations/drupal/executable-specification/runtime/live-server.js';
const mode = process.env.DEMO_MODE || 'mock';
if (!['mock', 'real'].includes(mode)) throw Error('Invalid DEMO_MODE');
const host = mode === 'real'
  ? await startConfiguredLiveHost(process.env.PIXIECORE_DEMO_CONFIG)
  : await startMockSpecificationHost(3087);
console.log(`PixieCore ${mode} host ready.`);
let closing = false;
async function stop() {
  if (closing) return;
  closing = true;
  const deadline = setTimeout(() => process.exit(1), 5000);
  try {
    await host.close();
    clearTimeout(deadline);
    process.exit(0);
  } catch {
    console.error('Demo host shutdown failed.');
    process.exit(1);
  }
}
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
