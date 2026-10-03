export const SampleRoleRole = {
  supportedRoles: ['sample-role'],
  apply(renderedPrompt) {
    return { messages: [{ role: 'user', content: renderedPrompt }] };
  },
};
