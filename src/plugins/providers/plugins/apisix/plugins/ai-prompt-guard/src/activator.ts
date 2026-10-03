/**
 * Activates the APISIX ai-prompt-guard contribution.
 */

import {
  createApisixContributionActivator,
  createEnvironmentApisixPluginContribution,
} from '../../../apisix.js';

/** Declares optional APISIX ai-prompt-guard configuration. */
export const aiPromptGuardContribution = createEnvironmentApisixPluginContribution(
  'ai-prompt-guard',
  'PIXIECORE_APISIX_AI_PROMPT_GUARD_CONFIG',
);

/** Creates a fresh activator for the contribution. */
export const createCorePluginActivator = createApisixContributionActivator(
  aiPromptGuardContribution,
);
