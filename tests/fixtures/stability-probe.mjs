import { readFileSync, writeFileSync } from 'node:fs';

const arguments_ = process.argv.slice(2);
const mode = valueOf('--mode') ?? 'success';
const statePath = valueOf('--state');
const seed = process.env.TEST_SEED ?? null;

console.log(`PIXIECORE_STABILITY_PROBE ${JSON.stringify({ mode, seed })}`);

if (mode === 'reproducible') {
  process.exitCode = 17;
} else if (mode === 'transient') {
  if (!statePath) throw new TypeError('--state is required in transient mode');
  let previous;
  try {
    previous = readFileSync(statePath, 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  if (previous === seed) {
    process.exitCode = 0;
  } else {
    writeFileSync(statePath, seed ?? '', 'utf8');
    process.exitCode = 19;
  }
}

function valueOf(name) {
  const prefix = `${name}=`;
  return arguments_.find(argument => argument.startsWith(prefix))?.slice(prefix.length);
}
