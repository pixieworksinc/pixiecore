/**
 * Implements activator behavior for the self evaluation plugin.
 */

import type { PluginActivatorFactory } from '../../../core/contracts/plugin/activation.js';
import { SelfEvalDecorator } from './self-eval-decorator.js';

export { SelfEvalDecorator };

export const createCorePluginActivator: PluginActivatorFactory = () => ({
  /**
   * Registers the plugin services and contributions during activation.
   */
  activate(context): void {
    const decorator = new SelfEvalDecorator();
    context.own(decorator);
    context.registerDecorator(decorator, decorator.priority);
  },
});
