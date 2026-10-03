import type { AgentRolePlugin } from '@pixieworks/pixiecore/plugin';

export const SampleRoleRole: AgentRolePlugin = {
  supportedRoles: ['sample-role'],
  apply(renderedPrompt) {
    return { messages: [{ role: 'user', content: renderedPrompt }] };
  },
};
