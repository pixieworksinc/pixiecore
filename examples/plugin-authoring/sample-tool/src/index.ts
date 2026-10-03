import type { RegisteredTool } from '@pixieworks/pixiecore/plugin';

export const SampleToolTool: RegisteredTool = {
  name: 'sample_tool',
  description: 'Returns a local example result.',
  parameters: { type: 'object', properties: {} },
  execute: () => ({ ok: true }),
};
