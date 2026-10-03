/**
 * Defines services contracts shared across PixieCore boundaries.
 */

import { createServiceToken } from './activation.js';
import type { ApiServicePort } from '../api/index.js';
import type { CliCommandServicePort } from '../cli/index.js';
import type { LoggingServicePort } from '../logging/index.js';
import type { JitServicePort } from '../jit/index.js';
import type { McpServicePort } from '../mcp/index.js';
import type { McpServerServicePort } from '../mcp/server.js';
import type { MultimodalServicePort } from '../multimodal/index.js';
import type { ProviderSupportServicePort } from '../provider/index.js';
import type { RecipeServicePort } from '../recipe/index.js';
import type { RuntimeServicePort } from '../runtime/index.js';
import type { ToolServicePort } from '../tools/index.js';
import type { ValidationServicePort } from '../validation/index.js';

/**
 * Defines the supported package root resolver values.
 */
export type PackageRootResolver = () => string;

export const API_SERVICE = createServiceToken<ApiServicePort>(
  'pixiecore.service.api',
);

export const CLI_COMMAND_SERVICE = createServiceToken<CliCommandServicePort>(
  'pixiecore.service.cli.commands',
);

/** Internal bootstrap-scope state used by trusted core provider activators. */
export const PLUGIN_ENVIRONMENT_SERVICE = createServiceToken<NodeJS.ProcessEnv>(
  'pixiecore.plugin.environment',
);

export const PACKAGE_ROOT_SERVICE = createServiceToken<PackageRootResolver>(
  'pixiecore.bootstrap.package-root',
);

export const RECIPE_SERVICE = createServiceToken<RecipeServicePort>(
  'pixiecore.service.recipe',
);

export const LOGGING_SERVICE = createServiceToken<LoggingServicePort>(
  'pixiecore.service.logging',
);

export const JIT_SERVICE = createServiceToken<JitServicePort>(
  'pixiecore.service.jit',
);

export const VALIDATION_SERVICE = createServiceToken<ValidationServicePort>(
  'pixiecore.service.validation',
);

export const MULTIMODAL_SERVICE = createServiceToken<MultimodalServicePort>(
  'pixiecore.service.multimodal',
);

export const PROVIDER_SUPPORT_SERVICE = createServiceToken<ProviderSupportServicePort>(
  'pixiecore.service.providers.support',
);

export const MCP_SERVICE = createServiceToken<McpServicePort>(
  'pixiecore.service.mcp',
);

export const MCP_SERVER_SERVICE = createServiceToken<McpServerServicePort>(
  'pixiecore.service.mcp-server',
);

export const RUNTIME_SERVICE = createServiceToken<RuntimeServicePort>(
  'pixiecore.service.runtime',
);

export const TOOL_SERVICE = createServiceToken<ToolServicePort>(
  'pixiecore.service.tools',
);
