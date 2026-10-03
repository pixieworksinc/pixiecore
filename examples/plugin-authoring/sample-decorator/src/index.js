export const SampleDecoratorDecorator = {
  priority: 100,
  stage: 'after',
  validate(context) {
    return context;
  },
};
