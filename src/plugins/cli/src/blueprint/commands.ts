/**
 * Implements commands behavior for the cli plugin.
 */

import { basename, resolve } from 'node:path';
import { diagnosticMessage, errorMessage } from '../../../../core/component/diagnostics/index.js';
import type {
  CliApplicationInspectInvocation,
  CliBlueprintCheckInvocation,
  CliBlueprintCreateInvocation,
  CliBlueprintEvalInvocation,
  CliBlueprintPlayInvocation,
  CliBlueprintScaffoldFile,
  CliHostPort,
} from '../../../../core/contracts/cli/index.js';
import type {
  BlueprintEvaluationResultArtifact,
  BlueprintPlaygroundArtifact,
} from '../../../../core/contracts/evaluation/index.js';
import {
  BLUEPRINT_OPERATIONS,
  createBlueprintScaffoldFiles,
  type BlueprintOperation,
} from './scaffold.js';
import { CLI_USAGE_TEXT, CliUsageError } from '../command/usage.js';

const OUTPUT_PREFIX = '--output=';
const SEED_PREFIX = '--seed=';
const OPERATION_PREFIX = '--operation=';
const NAME_PREFIX = '--name=';
const FORMAT_PREFIX = '--format=';
const CASE_PREFIX = '--case=';
const MODE_PREFIX = '--mode=';

/**
 * Executes blueprint play through its public boundary.
 */
export async function runBlueprintPlay(
  invocation: CliBlueprintPlayInvocation,
  host: CliHostPort,
): Promise<void> {
  const { path, options } = onePathWithOptions(invocation.args, [CASE_PREFIX, MODE_PREFIX]);
  const caseId = optionValue(options, CASE_PREFIX, '--case');
  const mode = optionValue(options, MODE_PREFIX, '--mode') ?? 'mock';
  if (!caseId || (mode !== 'mock' && mode !== 'real' && mode !== 'both')) {
    throw new CliUsageError(CLI_USAGE_TEXT);
  }
  const artifact = await invocation.factories.runPlayground({ datasetPath: path, caseId, mode });
  host.writeStdout(JSON.stringify(artifact, null, 2));
  if (artifact.real?.comparison.limitations?.includes('factuality_not_evaluated')) {
    host.writeStderr('Comparison scope: structural checks only; factuality was not evaluated.');
  }
  if (artifact.real?.comparison.passed !== false) return;
  host.writeStderr(playgroundFailureMessage(artifact));
  host.setExitCode(1);
}

/**
 * Executes application inspect through its public boundary.
 */
export async function runApplicationInspect(
  invocation: CliApplicationInspectInvocation,
  host: CliHostPort,
): Promise<void> {
  const { path, options } = onePathWithOptions(invocation.args, [FORMAT_PREFIX]);
  const format = optionValue(options, FORMAT_PREFIX, '--format') ?? 'json';
  if (format !== 'json' && format !== 'mermaid') throw new CliUsageError(CLI_USAGE_TEXT);
  const inspection = await invocation.factories.inspectApplication(path);
  host.writeStdout(format === 'mermaid'
    ? invocation.factories.renderMermaid(inspection)
    : JSON.stringify(inspection, null, 2));
}

/**
 * Executes blueprint check through its public boundary.
 */
export async function runBlueprintCheck(
  invocation: CliBlueprintCheckInvocation,
  host: CliHostPort,
): Promise<void> {
  const path = onePlainPath(invocation.args);
  if (invocation.command === 'test') {
    host.writeStdout(JSON.stringify(await invocation.factories.testBlueprintUnit(path), null, 2));
    return;
  }
  const inspection = await invocation.factories.inspectBlueprint(path);
  if (invocation.command === 'inspect') {
    host.writeStdout(JSON.stringify(inspection, null, 2));
    return;
  }
  host.writeStdout(`Blueprint valid: ${inspection.name} (${inspection.version})`);
}

/**
 * Executes blueprint create through its public boundary.
 */
export async function runBlueprintCreate(
  invocation: CliBlueprintCreateInvocation,
  host: CliHostPort,
): Promise<void> {
  const { path: directory, options } = onePathWithOptions(
    invocation.args,
    [OPERATION_PREFIX, NAME_PREFIX],
  );
  const operationValue = optionValue(options, OPERATION_PREFIX, '--operation');
  if (!operationValue || !isBlueprintOperation(operationValue)) {
    throw new CliUsageError(`--operation must be one of: ${BLUEPRINT_OPERATIONS.join(', ')}`);
  }
  const files = scaffoldFiles(
    basename(resolve(directory)),
    operationValue,
    optionValue(options, NAME_PREFIX, '--name'),
  );
  await invocation.factories.createScaffold(directory, files);
  host.writeStdout(`Created Blueprint scaffold at ${directory}`);
}

/**
 * Executes blueprint evaluation through its public boundary.
 */
export async function runBlueprintEvaluation(
  invocation: CliBlueprintEvalInvocation,
  host: CliHostPort,
): Promise<void> {
  const { path: datasetPath, options } = onePathWithOptions(
    invocation.args,
    [SEED_PREFIX, OUTPUT_PREFIX],
  );
  const seed = optionValue(options, SEED_PREFIX, '--seed');
  const output = optionValue(options, OUTPUT_PREFIX, '--output');
  const artifact = await invocation.factories.runEvaluation({
    datasetPath,
    ...(seed === undefined ? {} : { seed }),
  });
  await writeEvaluationArtifact(invocation, host, artifact, output);
  if (artifact.cases.some(item => item.limitations?.includes('factuality_not_evaluated'))) {
    host.writeStderr('Comparison scope: includes structural checks only; factuality was not evaluated for those cases.');
  }
  if (artifact.summary.failed === 0 && artifact.summary.errors === 0) return;
  host.writeStderr(evaluationFailureMessage(artifact));
  host.setExitCode(1);
}

async function writeEvaluationArtifact(
  invocation: CliBlueprintEvalInvocation,
  host: CliHostPort,
  artifact: BlueprintEvaluationResultArtifact,
  output: string | undefined,
): Promise<void> {
  const serialized = `${JSON.stringify(artifact, null, 2)}\n`;
  if (output === undefined) {
    host.writeStdout(serialized.trimEnd());
    return;
  }
  await invocation.factories.writeTextFile(output, serialized);
  host.writeStdout(`Evaluation artifact written to ${output}`);
}

function scaffoldFiles(
  slug: string,
  operation: BlueprintOperation,
  displayName: string | undefined,
): readonly CliBlueprintScaffoldFile[] {
  try {
    return createBlueprintScaffoldFiles(slug, operation, displayName);
  } catch (cause) {
    throw new CliUsageError(errorMessage(cause));
  }
}

function onePlainPath(args: readonly string[]): string {
  if (args.length !== 1 || args[0]!.startsWith('--')) throw new CliUsageError(CLI_USAGE_TEXT);
  return args[0]!;
}

function onePathWithOptions(
  args: readonly string[],
  allowedPrefixes: readonly string[],
): { path: string; options: readonly string[] } {
  const paths = args.filter(argument => !argument.startsWith('--'));
  const options = args.filter(argument => argument.startsWith('--'));
  if (paths.length !== 1) throw new CliUsageError(CLI_USAGE_TEXT);
  if (options.some(argument => !allowedPrefixes.some(prefix => argument.startsWith(prefix)))) {
    throw new CliUsageError(CLI_USAGE_TEXT);
  }
  return { path: paths[0]!, options };
}

function optionValue(
  args: readonly string[],
  prefix: string,
  label: string,
): string | undefined {
  const matches = args.filter(argument => argument.startsWith(prefix));
  if (matches.length > 1) throw new CliUsageError(`${label} may be specified only once`);
  const value = matches[0]?.slice(prefix.length);
  if (value === undefined) return undefined;
  if (!value.trim()) throw new CliUsageError(`${label} must be non-blank`);
  return value;
}

function isBlueprintOperation(value: string): value is BlueprintOperation {
  return (BLUEPRINT_OPERATIONS as readonly string[]).includes(value);
}

function evaluationFailureMessage(artifact: BlueprintEvaluationResultArtifact): string {
  const fields = artifact.cases.flatMap(item => (
    item.differences ?? []
  ).map(difference => difference.pointer || '/'));
  const suggestions = [
    ...(artifact.summary.failed === 0
      ? []
      : ['Review the expected output and comparison policy for the listed fields.']),
    ...(artifact.summary.errors === 0
      ? []
      : ['Inspect each recorded case error and validate provider and runtime configuration.']),
  ];
  return diagnosticMessage(
    `Evaluation failed: ${artifact.summary.failed} failed, ${artifact.summary.errors} errors.`,
    { blueprint: artifact.blueprint, fields, replayCommand: artifact.replay_command, suggestions },
  );
}

function playgroundFailureMessage(artifact: BlueprintPlaygroundArtifact): string {
  const fields = (artifact.real?.comparison.differences ?? [])
    .map(difference => difference.pointer || '/');
  return diagnosticMessage(
    `Playground comparison failed for case ${artifact.case.id}.`,
    {
      blueprint: artifact.blueprint,
      fields,
      replayCommand: artifact.replay_command,
      suggestions: [
        'Compare the real-provider output with the fixture and refine the Blueprint or expected output.',
      ],
    },
  );
}
