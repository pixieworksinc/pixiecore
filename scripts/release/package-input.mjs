/** Selects immutable candidate bytes or the ordinary checkout pack operation. */
import { join, resolve } from 'node:path';

import { verifyReleaseArtifactIdentity } from './verify-artifact.mjs';

/** Never falls back to packing when a candidate is missing, corrupt or incorrectly identified. */
export async function selectPackageInput({ outputDirectory, sourceRevision, version, packCheckout }) {
  if (outputDirectory === undefined) {
    if (sourceRevision !== undefined || version !== undefined) {
      throw new Error('artifact-directory is required for source-bound package verification');
    }
    return { tarball: await packCheckout() };
  }
  const manifest = await verifyReleaseArtifactIdentity({ outputDirectory, sourceRevision, version });
  return { tarball: join(resolve(outputDirectory), manifest.tarball), manifest };
}
