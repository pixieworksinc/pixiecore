import type { AgentRolePlugin } from '@pixieworks/pixiecore/plugin';
import { CONVERTER_SYSTEM_PROMPT } from './src/prompts.js';

export const ConverterRole: AgentRolePlugin = {
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
