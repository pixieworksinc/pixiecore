import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface FakeMcpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  result?: unknown;
  isError?: boolean;
  protocolError?: string;
}

export interface FakeMcpServerOptions {
  filename?: string;
  pageSize?: number;
  stderrBytes?: number;
  pidFile?: string;
  shutdownFile?: string;
  hangOnInitialize?: boolean;
  exitOnInitialize?: boolean;
  malformedInitializeResponse?: string;
  malformedToolsResponse?: string;
  initializeFile?: string;
  clientInfoFile?: string;
}

/** Writes a deterministic JSON-lines stdio MCP server for offline integration tests. */
export async function writeFakeMcpServer(
  directory: string,
  tools: FakeMcpTool[] = [],
  options: FakeMcpServerOptions = {},
): Promise<string> {
  const path = join(directory, options.filename ?? 'fake-mcp-server.mjs');
  const script = `
import readline from 'node:readline';
import { writeFileSync } from 'node:fs';
const tools = ${JSON.stringify(tools)};
const options = ${JSON.stringify(options)};
if (options.pidFile) writeFileSync(options.pidFile, String(process.pid));
if (options.stderrBytes) {
  const chunk = 'x'.repeat(Math.min(options.stderrBytes, 65536));
  let remaining = options.stderrBytes;
  while (remaining > 0) {
    process.stderr.write(chunk.slice(0, remaining));
    remaining -= chunk.length;
  }
}
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  if (options.shutdownFile) writeFileSync(options.shutdownFile, 'closed');
  process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
const lines = readline.createInterface({ input: process.stdin });
const send = value => process.stdout.write(JSON.stringify(value) + '\\n');
lines.on('line', line => {
  const message = JSON.parse(line);
  if (message.method === 'initialize') {
    if (options.initializeFile) writeFileSync(options.initializeFile, 'initialized');
    if (options.clientInfoFile) writeFileSync(options.clientInfoFile, JSON.stringify(message.params.clientInfo));
    if (options.exitOnInitialize) process.exit(17);
    if (options.hangOnInitialize) return;
    if (options.malformedInitializeResponse) {
      process.stdout.write(options.malformedInitializeResponse + '\\n');
      return;
    }
    send({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'pixiecore-test', version: '1.0.0' } } });
  }
  else if (message.method === 'tools/list') {
    if (options.malformedToolsResponse) {
      process.stdout.write(options.malformedToolsResponse + '\\n');
      return;
    }
    const start = Number(message.params?.cursor ?? 0);
    const pageSize = options.pageSize ?? Math.max(tools.length, 1);
    const page = tools.slice(start, start + pageSize).map(({ result, isError, protocolError, ...tool }) => ({ ...tool, inputSchema: tool.inputSchema ?? { type: 'object' } }));
    const next = start + pageSize;
    send({ jsonrpc: '2.0', id: message.id, result: { tools: page, ...(next < tools.length ? { nextCursor: String(next) } : {}) } });
  }
  else if (message.method === 'tools/call') {
    const tool = tools.find(candidate => candidate.name === message.params.name);
    if (!tool) send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Tool not found' } });
    else if (tool.protocolError) send({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: tool.protocolError } });
    else send({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: JSON.stringify(tool.result ?? message.params.arguments) }], ...(tool.isError ? { isError: true } : {}) } });
  }
});
lines.on('close', stop);
`;
  await writeFile(path, script, 'utf8');
  return path;
}
