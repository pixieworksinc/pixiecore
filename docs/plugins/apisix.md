# Apache APISIX AI Gateway

PixieCore can use Apache APISIX as an OpenAI-wire-compatible AI Gateway while
retaining the PixieCore `Provider` port. Gateway mode replaces multiple direct
network integrations with one `apisix` provider; the direct OpenAI, Anthropic,
Azure, and Gemini providers remain available when a gateway is not present or
when a provider-native feature is required.

## Plugin ownership

APISIX is a child of the provider family. Optional APISIX capabilities are
independently managed descendants of that provider plugin:

```text
pixiecore.providers
└── pixiecore.providers.apisix
    ├── pixiecore.providers.apisix.ai-proxy-multi
    ├── pixiecore.providers.apisix.ai-rate-limiting
    ├── pixiecore.providers.apisix.ai-prompt-guard
    └── pixiecore.providers.apisix.ai-rag
```

The physical tree mirrors the same ownership under
`src/plugins/providers/plugins/apisix/plugins/`. One global `PluginManager`
discovers, orders, activates, reports, and closes every level. No child creates
another manager.

## Provider route

`APISIX_GATEWAY_URL` is the exact route that accepts an OpenAI-compatible chat
request. PixieCore does not append `/v1/chat/completions` because APISIX route
paths are deployment-owned.

```bash
export PROMPT_RUNTIME_PROVIDER=apisix
export APISIX_GATEWAY_URL=https://gateway.example.com/ai/chat
export APISIX_GATEWAY_MODEL=production-route
export APISIX_GATEWAY_API_KEY=...
```

`APISIX_GATEWAY_API_KEY_HEADER` defaults to `x-api-key`.
`APISIX_GATEWAY_BEARER_TOKEN` configures an Authorization Bearer credential.
`APISIX_GATEWAY_MODELS_URL` optionally enables model discovery; without it,
`getModelList()` returns the configured model. The adapter constructs a fresh
header set from these values and never forwards application request headers.

Gateway capabilities fail closed. Set `APISIX_GATEWAY_SUPPORTS_TOOLS`,
`APISIX_GATEWAY_SUPPORTS_VISION`, or `APISIX_GATEWAY_SUPPORTS_FILES` to `true`
only when the exact configured route supports that feature. This prevents an
OpenAI-compatible URL from implicitly claiming every optional capability.

The APISIX route and selected upstream must accept the PixieCore request features
the application uses, including structured output, tools, images, or files.
The initial adapter deliberately keeps the existing OpenAI-compatible PixieCore
codec so output, tool calls, usage, cancellation, and errors retain one runtime
contract.

## Declarative APISIX child contributions

The child plugins register values at the public
`pixiecore.providers.apisix.plugin` extension point. Their APISIX configuration
is supplied as a JSON object only when the corresponding environment variable
is present:

| APISIX plugin | Configuration variable |
|---|---|
| `ai-proxy-multi` | `PIXIECORE_APISIX_AI_PROXY_MULTI_CONFIG` |
| `ai-rate-limiting` | `PIXIECORE_APISIX_AI_RATE_LIMITING_CONFIG` |
| `ai-prompt-guard` | `PIXIECORE_APISIX_AI_PROMPT_GUARD_CONFIG` |
| `ai-rag` | `PIXIECORE_APISIX_AI_RAG_CONFIG` |

Applications explicitly compile the active contributions. Compilation is pure
and performs no APISIX Admin API write:

```ts
import { PluginManager } from '@pixieworks/pixiecore';
import { compileApisixPluginConfiguration } from '@pixieworks/pixiecore/apisix';

const manager = new PluginManager();
const plugins = compileApisixPluginConfiguration(manager, {
  PIXIECORE_APISIX_AI_RATE_LIMITING_CONFIG: JSON.stringify({
    limit_strategy: 'total_tokens',
    instances: [{ name: 'production-route', limit: 100_000, time_window: 60 }],
  }),
});
```

The host owns translation of this neutral ordered output into an APISIX Route,
`PluginConfig`, ADC document, or Admin API request. Secrets should remain in
the APISIX deployment secret store rather than a rendered artifact.

APISIX prompt decorators and templates are not enabled by PixieCore. Rewriting
instruction text would conflict with PixieCore's instruction-delivery contract.
APISIX should own transport retries, health checks, routing, and rate limiting;
PixieCore should retain semantic validation and evidence-driven model fallback
so the same request is not retried independently at both layers.

See the official APISIX
[`ai-proxy-multi`](https://apisix.apache.org/docs/apisix/plugins/ai-proxy-multi/),
[external plugin](https://apisix.apache.org/docs/apisix/external-plugin/), and
[plugin development](https://apisix.apache.org/docs/apisix/plugin-develop/)
documentation for gateway-side behavior.
