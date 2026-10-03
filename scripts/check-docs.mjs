import { execFile } from 'node:child_process';
import { access, readFile, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const DEFAULT_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const IGNORED_DIRECTORIES = new Set(['.git', 'dist', 'node_modules']);

export async function checkDocs(root = DEFAULT_ROOT) {
  const repositoryRoot = resolve(root);
  const markdownFiles = await discoverMarkdown(repositoryRoot);
  const errors = [];
  const packedReferences = [];

  for (const file of markdownFiles) {
    const source = await readFile(file, 'utf8');
    await checkLinks(repositoryRoot, file, source, errors);
    await checkSyncedSnippets(repositoryRoot, file, source, errors);
    collectPackedReferences(file, source, packedReferences, errors);
  }

  if (packedReferences.length) {
    await checkPackedReferences(repositoryRoot, packedReferences, errors);
  }
  return { checkedFiles: markdownFiles.length, errors };
}

async function discoverMarkdown(root) {
  const files = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) files.push(path);
    }
  }
  await visit(root);
  return files.sort();
}

async function checkLinks(root, file, source, errors) {
  for (const target of markdownLinkTargets(source)) {
    if (isExternalOrAnchor(target)) continue;
    const pathPart = target.split(/[?#]/, 1)[0];
    if (!pathPart) continue;
    let decoded;
    try {
      decoded = decodeURIComponent(pathPart);
    } catch {
      errors.push(`${display(root, file)}: invalid URL encoding in link ${target}`);
      continue;
    }
    const resolved = isAbsolute(decoded)
      ? resolve(root, `.${decoded}`)
      : resolve(dirname(file), decoded);
    if (escapesRoot(root, resolved)) {
      errors.push(`${display(root, file)}: link escapes repository: ${target}`);
      continue;
    }
    try {
      await access(resolved);
    } catch {
      errors.push(`${display(root, file)}: missing relative link target: ${target}`);
    }
  }
}

function markdownLinkTargets(source) {
  const targets = [];
  let inFence = false;
  for (const line of source.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    for (const match of line.matchAll(/!?\[[^\]]*\]\((<[^>]+>|[^\s)]+)(?:\s+[^)]*)?\)/g)) {
      targets.push(unwrapTarget(match[1]));
    }
    const definition = line.match(/^\s*\[[^\]]+\]:\s*(<[^>]+>|\S+)/);
    if (definition) targets.push(unwrapTarget(definition[1]));
  }
  return targets;
}

function unwrapTarget(target) {
  return target.startsWith('<') && target.endsWith('>') ? target.slice(1, -1) : target;
}

function isExternalOrAnchor(target) {
  return target.startsWith('#')
    || target.startsWith('//')
    || /^[a-z][a-z0-9+.-]*:/i.test(target);
}

async function checkSyncedSnippets(root, file, source, errors) {
  const markerCount = [...source.matchAll(/<!--\s*pixiecore-sync\b/g)].length;
  const pattern = /<!--\s*pixiecore-sync\s+source="([^"]+)"\s*-->\s*```[^\n]*\n([\s\S]*?)\n```/g;
  let parsedCount = 0;
  for (const match of source.matchAll(pattern)) {
    parsedCount++;
    const sourcePath = resolve(root, match[1]);
    if (escapesRoot(root, sourcePath)) {
      errors.push(`${display(root, file)}: synced snippet source escapes repository: ${match[1]}`);
      continue;
    }
    try {
      const canonical = normalizeSnippet(await readFile(sourcePath, 'utf8'));
      if (normalizeSnippet(match[2]) !== canonical) {
        errors.push(`${display(root, file)}: synced snippet drifted from ${match[1]}`);
      }
    } catch {
      errors.push(`${display(root, file)}: missing synced snippet source: ${match[1]}`);
    }
  }
  if (markerCount !== parsedCount) {
    errors.push(`${display(root, file)}: malformed pixiecore-sync marker or fenced block`);
  }
}

function collectPackedReferences(file, source, references, errors) {
  const markerCount = [...source.matchAll(/<!--\s*pixiecore-packed\b/g)].length;
  const matches = [...source.matchAll(/<!--\s*pixiecore-packed\s+path="([^"]+)"\s*-->/g)];
  for (const match of matches) references.push({ file, path: normalizePackagePath(match[1]) });
  if (markerCount !== matches.length) errors.push(`${file}: malformed pixiecore-packed marker`);
}

async function checkPackedReferences(root, references, errors) {
  let stdout;
  try {
    ({ stdout } = await execFileAsync(
      process.platform === 'win32' ? 'npm.cmd' : 'npm',
      ['pack', '--dry-run', '--json', '--ignore-scripts'],
      {
        cwd: root,
        maxBuffer: 10 * 1024 * 1024,
        env: {
          ...process.env,
          npm_config_cache: join(tmpdir(), 'pixiecore-docs-npm-cache'),
          npm_config_update_notifier: 'false',
        },
      },
    ));
  } catch (error) {
    errors.push(`package file listing failed: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  let result;
  try {
    result = JSON.parse(stdout);
  } catch {
    errors.push('package file listing returned invalid JSON');
    return;
  }
  const packed = new Set((result[0]?.files ?? []).map(file => normalizePackagePath(file.path)));
  for (const reference of references) {
    if (!packed.has(reference.path)) {
      errors.push(`${display(root, reference.file)}: referenced file is not packed: ${reference.path}`);
    }
  }
}

function normalizeSnippet(value) {
  return value.replaceAll('\r\n', '\n').replace(/\n$/, '');
}

function normalizePackagePath(value) {
  return value.replace(/^\.\//, '').replaceAll('\\', '/');
}

function escapesRoot(root, path) {
  const child = relative(root, path);
  return child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child);
}

function display(root, file) {
  return relative(root, file).replaceAll('\\', '/');
}

async function main() {
  const rootIndex = process.argv.indexOf('--root');
  const root = rootIndex >= 0 ? process.argv[rootIndex + 1] : DEFAULT_ROOT;
  if (!root) throw new Error('--root requires a directory');
  const result = await checkDocs(root);
  if (result.errors.length) {
    for (const error of result.errors) console.error(error);
    process.exitCode = 1;
    return;
  }
  console.log(`Documentation drift check passed (${result.checkedFiles} Markdown files)`);
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  await main();
}
