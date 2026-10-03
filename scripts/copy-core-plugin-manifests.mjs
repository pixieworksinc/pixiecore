#!/usr/bin/env node

import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverCorePluginManifests } from './generate-core-plugin-catalog.mjs';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceRoot = resolve(repositoryRoot, 'src');
const destinationRoot = resolve(repositoryRoot, 'dist');
const manifests = await discoverCorePluginManifests(repositoryRoot);
const recipeArtifacts = [
  resolve(sourceRoot, 'plugins', 'recipe', 'recipes', 'pixiecore.recipe.yaml'),
];
const artifacts = [...manifests, ...recipeArtifacts];

for (const source of artifacts) {
  const sourceRelativePath = relative(sourceRoot, source);
  if (sourceRelativePath.startsWith('..') || sourceRelativePath.split(sep).includes('..')) {
    throw new Error(`Core plugin manifest escapes src: ${source}`);
  }
  const destination = resolve(destinationRoot, sourceRelativePath);
  const destinationRelativePath = relative(destinationRoot, destination);
  if (destinationRelativePath.startsWith('..') || destinationRelativePath.split(sep).includes('..')) {
    throw new Error(`Core plugin manifest destination escapes dist: ${destination}`);
  }
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination);
}

console.log(
  `Copied ${manifests.length} bundled plugin manifests and the standard Recipe into dist.`,
);
