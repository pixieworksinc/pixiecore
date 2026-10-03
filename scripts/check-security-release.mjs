import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

for (const path of ['SECURITY.md', 'docs/project/threat-model.md']) {
  assert.ok((await readFile(path, 'utf8')).trim().length > 200, `${path} is incomplete`);
}
const sbom = spawnSync('npm', ['sbom', '--omit=dev', '--sbom-format', 'spdx'], { encoding: 'utf8' });
if (sbom.status !== 0) throw new Error(sbom.stderr || sbom.error?.message || 'SBOM generation failed');
const document = JSON.parse(sbom.stdout);
assert.equal(document.spdxVersion, 'SPDX-2.3');
assert.ok(Array.isArray(document.packages) && document.packages.some(item => item.name === '@pixieworks/pixiecore'));
console.log(`Security release gate passed with SPDX SBOM (${document.packages.length} packages).`);
