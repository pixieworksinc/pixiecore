const arguments_ = process.argv.slice(2);
const exitCodeIndex = arguments_.indexOf('--exit-code');

console.log(`PIXIECORE_TEST_SEED_PROBE ${JSON.stringify({
  seed: process.env.TEST_SEED ?? null,
  arguments: arguments_,
})}`);

if (exitCodeIndex >= 0) {
  const exitCode = Number(arguments_[exitCodeIndex + 1]);
  if (!Number.isInteger(exitCode) || exitCode < 1 || exitCode > 255) {
    console.error('Probe exit code must be an integer from 1 through 255');
    process.exitCode = 64;
  } else {
    process.exitCode = exitCode;
  }
}
