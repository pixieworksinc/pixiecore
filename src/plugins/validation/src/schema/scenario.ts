/**
 * Validates structured Scenario prompts and serializes their instructions for
 * LLM execution without interpreting business decisions or arithmetic.
 */

import YAML from 'yaml';
import { BlueprintValidationError } from '../../../../core/contracts/errors/index.js';
import { isRecord } from './shared.js';

/**
 * Preserves text prompts and renders ordered Role instructions as YAML text.
 */
export function normalizePrompt(value: unknown): string {
  if (typeof value === 'string') {
    assertText(value, 'prompt');
    return value;
  }
  if (!isRecord(value)) invalid('prompt', 'must be text or a Scenario object');
  assertKeys(value, ['agent_role', 'Scenario'], 'prompt');
  if (value.agent_role !== undefined) assertText(value.agent_role, 'prompt.agent_role');
  if (!Array.isArray(value.Scenario) || value.Scenario.length === 0) {
    invalid('prompt.Scenario', 'must be a non-empty array');
  }
  for (const [index, step] of value.Scenario.entries()) {
    const path = `prompt.Scenario[${index}]`;
    if (!isRecord(step)) invalid(path, 'must be an object');
    assertKeys(step, ['Role', 'Instruction'], path);
    assertText(step.Role, `${path}.Role`);
    const instruction = step.Instruction;
    if (!isRecord(instruction)) invalid(`${path}.Instruction`, 'must be an object');
    assertKeys(instruction, ['Given', 'When', 'Then', 'And'], `${path}.Instruction`);
    for (const keyword of ['Given', 'When', 'Then']) {
      assertText(instruction[keyword], `${path}.Instruction.${keyword}`);
    }
    const and = instruction.And;
    if (and !== undefined) {
      if (Array.isArray(and)) {
        if (and.length === 0) invalid(`${path}.Instruction.And`, 'must not be empty');
        for (const item of and) assertText(item, `${path}.Instruction.And`);
      } else {
        assertText(and, `${path}.Instruction.And`);
      }
    }
  }
  // Serialization preserves array order. The LLM executes all Role instructions.
  return YAML.stringify(value, { lineWidth: 0 });
}

function assertText(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) invalid(path, 'cannot be empty');
}

function assertKeys(value: Record<string, unknown>, allowed: string[], path: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) invalid(`${path}.${key}`, 'is not a supported Scenario field');
  }
}

function invalid(path: string, message: string): never {
  throw new BlueprintValidationError(`${path} ${message}`);
}
