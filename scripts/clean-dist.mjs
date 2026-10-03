import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { dirname, join, parse, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const distDirectory = resolve(projectRoot, 'dist');

assert.equal(distDirectory, join(projectRoot, 'dist'));
assert.notEqual(distDirectory, projectRoot);
assert.notEqual(distDirectory, parse(distDirectory).root);

await rm(distDirectory, { recursive: true, force: true });
