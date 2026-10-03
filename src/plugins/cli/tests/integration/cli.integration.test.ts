import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:net';
import { join, resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import type { BlueprintEvaluationResultArtifact } from '../../../../core/contracts/evaluation/index.js';
import { BlueprintValidator } from '../../../../plugins/validation/validation.js';
import { testCliNodeArguments } from '../../../../../tests/helpers/cli.js';
import { testData } from '../../../../../tests/helpers/test-data.js';
import { withTempDirectory } from '../../../../../tests/helpers/temp.js';

const repositoryRoot = resolve('.');
const data = testData('CLI integration');
const USAGE = 'Usage: pixiecore serve | mcp serve | execute <blueprint.yaml> [--inputs={...}] | execute-yaml <file> [--inputs={...}] | blueprint create <directory> --operation=<operation> [--name=<name>] | blueprint validate <blueprint.yaml> | blueprint test <unit-directory> | blueprint eval <dataset.yaml> [--seed=<seed>] [--output=<result.json>] | blueprint inspect <blueprint.yaml> | blueprint play <dataset.yaml> --case=<id> [--mode=mock|real|both] | application inspect <application.graph.yaml> [--format=json|mermaid] | plugin <command> ...';
const PROCESS_DEADLINE_MS = 15_000;

interface CliResult {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
}

interface RunningCli {
  readonly child: ChildProcessWithoutNullStreams;
  readonly completion: Promise<CliResult>;
  waitForStdout(expected: string): Promise<void>;
}

test('CLI subprocess contract matrix', { concurrency: 4 }, async t => {
  const cases: Array<Promise<void>> = [];
  const addCase = (
    name: string,
    task: (context: TestContext) => Promise<void>,
  ): void => {
    cases.push(t.test(name, task));
  };

  addCase('no command returns exact usage on stderr', async () => {
    assertCliResult(await runCli([]), 2, '', `${USAGE}\n`);
  });

  addCase('unknown command returns exact usage on stderr', async () => {
    const command = data.text('unknown command', 'command');
    assertCliResult(await runCli([command]), 2, '', `${USAGE}\n`);
  });

  addCase('blueprint create writes a valid complete unit without overwriting it', async () => {
    await withTempDirectory(async directory => {
      const slug = data.text('created Blueprint slug', 'created').replaceAll('_', '-');
      const target = join(directory, slug);
      const displayName = data.text('created Blueprint name', 'Blueprint');
      assertCliResult(
        await runCli([
          'blueprint',
          'create',
          target,
          '--operation=converter',
          `--name=${displayName}`,
        ]),
        0,
        `Created Blueprint scaffold at ${target}\n`,
        '',
      );

      const blueprintPath = join(target, `${slug}.yaml`);
      const original = await readFile(blueprintPath, 'utf8');
      const blueprint = await new BlueprintValidator({ warn: () => undefined })
        .validateFile(blueprintPath);
      assert.equal(blueprint.name, displayName);
      assert.equal(blueprint.version, '0.1.0');
      assert.match(await readFile(join(target, 'README.md'), 'utf8'), /one cognitive operation/u);
      assert.match(
        await readFile(join(target, 'evaluations', `${slug}.yaml`), 'utf8'),
        new RegExp(`path: \\.\\.\\/${slug}\\.yaml`, 'u'),
      );
      assert.match(
        await readFile(join(target, 'tests', `${slug}.contract.test.ts`), 'utf8'),
        /randomUUID/u,
      );

      const [validation, inspection, unitTest] = await Promise.all([
        runCli(['blueprint', 'validate', blueprintPath]),
        runCli(['blueprint', 'inspect', blueprintPath]),
        runCli(['blueprint', 'test', target]),
      ]);
      assertCliResult(
        validation,
        0,
        `Blueprint valid: ${displayName} (0.1.0)\n`,
        '',
      );
      assert.equal(inspection.code, 0);
      assert.deepEqual(JSON.parse(inspection.stdout), {
        name: displayName,
        version: '0.1.0',
        role: 'assistant',
        input_fields: ['input'],
        has_input_schema: true,
        tool_names: [],
      });
      assert.equal(unitTest.code, 0, unitTest.stderr || unitTest.stdout);
      assert.deepEqual(JSON.parse(unitTest.stdout), {
        valid: true,
        unit: slug,
        blueprint: `${slug}.yaml`,
        version: '0.1.0',
        dataset: `evaluations/${slug}.yaml`,
        contract_test: `tests/${slug}.contract.test.ts`,
      });

      const repeated = await runCli([
        'blueprint',
        'create',
        target,
        '--operation=router',
      ]);
      assert.equal(repeated.code, 1);
      assert.equal(repeated.stdout, '');
      assert.match(repeated.stderr, /^PixieCore: /u);
      assert.equal(await readFile(blueprintPath, 'utf8'), original);
    });
  });

  addCase('application inspect renders packaged schemas as JSON and Mermaid offline', async () => {
    const graph = join(
      repositoryRoot,
      'examples',
      'application-composition',
      'publication-brief.graph.yaml',
    );
    const [jsonResult, mermaidResult] = await Promise.all([
      runCli(['application', 'inspect', graph]),
      runCli(['application', 'inspect', graph, '--format=mermaid']),
    ]);
    assert.equal(jsonResult.code, 0);
    assert.equal(jsonResult.stderr, '');
    const inspection = JSON.parse(jsonResult.stdout) as {
      schema: string;
      nodes: Array<{ id: string; input_schema: unknown; output_schema: unknown }>;
      edges: Array<{ from: string; to: string }>;
    };
    assert.equal(inspection.schema, 'pixiecore.application-graph-inspection/v1');
    assert.equal(inspection.nodes.length, 5);
    assert.equal(inspection.edges.length, 6);
    assert.ok(inspection.nodes.every(node => node.input_schema && node.output_schema));

    assert.equal(mermaidResult.code, 0);
    assert.equal(mermaidResult.stderr, '');
    assert.match(mermaidResult.stdout, /^flowchart TD\n/u);
    assert.match(mermaidResult.stdout, /extract-brief/u);
    assert.match(mermaidResult.stdout, /node_\d+ --> node_\d+/u);
  });

  addCase('blueprint play executes one packaged dataset case in offline mock mode', async () => {
    const dataset = join(
      repositoryRoot,
      'examples',
      'blueprints',
      'converter',
      'date-normalizer',
      'evaluations',
      'date-normalizer.yaml',
    );
    const result = await runCli([
      'blueprint',
      'play',
      dataset,
      '--case=japanese-gregorian',
    ]);
    assert.equal(result.code, 0);
    assert.equal(result.stderr, '');
    const artifact = JSON.parse(result.stdout) as {
      schema: string;
      mode: string;
      mock: { provider: string; output: unknown };
      real?: unknown;
    };
    assert.equal(artifact.schema, 'pixiecore.blueprint-playground/v1');
    assert.equal(artifact.mode, 'mock');
    assert.equal(artifact.mock.provider, 'playground-mock');
    assert.deepEqual(artifact.mock.output, {
      status: 'converted',
      normalized_date: '2026-02-04',
      reason_code: 'none',
    });
    assert.equal(artifact.real, undefined);
  });

  addCase('missing file is an operational failure without a stack trace', async () => {
    await withTempDirectory(async directory => {
      const path = join(directory, data.text('missing blueprint', 'blueprint'));
      const expected = await readFailureMessage(path);
      assertCliResult(
        await runCli(['execute-yaml', path]),
        1,
        '',
        `PixieCore: ${expected}\n`,
      );
    });
  });

  addCase('unreadable file is an operational failure when permissions are enforceable', async t => {
    await withTempDirectory(async directory => {
      const path = join(directory, data.text('unreadable blueprint', 'blueprint'));
      await writeFile(path, validBlueprint(), 'utf8');
      try {
        await chmod(path, 0o000);
      } catch {
        t.skip('This platform cannot remove blueprint read permissions');
        return;
      }

      try {
        let expected: string;
        try {
          expected = await readFailureMessage(path);
        } catch {
          t.skip('This process can read permission-free blueprint files');
          return;
        }
        assertCliResult(
          await runCli(['execute-yaml', path]),
          1,
          '',
          `PixieCore: ${expected}\n`,
        );
      } finally {
        await chmod(path, 0o600);
      }
    });
  });

  addCase('malformed JSON returns a usage error without starting execution', async () => {
    const malformed = '{';
    const expected = jsonFailureMessage(malformed);
    assertCliResult(
      await runCli(['execute', 'unused.yaml', `--inputs=${malformed}`]),
      2,
      '',
      `--inputs must be valid JSON: ${expected}\n`,
    );
  });

  addCase('non-object JSON returns a usage error without a stack trace', async () => {
    assertCliResult(
      await runCli(['execute', 'unused.yaml', '--inputs=[]']),
      2,
      '',
      '--inputs must be a JSON object\n',
    );
  });

  addCase('runtime failure uses operational exit code and sanitized stderr', async () => {
    await withTempDirectory(async directory => {
      const blueprint = join(directory, data.text('runtime failure blueprint', 'blueprint'));
      const provider = data.text('missing provider', 'provider');
      await writeFile(blueprint, validBlueprint(), 'utf8');

      assertCliResult(
        await runCli(['execute-yaml', blueprint], {
          PROMPT_RUNTIME_PROVIDER: provider,
          PROMPT_RUNTIME_PLUGINS_DIR: undefined,
        }),
        1,
        '',
        `PixieCore: Unknown provider: ${provider}\n`,
      );
    });
  });

  addCase('execute and execute-yaml write only structured results to stdout', async () => {
    await withTempDirectory(async directory => {
      const fixture = await writeExecutionFixture(directory);
      await Promise.all((['execute', 'execute-yaml'] as const).map(async command => {
        const result = await runCli([
          command,
          fixture.blueprint,
          `--inputs=${JSON.stringify({ name: fixture.name })}`,
        ], fixture.environment);
        assert.equal(result.code, 0);
        assert.equal(result.signal, null);
        assert.deepEqual(JSON.parse(result.stdout), {
          greeting: `Hello ${fixture.name}`,
        });
        assert.equal(result.stderr, '');
      }));
    });
  });

  addCase('blueprint eval emits a replayable artifact and persists only with --output', async () => {
    await withTempDirectory(async directory => {
      const fixture = await writeEvaluationFixture(directory);
      const seed = data.text('CLI evaluation seed', 'seed');
      const output = join(directory, data.text('CLI evaluation artifact', 'result.json'));
      const [passed, written] = await Promise.all([
        runCli([
          'blueprint',
          'eval',
          fixture.dataset,
          `--seed=${seed}`,
        ], fixture.environment),
        runCli([
          'blueprint',
          'eval',
          fixture.dataset,
          `--seed=${seed}`,
          `--output=${output}`,
        ], fixture.environment),
      ]);
      assert.equal(passed.code, 0);
      assert.equal(passed.stderr, '');
      const artifact = JSON.parse(passed.stdout) as BlueprintEvaluationResultArtifact;
      assert.equal(artifact.schema, 'pixiecore.blueprint-eval-result/v1');
      assert.equal(artifact.run.seed, seed);
      assert.deepEqual(artifact.summary, { total: 1, passed: 1, failed: 0, errors: 0 });

      assertCliResult(
        written,
        0,
        `Evaluation artifact written to ${output}\n`,
        '',
      );
      assert.deepEqual(
        JSON.parse(await readFile(output, 'utf8')).summary,
        artifact.summary,
      );
    });
  });

  addCase('blueprint eval returns one with the exact same-seed replay command on mismatch', async () => {
    await withTempDirectory(async directory => {
      const fixture = await writeEvaluationFixture(directory, 'different');
      const seed = data.text('CLI failing evaluation seed', 'seed');
      const result = await runCli([
        'blueprint',
        'eval',
        fixture.dataset,
        `--seed=${seed}`,
      ], fixture.environment);
      assert.equal(result.code, 1);
      const artifact = JSON.parse(result.stdout) as BlueprintEvaluationResultArtifact;
      assert.deepEqual(artifact.summary, { total: 1, passed: 0, failed: 1, errors: 0 });
      assert.equal(artifact.run.seed, seed);
      assert.match(result.stderr, /Evaluation failed: 1 failed, 0 errors\./u);
      assert.match(result.stderr, /Blueprint: .*fixture\.yaml @ 1\.0/u);
      assert.match(result.stderr, /Fields: \/(?:\n|$)/u);
      assert.match(result.stderr, new RegExp(`Reproduce: ${artifact.replay_command}`));
      assert.match(result.stderr, /Suggestion:/u);
      assert.match(artifact.replay_command, new RegExp(`--seed=${seed}$`));
    });
  });

  addCase('serve reports a listen failure and exits without remaining alive', async () => {
    const blocker = await listenOnLoopback();
    try {
      const result = await runCli(['serve'], {
        PIXIECORE_API_HOST: '127.0.0.1',
        PIXIECORE_API_PORT: String(blocker.port),
      });
      assertCliResult(
        result,
        1,
        '',
        `PixieCore: listen EADDRINUSE: address already in use 127.0.0.1:${blocker.port}\n`,
      );
    } finally {
      await closeServer(blocker.server);
    }
  });

  addCase('serve handles repeated termination signals with one clean shutdown', async () => {
    const reservation = await listenOnLoopback();
    const port = reservation.port;
    await closeServer(reservation.server);
    const running = spawnCli(['serve'], {
      PIXIECORE_API_HOST: '127.0.0.1',
      PIXIECORE_API_PORT: String(port),
    });
    const pid = running.child.pid;
    assert.ok(pid !== undefined);

    try {
      await running.waitForStdout(`PixieCore API listening on http://127.0.0.1:${port}\n`);
      assert.equal(running.child.kill('SIGTERM'), true);
      running.child.kill('SIGINT');
      const result = await running.completion;

      assert.equal(result.code, 0);
      assert.equal(result.signal, null);
      assert.equal(result.stderr, '');
      const stdoutLines = result.stdout.trimEnd().split('\n');
      assert.deepEqual(stdoutLines.slice(0, 1), [
        `PixieCore API listening on http://127.0.0.1:${port}`,
      ]);
      assert.equal(stdoutLines.length, 2);
      assert.match(
        stdoutLines[1] ?? '',
        /^PixieCore API received SIG(?:TERM|INT); shutting down$/,
      );
      assert.equal(processExists(pid), false);
    } finally {
      await stopCli(running);
    }
  });

  await Promise.all(cases);
});

function validBlueprint(): string {
  return `
name: CLI
version: '1.0'
role: assistant
prompt: Hello {{ name }}
input_placeholders:
  - name: name
    type: string
    required: true
output_schema: '{"type":"object","properties":{"greeting":{"type":"string"}},"required":["greeting"]}'
`;
}

async function writeExecutionFixture(directory: string): Promise<{
  readonly blueprint: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly name: string;
}> {
  const name = data.person('input name');
  const pluginDirectory = join(directory, 'plugins', data.text('plugin directory', 'fixture'));
  await mkdir(pluginDirectory, { recursive: true });
  await writeFile(join(pluginDirectory, 'plugin.yml'), `
name: CLI fixture
module: ./provider.mjs
`, 'utf8');
  await writeFile(join(pluginDirectory, 'provider.mjs'), `
export default {
  providers: [{
    name: 'cli_fixture', model: 'cli-fixture-1', supportsTools: true, supportsMultimodal: true,
    supportsVision() { return true; }, supportsFileInput() { return true; },
    async getModelList() { return ['cli-fixture-1']; },
    async generate(request) {
      const prompt = [...request.messages].reverse().find(message => message.role === 'user')?.content ?? '';
      return { content: JSON.stringify({ greeting: String(prompt) }) };
    },
  }],
};
`, 'utf8');
  const blueprint = join(directory, data.text('success blueprint', 'blueprint'));
  await writeFile(blueprint, validBlueprint(), 'utf8');
  return {
    blueprint,
    environment: {
      PROMPT_RUNTIME_PROVIDER: 'cli_fixture',
      PROMPT_RUNTIME_PLUGINS_DIR: join(directory, 'plugins'),
    },
    name,
  };
}

async function writeEvaluationFixture(
  directory: string,
  expected = 'actual',
): Promise<{
  readonly dataset: string;
  readonly environment: NodeJS.ProcessEnv;
}> {
  const pluginDirectory = join(directory, 'plugins', data.text('evaluation plugin', 'fixture'));
  const blueprintDirectory = join(directory, 'blueprints');
  const evaluationDirectory = join(directory, 'evaluations');
  await Promise.all([
    mkdir(pluginDirectory, { recursive: true }),
    mkdir(blueprintDirectory, { recursive: true }),
    mkdir(evaluationDirectory, { recursive: true }),
  ]);
  await writeFile(join(directory, 'package.json'), JSON.stringify({
    name: data.text('evaluation project name', 'evaluation-project'),
    private: true,
  }), 'utf8');
  await writeFile(join(pluginDirectory, 'plugin.yml'), `
name: CLI evaluation fixture
module: ./provider.mjs
`, 'utf8');
  await writeFile(join(pluginDirectory, 'provider.mjs'), `
export default {
  providers: [{
    name: 'cli_eval_fixture', model: 'cli-eval-fixture-1', supportsTools: true, supportsMultimodal: true,
    supportsVision() { return true; }, supportsFileInput() { return true; },
    async getModelList() { return ['cli-eval-fixture-1']; },
    async generate() { return { content: JSON.stringify({ value: 'actual' }) }; },
  }],
};
`, 'utf8');
  await writeFile(join(blueprintDirectory, 'fixture.yaml'), `
name: CLI evaluation
version: '1.0'
role: assistant
prompt: Return the fixture value
temperature: 0
output_schema:
  type: object
  additionalProperties: false
  required: [value]
  properties:
    value: { type: string }
`, 'utf8');
  const dataset = join(evaluationDirectory, 'dataset.yaml');
  await writeFile(dataset, `
schema: pixiecore.blueprint-eval-dataset/v1
name: CLI evaluation
version: 1.0.0
blueprint:
  path: ../blueprints/fixture.yaml
  version: '1.0'
tags: [cli]
cases:
  - id: cli-case
    tags: [contract]
    inputs: {}
    expected_output:
      value: ${JSON.stringify(expected)}
    comparison: { mode: exact }
`, 'utf8');
  return {
    dataset,
    environment: {
      PROMPT_RUNTIME_PROVIDER: 'cli_eval_fixture',
      PROMPT_RUNTIME_PLUGINS_DIR: join(directory, 'plugins'),
    },
  };
}

function runCli(
  args: readonly string[],
  environment: NodeJS.ProcessEnv = {},
): Promise<CliResult> {
  return spawnCli(args, environment).completion;
}

function spawnCli(
  args: readonly string[],
  environment: NodeJS.ProcessEnv = {},
): RunningCli {
  const child = spawn(process.execPath, testCliNodeArguments(args), {
    cwd: repositoryRoot,
    env: cliEnvironment(environment),
    stdio: ['pipe', 'pipe', 'pipe'],
    signal: AbortSignal.timeout(PROCESS_DEADLINE_MS),
  });
  child.stdin.end();
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk: string) => { stdout += chunk; });
  child.stderr.on('data', (chunk: string) => { stderr += chunk; });
  const completion = new Promise<CliResult>((resolvePromise, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => {
      resolvePromise({ code, signal, stdout, stderr });
    });
  });

  return {
    child,
    completion,
    waitForStdout(expected): Promise<void> {
      if (stdout.includes(expected)) return Promise.resolve();
      return new Promise((resolvePromise, reject) => {
        const onData = (): void => {
          if (!stdout.includes(expected)) return;
          cleanup();
          resolvePromise();
        };
        const onClose = (): void => {
          cleanup();
          reject(new Error(`CLI exited before stdout contained ${JSON.stringify(expected)}; stdout=${JSON.stringify(stdout)} stderr=${JSON.stringify(stderr)}`));
        };
        const cleanup = (): void => {
          child.stdout.off('data', onData);
          child.off('close', onClose);
        };
        child.stdout.on('data', onData);
        child.once('close', onClose);
      });
    },
  };
}

function cliEnvironment(overrides: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    PROMPT_RUNTIME_LOG_TO_FILE: 'false',
    PROMPT_RUNTIME_ENV_FILE: undefined,
    PROMPT_RUNTIME_PLUGINS_DIR: undefined,
    PIXIECORE_PLUGIN_CONFIG: undefined,
    MCP_CONFIG_PATH: undefined,
    ...overrides,
  };
  for (const [name, value] of Object.entries(environment)) {
    if (value === undefined) delete environment[name];
  }
  return environment;
}

function assertCliResult(
  result: CliResult,
  code: number,
  stdout: string,
  stderr: string,
): void {
  assert.equal(result.code, code);
  assert.equal(result.signal, null);
  assert.equal(result.stdout, stdout);
  assert.equal(result.stderr, stderr);
  assert.doesNotMatch(result.stderr, /\n\s+at /);
}

async function readFailureMessage(path: string): Promise<string> {
  try {
    await readFile(path, 'utf8');
  } catch (error) {
    assert.ok(error instanceof Error);
    return error.message;
  }
  throw new Error(`Expected read to fail: ${path}`);
}

function jsonFailureMessage(value: string): string {
  try {
    JSON.parse(value);
  } catch (error) {
    assert.ok(error instanceof Error);
    return error.message;
  }
  throw new Error(`Expected JSON.parse to fail: ${value}`);
}

async function listenOnLoopback(): Promise<{ readonly server: Server; readonly port: number }> {
  const server = createServer();
  await new Promise<void>((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolvePromise());
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return { server, port: address.port };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    server.close(error => error ? reject(error) : resolvePromise());
  });
}

async function stopCli(running: RunningCli): Promise<void> {
  if (running.child.exitCode === null && running.child.signalCode === null) {
    running.child.kill('SIGKILL');
  }
  await running.completion.catch(() => undefined);
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    assert.ok(error instanceof Error && 'code' in error);
    assert.equal((error as NodeJS.ErrnoException).code, 'ESRCH');
    return false;
  }
}
