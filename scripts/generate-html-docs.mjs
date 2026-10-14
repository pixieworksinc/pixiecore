import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { marked } from 'marked';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = join(ROOT, 'docs/html');
const IGNORED = new Set(['.git', '.github', 'node_modules', 'dist', 'build', 'coverage', '.pixiecore']);
const PAGES_BASE = 'https://pixieworksinc.github.io/pixiecore/docs/html/';

const escapeHtml = value => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

function displayPath(file) {
  return relative(ROOT, file).split(sep).join('/');
}

async function discover(directory, files = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (IGNORED.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (path === OUTPUT || path.startsWith(`${OUTPUT}${sep}`)) continue;
    if (entry.isDirectory()) {
      await discover(path, files);
      continue;
    }
    if (entry.isFile() && extname(entry.name).toLowerCase() === '.md') files.push(path);
  }
  return files;
}

function outputPathForMarkdown(sourcePath) {
  const source = displayPath(sourcePath);
  if (source === 'README.md') return 'README.html';
  return source.replace(/(^|\/)README\.md$/i, '$1index.html').replace(/\.md$/i, '.html');
}

function slugForHeading(value, used) {
  const slug = value.toLowerCase()
    .replace(/<[^>]*>/g, '')
    .replace(/&(?:amp|lt|gt|quot|#39);/g, '')
    .replace(/[^\p{L}\p{N}_\- ]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
  const count = used.get(slug) ?? 0;
  used.set(slug, count + 1);
  return count === 0 ? slug : `${slug}-${count}`;
}

function sourcePathFromHref(href, currentSource) {
  let parsed;
  try {
    parsed = new URL(href, `https://repository.invalid/${displayPath(currentSource)}`);
  }
  catch {
    return null;
  }
  if (parsed.origin !== 'https://repository.invalid') return null;
  const pathname = decodeURIComponent(parsed.pathname).replace(/^\//, '');
  const absolute = resolve(ROOT, pathname);
  const rel = relative(ROOT, absolute);
  if (rel === '..' || rel.startsWith(`..${sep}`) || resolve(ROOT, rel) !== absolute) {
    throw new Error(`Documentation link escapes repository: ${href}`);
  }
  return { absolute, pathname: rel.split(sep).join('/'), suffix: `${parsed.search}${parsed.hash}` };
}

function githubMarkdownTarget(href) {
  let url;
  try {
    url = new URL(href);
  }
  catch {
    return null;
  }
  if (url.hostname !== 'github.com') return null;
  const match = url.pathname.match(/^\/pixieworksinc\/pixiecore\/(?:blob|tree)\/([^/]+)\/(.+)$/);
  if (!match) return null;
  if (match[1] !== '0.2.x') return null;
  return { pathname: decodeURIComponent(match[2]), suffix: `${url.search}${url.hash}` };
}

async function resolveMarkdownTarget(pathname) {
  const absolute = resolve(ROOT, pathname);
  let metadata;
  try {
    metadata = await stat(absolute);
  }
  catch {
    return null;
  }
  if (metadata.isDirectory()) {
    const readme = join(absolute, 'README.md');
    try {
      await stat(readme);
      return readme;
    }
    catch {
      return null;
    }
  }
  if (extname(absolute).toLowerCase() === '.md') return absolute;
  return null;
}

async function hasReadme(directory) {
  try {
    await stat(join(directory, 'README.md'));
    return true;
  }
  catch {
    return false;
  }
}

async function renderDirectoryLanding(sourceDirectory, outputRoot, relativeDirectory) {
  const destinationDirectory = join(outputRoot, relativeDirectory);
  await mkdir(destinationDirectory, { recursive: true });
  const entries = (await readdir(sourceDirectory, { withFileTypes: true }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const items = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const source = join(sourceDirectory, entry.name);
    if (entry.isDirectory()) {
      const childRelative = join(relativeDirectory, entry.name);
      if (!await hasReadme(source)) await renderDirectoryLanding(source, outputRoot, childRelative);
      items.push({ name: `${entry.name}/`, href: `${entry.name}/index.html`, directory: true });
      continue;
    }
    if (!entry.isFile()) continue;
    const sourceRelative = relative(ROOT, source).split(sep).join('/');
    if (extname(entry.name).toLowerCase() === '.md') {
      const destination = outputPathForMarkdown(resolve(ROOT, sourceRelative));
      const href = relative(relativeDirectory, destination).split(sep).join('/');
      items.push({ name: entry.name, href: href.startsWith('.') ? href : `./${href}`, directory: false });
      continue;
    }
    await cp(source, join(destinationDirectory, entry.name));
    items.push({ name: entry.name, href: entry.name, directory: false });
  }

  const style = relative(relativeDirectory, 'assets/docs.css').split(sep).join('/');
  const rows = items.map(item => `<li>${item.directory ? '▸ ' : ''}<a href="${escapeHtml(item.href)}">${escapeHtml(item.name)}</a></li>`).join('');
  const title = relativeDirectory.split(sep).at(-1) || 'Repository files';
  const home = relative(relativeDirectory, 'index.html').split(sep).join('/');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="dark"><title>${escapeHtml(title)} · PixieCore Documentation</title><link rel="stylesheet" href="${escapeHtml(style)}"></head><body><header class="site-header"><a class="brand" href="${escapeHtml(home)}">PixieCore <span>Documentation</span></a><a class="repo" href="https://github.com/pixieworksinc/pixiecore">GitHub repository</a></header><main class="index-page"><p class="breadcrumb"><a href="${escapeHtml(home)}">Documentation</a> / <code>${escapeHtml(relativeDirectory)}</code></p><h1>${escapeHtml(title)}</h1><ul class="directory-list">${rows}</ul></main></body></html>`;
  await writeFile(join(destinationDirectory, 'index.html'), html);
}

async function rewriteLink(href, currentSource, currentOutput, stage) {
  if (!href || href.startsWith('#') || href.startsWith('//') || /^[a-z][a-z\d+.-]*:/i.test(href)) {
    const githubTarget = githubMarkdownTarget(href ?? '');
    if (!githubTarget) return href;
    const sourceTarget = await resolveMarkdownTarget(githubTarget.pathname);
    return sourceTarget ? `${PAGES_BASE}${outputPathForMarkdown(sourceTarget)}${githubTarget.suffix}` : href;
  }

  const target = sourcePathFromHref(href, currentSource);
  if (!target) return href;
  const markdownTarget = await resolveMarkdownTarget(target.absolute);
  if (markdownTarget) {
    const destination = outputPathForMarkdown(markdownTarget);
    const currentDirectory = dirname(currentOutput);
    let relativeTarget = relative(currentDirectory, destination).split(sep).join('/');
    if (!relativeTarget.startsWith('.')) relativeTarget = `./${relativeTarget}`;
    return `${relativeTarget}${target.suffix}`;
  }

  try {
    const info = await stat(target.absolute);
    if (info.isDirectory()) {
      await renderDirectoryLanding(target.absolute, stage, target.pathname);
      const destination = join(target.pathname, 'index.html');
      let relativeTarget = relative(dirname(currentOutput), destination).split(sep).join('/');
      if (!relativeTarget.startsWith('.')) relativeTarget = `./${relativeTarget}`;
      return `${relativeTarget}${target.suffix}`;
    }
    if (info.isFile()) {
      const assetDestination = join(stage, target.pathname);
      await mkdir(dirname(assetDestination), { recursive: true });
      await cp(target.absolute, assetDestination);
    }
  }
  catch {
    throw new Error(`${displayPath(currentSource)} links to a missing file: ${href}`);
  }
  return href;
}

async function renderMarkdown(sourcePath, stage, allDocs) {
  const source = await readFile(sourcePath, 'utf8');
  const destination = outputPathForMarkdown(sourcePath);
  const targetFile = join(stage, destination);
  await mkdir(dirname(targetFile), { recursive: true });

  const usedHeadings = new Map();
  const renderer = new marked.Renderer();
  renderer.heading = ({ depth, text, tokens }) => {
    const id = slugForHeading(text, usedHeadings);
    const inline = renderer.parser.parseInline(tokens);
    return `<h${depth} id="${escapeHtml(id)}">${inline}</h${depth}>\n`;
  };

  // Resolve links before rendering so the synchronous Marked renderer can keep
  // reference-style links and inline links on the same path.
  const tokens = marked.lexer(source, { gfm: true });
  const linkMap = new Map();
  const links = [];
  marked.walkTokens(tokens, token => {
    if (token.type === 'link' || token.type === 'image') {
      links.push(token.href);
    }
  });
  const rewritten = await Promise.all(links.map(href => rewriteLink(href, sourcePath, destination, stage)));
  links.forEach((href, index) => linkMap.set(href, rewritten[index]));
  renderer.link = ({ href, title, tokens: inlineTokens }) => {
    const label = renderer.parser.parseInline(inlineTokens);
    const titleAttribute = title ? ` title="${escapeHtml(title)}"` : '';
    const url = linkMap.has(href) ? linkMap.get(href) : href;
    return `<a href="${escapeHtml(url)}"${titleAttribute}>${label}</a>`;
  };
  renderer.image = ({ href, title, text }) => {
    const titleAttribute = title ? ` title="${escapeHtml(title)}"` : '';
    const url = linkMap.has(href) ? linkMap.get(href) : href;
    return `<img src="${escapeHtml(url)}" alt="${escapeHtml(text)}"${titleAttribute} loading="lazy">`;
  };
  renderer.code = ({ text, lang }) => {
    if (lang === 'mermaid') return `<pre class="mermaid">${escapeHtml(text)}</pre>\n`;
    const language = lang ? ` class="language-${escapeHtml(lang)}"` : '';
    return `<pre><code${language}>${escapeHtml(text)}</code></pre>\n`;
  };

  const body = marked.parse(source, { gfm: true, renderer });
  const title = firstHeading(tokens) ?? displayPath(sourcePath);
  const style = relative(dirname(destination), 'assets/docs.css').split(sep).join('/');
  const home = relative(dirname(destination), 'index.html').split(sep).join('/');
  const index = navigation(allDocs, destination);
  const mermaidScript = body.includes('class="mermaid"')
    ? `<script type="module">import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11.17.2/dist/mermaid.esm.min.mjs';mermaid.initialize({startOnLoad:true,theme:'dark'});</script>`
    : '';
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>${escapeHtml(title)} · PixieCore Documentation</title>
  <link rel="stylesheet" href="${escapeHtml(style)}">
</head>
<body>
  <header class="site-header"><a class="brand" href="${escapeHtml(home)}">PixieCore <span>Documentation</span></a><a class="repo" href="https://github.com/pixieworksinc/pixiecore">GitHub repository</a></header>
  <div class="layout"><aside class="sidebar"><a class="home-link" href="${escapeHtml(home)}">Documentation home</a>${index}</aside><main class="document"><p class="breadcrumb"><a href="${escapeHtml(home)}">Documentation</a> / <code>${escapeHtml(displayPath(sourcePath))}</code></p>${body}</main></div>
  ${mermaidScript}
</body>
</html>
`;
  await writeFile(targetFile, html);
}

function firstHeading(tokens) {
  for (const token of tokens) {
    if (token.type === 'heading' && token.depth === 1) return token.text;
  }
  return null;
}

function htmlLink(text, href) {
  return `<li><a href="${escapeHtml(href)}">${escapeHtml(text)}</a></li>`;
}

function navigation(docs, currentOutput) {
  const groups = new Map();
  for (const doc of docs) {
    const output = outputPathForMarkdown(doc);
    const path = displayPath(doc);
    const parts = path.split('/');
    const group = parts.length > 1 ? parts.slice(0, -1).join(' / ') : 'Repository';
    if (!groups.has(group)) groups.set(group, []);
    const relativeTarget = relative(dirname(currentOutput), output).split(sep).join('/');
    const filename = parts.at(-1).replace(/\.md$/i, '');
    const label = filename.toLowerCase() === 'readme' ? group : filename.replaceAll('-', ' ');
    groups.get(group).push(htmlLink(label, relativeTarget.startsWith('.') ? relativeTarget : `./${relativeTarget}`));
  }
  return `<details class="doc-list"><summary>Browse all documentation</summary>${[...groups]
    .map(([group, links]) => `<section><h2>${escapeHtml(group)}</h2><ul>${links.join('')}</ul></section>`)
    .join('')}</details>`;
}

function renderIndex(docs, stage) {
  const groups = new Map();
  for (const doc of docs) {
    const path = displayPath(doc);
    const parts = path.split('/');
    const group = parts.length > 1 ? parts.slice(0, -1).join(' / ') : 'Repository';
    if (!groups.has(group)) groups.set(group, []);
    const output = outputPathForMarkdown(doc);
    const filename = parts.at(-1).replace(/\.md$/i, '');
    const label = filename.toLowerCase() === 'readme' ? group : filename.replaceAll('-', ' ');
    groups.get(group).push(htmlLink(label, output));
  }
  const sections = [...groups].map(([group, links]) => `<section><h2>${escapeHtml(group)}</h2><ul>${links.join('')}</ul></section>`).join('');
  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="dark"><title>PixieCore Documentation</title><link rel="stylesheet" href="assets/docs.css"></head>
<body><header class="site-header"><a class="brand" href="index.html">PixieCore <span>Documentation</span></a><a class="repo" href="https://github.com/pixieworksinc/pixiecore">GitHub repository</a></header><main class="index-page"><p class="eyebrow">DOCUMENTATION · PIXIECORE</p><h1>PixieCore Documentation</h1><p class="intro">Browse the public guides, architecture, runtime contracts, specifications, and examples in the PixieCore repository.</p><div class="index-grid">${sections}</div></main></body>
</html>
`;
  return writeFile(join(stage, 'index.html'), html);
}

async function build(outputRoot) {
  const docs = (await discover(ROOT)).sort();
  if (!docs.length) throw new Error('No Markdown documentation files were found.');
  await mkdir(outputRoot, { recursive: true });
  await Promise.all(docs.map(doc => renderMarkdown(doc, outputRoot, docs)));
  await mkdir(join(outputRoot, 'assets'), { recursive: true });
  await writeFile(join(outputRoot, 'assets/docs.css'), css);
  await renderIndex(docs, outputRoot);
  return docs.length;
}

const css = `:root{color-scheme:dark;--bg:#061326;--panel:#0a1b33;--line:#233954;--text:#e8f0ff;--muted:#99abc4;--blue:#4c8dff;--violet:#7866ff}*{box-sizing:border-box}body{margin:0;background:linear-gradient(145deg,#071529,#0a1b33 55%,#071326);color:var(--text);font:16px/1.7 system-ui,-apple-system,"Segoe UI",sans-serif}.site-header{min-height:72px;padding:16px clamp(20px,5vw,72px);display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line);background:rgba(5,17,33,.9)}a{color:#8ab4ff;font-weight:600;text-decoration:none}a:hover{color:#c3d7ff;text-decoration:underline}.brand{font-size:20px;color:var(--text);font-weight:750}.brand span{color:var(--muted);font-weight:500;margin-left:.6rem}.repo{font:12px ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase}.layout{display:grid;grid-template-columns:minmax(220px,280px) minmax(0,860px);gap:clamp(24px,5vw,72px);max-width:1320px;margin:0 auto;padding:40px clamp(20px,5vw,72px) 96px}.sidebar{position:sticky;top:20px;align-self:start;max-height:calc(100vh - 40px);overflow:auto;padding:18px;border:1px solid var(--line);border-radius:14px;background:rgba(10,27,51,.8)}.home-link{display:block;padding-bottom:14px;border-bottom:1px solid var(--line)}.doc-list summary{cursor:pointer;color:var(--text);font-weight:700;padding:16px 0}.doc-list section{padding:0 0 12px}.doc-list h2{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}.doc-list ul,.index-grid ul{list-style:none;padding:0;margin:0}.doc-list li{margin:.35rem 0;font-size:13px}.doc-list li a{font-weight:500}.document{min-width:0}.breadcrumb,.eyebrow{color:var(--muted);font-size:12px;letter-spacing:.08em;text-transform:uppercase}.breadcrumb code{letter-spacing:0;text-transform:none}h1,h2,h3,h4{line-height:1.2;letter-spacing:-.025em}h1{font-size:clamp(2rem,4vw,3.5rem);margin:.6em 0}h2{font-size:clamp(1.45rem,2.7vw,2rem);margin-top:2em}h3{font-size:1.25rem;margin-top:1.7em}p,li{color:#c6d3e6}code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}code{font-size:.9em;color:#bdccff}pre{overflow:auto;padding:18px;background:#04101f;border:1px solid var(--line);border-radius:10px;color:#dbe7fb}blockquote{margin:1.5em 0;padding:8px 18px;border-left:3px solid var(--blue);background:#0a1b33;color:var(--muted)}table{display:block;max-width:100%;overflow:auto;border-collapse:collapse}th,td{padding:9px 12px;border:1px solid var(--line);text-align:left}th{background:#102644}hr{border:0;border-top:1px solid var(--line);margin:2.5em 0}.index-page{max-width:1120px;margin:0 auto;padding:clamp(32px,7vw,96px) 24px}.intro{max-width:760px;font-size:1.2rem;color:var(--muted)}.index-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:18px;margin-top:42px}.index-grid section{padding:20px;border:1px solid var(--line);border-radius:12px;background:rgba(10,27,51,.8)}.index-grid h2{margin:0 0 12px;font-size:1.1rem}.index-grid li{margin:8px 0}.mermaid{background:transparent;border:0;text-align:center}@media(max-width:850px){.layout{grid-template-columns:1fr}.sidebar{position:static;max-height:none}.site-header{padding-inline:20px}.layout{padding:24px 20px 64px}}`;

async function compareDirectory(expected, actual) {
  const expectedFiles = await collectFiles(expected);
  const actualFiles = await collectFiles(actual);
  const errors = [];
  for (const file of expectedFiles) {
    const path = relative(expected, file);
    const other = join(actual, path);
    try {
      const [left, right] = await Promise.all([readFile(file), readFile(other)]);
      if (!left.equals(right)) errors.push(`stale or changed generated file: ${path}`);
    }
    catch {
      errors.push(`missing generated file: ${path}`);
    }
  }
  const known = new Set(expectedFiles.map(file => relative(expected, file)));
  for (const file of actualFiles) {
    const path = relative(actual, file);
    if (!known.has(path)) errors.push(`unexpected generated file: ${path}`);
  }
  return errors;
}

async function collectFiles(directory, files = []) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  }
  catch {
    return files;
  }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await collectFiles(path, files);
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function decodeHtmlAttribute(value) {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>');
}

async function validateGeneratedReferences(root) {
  const errors = [];
  for (const file of await collectFiles(root)) {
    if (extname(file).toLowerCase() !== '.html') continue;
    const html = await readFile(file, 'utf8');
    for (const match of html.matchAll(/\b(?:href|src)="([^"]*)"/g)) {
      const target = decodeHtmlAttribute(match[1]);
      if (!target || target.startsWith('//') || /^[a-z][a-z\d+.-]*:/i.test(target)) {
        let parsed;
        try {
          parsed = new URL(target);
        }
        catch {
          continue;
        }
        if (parsed.hostname !== 'pixieworksinc.github.io') continue;
        const pagesPrefix = '/pixiecore/docs/html/';
        if (!parsed.pathname.startsWith(pagesPrefix)) continue;
        const localTarget = resolve(root, parsed.pathname.slice(pagesPrefix.length));
        await verifyLocalTarget(file, localTarget, parsed.hash, errors);
        continue;
      }
      const parsed = new URL(target, pathToFileURL(file));
      if (parsed.protocol !== 'file:') continue;
      const localTarget = resolve(fileURLToPath(parsed));
      await verifyLocalTarget(file, localTarget, parsed.hash, errors);
    }
  }
  return errors;
}

async function verifyLocalTarget(sourceFile, targetFile, fragment, errors) {
  let html;
  try {
    html = await readFile(targetFile, 'utf8');
  }
  catch {
    try {
      await stat(targetFile);
    }
    catch {
      errors.push(`${relative(ROOT, sourceFile)}: missing generated target ${relative(dirname(sourceFile), targetFile)}`);
      return;
    }
    return;
  }
  if (!fragment) return;
  let id;
  try {
    id = decodeURIComponent(fragment.slice(1));
  }
  catch {
    errors.push(`${relative(ROOT, sourceFile)}: invalid fragment ${fragment}`);
    return;
  }
  if (!html.includes(`id="${escapeHtml(id)}"`) && !html.includes(`name="${escapeHtml(id)}"`)) {
    errors.push(`${relative(ROOT, sourceFile)}: missing fragment ${fragment} in ${relative(dirname(sourceFile), targetFile)}`);
  }
}

async function main() {
  const write = process.argv.includes('--write');
  if (write) {
    await rm(OUTPUT, { recursive: true, force: true });
    const count = await build(OUTPUT);
    const errors = await validateGeneratedReferences(OUTPUT);
    if (errors.length) throw new Error(errors.join('\n'));
    console.log(`Generated HTML for ${count} Markdown documents in docs/html/.`);
    return;
  }
  const temporary = await import('node:fs/promises').then(fs => fs.mkdtemp(join(tmpdir(), 'pixiecore-html-docs-')));
  try {
    const count = await build(join(temporary, 'docs/html'));
    const errors = await compareDirectory(join(temporary, 'docs/html'), OUTPUT);
    errors.push(...await validateGeneratedReferences(join(temporary, 'docs/html')));
    if (errors.length) throw new Error(errors.join('\n'));
    console.log(`Verified generated HTML for ${count} Markdown documents.`);
  }
  finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

await main();
