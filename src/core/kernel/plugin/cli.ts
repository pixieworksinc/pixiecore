/**
 * Coordinates cli responsibilities inside the PixieCore kernel.
 */

import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  createPluginProject,
  PLUGIN_TEMPLATE_KINDS,
  testPluginProject,
  validatePluginProject,
  type PluginTemplateKind,
} from '../../bootstrap/plugin-manager/authoring/index.js';
import {
  createPluginCatalog,
  createPluginDistributionMetadata,
  signPluginDistribution,
  verifyPluginDistribution,
} from '../../bootstrap/plugin-manager/authoring/distribution.js';
import {
  installPluginLink,
  updatePluginActivationState,
} from '../../bootstrap/plugin-manager/authoring/state-editor.js';
import { errorMessage } from '../../component/diagnostics/index.js';
import type { CliHostPort } from '../../contracts/cli/index.js';
import { resolvePixieCorePackageRoot } from '../../bootstrap/config/package-root.js';

export const PLUGIN_CLI_USAGE = [
  'Usage: pixiecore plugin create <directory> --id=<id> --kind=<agent_role|decorator|tool|provider|extension> [--extension-point=<id>]',
  '       pixiecore plugin validate|test <directory>',
  '       pixiecore plugin install|link <directory> [--config=<path>] [--enable]',
  '       pixiecore plugin enable|disable <id> [--config=<path>]',
  '       pixiecore plugin provenance <directory> [--pixiecore-range=<range>] [--source=<url>] [--commit=<sha>]',
  '       pixiecore plugin sign <directory> --private-key=<path>',
  '       pixiecore plugin verify <directory> [--public-key=<path>] [--require-signature]',
  '       pixiecore plugin catalog <root> [--public-key=<path>]',
].join('\n');

/**
 * Reports plugin cli usage failures.
 */
class PluginCliUsageError extends Error {}

/**
 * Executes plugin cli through its public boundary.
 */
export async function runPluginCli(
  args: readonly string[],
  host: CliHostPort,
): Promise<void> {
  try {
    await dispatch(args, host);
  } catch (error) {
    host.writeStderr(
      error instanceof PluginCliUsageError
        ? error.message
        : `PixieCore: ${errorMessage(error)}`,
    );
    host.setExitCode(error instanceof PluginCliUsageError ? 2 : 1);
  }
}

async function dispatch(args: readonly string[], host: CliHostPort): Promise<void> {
  const [command, ...rest] = args;
  if (!command || command === '--help' || command === 'help') {
    host.writeStdout(PLUGIN_CLI_USAGE);
    return;
  }
  const positional = rest.filter(argument => !argument.startsWith('--'));
  const flags = parseFlags(rest.filter(argument => argument.startsWith('--')));
  const target = positional[0];
  if (!target || positional.length !== 1) throw usage();
  const pixiecoreVersion = await currentPixieCoreVersion();

  if (command === 'create') {
    const id = requiredFlag(flags, 'id');
    const kind = requiredFlag(flags, 'kind');
    const name = optionalStringFlag(flags, 'name');
    const extensionPoint = optionalStringFlag(flags, 'extension-point');
    if (!PLUGIN_TEMPLATE_KINDS.includes(kind as PluginTemplateKind)) throw usage();
    const directory = await createPluginProject({
      directory: target,
      id,
      kind: kind as PluginTemplateKind,
      ...(name === undefined ? {} : { name }),
      ...(extensionPoint === undefined ? {} : { extensionPoint }),
    });
    host.writeStdout(`Created PixieCore plugin project: ${directory}`);
    return;
  }
  if (command === 'validate') {
    const result = await validatePluginProject(target);
    host.writeStdout(JSON.stringify({
      id: result.manifest.id,
      version: result.manifest.version,
      exports: result.exports,
    }, null, 2));
    return;
  }
  if (command === 'test') {
    await testPluginProject(target);
    host.writeStdout(`PixieCore plugin tests passed: ${resolve(target)}`);
    return;
  }
  if (command === 'install' || command === 'link') {
    const installed = await installPluginLink({
      source: target,
      configPath: optionalStringFlag(flags, 'config') ?? resolve('pixiecore.plugins.yml'),
      enable: flags.enable === true,
    });
    host.writeStdout(JSON.stringify(installed, null, 2));
    return;
  }
  if (command === 'enable' || command === 'disable') {
    await updatePluginActivationState(
      optionalStringFlag(flags, 'config') ?? resolve('pixiecore.plugins.yml'),
      target,
      command,
    );
    host.writeStdout(`${command === 'enable' ? 'Enabled' : 'Disabled'} PixieCore plugin: ${target}`);
    return;
  }
  if (command === 'provenance') {
    const pixiecoreRange = optionalStringFlag(flags, 'pixiecore-range');
    const metadata = await createPluginDistributionMetadata(target, {
      pixiecoreVersion,
      ...(pixiecoreRange === undefined ? {} : { pixiecoreRange }),
      ...provenanceFlags(flags),
    });
    host.writeStdout(JSON.stringify(metadata, null, 2));
    return;
  }
  if (command === 'sign') {
    const metadata = await signPluginDistribution(target, requiredFlag(flags, 'private-key'));
    host.writeStdout(JSON.stringify({
      id: metadata.plugin.id,
      keyId: metadata.signature?.keyId,
    }, null, 2));
    return;
  }
  if (command === 'verify') {
    const verified = await verifyPluginDistribution(target, {
      pixiecoreVersion,
      ...(typeof flags['public-key'] === 'string'
        ? { publicKeyPath: flags['public-key'] }
        : {}),
      requireSignature: flags['require-signature'] === true,
    });
    host.writeStdout(JSON.stringify({
      id: verified.metadata.plugin.id,
      version: verified.metadata.plugin.version,
      signature: verified.signature,
    }, null, 2));
    return;
  }
  if (command === 'catalog') {
    const catalog = await createPluginCatalog(target, {
      pixiecoreVersion,
      ...(typeof flags['public-key'] === 'string'
        ? { publicKeyPath: flags['public-key'] }
        : {}),
    });
    host.writeStdout(JSON.stringify(catalog, null, 2));
    return;
  }
  throw usage();
}

type FlagValue = string | true;

function parseFlags(args: readonly string[]): Record<string, FlagValue> {
  const flags: Record<string, FlagValue> = {};
  for (const argument of args) {
    const match = /^--([a-z][a-z-]*)(?:=(.*))?$/.exec(argument);
    if (!match) throw usage();
    const name = match[1]!;
    const value = match[2] === undefined ? true : match[2];
    if (Object.hasOwn(flags, name)) throw new PluginCliUsageError(`Duplicate option --${name}\n${PLUGIN_CLI_USAGE}`);
    flags[name] = value;
  }
  return flags;
}

function requiredFlag(flags: Readonly<Record<string, FlagValue>>, name: string): string {
  const value = flags[name];
  if (typeof value !== 'string' || !value) throw usage();
  return value;
}

function optionalStringFlag(
  flags: Readonly<Record<string, FlagValue>>,
  name: string,
): string | undefined {
  const value = flags[name];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value) throw usage();
  return value;
}

function provenanceFlags(flags: Readonly<Record<string, FlagValue>>): {
  readonly provenance?: { readonly source?: string; readonly commit?: string };
} {
  const source = flags.source;
  const commit = flags.commit;
  if (source === true || commit === true) throw usage();
  if (source === undefined && commit === undefined) return {};
  return {
    provenance: {
      ...(source === undefined ? {} : { source }),
      ...(commit === undefined ? {} : { commit }),
    },
  };
}

async function currentPixieCoreVersion(): Promise<string> {
  const root = resolvePixieCorePackageRoot(import.meta.url);
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
    readonly version?: unknown;
  };
  if (typeof manifest.version !== 'string' || !manifest.version) {
    throw new Error('PixieCore package version is unavailable');
  }
  return manifest.version;
}

function usage(): PluginCliUsageError {
  return new PluginCliUsageError(PLUGIN_CLI_USAGE);
}
