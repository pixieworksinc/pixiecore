/**
 * Implements service behavior for the validation plugin.
 */

import type { ValidationServicePort } from '../../../core/contracts/validation/index.js';
import { BlueprintValidator } from './schema/blueprint.js';
import { InputValidator } from './input/index.js';
import { InputSchemaValidator } from './input/schema.js';
import { OutputValidator } from './schema/output.js';
import {
  JsonSchemaCompiler,
  type JsonSchemaCompilerSnapshot,
} from './schema/json-schema.js';

const compilerByService = new WeakMap<ValidationServicePort, JsonSchemaCompiler>();

/** Creates immutable validator factories; validators remain fresh per request. */
export function createValidationService(): ValidationServicePort {
  const compiler = new JsonSchemaCompiler();
  const compileSchema = compiler.compile.bind(compiler);
  const service: ValidationServicePort = {
    createBlueprintValidator: options => new BlueprintValidator(options, compileSchema),
    createInputValidator: (placeholders, strict) => new InputValidator(placeholders, strict),
    createInputSchemaValidator: schema => new InputSchemaValidator(schema, compileSchema),
    createOutputValidator: schema => new OutputValidator(schema, compileSchema),
  };
  const frozen = Object.freeze(service);
  compilerByService.set(frozen, compiler);
  return frozen;
}

/** Internal value-free measurement seam for the scope-local compiler cache. */
export function validationSchemaCompilerSnapshot(
  service: ValidationServicePort,
): JsonSchemaCompilerSnapshot {
  const compiler = compilerByService.get(service);
  if (!compiler) throw new TypeError('Validation service does not own a schema compiler');
  return compiler.snapshot();
}
