// @ts-check

import { CLASSIFIER_SYSTEM_PROMPT } from './src/prompts.mjs';

/** @type {import('@pixieworks/pixiecore/plugin').AgentRolePlugin} */
export const ClassifierRole = {
  supportedRoles: ['classifier'],
  apply(renderedPrompt) {
    return {
      messages: [
        { role: 'system', content: CLASSIFIER_SYSTEM_PROMPT },
        { role: 'user', content: renderedPrompt },
      ],
    };
  },
};
