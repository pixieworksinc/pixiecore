import type { AddressInfo } from 'node:net';
import type { ApiOptions, PixieCoreApiServer } from '../../src/core/kernel/api/index.js';
import { createApp } from '../../src/core/kernel/api/index.js';

export async function startApiServer(options: ApiOptions): Promise<{ server: PixieCoreApiServer; baseUrl: string }> {
  const server = createApp(options);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  const address = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

export async function stopApiServer(server: PixieCoreApiServer): Promise<void> {
  if (server.listening) {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
  await server.closeResources();
}

export async function responseJson(response: Response): Promise<Record<string, any>> {
  return await response.json() as Record<string, any>;
}
