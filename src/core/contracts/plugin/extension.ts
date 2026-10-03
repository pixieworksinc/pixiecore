/**
 * Defines open extension-point contributions shared across plugin boundaries.
 */

/** A typed value contributed to one namespaced plugin extension point. */
export interface PluginExtension<Value = unknown> {
  readonly point: string;
  readonly value: Value;
}
