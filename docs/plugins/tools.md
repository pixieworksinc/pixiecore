# PixieCore tools

Register an application tool before execution:

```ts
runtime.registerTool({
  name: 'lookup',
  description: 'Look up a record',
  parameters: {
    type: 'object',
    properties: { id: { type: 'string' } },
    required: ['id'],
  },
  execute: async ({ id }) => ({ id, found: true }),
});
```

A Blueprint `tools` list restricts availability by name. Without that field,
all registered application, plugin, and MCP tools are available.

## Tool choice and rounds

`toolChoice` accepts `auto`, `required`, or `none`. Set it on a runtime, through
`PROMPT_RUNTIME_TOOL_CHOICE`, or per execution. `maxToolRounds` and
`PROMPT_RUNTIME_MAX_TOOL_ROUNDS` bound continuation loops.

Calls in one response execute concurrently. Each result retains its call ID and
name. A missing or failed tool becomes a recoverable error result for that call;
it does not cancel successful siblings.

`required` means that the provider must make at least one tool call during the
whole execution. PixieCore sends `required` until the first call is observed,
then sends `auto` for continuation and output-validation retries. A failed tool
execution still satisfies the call requirement. Selecting no tools, setting
`maxToolRounds` to zero, or receiving a normal response before any required call
is a deterministic error.

Provider-returned arguments are validated against `parameters` immediately
before the handler runs. Validation never coerces values, adds defaults, removes
unknown fields, or mutates the argument object. Invalid arguments skip the
handler and become the same recoverable, call-ID-preserving error result used for
other tool failures.

## Standard and pseudo modes

Standard mode sends native assistant calls and linked tool results through the
provider adapter. Pseudo mode adds results as user messages for models that do
not reliably support native tool-result roles. Enable it with
`usePseudoToolCalling` or `PROMPT_RUNTIME_USE_PSEUDO_TOOL_CALLING=true`; a
per-execution value overrides the runtime default.

## Names and MCP

Valid provider tool names are preserved. Names containing dots or other
unsupported characters are deterministically sanitized for the provider and
converted back before local execution. Collision handling is stable.

MCP tools share the same registry and use `mcp.<server>.<tool>` names. See
[MCP](../runtime/mcp.md) for discovery, validation, recovery, and process lifecycle.
