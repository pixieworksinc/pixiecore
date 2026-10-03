import fs from 'node:fs';
import path from 'node:path';

const SOURCE_ROOTS = ['src/core', 'src/plugins'];
const EXCLUDED_DIRECTORIES = new Set(['generated', 'tests']);
const LEGACY_PLACEHOLDERS = [
  /within the .* boundary\./i,
  /for the public PixieCore contract\./i,
  /with its required dependencies and initial state\./i,
  /\*\s+\[symbol/i,
  /Initializes\s{2,}dependencies/i,
  /Implements the .* operation exposed by the public PixieCore API\./i,
  /Performs .* while preserving the .* contract\./i,
  /Initializes .* dependencies and establishes its lifecycle state\./i,
  /Implements .* kernel behavior for PixieCore\./i,
];

function collectSourceFiles(directory, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRECTORIES.has(entry.name)) collectSourceFiles(filePath, files);
      continue;
    }
    if (entry.isFile() && filePath.endsWith('.ts')) files.push(filePath);
  }
  return files;
}

function fileBody(sourceText) {
  if (!sourceText.startsWith('#!')) return sourceText;
  const newline = sourceText.indexOf('\n');
  return newline === -1 ? '' : sourceText.slice(newline + 1);
}

const failures = [];
for (const root of SOURCE_ROOTS) {
  for (const filePath of collectSourceFiles(root)) {
    const sourceText = fs.readFileSync(filePath, 'utf8');
    const body = fileBody(sourceText).trimStart();
    const header = body.match(/^\/\*\*([\s\S]*?)\*\//)?.[1];
    const description = header
      ?.split('\n')
      .map(line => line.replace(/^\s*\*?\s?/, '').trim())
      .filter(line => line && !line.startsWith('@'))
      .join(' ')
      .trim();
    if (!description) failures.push(`${filePath}: missing non-empty file header`);
    for (const pattern of LEGACY_PLACEHOLDERS) {
      if (pattern.test(sourceText)) {
        failures.push(`${filePath}: contains placeholder documentation matching ${pattern}`);
      }
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log('Source file documentation check passed.');
}
