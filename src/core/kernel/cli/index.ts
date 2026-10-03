#!/usr/bin/env node
/**
 * Coordinates cli responsibilities inside the PixieCore kernel.
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import YAML from 'yaml';
import { createApp } from '../api/index.js';
import {
  activateCorePluginRoots,
  PluginManager,
  resolvePluginService,
} from '../plugin/manager.js';
import { errorMessage } from '../../component/diagnostics/index.js';
import type {
  CliCommandInvocation,
  CliHostPort,
} from '../../contracts/cli/index.js';
import { CLI_COMMAND_SERVICE } from '../../contracts/plugin/services.js';
import { getRuntimeEnvironment } from '../config/index.js';
import { PromptRuntime } from '../runtime/index.js';
import { BlueprintValidator } from '../../../plugins/validation/validation.js';
import { servePixieCoreMcpStdio } from '../mcp-server/index.js';
import { runPluginCli } from '../plugin/cli.js';
import { runBlueprintPackageCli } from '../blueprint/package-cli.js';
import { runBlueprintEvaluation, runBlueprintPlayground } from '../evaluation/index.js';
import {
  inspectApplicationGraph,
  renderApplicationGraphMermaid,
  type ApplicationGraphDefinition,
  type ApplicationGraphNodeDefinition,
} from '../application/index.js';

const host: CliHostPort = {
  writeStdout: line => { console.log(line); },
  writeStderr: line => { console.error(line); },
  setExitCode: code => { process.exitCode = code; },
  onceSignal: (signal, listener) => { process.once(signal, listener); },
};

async function run(argv: readonly string[]): Promise<void> {
  const [command, ...args] = argv;
  if (command === 'plugin') {
    await runPluginCli(args, host);
    return;
  }
  if (command === 'blueprint' && args[0] === 'package') {
    await runBlueprintPackageCli(args.slice(1), host);
    return;
  }
  const manager = new PluginManager();
  try {
    const roots = command === 'serve'
      ? ['pixiecore.cli', 'pixiecore.api']
      : command === 'mcp' && args[0] === 'serve'
        ? ['pixiecore.cli', 'pixiecore.mcp-server']
        : ['pixiecore.cli'];
    activateCorePluginRoots(manager, roots);
    const commands = resolvePluginService(manager, CLI_COMMAND_SERVICE);
    await commands.run(createInvocation(command, args), host);
  } finally {
    await manager.close();
  }
}

function createInvocation(
  command: string | undefined,
  args: readonly string[],
): CliCommandInvocation {
  if (command === 'serve') {
    return {
      kind: 'serve',
      args,
      factories: {
        resolveEnvironment: getRuntimeEnvironment,
        createApp: environment => createApp({ environment }),
      },
    };
  }
  if (command === 'mcp' && args[0] === 'serve') {
    return {
      kind: 'mcp-serve',
      args: args.slice(1),
      factories: { serve: () => servePixieCoreMcpStdio() },
    };
  }
  if (command === 'blueprint' && args[0] === 'eval') {
    return {
      kind: 'blueprint-eval',
      args: args.slice(1),
      factories: {
        runEvaluation: options => runBlueprintEvaluation(options),
        writeTextFile: (path, contents) => writeFile(path, contents, 'utf8'),
      },
    };
  }
  if (command === 'blueprint' && args[0] === 'play') {
    return {
      kind: 'blueprint-play',
      args: args.slice(1),
      factories: { runPlayground: options => runBlueprintPlayground(options) },
    };
  }
  if (command === 'blueprint' && args[0] === 'create') {
    return {
      kind: 'blueprint-create',
      args: args.slice(1),
      factories: { createScaffold: writeBlueprintScaffold },
    };
  }
  if (command === 'application' && args[0] === 'inspect') {
    return {
      kind: 'application-inspect',
      args: args.slice(1),
      factories: {
        inspectApplication: inspectApplicationFile,
        renderMermaid: renderApplicationGraphMermaid,
      },
    };
  }
  if (
    command === 'blueprint'
    && (args[0] === 'validate' || args[0] === 'test' || args[0] === 'inspect')
  ) {
    return {
      kind: 'blueprint-check',
      command: args[0],
      args: args.slice(1),
      factories: {
        inspectBlueprint,
        testBlueprintUnit,
      },
    };
  }
  if (command === 'execute' || command === 'execute-yaml') {
    return {
      kind: 'execute',
      command,
      args,
      factories: {
        createRuntime: () => new PromptRuntime(),
        readTextFile: path => readFile(path, 'utf8'),
      },
    };
  }
  return { kind: 'usage' };
}

async function inspectApplicationFile(path: string) {
  const source = YAML.parse(await readFile(path, 'utf8')) as unknown;
  if (!isRecord(source)) throw new TypeError('Application graph must be an object');
  if (source.schema !== 'pixiecore.application-graph/v1') {
    throw new TypeError('Application graph schema must be pixiecore.application-graph/v1');
  }
  if (typeof source.name !== 'string' || typeof source.version !== 'string') {
    throw new TypeError('Application graph requires string name and version');
  }
  if (!Array.isArray(source.nodes)) throw new TypeError('Application graph nodes must be an array');
  const root = dirname(resolve(path));
  const nodes: ApplicationGraphNodeDefinition[] = source.nodes.map((value, index) => {
    if (!isRecord(value)) throw new TypeError(`Application graph nodes[${index}] must be an object`);
    if (
      typeof value.id !== 'string'
      || typeof value.blueprint !== 'string'
      || typeof value.version !== 'string'
    ) {
      throw new TypeError(
        `Application graph nodes[${index}] requires string id, blueprint, and version`,
      );
    }
    if (
      value.depends_on !== undefined
      && (!Array.isArray(value.depends_on)
        || !value.depends_on.every(dependency => typeof dependency === 'string'))
    ) {
      throw new TypeError(`Application graph nodes[${index}].depends_on must be strings`);
    }
    return {
      id: value.id,
      blueprintPath: resolve(root, value.blueprint),
      blueprintVersion: value.version,
      ...(value.depends_on === undefined ? {} : { dependsOn: value.depends_on }),
    };
  });
  const definition: ApplicationGraphDefinition = {
    name: source.name,
    version: source.version,
    nodes,
  };
  return inspectApplicationGraph(definition);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function inspectBlueprint(path: string) {
  const blueprint = await new BlueprintValidator({ warn: () => undefined }).validateFile(path);
  return Object.freeze({
    name: blueprint.name,
    version: blueprint.version,
    role: blueprint.role,
    input_fields: Object.freeze((blueprint.input_placeholders ?? [])
      .map(input => typeof input === 'string' ? input : input.name)
      .sort()),
    has_input_schema: blueprint.input_schema !== undefined,
    tool_names: Object.freeze([...(blueprint.tools ?? [])].sort()),
  });
}

async function testBlueprintUnit(directory: string) {
  const unit = normalize(directory).split(sep).at(-1) ?? '';
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(unit)) {
    throw new TypeError('Blueprint unit directory name must be lowercase kebab-case');
  }
  const blueprintRelative = `${unit}.yaml`;
  const datasetRelative = join('evaluations', `${unit}.yaml`);
  const testRelative = join('tests', `${unit}.contract.test.ts`);
  const blueprintPath = join(directory, blueprintRelative);
  const datasetPath = join(directory, datasetRelative);
  const testPath = join(directory, testRelative);
  const [inspection, datasetSource, testSource] = await Promise.all([
    inspectBlueprint(blueprintPath),
    readFile(datasetPath, 'utf8'),
    readFile(testPath, 'utf8'),
  ]);
  const dataset = YAML.parse(datasetSource) as {
    blueprint?: { path?: unknown; version?: unknown };
  };
  const schemaPath = fileURLToPath(new URL(
    '../../../../schemas/pixiecore.blueprint-eval-dataset-v1.schema.json',
    import.meta.url,
  ));
  const schema = JSON.parse(await readFile(schemaPath, 'utf8')) as object;
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  if (!validate(dataset)) {
    throw new TypeError(`Invalid Blueprint evaluation dataset: ${JSON.stringify(validate.errors)}`);
  }
  if (dataset.blueprint?.path !== `../${blueprintRelative}`) {
    throw new TypeError(`Evaluation dataset must reference ../${blueprintRelative}`);
  }
  if (dataset.blueprint.version !== inspection.version) {
    throw new TypeError('Evaluation dataset Blueprint version does not match the unit');
  }
  if (!/from ['"]@pixieworks\/pixiecore['"]/u.test(testSource)) {
    throw new TypeError('Blueprint contract test must import the public @pixieworks/pixiecore entry point');
  }
  if (/@pixieworks\/pixiecore\/(?:core|internal)/u.test(testSource)) {
    throw new TypeError('Blueprint contract test must not import PixieCore internals');
  }
  return Object.freeze({
    valid: true as const,
    unit,
    blueprint: blueprintRelative,
    version: inspection.version,
    dataset: datasetRelative,
    contract_test: testRelative,
  });
}

async function writeBlueprintScaffold(
  directory: string,
  files: readonly { readonly relativePath: string; readonly contents: string }[],
): Promise<void> {
  if (files.length === 0) throw new TypeError('Blueprint scaffold must contain files');
  for (const file of files) assertSafeRelativePath(file.relativePath);
  await mkdir(dirname(directory), { recursive: true });
  let created = false;
  try {
    await mkdir(directory);
    created = true;
    for (const file of files) {
      const target = join(directory, file.relativePath);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.contents, { encoding: 'utf8', flag: 'wx' });
    }
  } catch (cause) {
    if (created) await rm(directory, { recursive: true, force: true });
    throw cause;
  }
}

function assertSafeRelativePath(path: string): void {
  const normalized = normalize(path);
  if (
    path.trim()
    && !isAbsolute(path)
    && normalized !== '..'
    && !normalized.startsWith(`..${sep}`)
  ) return;
  throw new TypeError(`Unsafe Blueprint scaffold path: ${path}`);
}

try {
  await run(process.argv.slice(2));
} catch (error) {
  host.writeStderr(`PixieCore: ${errorMessage(error)}`);
  host.setExitCode(1);
}
