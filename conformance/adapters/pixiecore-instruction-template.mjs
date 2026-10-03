#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { runInstructionTemplateConformanceSuite } from '../../dist/core/kernel/conformance/index.js';

const suitePath = optionValue(process.argv.slice(2), '--suite');
if (!suitePath) {
  process.stderr.write(
    'Usage: node conformance/adapters/pixiecore-instruction-template.mjs --suite <suite.json>\n',
  );
  process.exitCode = 2;
} else {
  try {
    const suite = JSON.parse(await readFile(suitePath, 'utf8'));
    const report = await runInstructionTemplateConformanceSuite({ suite });
    process.stdout.write(`${JSON.stringify(report)}\n`);
    process.exitCode = report.conformant ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}

function optionValue(args, name) {
  const index = args.indexOf(name);
  if (index < 0 || index + 1 >= args.length) return undefined;
  return args[index + 1];
}
