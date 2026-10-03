/** Exercises claim and CLI crypto boundaries with unsigned, explicitly mocked fixtures. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import type { ReleaseArtifactManifest } from '../../scripts/release/prepare-artifact.mjs';
import { assertProvenanceStatement, verifyRegistryProvenance } from '../../scripts/release/verify-provenance.mjs';
import { fixtureStatement, provenanceDocument } from '../helpers/release/provenance.js';
import { testData } from '../helpers/test-data.js';

const data = testData('release provenance');
const bytes = Buffer.from(data.text('artifact'));
const manifest: ReleaseArtifactManifest = {
  schema: 'pixiecore.release-artifact/v1', package: '@pixieworks/pixiecore', version: '0.1.0',
  source_revision: createHash('sha1').update(data.text('source')).digest('hex'),
  tarball: 'pixieworks-pixiecore-0.1.0.tgz', bytes: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'),
  npm_integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
  npm_shasum: createHash('sha1').update(bytes).digest('hex'),
};
const document = provenanceDocument(manifest);
const dist = { attestations: { url: 'https://registry.npmjs.org/-/npm/v1/attestations/%40pixieworks%2Fpixiecore@0.1.0',
  provenance: { predicateType: 'https://slsa.dev/provenance/v1' } } };

test('provenance claims bind package, artifact, source, tag, release workflow and hosted runner', () => {
  const statement = fixtureStatement(document);
  assert.doesNotThrow(() => assertProvenanceStatement(statement, manifest));
  const serialized = JSON.stringify(statement);
  for (const changed of [
    serialized.replace('%40pixieworks/pixiecore@0.1.0', '%40other/package@0.1.0'),
    serialized.replace(manifest.source_revision, '0'.repeat(40)),
    serialized.replace(Buffer.from(manifest.npm_integrity.slice(7), 'base64').toString('hex'), '0'.repeat(128)),
    serialized.replace('https://github.com/pixieworksinc/pixiecore', 'https://github.com/other/pixiecore'),
    serialized.replace('.github/workflows/release.yml', '.github/workflows/other.yml'),
    serialized.replace('refs/tags/0.1.0', 'refs/heads/0.1.x'),
    serialized.replace('runner/github-hosted', 'runner/self-hosted'),
    serialized.replace('https://slsa.dev/provenance/v1', 'https://slsa.dev/provenance/v0.2'),
  ]) assert.throws(() => assertProvenanceStatement(JSON.parse(changed), manifest));
});

test('claim parsing cannot substitute for required cryptographic certificate verification', async () => {
  let calls = 0;
  await verifyRegistryProvenance(manifest, dist, bytes, {
    fetchImpl: async () => Response.json(document),
    run: async (command, args) => {
      calls++;
      assert.equal(command, 'gh');
      assert.deepEqual(args.slice(0, 2), ['attestation', 'verify']);
      const artifact = args[2];
      const bundle = args[args.indexOf('--bundle') + 1];
      assert.ok(artifact && bundle);
      assert.deepEqual(await readFile(artifact), bytes);
      assert.deepEqual(JSON.parse(await readFile(bundle, 'utf8')), document.attestations[0]?.bundle);
      assert.ok(args.includes('--deny-self-hosted-runners'));
      assert.ok(args.includes('--source-digest'));
      assert.ok(args.includes(manifest.source_revision));
      assert.ok(args.includes('https://github.com/pixieworksinc/pixiecore/.github/workflows/release.yml@refs/tags/0.1.0'));
      assert.equal(args[args.indexOf('--digest-alg') + 1], 'sha512');
      return { stdout: JSON.stringify([{ verificationResult: { statement: fixtureStatement(document) } }]) };
    },
  });
  assert.equal(calls, 1);
  await assert.rejects(verifyRegistryProvenance(manifest, dist, bytes, {
    fetchImpl: async () => Response.json(document),
    run: async () => { throw new Error('Invalid certificate or transparency proof'); },
  }), /Invalid certificate/u);
  await assert.rejects(verifyRegistryProvenance(manifest, dist, bytes, {
    fetchImpl: async () => Response.json(document), run: async () => ({ stdout: '[]' }),
  }), /No cryptographically verified/u);
});

test('absent, malformed, redirected or unavailable provenance is rejected before any registry write', async () => {
  for (const invalid of [{}, { attestations: { ...dist.attestations, url: 'https://example.com/bundle' } },
    { attestations: { ...dist.attestations, url: 'https://registry.npmjs.org/-/npm/v1/attestations/other@0.1.0' } }]) {
    await assert.rejects(verifyRegistryProvenance(manifest, invalid, bytes, {
      fetchImpl: async () => assert.fail('Invalid metadata must be rejected before download'),
    }));
  }
  for (const response of [new Response(null, { status: 404 }), new Response(null, { status: 503 }),
    Response.json({ attestations: [] }), Response.json({ attestations: document.attestations.concat(document.attestations) }),
    Response.json({ attestations: [{ predicateType: dist.attestations.provenance.predicateType, bundle: {} }] })]) {
    await assert.rejects(verifyRegistryProvenance(manifest, dist, bytes, {
      fetchImpl: async () => response, run: async () => assert.fail('Invalid bundle must not reach crypto admission'),
    }));
  }
});
