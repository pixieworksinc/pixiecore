import type { OutputDecorator } from '@pixieworks/pixiecore/plugin';

export const SampleDecoratorDecorator: OutputDecorator = {
  priority: 100,
  stage: 'after',
  validate(context) {
    return context;
  },
};
