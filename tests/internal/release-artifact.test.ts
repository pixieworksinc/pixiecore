import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  prepareReleaseArtifact,
  verifyReleaseArtifact,
} from '../../scripts/release/prepare-artifact.mjs';
import { verifyReleaseArtifactIdentity } from '../../scripts/release/verify-artifact.mjs';
import { selectPackageInput } from '../../scripts/release/package-input.mjs';

const execFileAsync = promisify(execFile);

test('release artifact preparation records and verifies exact package bytes', async () => {
  const fixture = await createFixture();
  try {
    const outputDirectory = join(fixture.root, 'release');
    const manifest = await prepareReleaseArtifact({
      npmCache: join(fixture.root, 'npm-cache'),
      repositoryRoot: fixture.root,
      outputDirectory,
      sourceRevision: fixture.revision,
      version: '0.1.0',
    });
    assert.equal(manifest.package, '@pixieworks/pixiecore');
    assert.equal(manifest.version, '0.1.0');
    assert.equal(manifest.source_revision, fixture.revision);
    assert.match(manifest.sha256, /^[0-9a-f]{64}$/u);
    assert.match(manifest.npm_integrity, /^sha512-[A-Za-z0-9+/]+={0,2}$/u);
    assert.match(manifest.npm_shasum, /^[0-9a-f]{40}$/u);
    await verifyReleaseArtifact({ outputDirectory });
    await verifyReleaseArtifactIdentity({
      outputDirectory,
      sourceRevision: fixture.revision,
      version: '0.1.0',
    });

    const candidateOptions = {
      outputDirectory,
      sourceRevision: fixture.revision,
      version: '0.1.0',
      packCheckout: async (): Promise<string> => assert.fail('Candidate verification must never repack'),
    };
    const selected = await selectPackageInput(candidateOptions);
    assert.equal(selected.tarball, join(outputDirectory, manifest.tarball));
    assert.deepEqual(selected.manifest, manifest);
    for (const overrides of [
      { version: '0.2.0' }, { sourceRevision: 'a'.repeat(40) },
      { outputDirectory: join(fixture.root, 'missing-candidate') }, { version: '' },
      { sourceRevision: '' }, { outputDirectory: '' },
    ]) {
      await assert.rejects(selectPackageInput({ ...candidateOptions, ...overrides }));
    }

    await assert.rejects(
      verifyReleaseArtifactIdentity({
        outputDirectory,
        sourceRevision: fixture.revision,
        version: '0.2.0',
      }),
      /does not match 0\.2\.0/u,
    );

    await appendFile(join(outputDirectory, manifest.tarball), 'tampered', 'utf8');
    await assert.rejects(
      verifyReleaseArtifact({ outputDirectory }),
      /size mismatch/u,
    );
    await assert.rejects(selectPackageInput(candidateOptions), /size mismatch/u);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('ordinary package verification packs once but partial candidate flags never fall back', async () => {
  let packCalls = 0;
  const packCheckout = async (): Promise<string> => {
    packCalls += 1;
    return '/fixture/development.tgz';
  };
  assert.deepEqual(await selectPackageInput({ packCheckout }), { tarball: '/fixture/development.tgz' });
  assert.equal(packCalls, 1);
  for (const options of [{ version: '0.1.0' }, { sourceRevision: 'a'.repeat(40) }]) {
    await assert.rejects(selectPackageInput({ ...options, packCheckout }), /artifact-directory is required/u);
  }
  assert.equal(packCalls, 1);
});

test('release artifact preparation rejects mismatched version and source identity', async () => {
  const fixture = await createFixture();
  try {
    await assert.rejects(
      prepareReleaseArtifact({
        npmCache: join(fixture.root, 'npm-cache'),
        repositoryRoot: fixture.root,
        outputDirectory: join(fixture.root, 'wrong-version'),
        sourceRevision: fixture.revision,
        version: '0.2.0',
      }),
      /does not match package\.json/u,
    );
    await assert.rejects(
      prepareReleaseArtifact({
        npmCache: join(fixture.root, 'npm-cache'),
        repositoryRoot: fixture.root,
        outputDirectory: join(fixture.root, 'wrong-revision'),
        sourceRevision: 'not-a-sha',
        version: '0.1.0',
      }),
      /full Git SHA/u,
    );
    await assert.rejects(
      prepareReleaseArtifact({
        npmCache: join(fixture.root, 'npm-cache'),
        repositoryRoot: fixture.root,
        outputDirectory: join(fixture.root, 'different-revision'),
        sourceRevision: 'a'.repeat(40),
        version: '0.1.0',
      }),
      /does not match repository HEAD/u,
    );
    await appendFile(join(fixture.root, 'dist', 'index.js'), 'export const dirty = true;\n', 'utf8');
    await assert.rejects(
      prepareReleaseArtifact({
        npmCache: join(fixture.root, 'npm-cache'),
        repositoryRoot: fixture.root,
        outputDirectory: join(fixture.root, 'dirty-source'),
        sourceRevision: fixture.revision,
        version: '0.1.0',
      }),
      /tracked changes/u,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

async function createFixture(): Promise<{ root: string; revision: string }> {
  const root = await mkdtemp(join(tmpdir(), 'pixiecore-release-artifact-'));
  await mkdir(join(root, 'dist'));
  await writeFile(join(root, 'dist', 'index.js'), 'export const ready = true;\n', 'utf8');
  await writeFile(join(root, 'package.json'), `${JSON.stringify({
    name: '@pixieworks/pixiecore',
    version: '0.1.0',
    type: 'module',
    main: './dist/index.js',
    files: ['dist'],
    repository: {
      type: 'git',
      url: 'git+https://github.com/pixieworksinc/pixiecore.git',
    },
  }, null, 2)}\n`, 'utf8');
  await execFileAsync('git', ['init', '--quiet'], { cwd: root });
  await execFileAsync('git', ['add', '.'], { cwd: root });
  await execFileAsync('git', [
    '-c',
    'user.name=PixieCore Test',
    '-c',
    'user.email=test@pixiecore.invalid',
    'commit',
    '--quiet',
    '-m',
    'test: Add release fixture',
  ], { cwd: root });
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  });
  return { root, revision: stdout.trim() };
}
