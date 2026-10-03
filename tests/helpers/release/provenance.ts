/** Supplies envelope-only npm provenance fixtures; these are not valid signatures. */
import type { ReleaseArtifactManifest } from '../../../scripts/release/prepare-artifact.mjs';

export interface ProvenanceDocument {
  attestations: { predicateType: string; bundle: { dsseEnvelope: { payload: string } } }[];
}

/** Builds the npm v1 claim shape independently of production admission functions. */
export function provenanceDocument(manifest: ReleaseArtifactManifest): ProvenanceDocument {
  const predicateType = 'https://slsa.dev/provenance/v1';
  const statement = {
    _type: 'https://in-toto.io/Statement/v1', predicateType,
    subject: [{ name: `pkg:npm/${manifest.package.replace(/^@/u, '%40')}@${manifest.version}`,
      digest: { sha512: Buffer.from(manifest.npm_integrity.slice(7), 'base64').toString('hex') } }],
    predicate: {
      buildDefinition: {
        externalParameters: { workflow: { repository: 'https://github.com/pixieworksinc/pixiecore',
          path: '.github/workflows/release.yml', ref: `refs/tags/${manifest.version}` } },
        resolvedDependencies: [{ uri: `git+https://github.com/pixieworksinc/pixiecore@refs/tags/${manifest.version}`,
          digest: { gitCommit: manifest.source_revision } }],
      },
      runDetails: { builder: { id: 'https://github.com/actions/runner/github-hosted' } },
    },
  };
  return { attestations: [{ predicateType,
    bundle: { dsseEnvelope: { payload: Buffer.from(JSON.stringify(statement)).toString('base64') } } }] };
}

/** Decodes a test claim without implying that its unsigned fixture is trusted. */
export function fixtureStatement(document: ProvenanceDocument): unknown {
  const payload = document.attestations[0]?.bundle.dsseEnvelope.payload;
  if (!payload) throw new Error('Missing provenance fixture payload');
  return JSON.parse(Buffer.from(payload, 'base64').toString('utf8')) as unknown;
}
