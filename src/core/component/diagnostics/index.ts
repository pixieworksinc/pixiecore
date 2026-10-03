/**
 * Provides reusable diagnostics primitives for PixieCore.
 */

/**
 * Normalizes an unknown failure into a safe diagnostic message.
 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Carries diagnostic message state across a boundary.
 */
export interface DiagnosticMessageContext {
  readonly blueprint?: {
    readonly path: string;
    readonly version?: string;
  };
  readonly fields?: readonly string[];
  readonly node?: string;
  readonly replayCommand?: string;
  readonly suggestions?: readonly string[];
}

/** Formats value-free operational context for CLI and application errors. */
export function diagnosticMessage(
  message: string,
  context: DiagnosticMessageContext,
): string {
  const lines = [message];
  if (context.node?.trim()) lines.push(`Node: ${context.node}`);
  if (context.blueprint?.path.trim()) {
    lines.push(
      `Blueprint: ${context.blueprint.path}`
      + (context.blueprint.version?.trim() ? ` @ ${context.blueprint.version}` : ''),
    );
  }
  const fields = uniqueNonBlank(context.fields);
  if (fields.length > 0) lines.push(`Fields: ${fields.join(', ')}`);
  if (context.replayCommand?.trim()) lines.push(`Reproduce: ${context.replayCommand}`);
  for (const suggestion of uniqueNonBlank(context.suggestions)) {
    lines.push(`Suggestion: ${suggestion}`);
  }
  return lines.join('\n');
}

function uniqueNonBlank(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? []).map(value => value.trim()).filter(Boolean))].sort();
}

/**
 * Returns elapsed monotonic time without exposing timer internals.
 */
export function elapsedMilliseconds(started: number): number {
  return Math.round((performance.now() - started) * 10) / 10;
}
