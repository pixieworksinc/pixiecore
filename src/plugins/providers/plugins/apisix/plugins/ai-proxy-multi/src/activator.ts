/**
 * Activates the APISIX ai-proxy-multi contribution.
 */

import {
  createApisixContributionActivator,
  createEnvironmentApisixPluginContribution,
} from '../../../apisix.js';

/** Declares optional APISIX ai-proxy-multi configuration. */
export const aiProxyMultiContribution = createEnvironmentApisixPluginContribution(
  'ai-proxy-multi',
  'PIXIECORE_APISIX_AI_PROXY_MULTI_CONFIG',
);

/** Creates a fresh activator for the contribution. */
export const createCorePluginActivator = createApisixContributionActivator(
  aiProxyMultiContribution,
);
