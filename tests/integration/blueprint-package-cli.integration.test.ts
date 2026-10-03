import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { testCliNodeArguments } from '../helpers/cli.js';
import { testData } from '../helpers/test-data.js';
import { withTempDirectory } from '../helpers/temp.js';

const data = testData('blueprint package cli');
const token = data.text('package identity', 'id').split('_').at(-1)!;
const packageName = `example.${token}.travel`;
const namespace = `example.${token}`;

test('Blueprint package CLI installs, disables, upgrades, and rolls back a local package', async () => {
  await withTempDirectory(async directory => {
    const first = join(directory, 'v1');
    const second = join(directory, 'v2');
    const config = join(directory, 'consumer', 'pixiecore.blueprints.yml');
    await writePackage(first, '1.0.0');
    await writePackage(second, '1.1.0');

    const installed = await runCli([
      'blueprint', 'package', 'install', first, `--config=${config}`, '--enable',
    ]);
    assert.equal(installed.code, 0, installed.stderr);
    assert.equal(JSON.parse(installed.stdout).enabled, true);

    const disabled = await runCli([
      'blueprint', 'package', 'disable', packageName, `--config=${config}`,
    ]);
    assert.equal(disabled.code, 0, disabled.stderr);
    assert.equal(JSON.parse(disabled.stdout).enabled, false);

    const upgraded = await runCli([
      'blueprint', 'package', 'upgrade', second, `--config=${config}`,
    ]);
    assert.equal(upgraded.code, 0, upgraded.stderr);
    assert.equal(JSON.parse(upgraded.stdout).version, '1.1.0');
    assert.equal(JSON.parse(upgraded.stdout).enabled, false);

    const rolledBack = await runCli([
      'blueprint', 'package', 'rollback', packageName, `--config=${config}`,
    ]);
    assert.equal(rolledBack.code, 0, rolledBack.stderr);
    assert.equal(JSON.parse(rolledBack.stdout).active, '1.0.0');
  });
});

test('Blueprint package CLI reports usage and package lifecycle errors without stack traces', async () => {
  const helpResults = await Promise.all([
    ['blueprint', 'package'],
    ['blueprint', 'package', '--help'],
    ['blueprint', 'package', 'help'],
  ].map(args => runCli(args)));
  for (const help of helpResults) {
    assert.equal(help.code, 0);
    assert.match(help.stdout, /blueprint package install/u);
  }

  const invalidResults = await Promise.all([
    ['blueprint', 'package', 'install'],
    ['blueprint', 'package', 'unknown', packageName],
    ['blueprint', 'package', 'rollback', packageName, '--unknown'],
    ['blueprint', 'package', 'rollback', packageName, '--config'],
    ['blueprint', 'package', 'install', packageName, '--enable=yes'],
    ['blueprint', 'package', 'rollback', packageName, '--config=a', '--config=b'],
  ].map(args => runCli(args)));
  for (const invalid of invalidResults) {
    assert.equal(invalid.code, 2);
    assert.match(invalid.stderr, /Usage:/u);
  }

  const missing = await runCli(['blueprint', 'package', 'rollback', packageName]);
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /is not installed/u);
  assert.doesNotMatch(missing.stderr, /\n\s+at /u);
});

test('Blueprint package CLI records provenance and verifies publisher signatures', async () => {
  await withTempDirectory(async directory => {
    const source = join(directory, 'signed');
    const keys = generateKeyPairSync('ed25519');
    const privateKeyPath = join(directory, 'private.pem');
    const publicKeyPath = join(directory, 'public.pem');
    await Promise.all([
      writePackage(source, '1.0.0'),
      writeFile(privateKeyPath, keys.privateKey.export({ type: 'pkcs8', format: 'pem' })),
      writeFile(publicKeyPath, keys.publicKey.export({ type: 'spki', format: 'pem' })),
    ]);

    const unsigned = await runCli([
      'blueprint', 'package', 'verify', source, '--require-signature',
    ]);
    assert.equal(unsigned.code, 1);
    assert.match(unsigned.stderr, /signature is required/u);

    const provenance = await runCli([
      'blueprint', 'package', 'provenance', source,
      '--source=https://example.invalid/publisher/travel.git',
      '--commit=0123456789abcdef',
    ]);
    assert.equal(provenance.code, 0, provenance.stderr);
    assert.equal(JSON.parse(provenance.stdout).commit, '0123456789abcdef');

    const signed = await runCli([
      'blueprint', 'package', 'sign', source, `--private-key=${privateKeyPath}`,
    ]);
    assert.equal(signed.code, 0, signed.stderr);
    assert.match(JSON.parse(signed.stdout).keyId, /^[0-9a-f]{64}$/u);

    const verified = await runCli([
      'blueprint', 'package', 'verify', source,
      `--public-key=${publicKeyPath}`, '--require-signature',
    ]);
    assert.equal(verified.code, 0, verified.stderr);
    assert.equal(JSON.parse(verified.stdout).signature, 'verified');
  });
});

async function writePackage(root: string, version: string): Promise<void> {
  await mkdir(join(root, 'blueprints'), { recursive: true });
  const blueprint = [
    `name: ${data.text(`Blueprint ${version}`, 'Blueprint')}`,
    `version: ${version}`,
    'role: converter',
    'prompt: Convert {value} to an ISO date.',
    'input_placeholders: [value]',
    'output_schema:',
    '  type: object',
    '',
  ].join('\n');
  await writeFile(join(root, 'blueprints', 'date-normalizer.yaml'), blueprint);
  await writeFile(join(root, 'pixiecore.blueprint-package.json'), `${JSON.stringify({
    schema: 'pixiecore.blueprint-package/v1',
    package: { name: packageName, namespace, version, license: 'Apache-2.0' },
    compatibility: { pop: '^0.1.0', pixiecore: '^0.1.0' },
    blueprints: [{
      id: `${namespace}.date-normalizer`,
      version,
      path: 'blueprints/date-normalizer.yaml',
    }],
    files: {
      'blueprints/date-normalizer.yaml': `sha256-${createHash('sha256').update(blueprint).digest('base64')}`,
    },
  }, null, 2)}\n`);
}

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
