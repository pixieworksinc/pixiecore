/**
 * Implements blueprint behavior for the validation plugin.
 */

import { readFile } from 'node:fs/promises';
import YAML from 'yaml';
import { findInstructionPlaceholders } from '../../../../core/component/instruction-template/index.js';
import { BlueprintValidationError } from '../../../../core/contracts/errors/index.js';
import type { Blueprint, InputPlaceholder } from '../../../../core/contracts/types/index.js';
import { compileJsonSchema } from './json-schema.js';
import { isRecord, normalizePlaceholders } from './shared.js';
import { normalizePrompt } from './scenario.js';

const REQUIRED_FIELDS = ['name', 'version', 'role', 'prompt', 'output_schema'] as const;
const REQUIRED_TEXT_FIELDS = ['name', 'role'] as const;

/**
 * Configures blueprint validator behavior.
 */
export interface BlueprintValidatorOptions {
  warn?: (message: string) => void;
}

/**
 * Validates blueprint contracts before execution.
 */
export class BlueprintValidator {
  private readonly warn: (message: string) => void;

  /**
   * Creates a BlueprintValidator and establishes its initial state.
   */
  constructor(
    options: BlueprintValidatorOptions = {},
    private readonly compileSchema = compileJsonSchema,
  ) {
    this.warn = options.warn ?? (message => console.warn(`[PixieCore] ${message}`));
  }

  /**
   * Validates dict and rejects unsupported state.
   */
  validateDict(input: unknown): Blueprint {
    if (!isRecord(input)) {
      throw new BlueprintValidationError('Blueprint must be a dictionary/object');
    }
    validateRequiredFields(input);
    validateRequiredTextFields(input);
    const prompt = normalizePrompt(input.prompt);
    validateVersion(input.version);
    validateJsonSchema(input.output_schema, 'output_schema', this.compileSchema);
    const placeholders = normalizePlaceholders(input.input_placeholders, 'Invalid type');
    validateOptionalFields(input, this.compileSchema);
    validateInstructionBindings({ ...input, prompt }, placeholders);
    if (typeof input.prompt === 'string') {
      warnForIncompleteRecommendedGherkin(prompt, this.warn);
    }
    return { ...input, prompt } as unknown as Blueprint;
  }

  /**
   * Validates yaml and rejects unsupported state.
   */
  validateYaml(source: string): Blueprint {
    try {
      return this.validateDict(YAML.parse(source));
    } catch (error) {
      if (error instanceof BlueprintValidationError) throw error;
      throw new BlueprintValidationError(`Failed to parse YAML: ${(error as Error).message}`, {
        cause: error,
      });
    }
  }

  /**
   * Validates file and rejects unsupported state.
   */
  async validateFile(path: string): Promise<Blueprint> {
    try {
      return this.validateYaml(await readFile(path, 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      throw new BlueprintValidationError(`Blueprint file not found: ${path}`, { cause: error });
    }
  }
}

function validateInstructionBindings(
  blueprint: Record<string, unknown>,
  placeholders: readonly InputPlaceholder[],
): void {
  if (placeholders.length === 0) return;
  const declared = new Set(placeholders.map(placeholder => placeholder.name));
  assertDeclaredReferences(blueprint.prompt as string, 'prompt', declared);
  if (!isRecord(blueprint.localization)) return;
  for (const [key, value] of Object.entries(blueprint.localization)) {
    assertDeclaredReferences(value as string, `localization.${key}`, declared);
  }
}

function assertDeclaredReferences(
  template: string,
  location: string,
  declared: ReadonlySet<string>,
): void {
  const undeclared = [...new Set(
    findInstructionPlaceholders(template)
      .map(reference => reference.name)
      .filter(name => !declared.has(name)),
  )];
  if (undeclared.length === 0) return;
  throw new BlueprintValidationError(
    `${location} references undeclared input placeholder${undeclared.length === 1 ? '' : 's'}: `
    + undeclared.join(', '),
  );
}

function validateRequiredFields(blueprint: Record<string, unknown>): void {
  for (const key of REQUIRED_FIELDS) {
    if (!(key in blueprint)) throw new BlueprintValidationError(`Missing required field: ${key}`);
  }
}

function validateRequiredTextFields(blueprint: Record<string, unknown>): void {
  for (const key of REQUIRED_TEXT_FIELDS) {
    if (typeof blueprint[key] === 'string' && blueprint[key].trim()) continue;
    throw new BlueprintValidationError(`${key} cannot be empty`);
  }
}

function validateVersion(value: unknown): void {
  if (typeof value === 'string' && /^\d+\.\d+(?:\.\d+)?$/.test(value)) return;
  throw new BlueprintValidationError(
    'version must use semantic versioning (for example 1.0 or 1.0.0)',
  );
}

function validateJsonSchema(
  value: unknown,
  name: string,
  compileSchema: typeof compileJsonSchema,
): void {
  try {
    compileSchema(value as string | Record<string, unknown>);
  } catch (cause) {
    throw new BlueprintValidationError(`${name} must be valid JSON Schema`, { cause });
  }
}

function validateOptionalFields(
  blueprint: Record<string, unknown>,
  compileSchema: typeof compileJsonSchema,
): void {
  if (
    blueprint.model !== undefined
    && (typeof blueprint.model !== 'string' || !blueprint.model.trim())
  ) {
    throw new BlueprintValidationError('model must be a non-empty string');
  }
  if (
    blueprint.temperature !== undefined
    && (typeof blueprint.temperature !== 'number' || !Number.isFinite(blueprint.temperature))
  ) {
    throw new BlueprintValidationError('temperature must be a finite number');
  }
  if (blueprint.localization !== undefined) {
    validateStringRecord(blueprint.localization, 'localization');
  }
  if (blueprint.input_schema !== undefined) {
    validateJsonSchema(blueprint.input_schema, 'input_schema', compileSchema);
  }
  validatePermissions(blueprint.permissions);
  validateExamples(blueprint.examples);
}

function validatePermissions(value: unknown): void {
  if (value === undefined) return;
  if (!isRecord(value)) throw new BlueprintValidationError('permissions must be an object');
  for (const [name, permission] of Object.entries(value)) {
    if (Array.isArray(permission) && permission.every(item => typeof item === 'string')) continue;
    throw new BlueprintValidationError(`permissions.${name} must be an array of strings`);
  }
}

function validateExamples(value: unknown): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) throw new BlueprintValidationError('examples must be an array');
  for (const [index, example] of value.entries()) {
    if (isRecord(example) && isRecord(example.input) && isRecord(example.output)) continue;
    throw new BlueprintValidationError(
      `example at index ${index} requires input and output objects`,
    );
  }
}

function validateStringRecord(value: unknown, name: string): void {
  if (!isRecord(value)) throw new BlueprintValidationError(`${name} must be an object`);
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') continue;
    throw new BlueprintValidationError(`${name}.${key} must be a string`);
  }
}

function warnForIncompleteRecommendedGherkin(
  prompt: string,
  warn: (message: string) => void,
): void {
  const hasHeader = /(?:^|\n)\s*(?:Feature|Scenario)\s*:/u.test(prompt);
  if (!hasHeader) return;
  const complete = [
    /(?:^|\n)\s*Feature\s*:\s*\S/u,
    /(?:^|\n)\s*Scenario\s*:\s*\S/u,
    /(?:^|\n)\s*Given\s+\S/u,
    /(?:^|\n)\s*When\s+\S/u,
    /(?:^|\n)\s*Then\s+\S/u,
  ].every(pattern => pattern.test(prompt));
  if (complete) return;
  warn(
    'Prompt does not follow the recommended Feature/Scenario/Given/When/Then form; '
    + 'free-form prompts remain valid',
  );
}
