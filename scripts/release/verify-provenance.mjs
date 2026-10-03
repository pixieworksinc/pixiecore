/** Verifies npm's Sigstore bundle with certificate-bound GitHub source and workflow policy. */
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const REPOSITORY = 'pixieworksinc/pixiecore';
const WORKFLOW = '.github/workflows/release.yml';
const PREDICATE = 'https://slsa.dev/provenance/v1';

/** Rejects missing, unrelated or unverifiable provenance, even for byte-identical packages. */
export async function verifyRegistryProvenance(manifest, dist, bytes, {
  fetchImpl = fetch, run = execFileAsync,
} = {}) {
  if (dist.attestations?.provenance?.predicateType !== PREDICATE) throw new Error('Required npm provenance is absent');
  const url = new URL(dist.attestations.url);
  if (url.protocol !== 'https:' || url.hostname !== 'registry.npmjs.org' || url.port
    || url.username || url.password || url.search || url.hash
    || decodeURIComponent(url.pathname) !== `/-/npm/v1/attestations/${manifest.package}@${manifest.version}`) {
    throw new Error('Unexpected registry attestation URL');
  }
  const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Registry provenance unavailable: HTTP ${response.status}`);
  const document = await response.json();
  const attestations = Array.isArray(document.attestations)
    ? document.attestations.filter(entry => entry.predicateType === PREDICATE) : undefined;
  if (!attestations || attestations.length !== 1) throw new Error('Required unique npm provenance is absent');
  const bundle = attestations[0].bundle;
  if (!bundle?.dsseEnvelope?.payload) throw new Error('Malformed npm provenance bundle');
  const statement = JSON.parse(Buffer.from(bundle.dsseEnvelope.payload, 'base64').toString('utf8'));
  assertProvenanceStatement(statement, manifest);

  const temporary = await mkdtemp(join(tmpdir(), 'pixiecore-provenance-'));
  try {
    const artifact = join(temporary, 'artifact.tgz');
    const bundlePath = join(temporary, 'bundle.json');
    await writeFile(artifact, bytes);
    await writeFile(bundlePath, JSON.stringify(bundle));
    const ref = `refs/tags/${manifest.version}`;
    const { stdout } = await run('gh', [
      'attestation', 'verify', artifact, '--bundle', bundlePath,
      '--repo', REPOSITORY, '--cert-identity', `https://github.com/${REPOSITORY}/${WORKFLOW}@${ref}`,
      '--source-ref', ref, '--source-digest', manifest.source_revision,
      '--cert-oidc-issuer', 'https://token.actions.githubusercontent.com',
      '--deny-self-hosted-runners', '--digest-alg', 'sha512', '--predicate-type', PREDICATE,
      '--format', 'json',
    ], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
    const verified = JSON.parse(stdout);
    if (!Array.isArray(verified) || verified.length === 0) throw new Error('No cryptographically verified provenance');
    for (const result of verified) assertProvenanceStatement(result.verificationResult?.statement, manifest);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

/** Validates claims in addition to, never instead of, the CLI's certificate and transparency verification. */
export function assertProvenanceStatement(statement, manifest) {
  const workflow = statement?.predicate?.buildDefinition?.externalParameters?.workflow;
  const ref = `refs/tags/${manifest.version}`;
  const subject = statement?.subject;
  const digest = Buffer.from(manifest.npm_integrity.slice('sha512-'.length), 'base64').toString('hex');
  if (statement?._type !== 'https://in-toto.io/Statement/v1' || statement?.predicateType !== PREDICATE
    || !Array.isArray(subject) || subject.length !== 1
    || subject[0]?.name !== `pkg:npm/${manifest.package.replace(/^@/u, '%40')}@${manifest.version}`
    || subject[0]?.digest?.sha512 !== digest) throw new Error('Provenance artifact identity mismatch');
  if (workflow?.repository !== `https://github.com/${REPOSITORY}` || workflow?.path !== WORKFLOW
    || workflow?.ref !== ref
    || statement.predicate.runDetails?.builder?.id !== 'https://github.com/actions/runner/github-hosted') {
    throw new Error('Provenance workflow identity mismatch');
  }
  const sources = statement.predicate.buildDefinition?.resolvedDependencies;
  if (!Array.isArray(sources) || !sources.some(source =>
    source.uri === `git+https://github.com/${REPOSITORY}@${ref}`
    && source.digest?.gitCommit === manifest.source_revision)) throw new Error('Provenance source revision mismatch');
}
