import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { reviewPublicationBriefBenchmarkEvidence } from './benchmark.js';

export interface ReviewPublicationBriefBenchmarkCommand {
  readonly reportPath: string;
  readonly datasetPath?: string;
  readonly outputReportPath: string;
  readonly outputScorecardPath: string;
}

export function parseReviewPublicationBriefBenchmarkArgs(
  args: readonly string[],
): ReviewPublicationBriefBenchmarkCommand {
  const { values } = parseArgs({
    args: [...args],
    strict: true,
    allowPositionals: false,
    options: {
      report: { type: 'string' },
      dataset: { type: 'string' },
      'output-report': { type: 'string' },
      'output-scorecard': { type: 'string' },
    },
  });
  return Object.freeze({
    reportPath: required(values.report, '--report'),
    ...(values.dataset?.trim() ? { datasetPath: values.dataset.trim() } : {}),
    outputReportPath: required(values['output-report'], '--output-report'),
    outputScorecardPath: required(values['output-scorecard'], '--output-scorecard'),
  });
}

function required(value: string | undefined, name: string): string {
  if (value?.trim()) return value.trim();
  throw new TypeError(`${name} is required and must be non-blank`);
}

async function main(): Promise<void> {
  const output = await reviewPublicationBriefBenchmarkEvidence(
    parseReviewPublicationBriefBenchmarkArgs(process.argv.slice(2)),
  );
  console.log(`Reviewed benchmark report: ${output.reportPath}`);
  console.log(`Reviewed benchmark scorecard: ${output.scorecardPath}`);
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(resolve(entry)).href) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
