/**
 * Coordinates package cli responsibilities inside the PixieCore kernel.
 */

import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  CURRENT_POP_VERSION,
  DEFAULT_BLUEPRINT_PACKAGE_STATE_FILENAME,
  installBlueprintPackage,
  rollbackBlueprintPackage,
  setBlueprintPackageProvenance,
  setBlueprintPackageEnabled,
  signBlueprintPackage,
  upgradeBlueprintPackage,
  verifyBlueprintPackage,
} from '../../bootstrap/blueprint/manager.js';
import { resolvePixieCorePackageRoot } from '../../bootstrap/config/package-root.js';
import { errorMessage } from '../../component/diagnostics/index.js';
import type { CliHostPort } from '../../contracts/cli/index.js';

export const BLUEPRINT_PACKAGE_CLI_USAGE = [
  'Usage: pixiecore blueprint package install <directory|metadata.json> [--config=<path>] [--enable]',
  '       pixiecore blueprint package upgrade <directory|metadata.json> [--config=<path>]',
  '       pixiecore blueprint package enable|disable <package-name> [--config=<path>]',
  '       pixiecore blueprint package rollback <package-name> [--config=<path>]',
  '       pixiecore blueprint package provenance <directory> [--source=<url>] [--commit=<sha>]',
  '       pixiecore blueprint package sign <directory> --private-key=<path>',
  '       pixiecore blueprint package verify <directory> [--public-key=<path>] [--require-signature]',
].join('\n');

/**
 * Reports blueprint package cli usage failures.
 */
class BlueprintPackageCliUsageError extends Error {}

/**
 * Executes blueprint package cli through its public boundary.
 */
export async function runBlueprintPackageCli(
  args: readonly string[],
  host: CliHostPort,
): Promise<void> {
  try {
    await dispatch(args, host);
  } catch (error) {
    host.writeStderr(
      error instanceof BlueprintPackageCliUsageError
        ? error.message
        : `PixieCore: ${errorMessage(error)}`,
    );
    host.setExitCode(error instanceof BlueprintPackageCliUsageError ? 2 : 1);
  }
}

async function dispatch(args: readonly string[], host: CliHostPort): Promise<void> {
  const [command, ...rest] = args;
  if (!command || command === '--help' || command === 'help') {
    host.writeStdout(BLUEPRINT_PACKAGE_CLI_USAGE);
    return;
  }
  const positional = rest.filter(argument => !argument.startsWith('--'));
  const flags = parseFlags(rest.filter(argument => argument.startsWith('--')));
  const target = positional[0];
  if (!target || positional.length !== 1) throw usage();
  const configPath = optionalStringFlag(flags, 'config')
    ?? resolve(DEFAULT_BLUEPRINT_PACKAGE_STATE_FILENAME);

  if (command === 'install') {
    assertOnlyFlags(flags, ['config', 'enable', 'public-key', 'require-signature']);
    if (flags.enable !== undefined && flags.enable !== true) throw usage();
    if (flags['require-signature'] !== undefined && flags['require-signature'] !== true) throw usage();
    const installed = await installBlueprintPackage({
      source: target,
      configPath,
      pixiecoreVersion: await currentPixieCoreVersion(),
      popVersion: CURRENT_POP_VERSION,
      enable: flags.enable === true,
      ...trustFlags(flags),
    });
    host.writeStdout(JSON.stringify(installed, null, 2));
    return;
  }
  if (command === 'upgrade') {
    assertOnlyFlags(flags, ['config', 'public-key', 'require-signature']);
    const upgraded = await upgradeBlueprintPackage({
      source: target,
      configPath,
      pixiecoreVersion: await currentPixieCoreVersion(),
      popVersion: CURRENT_POP_VERSION,
      ...trustFlags(flags),
    });
    host.writeStdout(JSON.stringify(upgraded, null, 2));
    return;
  }
  if (command === 'enable' || command === 'disable') {
    assertOnlyFlags(flags, ['config']);
    const state = await setBlueprintPackageEnabled(configPath, target, command === 'enable');
    host.writeStdout(JSON.stringify({ name: target, ...state }, null, 2));
    return;
  }
  if (command === 'rollback') {
    assertOnlyFlags(flags, ['config']);
    const state = await rollbackBlueprintPackage(configPath, target);
    host.writeStdout(JSON.stringify({ name: target, ...state }, null, 2));
    return;
  }
  if (command === 'provenance') {
    assertOnlyFlags(flags, ['source', 'commit']);
    const provenance = provenanceFlags(flags);
    const metadata = await setBlueprintPackageProvenance(
      target,
      provenance,
      { pixiecoreVersion: await currentPixieCoreVersion(), popVersion: CURRENT_POP_VERSION },
    );
    host.writeStdout(JSON.stringify(metadata.provenance, null, 2));
    return;
  }
  if (command === 'sign') {
    assertOnlyFlags(flags, ['private-key']);
    const metadata = await signBlueprintPackage(
      target,
      requiredStringFlag(flags, 'private-key'),
      { pixiecoreVersion: await currentPixieCoreVersion(), popVersion: CURRENT_POP_VERSION },
    );
    host.writeStdout(JSON.stringify({
      name: metadata.package.name,
      keyId: metadata.signature?.keyId,
    }, null, 2));
    return;
  }
  if (command === 'verify') {
    assertOnlyFlags(flags, ['public-key', 'require-signature']);
    const verified = await verifyBlueprintPackage(target, {
      pixiecoreVersion: await currentPixieCoreVersion(),
      popVersion: CURRENT_POP_VERSION,
      ...trustFlags(flags),
    });
    host.writeStdout(JSON.stringify({
      name: verified.metadata.package.name,
      version: verified.metadata.package.version,
      signature: verified.signature,
      keyId: verified.metadata.signature?.keyId,
    }, null, 2));
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
    if (Object.hasOwn(flags, name)) {
      throw new BlueprintPackageCliUsageError(
        `Duplicate option --${name}\n${BLUEPRINT_PACKAGE_CLI_USAGE}`,
      );
    }
    flags[name] = value;
  }
  return flags;
}

function assertOnlyFlags(
  flags: Readonly<Record<string, FlagValue>>,
  allowed: readonly string[],
): void {
  if (Object.keys(flags).every(flag => allowed.includes(flag))) return;
  throw usage();
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

function requiredStringFlag(
  flags: Readonly<Record<string, FlagValue>>,
  name: string,
): string {
  const value = optionalStringFlag(flags, name);
  if (value === undefined) throw usage();
  return value;
}

function trustFlags(flags: Readonly<Record<string, FlagValue>>): {
  readonly publicKeyPath?: string;
  readonly requireSignature?: boolean;
} {
  if (flags['require-signature'] !== undefined && flags['require-signature'] !== true) throw usage();
  const publicKeyPath = optionalStringFlag(flags, 'public-key');
  return {
    ...(publicKeyPath === undefined ? {} : { publicKeyPath }),
    ...(flags['require-signature'] === true ? { requireSignature: true } : {}),
  };
}

function provenanceFlags(flags: Readonly<Record<string, FlagValue>>): {
  readonly source?: string;
  readonly commit?: string;
} {
  const source = optionalStringFlag(flags, 'source');
  const commit = optionalStringFlag(flags, 'commit');
  if (source === undefined && commit === undefined) throw usage();
  return {
    ...(source === undefined ? {} : { source }),
    ...(commit === undefined ? {} : { commit }),
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

function usage(): BlueprintPackageCliUsageError {
  return new BlueprintPackageCliUsageError(BLUEPRINT_PACKAGE_CLI_USAGE);
}
