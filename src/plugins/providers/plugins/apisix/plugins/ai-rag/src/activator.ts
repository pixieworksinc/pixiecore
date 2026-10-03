/**
 * Activates the APISIX ai-rag contribution.
 */

import {
  createApisixContributionActivator,
  createEnvironmentApisixPluginContribution,
} from '../../../apisix.js';

/** Declares optional APISIX ai-rag configuration. */
export const aiRagContribution = createEnvironmentApisixPluginContribution(
  'ai-rag',
  'PIXIECORE_APISIX_AI_RAG_CONFIG',
);

/** Creates a fresh activator for the contribution. */
export const createCorePluginActivator = createApisixContributionActivator(
  aiRagContribution,
);
