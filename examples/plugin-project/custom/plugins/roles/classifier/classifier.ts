import type { AgentRolePlugin } from '@pixieworks/pixiecore/plugin';
import { CLASSIFIER_SYSTEM_PROMPT } from './src/prompts.js';

export const ClassifierRole: AgentRolePlugin = {
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
