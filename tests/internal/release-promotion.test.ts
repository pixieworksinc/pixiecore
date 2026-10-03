/** Exercises release admission with offline metadata and envelope-only signature fixtures. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { assertStableReleaseVersion } from '../../scripts/release/verify-artifact.mjs';
import {
  assertCandidateSource,
  assertCurrentTagReference,
  assertGitHubTagVerification,
  assertSignedArtifactBinding,
  verifyCandidatePromotion,
} from '../../scripts/release/verify-promotion.mjs';
import { testData } from '../helpers/test-data.js';

const data = testData('release promotion');
const revision = createHash('sha1').update(data.text('revision')).digest('hex');
const sha256 = createHash('sha256').update(data.text('artifact')).digest('hex');
const version = '0.1.0';
const manifest = { version, source_revision: revision, sha256 };

test('publication accepts stable numeric versions and rejects every prerelease before registry access', () => {
  assert.doesNotThrow(() => assertStableReleaseVersion(version));
  for (const value of ['0.2.0-rc.1', '0.1.0+build', 'v0.1.0', '01.1.0', '0.1.x', '--help', '']) {
    assert.throws(() => assertStableReleaseVersion(value), /stable numeric/u);
  }
});

test('candidate admission binds artifact ID, successful run, source, workflow and release repository', () => {
  const fixture = candidateFixture();
  assert.doesNotThrow(() => assertCandidateSource(fixture.run, fixture.artifact, fixture.expected));
  for (const run of [
    { ...fixture.run, conclusion: 'failure' },
    { ...fixture.run, status: 'in_progress' },
    { ...fixture.run, path: '.github/workflows/ci.yml' },
    { ...fixture.run, event: 'pull_request' },
    { ...fixture.run, head_branch: 'codex/unapproved' },
    { ...fixture.run, head_sha: '0'.repeat(40) },
    { ...fixture.run, head_repository: { ...fixture.run.head_repository, full_name: 'other/pixiecore' } },
    { ...fixture.run, run_attempt: fixture.run.run_attempt + 1 },
  ]) assert.throws(() => assertCandidateSource(run, fixture.artifact, fixture.expected));
  for (const artifact of [
    { ...fixture.artifact, expired: true },
    { ...fixture.artifact, id: fixture.artifact.id + 1 },
    { ...fixture.artifact, name: 'a mutable artifact name' },
    { ...fixture.artifact, workflow_run: { ...fixture.artifact.workflow_run, id: fixture.run.id + 1 } },
    { ...fixture.artifact, workflow_run: { ...fixture.artifact.workflow_run, head_sha: '0'.repeat(40) } },
    { ...fixture.artifact, workflow_run: { ...fixture.artifact.workflow_run, head_repository_id: -1 } },
  ]) assert.throws(() => assertCandidateSource(fixture.run, artifact, fixture.expected));
  for (const runId of ['latest', '0', '-1', '1/../../secrets', String(Number.MAX_SAFE_INTEGER + 1)]) {
    assert.throws(() => assertCandidateSource(fixture.run, fixture.artifact, { ...fixture.expected, runId }));
  }
});

test('signed annotation binds the exact digest, source and version without treating envelope text as trust', () => {
  const object = tagObject();
  assert.doesNotThrow(() => assertSignedArtifactBinding(manifest, object));
  for (const invalid of [
    object.replace(`SHA256: ${sha256}`, `SHA256: ${'0'.repeat(64)}`),
    object.replace(`SHA256: ${sha256}\n`, ''),
    object.replace(`SHA256: ${sha256}`, `SHA256: ${sha256}\nSHA256: ${sha256}`),
    object.replace(`object ${revision}`, `object ${'0'.repeat(40)}`),
    object.replace(`tag ${version}`, 'tag 0.2.0'),
    object.replace('-----BEGIN PGP SIGNATURE-----', ''),
    object.replace('-----END PGP SIGNATURE-----', ''),
    object.replace(`SHA256: ${sha256}`, 'SHA256: malformed'),
  ]) assert.throws(() => assertSignedArtifactBinding(manifest, invalid));
});

test('GitHub must verify the exact tag object separately from the annotation fixture', () => {
  const tagId = createHash('sha1').update(data.text('tag')).digest('hex');
  const expected = { tagId, sourceRevision: revision, version };
  const tag = { sha: tagId, tag: version, object: { sha: revision, type: 'commit' },
    verification: { verified: true, reason: 'valid' } };
  assert.doesNotThrow(() => assertGitHubTagVerification(tag, expected));
  assert.throws(() => assertGitHubTagVerification({ ...tag, verification: { verified: false, reason: 'unknown_key' } }, expected));
  assert.throws(() => assertGitHubTagVerification({ ...tag, sha: '0'.repeat(40) }, expected));
  assert.throws(() => assertGitHubTagVerification({ ...tag, object: { sha: '0'.repeat(40), type: 'commit' } }, expected));
});

test('a replaced remote tag cannot substitute code after environment approval', async () => {
  const tagId = createHash('sha1').update(data.text('approved tag object')).digest('hex');
  const expected = { tagId, version };
  const reference = { ref: `refs/tags/${version}`, object: { type: 'tag', sha: tagId } };
  assert.doesNotThrow(() => assertCurrentTagReference(reference, expected));
  for (const invalid of [
    { ...reference, ref: 'refs/tags/0.2.0' },
    { ...reference, object: { type: 'commit', sha: tagId } },
    { ...reference, object: { type: 'tag', sha: createHash('sha1').update(data.text('replacement tag')).digest('hex') } },
    {},
  ]) assert.throws(() => assertCurrentTagReference(invalid, expected), /reference changed/u);
  for (const tagObjectId of [version, 'refs/tags/0.1.0', '--help', '', '0'.repeat(39)]) {
    await assert.rejects(verifyCandidatePromotion({
      outputDirectory: 'not-read-for-invalid-object', sourceRevision: revision, version, tagObjectId,
    }), /Invalid tag object ID/u);
  }
});

/** Builds independently seeded, internally consistent workflow metadata. */
function candidateFixture(): {
  run: Record<string, unknown> & { id: number; run_attempt: number; repository: { id: number; full_name: string }; head_repository: { id: number; full_name: string } };
  artifact: { id: number; expired: boolean; name: string; workflow_run: { id: number; repository_id: number; head_repository_id: number; head_sha: string; head_branch: string } };
  expected: { repository: string; sourceRevision: string; runId: number; artifactId: number };
} {
  const runId = data.integer('run ID', 1, 1_000_000);
  const artifactId = data.integer('artifact ID', 1, 1_000_000);
  const repository = { id: data.integer('repository ID', 1, 1_000_000), full_name: 'pixieworksinc/pixiecore' };
  const attempt = data.integer('run attempt', 1, 10);
  return {
    run: { id: runId, run_attempt: attempt, repository, head_repository: repository,
      path: '.github/workflows/release-candidate.yml', event: 'workflow_dispatch', head_branch: '0.1.x',
      head_sha: revision, status: 'completed', conclusion: 'success' },
    artifact: { id: artifactId, expired: false, name: `pixiecore-release-candidate-${runId}-${attempt}`,
      workflow_run: { id: runId, repository_id: repository.id, head_repository_id: repository.id, head_sha: revision, head_branch: '0.1.x' } },
    expected: { repository: repository.full_name, sourceRevision: revision, runId, artifactId },
  };
}

/** Builds an annotation fixture, deliberately not a cryptographically valid signature. */
function tagObject(): string {
  return `object ${revision}\ntype commit\ntag ${version}\n\nRelease\nSHA256: ${sha256}\n\n`
    + '-----BEGIN PGP SIGNATURE-----\nfixture-envelope-only\n-----END PGP SIGNATURE-----\n';
}
