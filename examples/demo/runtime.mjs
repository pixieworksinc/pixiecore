/** Own the existing fixture host and drain it on container shutdown. */
import {startMockSpecificationHost} from '../integrations/drupal/executable-specification/runtime/mock-server.js';
const host = await startMockSpecificationHost(3087);
console.log('Offline PixieCore fixture host ready.');
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
    console.error('Fixture host shutdown failed.');
    process.exit(1);
  }
}
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
