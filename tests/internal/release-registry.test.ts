import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { assertRegistryArtifact, readPublishedDist, registryPublicationRequired } from '../../scripts/release/verify-registry.mjs';
import { fixtureStatement, provenanceDocument } from '../helpers/release/provenance.js';
import { testData } from '../helpers/test-data.js';

const data = testData('release registry');
const bytes = Buffer.from(data.text('package bytes'));
const manifest = {
  schema: 'pixiecore.release-artifact/v1' as const,
  package: '@pixieworks/pixiecore' as const,
  version: '0.1.0',
  source_revision: createHash('sha1').update(data.text('source revision')).digest('hex'),
  tarball: 'pixieworks-pixiecore-0.1.0.tgz',
  bytes: bytes.byteLength,
  sha256: digest('sha256', 'hex'),
  npm_integrity: `sha512-${digest('sha512', 'base64')}`,
  npm_shasum: digest('sha1', 'hex'),
};
const dist = {
  tarball: 'https://registry.npmjs.org/@pixieworks/pixiecore/-/pixiecore-0.1.0.tgz',
  integrity: manifest.npm_integrity,
  shasum: manifest.npm_shasum,
  attestations: { url: 'https://registry.npmjs.org/-/npm/v1/attestations/%40pixieworks%2Fpixiecore@0.1.0',
    provenance: { predicateType: 'https://slsa.dev/provenance/v1' } },
};

test('registry verification accepts the exact published tarball', () => {
  assert.doesNotThrow(() => assertRegistryArtifact(manifest, dist, bytes));
});

test('post-publish verification waits for asynchronous npm visibility without republishing', async () => {
  let requests = 0;
  const waits: number[] = [];
  const published = await readPublishedDist(manifest, async () => {
    requests += 1;
    return requests < 3 ? new Response(null, { status: 404 })
      : Response.json({ name: manifest.package, version: manifest.version, dist });
  }, async milliseconds => { waits.push(milliseconds); }, 3);
  assert.deepEqual(published, dist);
  assert.equal(requests, 3);
  assert.deepEqual(waits, [5_000, 5_000]);
});

test('post-publish verification exhausts absence but fails immediately on unrelated registry errors', async () => {
  let requests = 0;
  const waits: number[] = [];
  await assert.rejects(readPublishedDist(manifest, async () => {
    requests += 1;
    return new Response(null, { status: 404 });
  }, async milliseconds => { waits.push(milliseconds); }, 3), /after 3 attempts/u);
  assert.equal(requests, 3);
  assert.deepEqual(waits, [5_000, 5_000]);
  for (const response of [new Response(null, { status: 503 }),
    Response.json({ name: 'unrelated', version: manifest.version, dist })]) {
    requests = 0;
    await assert.rejects(readPublishedDist(manifest, async () => {
      requests += 1;
      return response;
    }, async () => assert.fail('Unexpected registry responses must not wait'), 3));
    assert.equal(requests, 1);
  }
});

test('registry verification rejects changed metadata and changed bytes', () => {
  assert.throws(
    () => assertRegistryArtifact(manifest, { ...dist, shasum: '0'.repeat(40) }, bytes),
    /integrity metadata/u,
  );
  assert.throws(
    () => assertRegistryArtifact(manifest, dist, Buffer.alloc(bytes.length)),
    /SHA-256 mismatch/u,
  );
  assert.throws(
    () => assertRegistryArtifact(manifest, dist, Buffer.from('short')),
    /size mismatch/u,
  );
});

test('registry verification rejects non-registry and credential-bearing download URLs', () => {
  for (const tarball of [
    'http://registry.npmjs.org/pixiecore.tgz',
    'https://registry.npmjs.org.evil.example/pixiecore.tgz',
    'https://user:password@registry.npmjs.org/pixiecore.tgz',
    'https://registry.npmjs.org:444/pixiecore.tgz',
  ]) {
    assert.throws(
      () => assertRegistryArtifact(manifest, { ...dist, tarball }, bytes),
      /official npm registry/u,
    );
  }
});

test('publication is skipped only for an existing version with the exact approved bytes', async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async input => {
    calls.push(String(input));
    if (String(input) === dist.tarball) return new Response(new Uint8Array(bytes));
    if (String(input) === dist.attestations.url) return Response.json(provenanceDocument(manifest));
    return Response.json({ name: manifest.package, version: manifest.version, dist });
  };
  assert.equal(await registryPublicationRequired(manifest, fetchImpl, { run: mockCryptoVerifier }), false);
  assert.equal(calls.length, 4);
  assert.match(calls[3] ?? '', /\/latest$/u);
  assert.match(calls[0] ?? '', /registry\.npmjs\.org/u);
});

test('byte-identical but unattested versions and mismatched latest tags cannot be accepted on retry', async () => {
  await assert.rejects(registryPublicationRequired(manifest, async input => String(input) === dist.tarball
    ? new Response(new Uint8Array(bytes))
    : Response.json({ name: manifest.package, version: manifest.version, dist: { ...dist, attestations: undefined } }),
  { run: async () => assert.fail('Missing provenance must fail before crypto') }), /provenance is absent/u);
  for (const latest of [Response.json({ name: manifest.package, version: '0.2.0' }),
    Response.json({ name: 'unrelated', version: manifest.version }), new Response(null, { status: 503 })]) {
    await assert.rejects(registryPublicationRequired(manifest, async input => {
      if (String(input).endsWith('/latest')) return latest;
      if (String(input) === dist.tarball) return new Response(new Uint8Array(bytes));
      if (String(input) === dist.attestations.url) return Response.json(provenanceDocument(manifest));
      return Response.json({ name: manifest.package, version: manifest.version, dist });
    }, { run: mockCryptoVerifier }), /latest/u);
  }
});

test('a missing package cannot restart first-package publication', async () => {
  const calls: string[] = [];
  await assert.rejects(registryPublicationRequired(manifest, async input => {
    calls.push(String(input));
    return new Response(null, { status: 404 });
  }), /requires an existing registry package/u);
  assert.deepEqual(calls, [
    `https://registry.npmjs.org/${encodeURIComponent(manifest.package)}/${manifest.version}`,
    `https://registry.npmjs.org/${encodeURIComponent(manifest.package)}`,
  ]);
});

test('absent candidates may advance latest but cannot backfill or equal it', async () => {
  for (const [candidate, latest, allowed] of [
    ['0.1.1', '0.1.0', true], ['0.2.0', '0.1.99', true], ['1.0.0', '0.99.99', true],
    ['0.1.0', '0.1.1', false], ['0.1.0', '0.2.0', false], ['0.1.0', '1.0.0', false],
    ['0.1.0', '0.1.0', false], ['0.1.10', '0.1.9', true], ['0.1.9', '0.1.10', false],
    ['9007199254740993.0.0', '9007199254740992.0.0', true],
    ['9007199254740992.0.0', '9007199254740993.0.0', false],
  ] as const) {
    const fetchImpl: typeof fetch = async input => String(input).endsWith(`/${candidate}`)
      ? new Response(null, { status: 404 })
      : Response.json({ name: manifest.package, 'dist-tags': { latest } });
    const request = registryPublicationRequired({ ...manifest, version: candidate }, fetchImpl);
    if (allowed) {
      assert.equal(await request, true, `${candidate} > ${latest}`);
      continue;
    }
    await assert.rejects(request, /must be newer/u, `${candidate} <= ${latest}`);
  }
});

test('missing candidates reject malformed or unrelated package-level latest metadata', async () => {
  for (const metadata of [
    { name: 'unrelated', 'dist-tags': { latest: '0.0.1' } },
    { name: manifest.package }, { name: manifest.package, 'dist-tags': {} },
    ...['0.0.1-rc.1', 'v0.0.1', '00.0.1', '0.0.1+build', null, 1]
      .map(latest => ({ name: manifest.package, 'dist-tags': { latest } })),
  ]) {
    await assert.rejects(registryPublicationRequired(manifest, async input =>
      String(input).endsWith(`/${manifest.version}`) ? new Response(null, { status: 404 })
        : Response.json(metadata)), /identity mismatch|stable numeric/u);
  }
});

test('version or package lookup outages and authorization failures stop publication', async () => {
  for (const status of [401, 403, 429, 500, 503]) {
    await assert.rejects(registryPublicationRequired(manifest, async () => new Response(null, { status })), /lookup failed/u);
    await assert.rejects(registryPublicationRequired(manifest, async input =>
      String(input).endsWith(`/${manifest.version}`) ? new Response(null, { status: 404 })
        : new Response(null, { status })), /package lookup failed/u);
  }
  await assert.rejects(registryPublicationRequired(manifest, async () => { throw new Error('offline'); }), /offline/u);
  await assert.rejects(registryPublicationRequired(manifest, async input => {
    if (String(input).endsWith(`/${manifest.version}`)) return new Response(null, { status: 404 });
    throw new Error('package lookup offline');
  }), /package lookup offline/u);
});

test('existing mismatched metadata, bytes, identity and prereleases cannot be silently republished', async () => {
  for (const metadata of [
    { name: 'another-package', version: manifest.version, dist },
    { name: manifest.package, version: '0.2.0', dist },
    { name: manifest.package, version: manifest.version },
    { name: manifest.package, version: manifest.version, dist: { ...dist, integrity: 'wrong' } },
  ]) {
    await assert.rejects(registryPublicationRequired(manifest, async input => String(input) === dist.tarball
      ? new Response(new Uint8Array(bytes)) : Response.json(metadata)));
  }
  await assert.rejects(registryPublicationRequired(manifest, async input => String(input) === dist.tarball
    ? new Response(new Uint8Array(Buffer.alloc(bytes.length)))
    : Response.json({ name: manifest.package, version: manifest.version, dist })), /SHA-256 mismatch/u);
  await assert.rejects(registryPublicationRequired({ ...manifest, version: '0.2.0-rc.1' }, async () => {
    assert.fail('Prerelease rejection must precede any network access');
  }), /stable numeric/u);
});

function digest(algorithm: string, encoding: 'hex' | 'base64'): string {
  return createHash(algorithm).update(bytes).digest(encoding);
}

/** Returns an explicitly mocked CLI result; crypto-policy flags are covered in their owned tests. */
async function mockCryptoVerifier(): Promise<{ stdout: string }> {
  return { stdout: JSON.stringify([{ verificationResult: { statement: fixtureStatement(provenanceDocument(manifest)) } }]) };
}
