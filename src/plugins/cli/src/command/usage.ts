/**
 * Implements usage behavior for the cli plugin.
 */

export const CLI_USAGE_TEXT = 'Usage: pixiecore serve | mcp serve | execute <blueprint.yaml> [--inputs={...}] | execute-yaml <file> [--inputs={...}] | blueprint create <directory> --operation=<operation> [--name=<name>] | blueprint validate <blueprint.yaml> | blueprint test <unit-directory> | blueprint eval <dataset.yaml> [--seed=<seed>] [--output=<result.json>] | blueprint inspect <blueprint.yaml> | blueprint play <dataset.yaml> --case=<id> [--mode=mock|real|both] | application inspect <application.graph.yaml> [--format=json|mermaid] | plugin <command> ...';

/**
 * Reports cli usage failures.
 */
export class CliUsageError extends Error {}
