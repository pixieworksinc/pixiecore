import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const suppliedSeed = process.env.TEST_SEED?.trim();
const seed = suppliedSeed || randomUUID();
const testTsconfig = fileURLToPath(new URL('../tsconfig.test.json', import.meta.url));

console.log(
  `PixieCore test seed: ${seed}${suppliedSeed ? ' (from TEST_SEED)' : ' (generated; rerun with TEST_SEED=<seed>)'}`,
);

const result = await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, process.argv.slice(2), {
    env: {
      ...process.env,
      TEST_SEED: seed,
      TSX_TSCONFIG_PATH: process.env.TSX_TSCONFIG_PATH ?? testTsconfig,
    },
    stdio: 'inherit',
  });
  child.once('error', reject);
  child.once('exit', (code, signal) => resolve({ code, signal }));
});

if (result.code !== 0) {
  console.error(`Test run failed. Reproduce with ${replayCommand(seed, process.argv.slice(2))}`);
  process.exitCode = result.code ?? 1;
  if (result.signal) console.error(`Test process ended with signal ${result.signal}`);
}

function replayCommand(seed, childArguments) {
  return [
    `TEST_SEED=${shellToken(seed)}`,
    shellToken(process.execPath),
    shellToken(fileURLToPath(import.meta.url)),
    ...childArguments.map(shellToken),
  ].join(' ');
}

function shellToken(value) {
  if (/^[A-Za-z0-9_./:=+,@%-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}
