import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { testCliNodeArguments } from '../helpers/cli.js';
import { withTempDirectory } from '../helpers/temp.js';

test('plugin CLI creates, validates, tests, installs, and changes activation state', async () => {
  await withTempDirectory(async directory => {
    const plugin = join(directory, 'sample-tool');
    const config = join(directory, 'consumer', 'pixiecore.plugins.yml');
    assert.equal((await runCli([
      'plugin', 'create', plugin,
      '--id=example.sample-tool',
      '--kind=tool',
    ])).code, 0);

    const validation = await runCli(['plugin', 'validate', plugin]);
    assert.equal(validation.code, 0);
    assert.equal(JSON.parse(validation.stdout).id, 'example.sample-tool');
    assert.equal((await runCli(['plugin', 'test', plugin])).code, 0);
    assert.equal((await runCli([
      'plugin', 'install', plugin,
      `--config=${config}`,
      '--enable',
    ])).code, 0);
    assert.equal((await runCli([
      'plugin', 'disable', 'example.sample-tool',
      `--config=${config}`,
    ])).code, 0);
    assert.equal((await runCli(['plugin', 'provenance', plugin])).code, 0);
    const verified = await runCli(['plugin', 'verify', plugin]);
    assert.equal(verified.code, 0);
    assert.equal(JSON.parse(verified.stdout).signature, 'absent');
    const catalog = await runCli(['plugin', 'catalog', directory]);
    assert.equal(catalog.code, 0);
    assert.deepEqual(
      JSON.parse(catalog.stdout).plugins.map((item: { plugin: { id: string } }) => item.plugin.id),
      ['example.sample-tool'],
    );
  });
});

interface CliResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function runCli(args: readonly string[]): Promise<CliResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, testCliNodeArguments(args), {
      cwd: resolve('.'),
      env: {
        ...process.env,
        PROMPT_RUNTIME_ENV_FILE: undefined,
        PIXIECORE_PLUGIN_CONFIG: undefined,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => resolvePromise({ code, stdout, stderr }));
  });
}
