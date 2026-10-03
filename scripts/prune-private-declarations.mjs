import { access, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distRoot = resolve(projectRoot, 'dist');
const packageJson = JSON.parse(await readFile(resolve(projectRoot, 'package.json'), 'utf8'));
const publicDeclarations = [
  ...declarationEntrypoints(packageJson.exports),
  ...await corePluginDeclarationEntrypoints(),
  resolve(distRoot, 'core/kernel/generated/core-plugin-catalog.generated.d.ts'),
];
const reachable = await reachableDeclarations(publicDeclarations);
const declarations = await collectDeclarations(distRoot);
const privateDeclarations = declarations.filter(path => !reachable.has(path));

await Promise.all(privateDeclarations.map(path => unlink(path)));
const strippedFileHeaders = await stripDeclarationFileHeaders([...reachable]);
console.log(
  `Kept ${reachable.size} public declaration files; pruned ${privateDeclarations.length} private declarations; `
    + `removed ${strippedFileHeaders} redundant declaration file headers.`,
);

async function stripDeclarationFileHeaders(declarations) {
  let stripped = 0;
  for (const declaration of declarations) {
    const sourcePath = resolve(
      projectRoot,
      'src',
      relative(distRoot, declaration).replace(/\.d\.(?:ts|mts|cts)$/u, '.ts'),
    );
    let source;
    try {
      source = await readFile(sourcePath, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    const sourceHeader = source.match(/^\/\*\*[\s\S]*?\*\//u)?.[0];
    if (!sourceHeader || sourceHeader.includes('@packageDocumentation')) continue;
    const output = await readFile(declaration, 'utf8');
    if (!output.startsWith(sourceHeader)) continue;
    await writeFile(declaration, output.slice(sourceHeader.length).replace(/^\s+/u, ''));
    stripped++;
  }
  return stripped;
}

function declarationEntrypoints(exportsField) {
  const found = new Set();
  visit(exportsField);
  if (found.size === 0) throw new Error('package exports define no public declaration entrypoints');
  return [...found];

  function visit(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    if (typeof value.types === 'string') {
      const path = resolve(projectRoot, value.types);
      if (!withinDist(path)) throw new Error(`Public declaration escapes dist: ${value.types}`);
      found.add(path);
    }
    for (const nested of Object.values(value)) visit(nested);
  }
}

async function corePluginDeclarationEntrypoints() {
  const declarations = [];
  const pluginRoot = resolve(distRoot, 'plugins');
  for (const manifest of await collectFiles(pluginRoot, path => path.endsWith('.yaml'))) {
    const pluginName = basename(dirname(manifest));
    if (basename(manifest) !== `${pluginName}.yaml`) continue;
    declarations.push(resolve(dirname(manifest), `${pluginName}.d.ts`));
  }
  return declarations;
}

async function reachableDeclarations(entrypoints) {
  const reachable = new Set();
  const pending = [...entrypoints];
  while (pending.length > 0) {
    const path = pending.pop();
    if (reachable.has(path)) continue;
    await access(path);
    reachable.add(path);
    const source = await readFile(path, 'utf8');
    for (const specifier of declarationSpecifiers(source)) {
      if (!specifier.startsWith('.')) continue;
      const dependency = declarationPath(path, specifier);
      if (!reachable.has(dependency)) pending.push(dependency);
    }
  }
  return reachable;
}

function declarationSpecifiers(source) {
  const found = new Set();
  const modulePattern = /\b(?:from\s+|import\s*\(\s*)['"]([^'"]+)['"]/gu;
  const sideEffectPattern = /^\s*import\s*['"]([^'"]+)['"]/gmu;
  const referencePattern = /^\s*\/\/\/\s*<reference\s+path=['"]([^'"]+)['"]/gmu;
  for (const pattern of [modulePattern, sideEffectPattern, referencePattern]) {
    for (const match of source.matchAll(pattern)) found.add(match[1]);
  }
  return found;
}

function declarationPath(importer, specifier) {
  const resolved = resolve(dirname(importer), specifier);
  const extension = extname(resolved);
  const path = extension === '.js'
    ? `${resolved.slice(0, -3)}.d.ts`
    : extension === '.mjs'
      ? `${resolved.slice(0, -4)}.d.mts`
      : extension === '.cjs'
        ? `${resolved.slice(0, -4)}.d.cts`
        : `${resolved}.d.ts`;
  if (!withinDist(path)) throw new Error(`Declaration dependency escapes dist: ${specifier}`);
  return path;
}

async function collectDeclarations(directory) {
  return collectFiles(directory, path => /\.d\.(?:ts|mts|cts)$/u.test(path));
}

async function collectFiles(directory, include) {
  const files = [];
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(path, include));
      continue;
    }
    if (entry.isFile() && include(path)) files.push(path);
  }
  return files;
}

function withinDist(path) {
  return path === distRoot || path.startsWith(`${distRoot}${sep}`);
}
