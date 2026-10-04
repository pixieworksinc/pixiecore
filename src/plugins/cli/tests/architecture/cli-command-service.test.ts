import { EventEmitter } from 'node:events';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { PixieCoreApiServer } from '../../../../core/contracts/api/index.js';
import type {
  BlueprintEvaluationResultArtifact,
  BlueprintPlaygroundArtifact,
} from '../../../../core/contracts/evaluation/index.js';
import type {
  CliCommandInvocation,
  CliHostPort,
  CliRuntimePort,
  CliSignal,
} from '../../../../core/contracts/cli/index.js';
import { CLI_COMMAND_SERVICE } from '../../../../core/contracts/plugin/services.js';
import type { PluginActivationContext } from '../../../../core/contracts/plugin/activation.js';
import type { Provider } from '../../../../core/contracts/types/index.js';
import {
  activateCorePluginRoots,
  resolvePluginService,
  PluginManager,
} from '../../../../core/kernel/plugin/manager.js';
import { ScopedServiceRegistry } from '../../../../core/bootstrap/plugin-manager/registries/services.js';
import { CORE_PLUGIN_CATALOG } from '../../../../core/kernel/generated/core-plugin-catalog.generated.js';
import type {
  StaticCoreCommandComponent,
  StaticCorePluginManifest,
} from '../../../../core/bootstrap/plugin-manager/model/definition.js';
import { createCorePluginActivator } from '../../../../plugins/cli/src/activator.js';
import {
  BLUEPRINT_OPERATIONS,
  createBlueprintScaffoldFiles,
} from '../../../../plugins/cli/src/blueprint/scaffold.js';
import { createCliCommandService } from '../../../../plugins/cli/src/service.js';
import { testData } from '../../../../../tests/helpers/test-data.js';

const data = testData('CLI command service');

test('CLI activator only registers fresh frozen command services', () => {
  const beforeSignals = signalListenerCounts();
  const first = activateCliService();
  const second = activateCliService();
  const firstService = first.resolve(CLI_COMMAND_SERVICE);
  const secondService = second.resolve(CLI_COMMAND_SERVICE);

  assert.notEqual(firstService, secondService);
  assert.equal(Object.isFrozen(firstService), true);
  assert.equal(Object.isFrozen(secondService), true);
  assert.equal('close' in firstService, false);
  assert.deepEqual(signalListenerCounts(), beforeSignals);
  const manifest = corePluginManifest('pixiecore.cli');
  assert.deepEqual(manifest.requires, {
    'pixiecore.runtime': '^0.1.0',
  });
  assert.equal('pixiecore.api' in manifest.requires, false);
  assert.deepEqual(
    commandComponent(manifest).command_names,
    ['application', 'blueprint', 'execute', 'execute-yaml', 'serve', 'mcp', 'plugin'],
  );
});

function corePluginManifest(id: string): StaticCorePluginManifest {
  const entry = CORE_PLUGIN_CATALOG.find(item => item.manifest.id === id);
  assert.ok(entry, `Missing core plugin manifest: ${id}`);
  return entry.manifest;
}

function commandComponent(manifest: StaticCorePluginManifest): StaticCoreCommandComponent {
  const component = manifest.components.find(candidate => candidate.type === 'command');
  if (!component || component.type !== 'command') {
    throw new Error(`Core plugin ${manifest.id} has no command component`);
  }
  return component;
}

test('CLI execute, API, and MCP server roots activate independently', async () => {
  const executeManager = new PluginManager(undefined, {});
  const serveManager = new PluginManager(undefined, {});
  const mcpManager = new PluginManager(undefined, {});
  try {
    activateCorePluginRoots(executeManager, 'pixiecore.cli');
    assert.ok(resolvePluginService(executeManager, CLI_COMMAND_SERVICE));
    assert.deepEqual(coreActivation(executeManager, [
      'pixiecore.cli',
      'pixiecore.runtime',
      'pixiecore.api',
      'pixiecore.mcp-server',
    ]), {
      'pixiecore.cli': true,
      'pixiecore.runtime': true,
      'pixiecore.api': false,
      'pixiecore.mcp-server': false,
    });

    activateCorePluginRoots(serveManager, ['pixiecore.cli', 'pixiecore.api']);
    assert.ok(resolvePluginService(serveManager, CLI_COMMAND_SERVICE));
    assert.deepEqual(coreActivation(serveManager, [
      'pixiecore.cli',
      'pixiecore.runtime',
      'pixiecore.api',
      'pixiecore.mcp-server',
    ]), {
      'pixiecore.cli': true,
      'pixiecore.runtime': true,
      'pixiecore.api': true,
      'pixiecore.mcp-server': false,
    });
    activateCorePluginRoots(mcpManager, ['pixiecore.cli', 'pixiecore.mcp-server']);
    assert.deepEqual(coreActivation(mcpManager, [
      'pixiecore.cli',
      'pixiecore.runtime',
      'pixiecore.api',
      'pixiecore.mcp-server',
    ]), {
      'pixiecore.cli': true,
      'pixiecore.runtime': true,
      'pixiecore.api': false,
      'pixiecore.mcp-server': true,
    });
  } finally {
    await Promise.all([executeManager.close(), serveManager.close(), mcpManager.close()]);
  }
});

test('MCP serve reserves stdout and closes once on the first shutdown signal', async () => {
  const host = new RecordingHost();
  let closeCount = 0;

  await createCliCommandService().run({
    kind: 'mcp-serve',
    args: [],
    factories: {
      serve: () => ({
        async close(): Promise<void> { closeCount++; },
      }),
    },
  }, host);

  assert.deepEqual(host.stdout, []);
  assert.deepEqual(host.stderr, []);
  assert.deepEqual([...host.signals.keys()], ['SIGINT', 'SIGTERM']);
  host.emitSignal('SIGINT');
  host.emitSignal('SIGTERM');
  await flushTasks();
  assert.equal(closeCount, 1);

  const invalidHost = new RecordingHost();
  await createCliCommandService().run({
    kind: 'mcp-serve',
    args: ['unexpected'],
    factories: { serve: () => { throw new Error('must not start'); } },
  }, invalidHost);
  assert.deepEqual(invalidHost.stdout, []);
  assert.match(invalidHost.stderr[0] ?? '', /^Usage: pixiecore serve \| mcp serve /);
  assert.equal(invalidHost.exitCode, 2);
});

test('execute commands preserve lazy factories, output, inputs, and runtime cleanup', async () => {
  for (const command of ['execute', 'execute-yaml'] as const) {
    const name = data.person(`command input ${command}`);
    const host = new RecordingHost();
    const runtime = new RecordingRuntime();
    let runtimeCreations = 0;
    let fileReads = 0;
    const invocation: CliCommandInvocation = {
      kind: 'execute',
      command,
      args: ['fixture.yaml', `--inputs=${JSON.stringify({ name })}`],
      factories: {
        createRuntime: () => { runtimeCreations++; return runtime; },
        readTextFile: async path => {
          fileReads++;
          assert.equal(path, 'fixture.yaml');
          return 'name: fixture';
        },
      },
    };

    await createCliCommandService().run(invocation, host);

    assert.equal(runtimeCreations, 1);
    assert.equal(fileReads, command === 'execute-yaml' ? 1 : 0);
    assert.equal(runtime.closeCount, 1);
    assert.deepEqual(runtime.inputs, { name });
    assert.deepEqual(host.stdout, [`{\n  "greeting": "Hello ${name}"\n}`]);
    assert.deepEqual(host.stderr, []);
    assert.equal(host.exitCode, undefined);
  }
});

test('blueprint eval emits artifacts, writes only explicitly requested files, and reports replay', async () => {
  const seed = data.text('evaluation seed', 'seed');
  const datasetPath = data.text('dataset path', 'dataset.yaml');
  const outputPath = data.text('artifact path', 'result.json');
  const artifact = evaluationArtifact(seed, { failed: 1 });
  const host = new RecordingHost();
  const writes: Array<{ path: string; contents: string }> = [];
  let received: unknown;

  await createCliCommandService().run({
    kind: 'blueprint-eval',
    args: [datasetPath, `--seed=${seed}`, `--output=${outputPath}`],
    factories: {
      runEvaluation: async options => { received = options; return artifact; },
      writeTextFile: async (path, contents) => { writes.push({ path, contents }); },
    },
  }, host);

  assert.deepEqual(received, { datasetPath, seed });
  assert.deepEqual(writes, [{
    path: outputPath,
    contents: `${JSON.stringify(artifact, null, 2)}\n`,
  }]);
  assert.deepEqual(host.stdout, [`Evaluation artifact written to ${outputPath}`]);
  assert.deepEqual(host.stderr, [
    [
      'Evaluation failed: 1 failed, 0 errors.',
      'Blueprint: blueprint.yaml @ 1.0',
      'Fields: /',
      `Reproduce: ${artifact.replay_command}`,
      'Suggestion: Review the expected output and comparison policy for the listed fields.',
    ].join('\n'),
  ]);
  assert.equal(host.exitCode, 1);

  const stdoutHost = new RecordingHost();
  const passing = evaluationArtifact(seed);
  await createCliCommandService().run({
    kind: 'blueprint-eval',
    args: [datasetPath],
    factories: {
      runEvaluation: async options => {
        assert.deepEqual(options, { datasetPath });
        return passing;
      },
      writeTextFile: async () => { throw new Error('must not persist implicitly'); },
    },
  }, stdoutHost);
  assert.deepEqual(JSON.parse(stdoutHost.stdout[0] ?? ''), passing);
  assert.deepEqual(stdoutHost.stderr, []);
  assert.equal(stdoutHost.exitCode, undefined);
});

test('blueprint eval warns about structural scope without changing a successful exit', async () => {
  const base = evaluationArtifact(data.text('limited evaluation seed', 'seed'));
  const artifact = {
    ...base,
    cases: base.cases.map(item => ({
      ...item,
      limitations: ['factuality_not_evaluated'] as const,
    })),
  };
  const host = new RecordingHost();
  await createCliCommandService().run({
    kind: 'blueprint-eval',
    args: [data.text('limited dataset path', 'dataset.yaml')],
    factories: {
      runEvaluation: async () => artifact,
      writeTextFile: async () => { throw new Error('must not persist implicitly'); },
    },
  }, host);
  assert.deepEqual(JSON.parse(host.stdout[0] ?? ''), artifact);
  assert.match(host.stderr.join('\n'), /factuality was not evaluated/u);
  assert.equal(host.exitCode, undefined);
});

test('blueprint eval rejects malformed arguments before running or writing', async () => {
  for (const args of [
    [],
    ['dataset.yaml', 'extra.yaml'],
    ['dataset.yaml', '--unknown=value'],
    ['dataset.yaml', '--seed='],
    ['dataset.yaml', '--output='],
    ['dataset.yaml', '--seed=first', '--seed=second'],
  ]) {
    const host = new RecordingHost();
    let sideEffects = 0;
    await createCliCommandService().run({
      kind: 'blueprint-eval',
      args,
      factories: {
        runEvaluation: async () => { sideEffects++; return evaluationArtifact('unused'); },
        writeTextFile: async () => { sideEffects++; },
      },
    }, host);
    assert.equal(sideEffects, 0, JSON.stringify(args));
    assert.equal(host.exitCode, 2, JSON.stringify(args));
    assert.equal(host.stdout.length, 0, JSON.stringify(args));
  }
});

test('blueprint play selects one dataset case and defaults to offline mock mode', async () => {
  const artifact = {
    schema: 'pixiecore.blueprint-playground/v1' as const,
    dataset: { name: 'Fixture', version: '1.0.0', path: 'dataset.yaml' },
    blueprint: { path: 'fixture.yaml', version: '1.0' },
    case: { id: 'case-one', tags: ['contract'] },
    mode: 'mock' as const,
    mock: { provider: 'playground-mock', model: 'fixture', output: { value: 'expected' } },
    replay_command: 'pixiecore blueprint play dataset.yaml --case=case-one --mode=mock',
  };
  const host = new RecordingHost();
  let received: unknown;
  await createCliCommandService().run({
    kind: 'blueprint-play',
    args: ['dataset.yaml', '--case=case-one'],
    factories: {
      runPlayground: async options => { received = options; return artifact; },
    },
  }, host);
  assert.deepEqual(received, {
    datasetPath: 'dataset.yaml',
    caseId: 'case-one',
    mode: 'mock',
  });
  assert.deepEqual(JSON.parse(host.stdout[0] ?? ''), artifact);
  assert.deepEqual(host.stderr, []);

  const mismatch: BlueprintPlaygroundArtifact = {
    schema: artifact.schema,
    dataset: artifact.dataset,
    blueprint: artifact.blueprint,
    case: artifact.case,
    mode: 'real' as const,
    real: {
      provider: 'fixture-real',
      model: 'fixture-real-1',
      output: { value: 'actual' },
      comparison: {
        passed: false,
        differences: [{ pointer: '/value', reason: 'not_equal' as const }],
      },
    },
    replay_command: 'pixiecore blueprint play dataset.yaml --case=case-one --mode=real',
  };
  const mismatchHost = new RecordingHost();
  await createCliCommandService().run({
    kind: 'blueprint-play',
    args: ['dataset.yaml', '--case=case-one', '--mode=real'],
    factories: { runPlayground: async () => mismatch },
  }, mismatchHost);
  assert.equal(mismatchHost.exitCode, 1);
  assert.match(mismatchHost.stderr[0] ?? '', /Blueprint: fixture\.yaml @ 1\.0/u);
  assert.match(mismatchHost.stderr[0] ?? '', /Fields: \/value/u);
  assert.match(mismatchHost.stderr[0] ?? '', /Reproduce: pixiecore blueprint play/u);
  assert.match(mismatchHost.stderr[0] ?? '', /Suggestion:/u);

  const limitedHost = new RecordingHost();
  const limited: BlueprintPlaygroundArtifact = {
    ...mismatch,
    real: {
      ...mismatch.real!,
      comparison: { passed: true, differences: [], limitations: ['factuality_not_evaluated'] },
    },
  };
  await createCliCommandService().run({
    kind: 'blueprint-play',
    args: ['dataset.yaml', '--case=case-one', '--mode=real'],
    factories: { runPlayground: async () => limited },
  }, limitedHost);
  assert.match(limitedHost.stderr.join('\n'), /factuality was not evaluated/u);
  assert.equal(limitedHost.exitCode, undefined);

  for (const args of [
    [],
    ['dataset.yaml'],
    ['dataset.yaml', '--case='],
    ['dataset.yaml', '--case=one', '--mode=invalid'],
    ['dataset.yaml', '--case=one', '--unknown=value'],
  ]) {
    const invalidHost = new RecordingHost();
    let calls = 0;
    await createCliCommandService().run({
      kind: 'blueprint-play',
      args,
      factories: { runPlayground: async () => { calls++; return artifact; } },
    }, invalidHost);
    assert.equal(calls, 0);
    assert.equal(invalidHost.exitCode, 2);
  }
});

test('blueprint create emits a complete frozen single-operation scaffold', async () => {
  const slug = data.text('Blueprint scaffold slug', 'generated').replaceAll('_', '-');
  const directory = `/workspace/${slug}`;
  const displayName = data.text('Blueprint display name', 'Blueprint');
  const host = new RecordingHost();
  let receivedDirectory: string | undefined;
  let receivedFiles: ReturnType<typeof createBlueprintScaffoldFiles> | undefined;

  await createCliCommandService().run({
    kind: 'blueprint-create',
    args: [directory, '--operation=converter', `--name=${displayName}`],
    factories: {
      createScaffold: async (target, files) => {
        receivedDirectory = target;
        receivedFiles = files;
      },
    },
  }, host);

  assert.equal(receivedDirectory, directory);
  assert.ok(receivedFiles);
  assert.equal(Object.isFrozen(receivedFiles), true);
  assert.deepEqual(receivedFiles.map(file => file.relativePath), [
    `${slug}.yaml`,
    'README.md',
    `evaluations/${slug}.yaml`,
    `tests/${slug}.contract.test.ts`,
  ]);
  assert.equal(receivedFiles.every(file => Object.isFrozen(file)), true);
  assert.match(receivedFiles[0]!.contents, new RegExp(`name: ${JSON.stringify(displayName)}`));
  assert.match(receivedFiles[0]!.contents, /exactly one Converter operation/u);
  assert.match(receivedFiles[0]!.contents, /Feature: /u);
  assert.match(receivedFiles[0]!.contents, /Scenario: Perform one Converter operation/u);
  assert.match(receivedFiles[0]!.contents, /Given the caller supplies \{\{ input \}\}/u);
  assert.match(receivedFiles[0]!.contents, /Given .+\n\s+And .+\n\s+When .+\n\s+Then /u);
  assert.match(
    receivedFiles[0]!.contents,
    /Then the result contains only the documented Converter outcome/u,
  );
  assert.doesNotMatch(receivedFiles[0]!.contents, /Then .*JSON|Then .*output schema/u);
  assert.match(receivedFiles[3]!.contents, /from '@pixieworks\/pixiecore'/u);
  assert.doesNotMatch(receivedFiles[3]!.contents, /pixiecore\/(?:core|internal)/u);
  assert.match(receivedFiles[3]!.contents, /TEST_SEED/u);
  assert.deepEqual(host.stdout, [`Created Blueprint scaffold at ${directory}`]);
  assert.deepEqual(host.stderr, []);
  assert.equal(host.exitCode, undefined);
});

test('blueprint scaffold templates cover all eight operations with no hidden I/O', () => {
  for (const operation of BLUEPRINT_OPERATIONS) {
    const files = createBlueprintScaffoldFiles('bounded-operation', operation);
    assert.equal(files.length, 4);
    assert.match(files[0]!.contents, new RegExp(`one ${operation}`, 'iu'));
    assert.match(files[0]!.contents, /Feature: /u);
    assert.doesNotMatch(files[0]!.contents, /Then .*JSON|Then .*output schema/u);
    assert.match(files[1]!.contents, /one cognitive operation/u);
    assert.ok(files[1]!.contents.includes(
      "npx --package @pixieworks/pixiecore pixiecore execute bounded-operation.yaml --inputs='{\"input\":\"fixture input\"}'",
    ));
    assert.ok(files[1]!.contents.includes(
      'npx --package @pixieworks/pixiecore pixiecore blueprint eval evaluations/bounded-operation.yaml',
    ));
    assert.doesNotMatch(files[1]!.contents, /npx pixiecore/u);
    assert.match(files[2]!.contents, new RegExp(`tags: \\[${operation}, scaffold\\]`, 'u'));
  }
});

test('blueprint create rejects unsafe or incomplete arguments before filesystem writes', async () => {
  for (const args of [
    [],
    ['one', 'two', '--operation=converter'],
    ['unit'],
    ['unit', '--operation=unknown'],
    ['unit', '--operation=converter', '--operation=router'],
    ['Not Valid', '--operation=converter'],
    ['unit', '--operation=converter', '--name='],
    ['unit', '--operation=converter', '--unknown=value'],
  ]) {
    const host = new RecordingHost();
    let writes = 0;
    await createCliCommandService().run({
      kind: 'blueprint-create',
      args,
      factories: { createScaffold: async () => { writes++; } },
    }, host);
    assert.equal(writes, 0, JSON.stringify(args));
    assert.equal(host.exitCode, 2, JSON.stringify(args));
    assert.equal(host.stdout.length, 0, JSON.stringify(args));
  }
});

test('blueprint validate, test, and inspect share one offline command workflow', async () => {
  const inspection = {
    name: data.text('inspected Blueprint name', 'Blueprint'),
    version: '0.1.0',
    role: 'assistant',
    input_fields: ['input'],
    has_input_schema: true,
    tool_names: [],
  } as const;
  const unitResult = {
    valid: true as const,
    unit: 'bounded-unit',
    blueprint: 'bounded-unit.yaml',
    version: '0.1.0',
    dataset: 'evaluations/bounded-unit.yaml',
    contract_test: 'tests/bounded-unit.contract.test.ts',
  };
  for (const command of ['validate', 'inspect', 'test'] as const) {
    const host = new RecordingHost();
    let inspected = 0;
    let tested = 0;
    await createCliCommandService().run({
      kind: 'blueprint-check',
      command,
      args: [command === 'test' ? 'bounded-unit' : 'bounded-unit/bounded-unit.yaml'],
      factories: {
        inspectBlueprint: async () => { inspected++; return inspection; },
        testBlueprintUnit: async () => { tested++; return unitResult; },
      },
    }, host);
    assert.equal(inspected, command === 'test' ? 0 : 1);
    assert.equal(tested, command === 'test' ? 1 : 0);
    assert.deepEqual(host.stderr, []);
    if (command === 'validate') {
      assert.deepEqual(host.stdout, [`Blueprint valid: ${inspection.name} (0.1.0)`]);
    } else {
      assert.deepEqual(
        JSON.parse(host.stdout[0] ?? ''),
        command === 'inspect' ? inspection : unitResult,
      );
    }
  }
});

test('blueprint checks reject extra arguments before inspection or testing', async () => {
  for (const command of ['validate', 'inspect', 'test'] as const) {
    for (const args of [[], ['one', 'two'], ['--unknown=value']]) {
      const host = new RecordingHost();
      let calls = 0;
      await createCliCommandService().run({
        kind: 'blueprint-check',
        command,
        args,
        factories: {
          inspectBlueprint: async () => { calls++; throw new Error('must not inspect'); },
          testBlueprintUnit: async () => { calls++; throw new Error('must not test'); },
        },
      }, host);
      assert.equal(calls, 0);
      assert.equal(host.exitCode, 2);
    }
  }
});

test('application inspect emits offline JSON or Mermaid and rejects malformed options', async () => {
  const inspection = {
    schema: 'pixiecore.application-graph-inspection/v1' as const,
    name: data.text('application inspection name', 'Application'),
    version: '1.0.0',
    nodes: [],
    edges: [],
  };
  for (const format of ['json', 'mermaid'] as const) {
    const host = new RecordingHost();
    let inspections = 0;
    await createCliCommandService().run({
      kind: 'application-inspect',
      args: ['application.graph.yaml', `--format=${format}`],
      factories: {
        inspectApplication: async path => {
          inspections++;
          assert.equal(path, 'application.graph.yaml');
          return inspection;
        },
        renderMermaid: value => {
          assert.equal(value, inspection);
          return 'flowchart TD';
        },
      },
    }, host);
    assert.equal(inspections, 1);
    assert.deepEqual(host.stderr, []);
    assert.equal(
      host.stdout[0],
      format === 'json' ? JSON.stringify(inspection, null, 2) : 'flowchart TD',
    );
  }

  for (const args of [[], ['one', 'two'], ['graph.yaml', '--format=dot'], ['--unknown=x']]) {
    const host = new RecordingHost();
    let calls = 0;
    await createCliCommandService().run({
      kind: 'application-inspect',
      args,
      factories: {
        inspectApplication: async () => { calls++; return inspection; },
        renderMermaid: () => 'must not render',
      },
    }, host);
    assert.equal(calls, 0);
    assert.equal(host.exitCode, 2);
  }
});

test('CLI usage and operational failures preserve stderr and exit contracts', async () => {
  let runtimeCreations = 0;
  const invalidHost = new RecordingHost();
  await createCliCommandService().run({
    kind: 'execute',
    command: 'execute',
    args: ['unused.yaml', '--inputs=[]'],
    factories: {
      createRuntime: () => { runtimeCreations++; return new RecordingRuntime(); },
      readTextFile: async () => 'unused',
    },
  }, invalidHost);
  assert.equal(runtimeCreations, 0);
  assert.deepEqual(invalidHost.stdout, []);
  assert.deepEqual(invalidHost.stderr, ['--inputs must be a JSON object']);
  assert.equal(invalidHost.exitCode, 2);

  const usageHost = new RecordingHost();
  await createCliCommandService().run({ kind: 'usage' }, usageHost);
  assert.match(usageHost.stderr[0] ?? '', /^Usage: pixiecore serve \| mcp serve /);
  assert.equal(usageHost.exitCode, 2);

  const failureHost = new RecordingHost();
  const failingRuntime = new RecordingRuntime(new Error('provider unavailable'));
  await createCliCommandService().run({
    kind: 'execute',
    command: 'execute',
    args: ['fixture.yaml'],
    factories: {
      createRuntime: () => failingRuntime,
      readTextFile: async () => 'unused',
    },
  }, failureHost);
  assert.deepEqual(failureHost.stdout, []);
  assert.deepEqual(failureHost.stderr, ['PixieCore: provider unavailable']);
  assert.doesNotMatch(failureHost.stderr[0] ?? '', /\n\s+at /);
  assert.equal(failureHost.exitCode, 1);
  assert.equal(failingRuntime.closeCount, 1);
});

test('serve preserves listen, signal, shutdown, and listen-failure behavior', async () => {
  const host = new RecordingHost();
  const server = new RecordingApiServer();
  let environmentResolutions = 0;
  let appCreations = 0;

  await createCliCommandService().run(serveInvocation(server, {
    resolveEnvironment: () => {
      environmentResolutions++;
      return { PIXIECORE_API_HOST: '127.0.0.1', PIXIECORE_API_PORT: '4321' };
    },
    onCreateApp: environment => {
      appCreations++;
      assert.equal(environment.PIXIECORE_API_PORT, '4321');
    },
  }), host);

  assert.equal(environmentResolutions, 1);
  assert.equal(appCreations, 1);
  assert.deepEqual(server.listenCalls, [[4321, '127.0.0.1']]);
  assert.deepEqual(host.stdout, ['PixieCore API listening on http://127.0.0.1:4321']);
  assert.deepEqual([...host.signals.keys()], ['SIGINT', 'SIGTERM']);

  host.emitSignal('SIGTERM');
  await flushTasks();
  assert.equal(server.closeCount, 1);
  assert.equal(server.closeResourcesCount, 1);
  assert.deepEqual(host.stdout, [
    'PixieCore API listening on http://127.0.0.1:4321',
    'PixieCore API received SIGTERM; shutting down',
  ]);

  host.emitSignal('SIGINT');
  await flushTasks();
  assert.equal(server.closeCount, 1);
  assert.equal(server.closeResourcesCount, 1);

  const failureHost = new RecordingHost();
  const listenError = new RecordingApiServer(new Error('address in use'));
  await createCliCommandService().run(serveInvocation(listenError), failureHost);
  assert.deepEqual(failureHost.stdout, []);
  assert.deepEqual(failureHost.stderr, ['PixieCore: address in use']);
  assert.equal(failureHost.exitCode, 1);
  assert.equal(listenError.closeResourcesCount, 1);
  assert.deepEqual(failureHost.signals, new Map());

  const shutdownHost = new RecordingHost();
  const shutdownError = new RecordingApiServer(
    undefined,
    new Error('shutdown failed'),
  );
  await createCliCommandService().run(
    serveInvocation(shutdownError),
    shutdownHost,
  );
  shutdownHost.emitSignal('SIGINT');
  await flushTasks();
  assert.deepEqual(shutdownHost.stderr, ['PixieCore: shutdown failed']);
  assert.equal(shutdownHost.exitCode, 1);
  assert.equal(shutdownError.closeCount, 1);
  assert.equal(shutdownError.closeResourcesCount, 0);
});

test('serve defaults to loopback and requires a token for external binding', async () => {
  const defaultHost = new RecordingHost();
  const defaultServer = new RecordingApiServer();
  await createCliCommandService().run(serveInvocation(defaultServer), defaultHost);
  assert.deepEqual(defaultServer.listenCalls, [[8000, '127.0.0.1']]);
  defaultHost.emitSignal('SIGTERM');
  await flushTasks();

  const rejectedHost = new RecordingHost();
  let rejectedCreations = 0;
  await createCliCommandService().run(serveInvocation(new RecordingApiServer(), {
    resolveEnvironment: () => ({
      PIXIECORE_API_HOST: '0.0.0.0',
      PIXIECORE_API_TOKEN: '   ',
    }),
    onCreateApp: () => { rejectedCreations++; },
  }), rejectedHost);
  assert.equal(rejectedCreations, 0);
  assert.deepEqual(rejectedHost.stderr, [
    'PIXIECORE_API_TOKEN is required when PIXIECORE_API_HOST is not loopback',
  ]);
  assert.equal(rejectedHost.exitCode, 2);

  const authenticatedHost = new RecordingHost();
  const authenticatedServer = new RecordingApiServer();
  await createCliCommandService().run(serveInvocation(authenticatedServer, {
    resolveEnvironment: () => ({
      PIXIECORE_API_HOST: '0.0.0.0',
      PIXIECORE_API_PORT: '4322',
      PIXIECORE_API_TOKEN: data.text('external bearer', 'token'),
    }),
  }), authenticatedHost);
  assert.deepEqual(authenticatedServer.listenCalls, [[4322, '0.0.0.0']]);
  authenticatedHost.emitSignal('SIGTERM');
  await flushTasks();
});

test('serve uses PixieCore API environment variables', async () => {
  const host = new RecordingHost();
  const server = new RecordingApiServer();
  await createCliCommandService().run(serveInvocation(server, {
    resolveEnvironment: () => ({
      PIXIECORE_API_HOST: '127.0.0.1',
      PIXIECORE_API_PORT: '4323',
    }),
  }), host);
  assert.deepEqual(server.listenCalls, [[4323, '127.0.0.1']]);
  host.emitSignal('SIGTERM');
  await flushTasks();
});

class RecordingRuntime implements CliRuntimePort {
  closeCount = 0;
  inputs: Record<string, unknown> | undefined;

  constructor(private readonly failure?: Error) {}

  async execute(
    _path: string,
    inputs: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    return this.result(inputs);
  }

  async executeYaml(
    _yaml: string,
    inputs: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    return this.result(inputs);
  }

  close(): void { this.closeCount++; }

  private result(inputs: Record<string, unknown>): Record<string, unknown> {
    this.inputs = inputs;
    if (this.failure) throw this.failure;
    return { greeting: `Hello ${String(inputs.name)}` };
  }
}

class RecordingHost implements CliHostPort {
  readonly stdout: string[] = [];
  readonly stderr: string[] = [];
  readonly signals = new Map<CliSignal, () => void>();
  exitCode: 1 | 2 | undefined;

  writeStdout(line: string): void { this.stdout.push(line); }
  writeStderr(line: string): void { this.stderr.push(line); }
  setExitCode(code: 1 | 2): void { this.exitCode = code; }
  onceSignal(signal: CliSignal, listener: () => void): void {
    this.signals.set(signal, listener);
  }
  emitSignal(signal: CliSignal): void {
    const listener = this.signals.get(signal);
    this.signals.delete(signal);
    listener?.();
  }
}

class RecordingApiServer extends EventEmitter {
  listening = false;
  readonly listenCalls: Array<[number, string]> = [];
  closeCount = 0;
  closeResourcesCount = 0;
  private closePromise: Promise<void> | undefined;

  constructor(
    private readonly listenFailure?: Error,
    private readonly closeFailure?: Error,
  ) { super(); }

  listen(port: number, host: string): this {
    this.listenCalls.push([port, host]);
    queueMicrotask(() => {
      if (this.listenFailure) {
        this.emit('error', this.listenFailure);
        return;
      }
      this.listening = true;
      this.emit('listening');
    });
    return this;
  }

  close(callback?: (error?: Error) => void): this {
    this.closeCount++;
    this.listening = false;
    queueMicrotask(() => {
      this.emit('close');
      callback?.(this.closeFailure);
    });
    return this;
  }

  closeResources(): Promise<void> {
    return this.closePromise ??= Promise.resolve().then(() => {
      this.closeResourcesCount++;
    });
  }

  asPixieCoreServer(): PixieCoreApiServer {
    return this as unknown as PixieCoreApiServer;
  }
}

function serveInvocation(
  server: RecordingApiServer,
  options: {
    resolveEnvironment?: () => NodeJS.ProcessEnv;
    onCreateApp?: (environment: NodeJS.ProcessEnv) => void;
  } = {},
): CliCommandInvocation {
  return {
    kind: 'serve',
    args: [],
    factories: {
      resolveEnvironment: options.resolveEnvironment ?? (() => ({})),
      createApp: environment => {
        options.onCreateApp?.(environment);
        return server.asPixieCoreServer();
      },
    },
  };
}

function activateCliService(): ScopedServiceRegistry {
  const services = new ScopedServiceRegistry();
  const context: PluginActivationContext = {
    services,
    own: () => undefined,
    registerExtension: () => undefined,
    registerAgentRole: () => undefined,
    registerDecorator: () => undefined,
    registerTool: () => undefined,
    registerProvider: (_provider: Provider) => undefined,
    registerProviderFactory: () => undefined,
  };
  assert.equal(createCorePluginActivator().activate(context), undefined);
  return services;
}

function signalListenerCounts(): readonly number[] {
  return [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')];
}

function coreActivation(
  manager: PluginManager,
  ids: readonly string[],
): Record<string, boolean> {
  const status = new Map(
    manager.getPluginStatus().plugins.map(plugin => [plugin.id, plugin.activated]),
  );
  return Object.fromEntries(ids.map(id => [id, status.get(id) ?? false]));
}

async function flushTasks(): Promise<void> {
  await new Promise<void>(resolve => { setImmediate(resolve); });
}

function evaluationArtifact(
  seed: string,
  failures: { failed?: number; errors?: number } = {},
): BlueprintEvaluationResultArtifact {
  const failed = failures.failed ?? 0;
  const errors = failures.errors ?? 0;
  const passed = failed === 0 && errors === 0 ? 1 : 0;
  return {
    schema: 'pixiecore.blueprint-eval-result/v1',
    dataset: {
      name: 'fixture', version: '1.0.0', path: 'dataset.yaml', sha256: 'a'.repeat(64),
    },
    blueprint: {
      path: 'blueprint.yaml', version: '1.0', sha256: 'b'.repeat(64),
    },
    run: {
      id: '00000000-0000-4000-8000-000000000000',
      seed,
      seed_scope: 'runner',
      started_at: '2026-01-01T00:00:00.000Z',
      completed_at: '2026-01-01T00:00:01.000Z',
      provider: 'fixture',
      model: 'fixture-1',
      temperature: 0,
    },
    summary: { total: passed + failed + errors, passed, failed, errors },
    cases: [{
      id: 'fixture',
      tags: ['contract'],
      status: failed ? 'failed' : errors ? 'error' : 'passed',
      duration_ms: 1,
      ...(errors ? { error: { name: 'Error', message: 'failure' } } : {
        actual_output: { result: 'fixture' },
        differences: failed ? [{ pointer: '', reason: 'not_equal' as const }] : [],
      }),
    }],
    replay_command: `pixiecore blueprint eval dataset.yaml --seed=${seed}`,
  };
}
