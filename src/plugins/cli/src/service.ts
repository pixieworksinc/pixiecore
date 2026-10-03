/**
 * Implements service behavior for the cli plugin.
 */

import type {
  CliCommandInvocation,
  CliCommandServicePort,
  CliHostPort,
} from '../../../core/contracts/cli/index.js';
import { errorMessage } from '../../../core/component/diagnostics/index.js';
import {
  runApplicationInspect,
  runBlueprintCheck,
  runBlueprintCreate,
  runBlueprintEvaluation,
  runBlueprintPlay,
} from './blueprint/commands.js';
import {
  runApiServer,
  runBlueprintExecution,
  runMcpServer,
} from './command/runtime.js';
import { CLI_USAGE_TEXT, CliUsageError } from './command/usage.js';

/** Creates an immutable dispatcher without reading files or touching process state. */
export function createCliCommandService(): CliCommandServicePort {
  return Object.freeze({
    /** Dispatches one parsed CLI invocation and normalizes user-facing failures. */
    async run(invocation: CliCommandInvocation, host: CliHostPort): Promise<void> {
      try {
        await runInvocation(invocation, host);
      } catch (error) {
        host.writeStderr(
          error instanceof CliUsageError
            ? error.message
            : `PixieCore: ${errorMessage(error)}`,
        );
        host.setExitCode(error instanceof CliUsageError ? 2 : 1);
      }
    },
  });
}

async function runInvocation(
  invocation: CliCommandInvocation,
  host: CliHostPort,
): Promise<void> {
  switch (invocation.kind) {
    case 'usage':
      throw new CliUsageError(CLI_USAGE_TEXT);
    case 'serve':
      return runApiServer(invocation, host);
    case 'mcp-serve':
      return runMcpServer(invocation, host);
    case 'blueprint-eval':
      return runBlueprintEvaluation(invocation, host);
    case 'blueprint-play':
      return runBlueprintPlay(invocation, host);
    case 'application-inspect':
      return runApplicationInspect(invocation, host);
    case 'blueprint-create':
      return runBlueprintCreate(invocation, host);
    case 'blueprint-check':
      return runBlueprintCheck(invocation, host);
    case 'execute':
      return runBlueprintExecution(invocation, host);
  }
}
