/**
 * Activates the APISIX ai-rate-limiting contribution.
 */

import {
  createApisixContributionActivator,
  createEnvironmentApisixPluginContribution,
} from '../../../apisix.js';

/** Declares optional APISIX ai-rate-limiting configuration. */
export const aiRateLimitingContribution = createEnvironmentApisixPluginContribution(
  'ai-rate-limiting',
  'PIXIECORE_APISIX_AI_RATE_LIMITING_CONFIG',
);

/** Creates a fresh activator for the contribution. */
export const createCorePluginActivator = createApisixContributionActivator(
  aiRateLimitingContribution,
);
