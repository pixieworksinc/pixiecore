/** Disable ambient network entry points before the offline test modules load. */
import http from 'node:http';
import http2 from 'node:http2';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import net from 'node:net';
import tls from 'node:tls';

const deny = () => { throw new Error('Network is disabled for PixieAgent offline tests'); };

globalThis.fetch = async () => deny();
/** @type {Array<[object, string[]]>} */
const blockedMethods = [
  [http, ['get', 'request']],
  [http2, ['connect']],
  [https, ['get', 'request']],
  [net, ['connect', 'createConnection']],
  [tls, ['connect']],
];
for (const [module, methods] of blockedMethods) {
  for (const method of methods) Object.defineProperty(module, method, { value: deny, configurable: true });
}
Object.defineProperty(net.Socket.prototype, 'connect', { value: deny, configurable: true });
syncBuiltinESMExports();
