/** Verifies resumable release writes entirely through mocked HTTP and CLI boundaries. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import {
  assertGitHubReleaseIdentity,
  completeGitHubRelease,
  releaseDigestNotes,
} from '../../scripts/release/github-release.mjs';
import type { ReleaseArtifactManifest } from '../../scripts/release/prepare-artifact.mjs';
import { testData } from '../helpers/test-data.js';
import { withTempDirectory } from '../helpers/temp.js';

const data = testData('GitHub release resume');
const tarballBytes = Buffer.from(data.text('tarball'));
const manifest: ReleaseArtifactManifest = {
  schema: 'pixiecore.release-artifact/v1', package: '@pixieworks/pixiecore', version: '0.1.0',
  source_revision: createHash('sha1').update(data.text('source')).digest('hex'),
  tarball: 'pixieworks-pixiecore-0.1.0.tgz', bytes: tarballBytes.length,
  sha256: createHash('sha256').update(tarballBytes).digest('hex'),
  npm_integrity: `sha512-${createHash('sha512').update(tarballBytes).digest('base64')}`,
  npm_shasum: createHash('sha1').update(tarballBytes).digest('hex'),
};

test('release notes and admission bind exact tag, source and digest without editing an existing release', () => {
  const release = releaseFixture();
  assert.doesNotThrow(() => assertGitHubReleaseIdentity(release, manifest));
  assert.match(release.body, new RegExp(`SHA256: ${manifest.sha256}`, 'u'));
  for (const invalid of [
    { ...release, tag_name: '0.2.0' }, { ...release, draft: 'false' }, { ...release, prerelease: true },
    { ...release, body: release.body.replace(manifest.sha256, '0'.repeat(64)) },
    { ...release, body: release.body.replace(manifest.source_revision, '0'.repeat(40)) },
    { ...release, body: `${release.body}\nSHA256: ${manifest.sha256}` },
    { ...release, assets: release.assets.concat({ name: 'unreviewed.zip' }) },
    { ...release, assets: release.assets.concat({ name: manifest.tarball }) },
  ]) assert.throws(() => assertGitHubReleaseIdentity(invalid, manifest));
});

test('existing verified release downloads matching assets without create, upload or clobber', async () => {
  await withTempDirectory(async directory => {
    await writeFixtureFiles(directory);
    const commands: string[][] = [];
    await completeGitHubRelease(manifest, {
      outputDirectory: directory,
      fetchImpl: async () => Response.json(releaseFixture()),
      run: async (command, args) => {
        assert.equal(command, 'gh');
        commands.push(args);
        assert.equal(args[1], 'download');
        const name = args[args.indexOf('--pattern') + 1];
        const target = args[args.indexOf('--dir') + 1];
        assert.ok(name && target);
        await writeFile(join(target, name), await readFile(join(directory, name)));
      },
    });
    assert.equal(commands.length, 2);
  });
});

test('absent release is created as a draft and published only after all assets are verified', async () => {
  await withTempDirectory(async directory => {
    await writeFixtureFiles(directory);
    let release: ReturnType<typeof releaseFixture> | undefined;
    let afterCreateLookups = 0;
    const commands: string[][] = [];
    const waits: number[] = [];
    await completeGitHubRelease(manifest, {
      outputDirectory: directory,
      fetchImpl: async input => {
        if (String(input).includes('/tags/')) {
          return release && !release.draft ? Response.json(release) : new Response(null, { status: 404 });
        }
        if (!release) return Response.json([]);
        afterCreateLookups += 1;
        if (afterCreateLookups === 1) return Response.json([]);
        if (afterCreateLookups === 2) return Response.json([{ ...release, assets: null }]);
        return Response.json([release]);
      },
      wait: async milliseconds => { waits.push(milliseconds); },
      run: async (_command, args) => {
        commands.push(args);
        if (args[1] === 'create') {
          assert.ok(args.includes('--verify-tag'));
          assert.ok(args.includes('--draft'));
          assert.ok(args.includes(releaseDigestNotes(manifest)));
          release = { ...releaseFixture(), draft: true };
          return;
        }
        if (args[1] === 'edit') {
          assert.ok(release);
          assert.ok(args.includes('--draft=false'));
          release.draft = false;
          return;
        }
        assert.equal(args[1], 'download');
        const name = args[args.indexOf('--pattern') + 1];
        const target = args[args.indexOf('--dir') + 1];
        assert.ok(name && target);
        await writeFile(join(target, name), await readFile(join(directory, name)));
      },
    });
    assert.equal(commands.filter(args => args[1] === 'create').length, 1);
    assert.equal(commands.filter(args => args[1] === 'download').length, 2);
    assert.equal(commands.filter(args => args[1] === 'edit').length, 1);
    assert.equal(release?.draft, false);
    assert.deepEqual(waits, [1_000, 1_000]);
  });
});

test('failed creation leaves a draft that resumes through authenticated lookup without a second create or clobber', async () => {
  await withTempDirectory(async directory => {
    await writeFixtureFiles(directory);
    let release: ReturnType<typeof releaseFixture> | undefined;
    const commands: string[][] = [];
    const options = {
      outputDirectory: directory,
      fetchImpl: (async input => String(input).includes('/tags/')
        ? release && !release.draft ? Response.json(release) : new Response(null, { status: 404 })
        : Response.json(release ? [release] : [])) satisfies typeof fetch,
      run: async (_command: string, args: string[]): Promise<void> => {
        commands.push(args);
        assert.ok(!args.includes('--clobber'));
        if (args[1] === 'create') {
          release = { ...releaseFixture(), draft: true, assets: [{ name: manifest.tarball }] };
          throw new Error('Second asset upload failed, leaving a draft');
        }
        assert.ok(release);
        if (args[1] === 'upload') {
          assert.ok(args.includes(join(directory, 'release-manifest.json')));
          release.assets.push({ name: 'release-manifest.json' });
          return;
        }
        if (args[1] === 'edit') {
          assert.equal(release.assets.length, 2);
          assert.ok(args.includes('--draft=false'));
          release.draft = false;
          return;
        }
        assert.equal(args[1], 'download');
        const name = args[args.indexOf('--pattern') + 1];
        const target = args[args.indexOf('--dir') + 1];
        assert.ok(name && target);
        await writeFile(join(target, name), await readFile(join(directory, name)));
      },
    };
    await assert.rejects(completeGitHubRelease(manifest, options), /leaving a draft/u);
    await completeGitHubRelease(manifest, options);
    assert.deepEqual(commands.map(args => args[1]), ['create', 'download', 'upload', 'download', 'edit']);
    assert.equal(release?.draft, false);
  });
});

test('a mismatched newly created release fails immediately rather than waiting for a rewrite', async () => {
  await withTempDirectory(async directory => {
    await writeFixtureFiles(directory);
    let created = false;
    let lookups = 0;
    await assert.rejects(completeGitHubRelease(manifest, {
      outputDirectory: directory,
      fetchImpl: async input => {
        if (String(input).includes('/tags/')) return new Response(null, { status: 404 });
        lookups += 1;
        return Response.json(created ? [{ ...releaseFixture(), body: 'Unexpected notes' }] : []);
      },
      run: async (_command, args) => {
        assert.equal(args[1], 'create');
        created = true;
      },
      wait: async () => assert.fail('A complete but mismatched release must not be retried'),
    }), /digest or source mismatch/u);
    assert.equal(lookups, 2);
  });
});

test('outages, differing published assets and note mismatches stop instead of recreating or repairing', async () => {
  await withTempDirectory(async directory => {
    await writeFixtureFiles(directory);
    for (const status of [401, 403, 500, 503]) {
      await assert.rejects(completeGitHubRelease(manifest, {
        outputDirectory: directory,
        fetchImpl: async () => new Response(null, { status }),
        run: async () => assert.fail('Lookup failure must not write a release'),
      }), /lookup failed/u);
    }
    await assert.rejects(completeGitHubRelease(manifest, {
      outputDirectory: directory,
      fetchImpl: async () => Response.json({ ...releaseFixture(), body: 'Unrelated release notes' }),
      run: async () => assert.fail('Digest failure must precede any release write'),
    }), /digest or source mismatch/u);
    await assert.rejects(completeGitHubRelease(manifest, {
      outputDirectory: directory,
      fetchImpl: async () => Response.json({ ...releaseFixture(), assets: releaseFixture().assets.concat({ name: 'stale.zip' }) }),
      run: async () => assert.fail('Unexpected assets must stop before any release write'),
    }), /unapproved assets/u);
    await assert.rejects(completeGitHubRelease(manifest, {
      outputDirectory: directory,
      fetchImpl: async () => Response.json(releaseFixture()),
      run: async (_command, args) => {
        assert.equal(args[1], 'download');
        const name = args[args.indexOf('--pattern') + 1];
        const target = args[args.indexOf('--dir') + 1];
        assert.ok(name && target);
        await writeFile(join(target, name), data.text('different published asset'));
      },
    }), /asset differs/u);
  });
});

/** Supplies metadata for the exact verified release, not a live GitHub resource. */
function releaseFixture(): { tag_name: string; draft: boolean; prerelease: boolean; body: string; assets: { name: string }[] } {
  return { tag_name: manifest.version, draft: false, prerelease: false,
    body: releaseDigestNotes(manifest), assets: [{ name: manifest.tarball }, { name: 'release-manifest.json' }] };
}

/** Writes small local assets that mocked download commands return verbatim. */
async function writeFixtureFiles(directory: string): Promise<void> {
  await writeFile(join(directory, manifest.tarball), tarballBytes);
  await writeFile(join(directory, 'release-manifest.json'), JSON.stringify(manifest));
}
