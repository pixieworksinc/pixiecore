// @ts-check

import { CONVERTER_SYSTEM_PROMPT } from './src/prompts.mjs';

/** @type {import('@pixieworks/pixiecore/plugin').AgentRolePlugin} */
export const ConverterRole = {
  supportedRoles: ['converter'],
  apply(renderedPrompt) {
    return {
      messages: [
        { role: 'system', content: CONVERTER_SYSTEM_PROMPT },
        { role: 'user', content: renderedPrompt },
      ],
    };
  },
};
