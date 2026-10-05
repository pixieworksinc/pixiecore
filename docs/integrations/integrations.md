# Integration examples

PixieCore integrates at two narrow transports:

- MCP exposes `execute` and `execute_yaml` as tools to an MCP host.
- REST accepts one inline Blueprint and business inputs from an authenticated
  application service.

The external host remains the orchestrator. It owns tool selection, workflow
state, identity, authorization, persistence, retries, notification, and final
side effects. PixieCore owns validation and execution of the selected Blueprint.

## Official MCP client

The type-checked [`mcp-client.ts`](../../examples/integrations/mcp-client.ts)
starts PixieCore's stdio server using the official MCP client already used by
the project. From a PixieCore checkout:

```bash
npm run build
node --import tsx examples/integrations/mcp-client.ts
```

The default run lists `execute` and `execute_yaml` without a model call. To
execute `examples/hello.yaml`, explicitly configure a PixieCore provider and opt
in:

```bash
PROMPT_RUNTIME_PROVIDER=openai \
OPENAI_API_KEY='from-your-secret-manager' \
PIXIECORE_EXAMPLE_EXECUTE=true \
node --import tsx examples/integrations/mcp-client.ts
```

The example closes the MCP client in `finally`, which also reaps its PixieCore
child process.

## LangChain or LangGraph host

LangChain's official JavaScript documentation loads MCP tools with
`MultiServerMCPClient` from `@langchain/mcp-adapters` and passes those tools to
an agent. PixieCore requires no LangChain-specific plugin because it already
implements the MCP server boundary.

Copy the dependency-isolated example from a PixieCore checkout into a consumer
project. Repository examples are intentionally not duplicated into the runtime
npm package:

```bash
cp examples/integrations/langchain/agent.mjs.example \
  ./pixiecore-agent.mjs
npm install langchain @langchain/mcp-adapters
LANGCHAIN_MODEL='your-provider:model' node ./pixiecore-agent.mjs
```

Review the current
[LangChain MCP documentation](https://docs.langchain.com/oss/javascript/langchain/mcp)
before selecting package versions. The example is intentionally excluded from
PixieCore's dependency graph so a framework upgrade cannot change the runtime's
public contract.

The outer agent model chooses whether to call a PixieCore tool. The PixieCore
server may then call its separately configured provider to execute the
Blueprint. Treat them as two independent model, credential, budget, retry, and
telemetry boundaries. For deterministic graphs, call the MCP tool from a fixed
workflow node instead of allowing free-form tool selection.

## Drupal host

[`pixiecore_integration`](../../examples/integrations/drupal/pixiecore_integration/)
is a module-shaped Drupal example. Copy it under `modules/custom/`, enable it,
and inject `pixiecore_integration.client` into the application service that owns
the workflow.

Operate PixieCore separately and require Bearer authentication for any
non-loopback bind:

```bash
PIXIECORE_API_HOST=0.0.0.0 \
PIXIECORE_API_TOKEN='from-your-secret-manager' \
npx --package @pixieworks/pixiecore pixiecore serve
```

The Drupal service accepts the base URL, token, inline Blueprint YAML, and
business inputs at its trusted application boundary. Store the endpoint and
token in environment-specific settings or a secret manager, not exported
configuration. The service sends neither Drupal user identity nor permission
claims in `inputs`; PixieCore derives caller context only from its server-side
Bearer configuration or `callerResolver`.

The example returns validated `data` and rejects malformed response envelopes.
Drupal code still owns form access, user/session mapping, queueing, persistence,
messaging, and any entity mutation. The included PHPUnit test proves that the
HTTP request contains only Blueprint YAML and business inputs.

The separately planned [metered Drupal demo boundary](drupal-metered-execution.md)
records the capability, usage, and budget contract required before a hosted
real-provider demo can send paid requests. The clean-install example remains
offline until that contract is implemented and tested.

## Production checklist

- Pin PixieCore, Blueprint, dataset, framework, and adapter versions.
- Keep stdio stdout protocol-only and route diagnostics to stderr or files.
- Use absolute or project-contained Blueprint paths and controlled working
  directories.
- Keep secrets out of Blueprint YAML, MCP config committed to source control,
  Drupal exported config, logs, and evaluation fixtures.
- Propagate cancellation and assign exactly one retry owner.
- Validate external tool arguments and PixieCore results before side effects.
- Close MCP clients, PixieCore runtimes, HTTP servers, and plugin resources once.
- Test the integration offline with fixture providers before enabling paid
  provider execution.
