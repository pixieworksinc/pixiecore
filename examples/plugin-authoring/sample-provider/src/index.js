export const SampleProviderProviderFactory = {
  name: 'sample_provider',
  create(options) {
    return {
      name: 'sample_provider',
      model: options.model ?? 'sample-model',
      supportsTools: false,
      supportsMultimodal: false,
      supportsVision: () => false,
      supportsFileInput: () => false,
      getModelList: async () => ['sample-model'],
      generate: async () => ({ content: '{}' }),
    };
  },
};
