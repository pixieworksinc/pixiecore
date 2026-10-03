/**
 * Implements runtime commands behavior for the cli plugin.
 */

import type { PixieCoreApiServer } from '../../../../core/contracts/api/index.js';
import type {
  CliExecuteInvocation,
  CliHostPort,
  CliMcpServeInvocation,
  CliServeInvocation,
  CliSignal,
} from '../../../../core/contracts/cli/index.js';
import { errorMessage } from '../../../../core/component/diagnostics/index.js';
import { resolveEnvironmentVariable } from '../../../../core/component/environment-alias/index.js';
import { CLI_USAGE_TEXT, CliUsageError } from './usage.js';

const DEFAULT_API_HOST = '127.0.0.1';
const DEFAULT_API_PORT = 8000;
const INPUTS_PREFIX = '--inputs=';
const SHUTDOWN_SIGNALS = ['SIGINT', 'SIGTERM'] as const;

/**
 * Executes mcp server through its public boundary.
 */
export function runMcpServer(invocation: CliMcpServeInvocation, host: CliHostPort): void {
  if (invocation.args.length) throw new CliUsageError(CLI_USAGE_TEXT);
  const handle = invocation.factories.serve();
  let stopping = false;
  const shutdown = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    await handle.close();
  };
  registerShutdownSignals(host, () => shutdown());
}

/**
 * Executes blueprint execution through its public boundary.
 */
export async function runBlueprintExecution(
  invocation: CliExecuteInvocation,
  host: CliHostPort,
): Promise<void> {
  const path = invocation.args.find(argument => !argument.startsWith('--'));
  if (!path) throw new CliUsageError(CLI_USAGE_TEXT);
  const inputs = parseInputs(invocation.args);
  const runtime = invocation.factories.createRuntime();
  try {
    const result = invocation.command === 'execute'
      ? await runtime.execute(path, inputs)
      : await runtime.executeYaml(await invocation.factories.readTextFile(path), inputs);
    host.writeStdout(JSON.stringify(result, null, 2));
  } finally {
    await runtime.close();
  }
}

/**
 * Executes api server through its public boundary.
 */
export async function runApiServer(
  invocation: CliServeInvocation,
  host: CliHostPort,
): Promise<void> {
  const environment = invocation.factories.resolveEnvironment();
  const hostSetting = resolveEnvironmentVariable(environment, 'PIXIECORE_API_HOST');
  const portSetting = resolveEnvironmentVariable(environment, 'PIXIECORE_API_PORT');
  const token = resolveEnvironmentVariable(environment, 'PIXIECORE_API_TOKEN');
  const address = hostSetting?.value ?? DEFAULT_API_HOST;
  const port = parsePort(portSetting?.value, portSetting?.name ?? 'PIXIECORE_API_PORT');
  if (!isLoopbackHost(address) && !token?.value.trim()) {
    throw new CliUsageError(
      'PIXIECORE_API_TOKEN is required when PIXIECORE_API_HOST is not loopback',
    );
  }
  const server = invocation.factories.createApp(environment);
  await startServer(server, port, address);
  registerApiShutdown(server, host);
  host.writeStdout(`PixieCore API listening on http://${address}:${port}`);
}

async function startServer(
  server: PixieCoreApiServer,
  port: number,
  address: string,
): Promise<void> {
  try {
    await listen(server, port, address);
  } catch (error) {
    await server.closeResources();
    throw error;
  }
}

function registerApiShutdown(server: PixieCoreApiServer, host: CliHostPort): void {
  let stopping = false;
  const shutdown = async (signal: CliSignal): Promise<void> => {
    if (stopping) return;
    stopping = true;
    host.writeStdout(`PixieCore API received ${signal}; shutting down`);
    if (server.listening) await closeServer(server);
    await server.closeResources();
  };
  for (const signal of SHUTDOWN_SIGNALS) {
    host.onceSignal(signal, () => reportShutdownFailure(host, () => shutdown(signal)));
  }
}

function registerShutdownSignals(host: CliHostPort, shutdown: () => Promise<void>): void {
  for (const signal of SHUTDOWN_SIGNALS) {
    host.onceSignal(signal, () => reportShutdownFailure(host, shutdown));
  }
}

function reportShutdownFailure(host: CliHostPort, shutdown: () => Promise<void>): void {
  void shutdown().catch(error => {
    host.writeStderr(`PixieCore: ${errorMessage(error)}`);
    host.setExitCode(1);
  });
}

function listen(server: PixieCoreApiServer, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

function closeServer(server: PixieCoreApiServer): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
}

function parseInputs(args: readonly string[]): Record<string, unknown> {
  const argument = args.find(value => value.startsWith(INPUTS_PREFIX));
  if (!argument) return {};
  let value: unknown;
  try {
    value = JSON.parse(argument.slice(INPUTS_PREFIX.length));
  } catch (cause) {
    throw new CliUsageError(`--inputs must be valid JSON: ${errorMessage(cause)}`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CliUsageError('--inputs must be a JSON object');
  }
  return value as Record<string, unknown>;
}

function parsePort(value: string | undefined, name: string): number {
  if (value === undefined) return DEFAULT_API_PORT;
  if (!/^\d+$/.test(value)) throw invalidPort(name);
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw invalidPort(name);
  return port;
}

function invalidPort(name: string): CliUsageError {
  return new CliUsageError(`${name} must be an integer from 1 to 65535`);
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.toLowerCase();
  return normalized === 'localhost'
    || normalized === '127.0.0.1'
    || normalized === '::1'
    || normalized === '[::1]'
    || normalized === '0:0:0:0:0:0:0:1';
}
