import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const { runs, command, arguments: childArguments } = parseArguments(
  process.argv.slice(2),
  process.env.TEST_STABILITY_RUNS,
);

for (let run = 1; run <= runs; run++) {
  const seed = randomUUID();
  console.log(`PixieCore stability run ${run}/${runs} seed: ${seed}`);
  const first = await runChild(command, childArguments, seed);
  if (first.code === 0 && !first.signal) continue;

  console.error(
    `PixieCore stability run ${run}/${runs} failed; replaying the same seed ${seed}`,
  );
  console.error(`Direct replay: ${replayCommand(seed, command, childArguments)}`);
  const replay = await runChild(command, childArguments, seed);
  const classification = replay.code === 0 && !replay.signal
    ? 'non-seed nondeterminism'
    : 'seed-reproducible failure';
  console.error(`PixieCore stability classification: ${classification}`);
  reportSignal('initial run', first.signal);
  reportSignal('same-seed replay', replay.signal);
  process.exitCode = 1;
  break;
}

if (!process.exitCode) {
  console.log(`PixieCore stability check passed (${runs} independent runs)`);
}

function parseArguments(arguments_, configuredRuns) {
  const separator = arguments_.indexOf('--');
  const options = separator < 0 ? arguments_ : arguments_.slice(0, separator);
  const commandArguments = separator < 0 ? [] : arguments_.slice(separator + 1);
  let runValue = configuredRuns?.trim() || '5';
  for (const option of options) {
    if (!option.startsWith('--runs=')) {
      throw new TypeError(`Unsupported stability option: ${option}`);
    }
    runValue = option.slice('--runs='.length);
  }
  const parsedRuns = Number(runValue);
  if (!Number.isSafeInteger(parsedRuns) || parsedRuns < 1) {
    throw new RangeError('stability runs must be a positive safe integer');
  }
  if (separator >= 0 && commandArguments.length === 0) {
    throw new TypeError('-- must be followed by a command');
  }
  return commandArguments.length
    ? { runs: parsedRuns, command: commandArguments[0], arguments: commandArguments.slice(1) }
    : { runs: parsedRuns, command: npm, arguments: ['test'] };
}

function runChild(command, arguments_, seed) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, {
      env: { ...process.env, TEST_SEED: seed },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.pipe(process.stdout);
    child.stderr.pipe(process.stderr);
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
}

function reportSignal(label, signal) {
  if (signal) console.error(`PixieCore stability ${label} ended with signal ${signal}`);
}

function replayCommand(seed, command, arguments_) {
  return [
    `TEST_SEED=${shellToken(seed)}`,
    shellToken(command),
    ...arguments_.map(shellToken),
  ].join(' ');
}

function shellToken(value) {
  if (/^[A-Za-z0-9_./:=+,@%-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}
