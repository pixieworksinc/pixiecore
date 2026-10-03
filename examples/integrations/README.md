# PixieCore integration examples

These examples preserve one boundary: the external host owns orchestration,
identity, state, and side effects; PixieCore validates and executes one requested
Blueprint.

- `mcp-client.ts` uses the official MCP TypeScript client against PixieCore's
  stdio server. Listing tools is offline; execution is opt-in.
- `langchain/agent.mjs.example` is a copy-ready LangChain MCP adapter example.
  It is not part of PixieCore's dependency graph.
- `drupal/pixiecore_integration/` is a Drupal module-shaped HTTP client with a
  plugin-owned PHPUnit test.

See the [integration guide](../../docs/integrations/integrations.md) for setup and trust
boundaries.
