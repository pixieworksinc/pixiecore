/**
 * Run development-only TypeDoc with the minimatch 11 traversal fix from
 * https://github.com/TypeStrong/typedoc/pull/3151 until a release includes it.
 * No install hook or published runtime dependency is changed.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const declaration = '  const mini = new Minimatch2(pattern);';
const compatibleDeclaration = `${declaration}\n  const recurseMini = new Minimatch2(pattern, { flipNegate: true });`;
const traversal = `      return mini.set.some((row) => mini.matchOne(
        childPath,
        row,
        /* partial */
        true
      ));`;
const compatibleTraversal = '      return recurseMini.match(childPath.join("/"), /* partial */ true);';

/**
 * Apply the two upstream changes only to the known TypeDoc release.
 * Unknown older implementations fail before any file is changed.
 * @param {string} packageDirectory Installed TypeDoc package directory.
 * @returns {boolean} Whether the compatibility fix was written.
 */
export function applyTypeDocCompat(packageDirectory) {
  const metadata = JSON.parse(readFileSync(join(packageDirectory, 'package.json'), 'utf8'));
  const file = join(packageDirectory, 'dist/node-utils.js');
  const source = readFileSync(file, 'utf8');
  if (!source.includes('.matchOne(')) return false;
  if (metadata.version !== '0.28.20'
    || source.split(declaration).length !== 2
    || source.split(traversal).length !== 2
    || source.includes('recurseMini')) {
    throw new Error('Unsupported TypeDoc traversal; review the upstream fix before generating API documentation.');
  }
  const updated = source.replace(declaration, compatibleDeclaration).replace(traversal, compatibleTraversal);
  if (updated.includes('.matchOne(')) throw new Error('Unrecognized TypeDoc matchOne call remains.');
  writeFileSync(file, updated);
  return true;
}

/**
 * Run TypeDoc after compatibility preparation and forward its exit status.
 * @returns {void}
 */
function main() {
  const require = createRequire(import.meta.url);
  const packageDirectory = dirname(require.resolve('typedoc/package.json'));
  if (applyTypeDocCompat(packageDirectory)) console.log('Applied upstream TypeDoc minimatch 11 compatibility fix.');
  const result = spawnSync(process.execPath, [join(packageDirectory, 'bin/typedoc'), ...process.argv.slice(2)], { stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
