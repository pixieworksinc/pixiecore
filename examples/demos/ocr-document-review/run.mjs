import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * @param {string[]} [argv]
 * @returns {Promise<Record<string, unknown>>}
 */
async function runOcrDocumentReview(argv = process.argv.slice(2)) {
  const mode = parseMode(argv);
  const packageRoot = fileURLToPath(new URL('../../../', import.meta.url));
  const cliPath = fileURLToPath(new URL('../../../dist/core/kernel/cli/index.js', import.meta.url));
  const datasetPath = fileURLToPath(new URL(
    '../../blueprints/extractor/travel-document-fields/evaluations/travel-document-fields.yaml',
    import.meta.url,
  ));
  const result = await run(process.execPath, [
    cliPath,
    'blueprint',
    'play',
    datasetPath,
    '--case=scanned-pdf-partial',
    `--mode=${mode}`,
  ], packageRoot);
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || `OCR demo failed with exit code ${result.code}`);
  }
  return JSON.parse(result.stdout);
}

/**
 * @param {string[]} argv
 * @returns {'mock' | 'real' | 'both'}
 */
function parseMode(argv) {
  if (argv.length > 1) throw new TypeError('Usage: run.mjs [--mode=mock|real|both]');
  if (argv.length === 0) return 'mock';
  const argument = argv[0];
  if (argument === undefined) throw new TypeError('Usage: run.mjs [--mode=mock|real|both]');
  const match = /^--mode=(mock|real|both)$/.exec(argument);
  if (!match || match[1] === undefined) {
    throw new TypeError('Usage: run.mjs [--mode=mock|real|both]');
  }
  return /** @type {'mock' | 'real' | 'both'} */ (match[1]);
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {string} cwd
 * @returns {Promise<{code: number | null, stdout: string, stderr: string}>}
 */
async function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => resolve({ code, stdout, stderr }));
  });
}

try {
  console.log(JSON.stringify(await runOcrDocumentReview(), null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
