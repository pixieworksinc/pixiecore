/**
 * Implements default agent role behavior for the roles plugin.
 */

import type { AgentRolePlugin, AgentRoleResult, Blueprint } from '../../../core/contracts/types/index.js';

/**
 * Encapsulates default agent role behavior and lifecycle.
 */
export class DefaultAgentRole implements AgentRolePlugin {
  readonly supportedRoles = ['assistant', 'default'] as const;

  /**
   * Applies according to the DefaultAgentRole contract.
   */
  apply(renderedPrompt: string, blueprint: Blueprint): AgentRoleResult {
    const schema = typeof blueprint.output_schema === 'string'
      ? JSON.parse(blueprint.output_schema)
      : blueprint.output_schema;
    return {
      messages: [
        {
          role: 'system',
          content: `Role: ${blueprint.role}\nReturn only JSON matching this schema:\n${JSON.stringify(schema)}`,
        },
        { role: 'user', content: renderedPrompt },
      ],
    };
  }
}
