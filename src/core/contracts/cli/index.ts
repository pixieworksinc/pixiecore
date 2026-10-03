/**
 * Defines cli contracts shared across PixieCore boundaries.
 */

import type { PixieCoreApiServer } from '../api/index.js';
import type { ApplicationGraphInspection } from '../application/index.js';
import type {
  BlueprintEvaluationResultArtifact,
  BlueprintEvaluationRunOptions,
  BlueprintPlaygroundArtifact,
  BlueprintPlaygroundRunOptions,
} from '../evaluation/index.js';

/**
 * Defines the supported cli signal values.
 */
export type CliSignal = 'SIGINT' | 'SIGTERM';
/**
 * Defines the supported cli execute command values.
 */
export type CliExecuteCommand = 'execute' | 'execute-yaml';

/** Process-facing capabilities supplied by the executable entry point. */
export interface CliHostPort {
  /**
   * Writes stdout for the owning PixieCore boundary.
   */
  writeStdout(line: string): void;
  /**
   * Writes stderr for the owning PixieCore boundary.
   */
  writeStderr(line: string): void;
  /**
   * Sets exit code for the owning PixieCore boundary.
   */
  setExitCode(code: 1 | 2): void;
  /**
   * Handles once signal for the owning PixieCore boundary.
   */
  onceSignal(signal: CliSignal, listener: () => void): void;
}

/** Runtime surface used by the execute commands. */
export interface CliRuntimePort {
  /**
   * Executes the requested operation through its public boundary.
   */
  execute(
    path: string,
    inputs?: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
  /**
   * Executes yaml through its public boundary.
   */
  executeYaml(
    yaml: string,
    inputs?: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
  /**
   * Releases resources owned by the implementation.
   */
  close(): void | Promise<void>;
}

/**
 * Defines the cli execute factories boundary implemented by adapters.
 */
export interface CliExecuteFactoriesPort {
  /**
   * Creates runtime after validating the supplied contract.
   */
  createRuntime(): CliRuntimePort;
  /**
   * Returns text file without exposing mutable internal state.
   */
  readTextFile(path: string): Promise<string>;
}

/**
 * Defines the cli serve factories boundary implemented by adapters.
 */
export interface CliServeFactoriesPort {
  /**
   * Resolves environment for the owning PixieCore boundary.
   */
  resolveEnvironment(): NodeJS.ProcessEnv;
  /**
   * Creates app after validating the supplied contract.
   */
  createApp(environment: NodeJS.ProcessEnv): PixieCoreApiServer;
}

/**
 * Defines the cli mcp server handle boundary implemented by adapters.
 */
export interface CliMcpServerHandlePort {
  /**
   * Releases resources owned by the implementation.
   */
  close(): Promise<void>;
}

/**
 * Defines the cli mcp serve factories boundary implemented by adapters.
 */
export interface CliMcpServeFactoriesPort {
  /**
   * Serves for the owning PixieCore boundary.
   */
  serve(): CliMcpServerHandlePort;
}

/**
 * Defines the cli blueprint eval factories boundary implemented by adapters.
 */
export interface CliBlueprintEvalFactoriesPort {
  /**
   * Executes evaluation through its public boundary.
   */
  runEvaluation(options: BlueprintEvaluationRunOptions): Promise<BlueprintEvaluationResultArtifact>;
  /**
   * Writes text file for the owning PixieCore boundary.
   */
  writeTextFile(path: string, contents: string): Promise<void>;
}

/**
 * Defines the cli blueprint play factories boundary implemented by adapters.
 */
export interface CliBlueprintPlayFactoriesPort {
  /**
   * Executes playground through its public boundary.
   */
  runPlayground(options: BlueprintPlaygroundRunOptions): Promise<BlueprintPlaygroundArtifact>;
}

/**
 * Describes the cli blueprint scaffold file contract.
 */
export interface CliBlueprintScaffoldFile {
  readonly relativePath: string;
  readonly contents: string;
}

/**
 * Defines the cli blueprint create factories boundary implemented by adapters.
 */
export interface CliBlueprintCreateFactoriesPort {
  /**
   * Creates scaffold after validating the supplied contract.
   */
  createScaffold(
    directory: string,
    files: readonly CliBlueprintScaffoldFile[],
  ): Promise<void>;
}

/**
 * Describes the cli blueprint inspection contract.
 */
export interface CliBlueprintInspection {
  readonly name: string;
  readonly version: string;
  readonly role: string;
  readonly input_fields: readonly string[];
  readonly has_input_schema: boolean;
  readonly tool_names: readonly string[];
}

/**
 * Describes the result of cli blueprint unit test.
 */
export interface CliBlueprintUnitTestResult {
  readonly valid: true;
  readonly unit: string;
  readonly blueprint: string;
  readonly version: string;
  readonly dataset: string;
  readonly contract_test: string;
}

/**
 * Defines the cli blueprint check factories boundary implemented by adapters.
 */
export interface CliBlueprintCheckFactoriesPort {
  /**
   * Inspects blueprint for the owning PixieCore boundary.
   */
  inspectBlueprint(path: string): Promise<CliBlueprintInspection>;
  /**
   * Tests blueprint unit for the owning PixieCore boundary.
   */
  testBlueprintUnit(directory: string): Promise<CliBlueprintUnitTestResult>;
}

/**
 * Defines the cli application inspect factories boundary implemented by adapters.
 */
export interface CliApplicationInspectFactoriesPort {
  /**
   * Inspects application for the owning PixieCore boundary.
   */
  inspectApplication(path: string): Promise<ApplicationGraphInspection>;
  /**
   * Renders mermaid for the owning PixieCore boundary.
   */
  renderMermaid(inspection: ApplicationGraphInspection): string;
}

/**
 * Describes the cli execute invocation contract.
 */
export interface CliExecuteInvocation {
  readonly kind: 'execute';
  readonly command: CliExecuteCommand;
  readonly args: readonly string[];
  readonly factories: CliExecuteFactoriesPort;
}

/**
 * Describes the cli serve invocation contract.
 */
export interface CliServeInvocation {
  readonly kind: 'serve';
  readonly args: readonly string[];
  readonly factories: CliServeFactoriesPort;
}

/**
 * Describes the cli mcp serve invocation contract.
 */
export interface CliMcpServeInvocation {
  readonly kind: 'mcp-serve';
  readonly args: readonly string[];
  readonly factories: CliMcpServeFactoriesPort;
}

/**
 * Describes the cli blueprint eval invocation contract.
 */
export interface CliBlueprintEvalInvocation {
  readonly kind: 'blueprint-eval';
  readonly args: readonly string[];
  readonly factories: CliBlueprintEvalFactoriesPort;
}

/**
 * Describes the cli blueprint play invocation contract.
 */
export interface CliBlueprintPlayInvocation {
  readonly kind: 'blueprint-play';
  readonly args: readonly string[];
  readonly factories: CliBlueprintPlayFactoriesPort;
}

/**
 * Describes the cli blueprint create invocation contract.
 */
export interface CliBlueprintCreateInvocation {
  readonly kind: 'blueprint-create';
  readonly args: readonly string[];
  readonly factories: CliBlueprintCreateFactoriesPort;
}

/**
 * Describes the cli blueprint check invocation contract.
 */
export interface CliBlueprintCheckInvocation {
  readonly kind: 'blueprint-check';
  readonly command: 'validate' | 'test' | 'inspect';
  readonly args: readonly string[];
  readonly factories: CliBlueprintCheckFactoriesPort;
}

/**
 * Describes the cli application inspect invocation contract.
 */
export interface CliApplicationInspectInvocation {
  readonly kind: 'application-inspect';
  readonly args: readonly string[];
  readonly factories: CliApplicationInspectFactoriesPort;
}

/**
 * Describes the cli usage invocation contract.
 */
export interface CliUsageInvocation {
  readonly kind: 'usage';
}

/**
 * Defines the supported cli command invocation values.
 */
export type CliCommandInvocation =
  | CliApplicationInspectInvocation
  | CliBlueprintCheckInvocation
  | CliBlueprintCreateInvocation
  | CliBlueprintEvalInvocation
  | CliBlueprintPlayInvocation
  | CliExecuteInvocation
  | CliMcpServeInvocation
  | CliServeInvocation
  | CliUsageInvocation;

/** Scope-local command dispatcher registered by the CLI core plugin. */
export interface CliCommandServicePort {
  /**
   * Executes the requested operation through its public boundary.
   */
  run(invocation: CliCommandInvocation, host: CliHostPort): Promise<void>;
}
