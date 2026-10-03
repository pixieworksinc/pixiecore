/**
 * Provides reusable instruction template primitives for PixieCore.
 */

const PLACEHOLDER_NAME_SOURCE = '[A-Za-z_][A-Za-z0-9_.-]*';
const PLACEHOLDER_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]*$/u;
const PORTABLE_PLACEHOLDER_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const PLACEHOLDER_PATTERN = new RegExp(
  `\\{\\{[ \\t]*(${PLACEHOLDER_NAME_SOURCE})[ \\t]*\\}\\}`
  + `|\\{[ \\t]*(${PLACEHOLDER_NAME_SOURCE})[ \\t]*\\}`,
  'gu',
);

/**
 * Defines the supported instruction placeholder syntax values.
 */
export type InstructionPlaceholderSyntax = 'mustache' | 'legacy-single-brace';

/**
 * Describes the instruction placeholder reference contract.
 */
export interface InstructionPlaceholderReference {
  readonly name: string;
  readonly syntax: InstructionPlaceholderSyntax;
  readonly start: number;
  readonly end: number;
  readonly source: string;
}

/**
 * Finds input references without interpreting any other instruction text.
 *
 * `{{ name }}` is the portable authoring form. Single braces remain accepted
 * as a PixieCore 0.x migration syntax. Dots and hyphens are retained as a
 * PixieCore compatibility extension; portable names use ASCII identifiers.
 */
export function findInstructionPlaceholders(
  template: string,
): readonly InstructionPlaceholderReference[] {
  const references: InstructionPlaceholderReference[] = [];
  for (const match of template.matchAll(PLACEHOLDER_PATTERN)) {
    const source = match[0];
    const name = match[1] ?? match[2];
    if (name === undefined || match.index === undefined) continue;
    references.push(Object.freeze({
      name,
      syntax: match[1] === undefined ? 'legacy-single-brace' : 'mustache',
      start: match.index,
      end: match.index + source.length,
      source,
    }));
  }
  return Object.freeze(references);
}

/**
 * Substitutes declared bindings while preserving all other instruction text.
 */
export function renderInstructionTemplate(
  template: string,
  inputs: Readonly<Record<string, unknown>>,
): string {
  const references = findInstructionPlaceholders(template);
  if (references.length === 0) return template;

  let cursor = 0;
  let output = '';
  for (const reference of references) {
    output += template.slice(cursor, reference.start);
    output += Object.hasOwn(inputs, reference.name)
      ? formatInstructionValue(inputs[reference.name])
      : reference.source;
    cursor = reference.end;
  }
  return output + template.slice(cursor);
}

/**
 * Reports whether portable instruction placeholder name.
 */
export function isPortableInstructionPlaceholderName(name: string): boolean {
  return PORTABLE_PLACEHOLDER_NAME_PATTERN.test(name);
}

/**
 * Reports whether instruction placeholder name.
 */
export function isInstructionPlaceholderName(name: string): boolean {
  return PLACEHOLDER_NAME_PATTERN.test(name);
}

function formatInstructionValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  const serialized = JSON.stringify(value);
  return serialized ?? String(value);
}
