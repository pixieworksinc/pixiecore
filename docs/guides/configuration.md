# PixieCore configuration

PixieCore reads configuration once when a `PromptRuntime` or HTTP server is
created. The same resolved environment snapshot is then shared by runtime,
provider, plugin, MCP, logging, CLI, and REST components.

## Precedence

Values are resolved in this order, from lowest to highest priority:

1. PixieCore defaults.
2. The current working directory `.env` file.
3. The PixieCore package-root `.env` file.
4. The file named by `PROMPT_RUNTIME_ENV_FILE`.
5. Real process environment variables.
6. Explicit `PromptRuntime` constructor options.
7. Blueprint `model` and `temperature` for the individual request.
8. Per-execution tool and token options where supported.

Passing `environment` to `PromptRuntime` supplies a complete snapshot and
disables `.env` discovery. PixieCore never writes loaded `.env` values into
`process.env`.

When package-level discovery is needed, PixieCore resolves the nearest
`package.json` from its own module location and requires its name to be
`@pixieworks/pixiecore`. A missing, unreadable, malformed, or mismatched owning manifest is a
`ConfigurationError`, rather than an implicit fallback to the current working
directory. This makes corrupt, vendored, or single-file-bundled installations
fail with an explicit packaging diagnostic.

## Runtime variables

| Environment variable | Default | TypeScript option | Accepted values |
|---|---:|---|---|
| `PROMPT_RUNTIME_PROVIDER` | `openai` | `provider` | Provider name |
| `PROMPT_RUNTIME_MODEL` | provider default | `model` | Model name |
| `PROMPT_RUNTIME_TEMPERATURE` | `0.7` | `temperature` | Finite number |
| `PROMPT_RUNTIME_MAX_RETRY` | `3` | `maxRetry` | Safe integer at least `0` |
| `PROMPT_RUNTIME_REQUEST_TIMEOUT` | `60` seconds | `requestTimeout` | Safe integer at least `1` |
| `PROMPT_RUNTIME_MAX_TOOL_ROUNDS` | `10` | `maxToolRounds` | Safe integer at least `0` |
| `PROMPT_RUNTIME_TOOL_CHOICE` | provider default | `toolChoice` | `auto`, `required`, or `none` |
| `PROMPT_RUNTIME_USE_PSEUDO_TOOL_CALLING` | `false` | `usePseudoToolCalling` | Boolean value listed below |
| `PROMPT_RUNTIME_STRICT_VALIDATION` | `true` | `strictValidation` | Boolean value listed below |
| `PROMPT_RUNTIME_MAX_PAYLOAD_SIZE` | `102400` bytes | `maxPayloadSize` | Safe integer at least `1` |
| `PROMPT_RUNTIME_PLUGINS_DIR` | unset | `pluginsDir` | Path or path list |
| `PIXIECORE_PLUGIN_CONFIG` | unset | `pluginConfigPath` | Path, `disabled`, or `null` option |

`toolChoice` accepts `auto`, `required`, or `none`. Boolean variables accept
`true`/`false`, `1`/`0`, `yes`/`no`, and `on`/`off`. Invalid values fail during
construction instead of being silently ignored. Numeric constructor options
use the same accepted ranges as their equivalent environment variables.

Per-call `ExecuteOptions` can override `toolChoice`, `maxToolRounds`,
`usePseudoToolCalling`, and `maxTokens`, and can supply `messages` and an
`AbortSignal`.

## Provider variables

| Provider | Required variables | Optional variables |
|---|---|---|
| OpenAI | `OPENAI_API_KEY` | `OPENAI_MODEL`, `OPENAI_BASE_URL` |
| Anthropic | `ANTHROPIC_API_KEY` | `ANTHROPIC_MODEL`, `ANTHROPIC_MAX_OUTPUT_TOKENS`, `ANTHROPIC_ENABLE_FILES_API` |
| Azure OpenAI | `AZURE_OPENAI_ENDPOINT`, deployment, and API key unless Azure AD is enabled | `AZURE_OPENAI_DEPLOYMENT_NAME` or `AZURE_OPENAI_DEPLOYMENT`, `AZURE_OPENAI_API_VERSION`, `AZURE_OPENAI_USE_AZURE_AD` |
| Azure Native | `AZURE_NATIVE_ENDPOINT` and API key unless Azure AD is enabled | `AZURE_NATIVE_DEPLOYMENT_NAME`, `AZURE_NATIVE_USE_AZURE_AD` |
| Gemini Native | `GEMINI_NATIVE_API_KEY` | `GEMINI_NATIVE_MODEL` or `GEMINI_MODEL`, `GEMINI_INLINE_FILE_SIZE_LIMIT` |
| Gemini OpenAI | `GEMINI_OPENAI_API_KEY` | `GEMINI_OPENAI_MODEL` or `GEMINI_MODEL`, `GEMINI_OPENAI_BASE_URL` |
| Apache APISIX | `APISIX_GATEWAY_URL` | `APISIX_GATEWAY_MODEL`, `APISIX_GATEWAY_MODELS_URL`, `APISIX_GATEWAY_API_KEY`, `APISIX_GATEWAY_API_KEY_HEADER`, `APISIX_GATEWAY_BEARER_TOKEN`, `APISIX_GATEWAY_SUPPORTS_TOOLS`, `APISIX_GATEWAY_SUPPORTS_VISION`, `APISIX_GATEWAY_SUPPORTS_FILES` |

Azure AD uses `DefaultAzureCredential`. Applications can inject
`azureTokenProvider` for controlled credential acquisition and testing.
Provider URLs may use HTTP or HTTPS, but embedded URL credentials are rejected.
`APISIX_GATEWAY_URL` is an exact gateway route rather than a provider base URL.
APISIX child-plugin JSON variables are documented in the
[APISIX integration guide](../plugins/apisix.md).

## Plugin activation state

`RuntimeOptions.pluginConfigPath` accepts a path, `'disabled'`, or `null`.
PixieCore resolves managed plugin state by explicit option first, then
`PIXIECORE_PLUGIN_CONFIG`, then `pixiecore.plugins.yml` in the current working
directory. Omission or `null` enables this automatic lookup. Passing
`'disabled'` bypasses managed discovery. The `plugins/` directory beside the
resolved default state location is always the first managed root; if no state
file exists, installed candidates are inventoried but remain disabled. An
explicitly configured or environment path must exist. Relative state paths
resolve from the captured working directory, while relative roots inside the
file resolve from its parent directory.

The versioned state file separates project policy from plugin distribution:

```yaml
schema: pixiecore.plugins/v1
roots:
  - ./custom/plugins
enabled:
  - acme.converter
disabled:
  - acme.classifier
```

`roots` is optional. Entries extend the canonical `./plugins` installation
slot and are deduplicated by real path. A typical project keeps third-party
plugin repositories or packages elsewhere and places directory symlinks below
`plugins/`.

Nested units use hierarchical IDs. Enabling a parent cascades to descendants
unless a child is explicitly disabled; disabling a parent blocks the whole
subtree. Contradictory explicit enablement and required dependencies into a
disabled subtree fail before module import.

Managed custom plugins are disabled by default and PixieCore never writes this
file. The existing `pluginsDir`/`PROMPT_RUNTIME_PLUGINS_DIR` path remains an
automatically enabled legacy compatibility path with its existing precedence
and ordering. See [plugins](../plugins/plugins.md) for manifest, dependency, overlap, and
status rules. A runnable project-shaped example is available at
[`examples/plugin-project/pixiecore.plugins.yml`](../../examples/plugin-project/pixiecore.plugins.yml),
with converter and classifier plugins beneath its `custom/plugins` root.

Code that constructs `PluginManager` directly may pass the same value in its
optional third `{ pluginConfigPath }` options argument. Its
`getPluginStatus()` method returns a frozen passive snapshot and performs no
discovery or module import.

## MCP, logging, and REST

`mcpConfigPath` accepts an explicit path, `null`/omitted auto-discovery, or
`disabled`. `MCP_CONFIG_PATH` is a PixieCore extension that accepts one or more
platform-delimited config paths. See [MCP](../runtime/mcp.md).

Logging variables, rotation, sanitization, and audit output are listed in
[logging and audit](../runtime/logging.md).

The CLI server uses canonical `PIXIECORE_API_HOST`, `PIXIECORE_API_PORT`,
`PIXIECORE_API_TOKEN`, `PIXIECORE_API_CALLER_ROLE`, `PIXIECORE_API_CALLER_ID`,
`PIXIECORE_API_CALLER_SCOPES`, `PIXIECORE_API_MAX_FILE_SIZE`,
`PIXIECORE_API_MAX_REQUEST_SIZE`, and `PIXIECORE_CORS_ORIGINS` variables. The
default host is `127.0.0.1`; a non-loopback bind requires a Bearer token. See
the [REST API guide](../runtime/rest-api.md).
