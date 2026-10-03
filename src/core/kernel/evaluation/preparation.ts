/**
 * Coordinates preparation responsibilities inside the PixieCore kernel.
 */

import { readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { Ajv2020, type ErrorObject } from 'ajv/dist/2020.js';
import YAML from 'yaml';
import { errorMessage } from '../../component/diagnostics/index.js';
import type { BlueprintEvaluationDataset } from '../../contracts/evaluation/index.js';
import type { Blueprint } from '../../contracts/types/index.js';
import { BlueprintValidator } from '../../../plugins/validation/validation.js';

const DATASET_SCHEMA_URL = new URL(
  '../../../../schemas/pixiecore.blueprint-eval-dataset-v1.schema.json',
  import.meta.url,
);

/**
 * Describes the prepared evaluation contract.
 */
export interface PreparedEvaluation {
  readonly cwd: string;
  readonly datasetPath: string;
  readonly datasetSource: string;
  readonly dataset: BlueprintEvaluationDataset;
  readonly projectRoot: string;
  readonly blueprintPath: string;
  readonly blueprintSource: string;
  readonly blueprint: Blueprint;
}

/**
 * Prepares evaluation for the owning PixieCore boundary.
 */
export async function prepareEvaluation(
  declaredDatasetPath: string,
  declaredCwd?: string,
): Promise<PreparedEvaluation> {
  const cwd = await realpath(resolve(declaredCwd ?? process.cwd()));
  const datasetPath = await realpath(
    resolve(cwd, requireNonBlank(declaredDatasetPath, 'datasetPath')),
  );
  const [datasetSource, projectRoot] = await Promise.all([
    readFile(datasetPath, 'utf8'),
    findProjectRoot(datasetPath),
  ]);
  const dataset = await parseDataset(datasetSource);
  assertUniqueCaseIds(dataset);
  const blueprintPath = await resolveBlueprintPath(
    datasetPath,
    dataset.blueprint.path,
    projectRoot,
  );
  const blueprintSource = await readFile(blueprintPath, 'utf8');
  const blueprint = new BlueprintValidator().validateYaml(blueprintSource);
  assertBlueprintVersion(dataset, blueprint);
  return {
    cwd,
    datasetPath,
    datasetSource,
    dataset,
    projectRoot,
    blueprintPath,
    blueprintSource,
    blueprint,
  };
}

async function parseDataset(source: string): Promise<BlueprintEvaluationDataset> {
  let value: unknown;
  try {
    value = YAML.parse(source);
  } catch (cause) {
    throw new TypeError(`Failed to parse evaluation dataset: ${errorMessage(cause)}`, { cause });
  }
  const schema = JSON.parse(await readFile(DATASET_SCHEMA_URL, 'utf8')) as object;
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  if (validate(value)) return value as BlueprintEvaluationDataset;
  throw new TypeError(`Invalid evaluation dataset: ${formatSchemaErrors(validate.errors)}`);
}

async function findProjectRoot(path: string): Promise<string> {
  let current = dirname(path);
  while (true) {
    try {
      await readFile(resolve(current, 'package.json'), 'utf8');
      return await realpath(current);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    const parent = dirname(current);
    if (parent === current) return await realpath(dirname(path));
    current = parent;
  }
}

async function resolveBlueprintPath(
  datasetPath: string,
  declaredPath: string,
  projectRoot: string,
): Promise<string> {
  if (isAbsolute(declaredPath)) {
    throw new TypeError('evaluation blueprint.path must be relative');
  }
  const candidate = resolve(dirname(datasetPath), declaredPath);
  if (escapes(projectRoot, candidate)) {
    throw new TypeError('evaluation blueprint.path escapes the project root');
  }
  const resolved = await realpath(candidate);
  if (escapes(projectRoot, resolved)) {
    throw new TypeError('evaluation blueprint.path resolves outside the project root');
  }
  return resolved;
}

function assertUniqueCaseIds(dataset: BlueprintEvaluationDataset): void {
  const ids = new Set<string>();
  for (const evaluationCase of dataset.cases) {
    if (ids.has(evaluationCase.id)) {
      throw new TypeError(`Duplicate evaluation case id: ${evaluationCase.id}`);
    }
    ids.add(evaluationCase.id);
  }
}

function assertBlueprintVersion(dataset: BlueprintEvaluationDataset, blueprint: Blueprint): void {
  if (dataset.blueprint.version === undefined || dataset.blueprint.version === blueprint.version) return;
  throw new TypeError(
    `Evaluation dataset requires Blueprint version ${dataset.blueprint.version}; found ${blueprint.version}`,
  );
}

function escapes(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === '..' || path.startsWith('../') || isAbsolute(path);
}

function requireNonBlank(value: string, name: string): string {
  if (value.trim()) return value;
  throw new TypeError(`${name} must be non-blank`);
}

function formatSchemaErrors(errors: null | readonly ErrorObject[] | undefined): string {
  return (errors ?? [])
    .map(error => `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`)
    .join('; ');
}

function isMissing(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as NodeJS.ErrnoException).code === 'ENOENT');
}
