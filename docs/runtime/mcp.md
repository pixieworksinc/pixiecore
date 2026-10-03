# MCP

PixieCore supports both directions of the Model Context Protocol (MCP):

- As an MCP client, PixieCore imports tools from local stdio MCP servers.
- As an MCP server, PixieCore exposes Blueprint execution to MCP hosts.

## Run PixieCore as an MCP server

Build the package and start the stdio server:

```bash
npm run build
node dist/core/kernel/cli/index.js mcp serve
```

An installed package can be registered with an MCP host like this:

```json
{
  "mcpServers": {
    "pixiecore": {
      "command": "npx",
      "args": ["--package", "@pixieworks/pixiecore", "pixiecore", "mcp", "serve"],
      "cwd": "/absolute/path/to/your/project",
      "env": {
        "PROMPT_RUNTIME_PROVIDER": "openai"
      }
    }
  }
}
```

Supply the selected provider's credentials through the MCP host's supported
secret or environment mechanism; do not store API keys in the configuration.

The server exposes two tools:

- `execute` accepts `blueprint_path`, optional `inputs`, and optional execution
  settings. Relative paths resolve from the MCP server process working
  directory.
- `execute_yaml` accepts `blueprint_yaml`, optional `inputs`, and the same
  execution settings.

Execution settings use MCP-friendly snake-case names: `tool_choice`,
`max_tool_rounds`, `use_pseudo_tool_calling`, and `max_tokens`. Successful calls
return the Blueprint result as both text JSON and MCP structured content.
Invalid arguments are rejected before PixieCore invokes the runtime, and MCP
request cancellation is passed to the provider execution as an abort signal.

The library facade is available from both `@pixieworks/pixiecore` and
`@pixieworks/pixiecore/mcp-server`:

```ts
import { servePixieCoreMcpStdio } from '@pixieworks/pixiecore/mcp-server';

const handle = servePixieCoreMcpStdio({ provider: 'openai' });
// Later: await handle.close();
```

stdio reserves stdout exclusively for MCP protocol frames. The stdio facade
therefore disables PixieCore console logging for the runtime it creates. An
application that injects its own runtime or logger must also keep diagnostics
on stderr or in files.

## Import tools from MCP servers

PixieCore exposes tools from local stdio Model Context Protocol (MCP) servers.
It uses the official
[`@modelcontextprotocol/client`](https://github.com/modelcontextprotocol/typescript-sdk)
package for initialization, paginated tool discovery, tool calls, timeouts, and
transport shutdown.

## Runtime configuration

Pass an explicit config path to `PromptRuntime`:

```ts
import { PromptRuntime } from '@pixieworks/pixiecore';

const runtime = new PromptRuntime({
  provider: 'openai',
  mcpConfigPath: './mcp.json',
});

try {
  const result = await runtime.execute('./blueprint.yml', {});
  console.log(result);
} finally {
  await runtime.close();
}
```

`mcpConfigPath` accepts:

- A string path: use that file.
- `null` or omission: auto-discover a file.
- `'disabled'`: do not discover or start MCP servers.

Auto-discovery checks the first available source in this order:

1. `MCP_CONFIG_PATH`, when set. It may contain multiple platform-delimited
   paths; later files override earlier files.
2. `mcp.json` in the current working directory.
3. `mcp.json` in the installed PixieCore package root.

An explicit `mcpConfigPath` takes precedence over every auto-discovery source.
A missing auto-discovery file is a normal no-MCP condition.

The package-root source is resolved only after the explicit, environment, and
current-directory sources are absent. It validates the nearest owning
`@pixieworks/pixiecore` package; `McpManager.fromAutoDiscovery()` reports a malformed or
mismatched installation as a `ConfigurationError`. The runtime-facing lazy
loader instead warns and continues without MCP tools, preserving its recoverable
startup behavior.

## File format

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "./data"],
      "env": {
        "SERVICE_TOKEN": "${SERVICE_TOKEN}"
      },
      "timeout_seconds": 30,
      "cwd": "."
    }
  }
}
```

Each server requires:

- `command`: a non-empty executable name or path.
- `args`: an array of string arguments. Use `[]` when none are needed.

Optional fields are:

- `env`: string environment overrides. `${NAME}` references are expanded from
  the manager environment. An unset reference is preserved so configuration
  mistakes remain visible to the server.
- `timeout_seconds`: a positive number used for initialization, listing, and
  calls; the default is 30 seconds.
- `cwd`: the child working directory. Relative values resolve from the config
  file that defines the server.

Child processes inherit PixieCore's environment, with the configured `env`
values applied last. Diagnostic stderr is drained without forwarding its
contents, preventing a noisy server from blocking while avoiding accidental
credential or payload logging.

## Multiple configs

Use `McpManager.fromConfigPaths()` when an application composes configuration
explicitly:

```ts
import { McpManager } from '@pixieworks/pixiecore';

const manager = await McpManager.fromConfigPaths([
  './mcp.base.json',
  './mcp.project.json',
]);

try {
  const tools = await manager.getTools();
  console.log(tools.map(tool => tool.name));
} finally {
  await manager.close();
}
```

Files merge from left to right. A later server entry replaces an earlier entry
with the same name. `fromConfigPath()`, `fromConfigPaths()`, and
`fromAutoDiscovery()` validate configuration but do not start child processes;
the first `getTool()` or `getTools()` call performs connection and discovery.

## Tool names and failures

Discovered tools use `mcp.<server>.<tool>` names. For example, the
`filesystem` server's `read_file` tool is registered as
`mcp.filesystem.read_file`.

Strict manager factories reject invalid files with `McpConfigError`, and a
direct unknown call rejects with `McpToolError` containing `Unknown MCP tool`.
The runtime path is intentionally recoverable:

- A malformed runtime config is ignored with a sanitized warning.
- Spawn, initialization, timeout, exit, or tool-list failure skips only the
  affected server.
- An MCP result with `isError: true` and protocol-level call failures become
  ordinary failed tool results, allowing the model to continue its tool round.

`close()` is asynchronous and idempotent. It aborts pending initialization,
settles requests, and closes every child process, including processes created
by a server that failed partway through startup. `await using` is also
supported on runtimes and managers in TypeScript configurations that enable
explicit resource management.

## Current transport scope

Both PixieCore's MCP client configuration and its MCP server facade currently
use stdio. Client-side HTTP/SSE servers can be used through a stdio bridge when
appropriate. A directly hosted Streamable HTTP MCP endpoint is intentionally
deferred until its authentication, session, origin, and DNS-rebinding policy is
defined; it is not part of the PixieCore 0.1 contract.
