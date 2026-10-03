/** Ensures cloned-checkout instructions execute local code without registry resolution. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { promisify } from 'node:util';
import { parse } from 'yaml';

import { selectPublicSnapshotFiles } from '../../scripts/publication/prepare.mjs';

const execFileAsync = promisify(execFile);

test('every public Markdown guide names the scoped CLI package explicitly', async () => {
  const { stdout } = await execFileAsync('git', ['ls-files', '-z'], { encoding: 'utf8' });
  const paths = selectPublicSnapshotFiles(stdout.split('\0').filter(Boolean))
    .filter(path => path.endsWith('.md'));
  assert.ok(paths.includes('examples/application-composition/README.md'));
  assert.ok(paths.includes('examples/blueprints/converter/date-normalizer/README.md'));
  for (const path of paths) {
    const source = await readFile(path, 'utf8');
    assert.doesNotMatch(source, /\bnpx[\t ]+pixiecore(?:[\t ]|$)/mu, path);
    assert.doesNotMatch(source,
      /"command"\s*:\s*"npx"\s*,\s*"args"\s*:\s*\[\s*"pixiecore"/u, path);
    assert.doesNotMatch(source, /\bnode_modules\/pixiecore(?:\/|\b)/u, path);
  }
});

test('README builds and executes the checkout CLI rather than an unscoped npm package', async () => {
  const readme = await readFile('README.md', 'utf8');
  const section = readme.split('From a cloned PixieCore checkout:')[1]?.split('```')[1];
  assert.ok(section, 'Missing cloned-checkout command block');
  assert.match(section, /npm ci\s+npm run build/u);
  assert.doesNotMatch(section, /\bnpx\b|\bnpm exec\b/u);
  const command = section.split('\n').find(line => line.startsWith('node '));
  assert.ok(command);
  const cliPath = command.split(' ')[1];
  assert.equal(cliPath, 'dist/core/kernel/cli/index.js');
  const { stdout } = await execFileAsync(process.execPath, [cliPath, 'blueprint', 'inspect', 'examples/hello.yaml'], {
    env: { ...process.env, OPENAI_API_KEY: '' },
    timeout: 10_000,
  });
  const blueprint = parse(await readFile('examples/hello.yaml', 'utf8')) as { name: string };
  assert.equal(JSON.parse(stdout).name, blueprint.name);
});
