/**
 * Implements permission guard behavior for the permissions plugin.
 */

import {
  RolePermissionError,
  ScopePermissionError,
  UserPermissionError,
} from '../../../core/contracts/errors/index.js';
import type { DecoratorContext, OutputDecorator } from '../../../core/contracts/types/index.js';

/**
 * Enforces permission policy at its execution boundary.
 */
export class PermissionGuard implements OutputDecorator {
  readonly priority = 20;
  readonly stage = 'before' as const;

  /**
   * Validates the requested operation and rejects unsupported state.
   */
  validate(context: DecoratorContext): DecoratorContext {
    const permissions = context.blueprint.permissions;
    if (!permissions) return context;

    const role = stringValue(context.inputs.user_role);
    const user = stringValue(context.inputs.user_id);
    const scopes = stringSet(context.inputs.user_scopes);

    if (role && permissions.deny_roles?.includes(role)) {
      throw new RolePermissionError(`Role is explicitly denied: ${role}`);
    }
    if (permissions.allow_roles?.length && (!role || !permissions.allow_roles.includes(role))) {
      throw new RolePermissionError(`Role is not allowed: ${role ?? '<missing>'}`);
    }
    if (user && permissions.deny_users?.includes(user)) {
      throw new UserPermissionError(`User is explicitly denied: ${user}`);
    }
    if (permissions.allow_users?.length && (!user || !permissions.allow_users.includes(user))) {
      throw new UserPermissionError(`User is not allowed: ${user ?? '<missing>'}`);
    }

    const deniedScopes = permissions.deny_scopes?.filter(scope => scopes.has(scope)) ?? [];
    if (deniedScopes.length) {
      throw new ScopePermissionError(`Scope is explicitly denied: ${deniedScopes.join(', ')}`);
    }
    const missingScopes = permissions.allow_scopes?.filter(scope => !scopes.has(scope)) ?? [];
    if (missingScopes.length) {
      throw new ScopePermissionError(`Missing required scopes: ${missingScopes.join(', ')}`);
    }
    return context;
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function stringSet(value: unknown): Set<string> {
  if (value instanceof Set) {
    return new Set([...value].filter((item): item is string => typeof item === 'string'));
  }
  if (Array.isArray(value)) {
    return new Set(value.filter((item): item is string => typeof item === 'string'));
  }
  if (typeof value === 'string') return new Set(value.split(/[\s,]+/).filter(Boolean));
  return new Set();
}
