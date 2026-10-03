/**
 * Defines validation contracts shared across PixieCore boundaries.
 */

import type { Blueprint, InputPlaceholder } from '../types/index.js';

/**
 * Configures blueprint validator behavior.
 */
export interface BlueprintValidatorOptions {
  /** Receives non-fatal compatibility and authoring warnings. */
  warn?: (message: string) => void;
}

/**
 * Defines the blueprint validator boundary implemented by adapters.
 */
export interface BlueprintValidatorPort {
  /**
   * Validates dict and rejects unsupported input.
   */
  validateDict(input: unknown): Blueprint;
  /**
   * Validates yaml and rejects unsupported input.
   */
  validateYaml(source: string): Blueprint;
  /**
   * Validates file and rejects unsupported input.
   */
  validateFile(path: string): Promise<Blueprint>;
}

/**
 * Defines the input validator boundary implemented by adapters.
 */
export interface InputValidatorPort {
  readonly placeholders: readonly InputPlaceholder[];
  /**
   * Validates the requested operation and rejects unsupported input.
   */
  validate(input: Record<string, unknown>): Record<string, unknown>;
}

/**
 * Defines the input schema validator boundary implemented by adapters.
 */
export interface InputSchemaValidatorPort {
  /**
   * Validates the requested operation and rejects unsupported input.
   */
  validate(value: Record<string, unknown>): Record<string, unknown>;
}

/**
 * Defines the output validator boundary implemented by adapters.
 */
export interface OutputValidatorPort {
  /**
   * Validates the requested operation and rejects unsupported input.
   */
  validate(value: unknown): Record<string, unknown>;
}

/** Scope-local validator factories supplied by the validation core plugin. */
export interface ValidationServicePort {
  /**
   * Creates blueprint validator after validating the supplied contract.
   */
  createBlueprintValidator(options?: BlueprintValidatorOptions): BlueprintValidatorPort;
  /**
   * Creates input validator after validating the supplied contract.
   */
  createInputValidator(
    placeholders?: Blueprint['input_placeholders'],
    strict?: boolean,
  ): InputValidatorPort;
  /**
   * Creates input schema validator after validating the supplied contract.
   */
  createInputSchemaValidator(
    schema: NonNullable<Blueprint['input_schema']>,
  ): InputSchemaValidatorPort;
  /**
   * Creates output validator after validating the supplied contract.
   */
  createOutputValidator(
    schema: string | Record<string, unknown>,
  ): OutputValidatorPort;
}
