# PixieCore providers

PixieCore ships seven provider adapters with one provider-neutral message and tool
model.

| Runtime name | Protocol | Vision | Files | Tools | Model list |
|---|---|---:|---:|---:|---:|
| `openai` | OpenAI Chat Completions | yes | PDF/file ID | yes | API |
| `anthropic` | Anthropic Messages | yes | PDF/text/Files API | yes | API with fallback |
| `azure_openai` | Azure OpenAI deployments | yes | PDF base64 | yes | deployment fallback |
| `azure_native` | Azure OpenAI-compatible `/v1` | yes | PDF base64 | yes | API with fallback |
| `gemini_native` | Gemini GenerateContent | yes | inline/Files API | yes | API with fallback |
| `gemini_openai` | Gemini OpenAI compatibility | yes | PDF/file ID | yes | API |
| `apisix` | APISIX OpenAI-compatible route | route-dependent | route-dependent | route-dependent | optional route |

## Built-in family inventory

The public provider names and `createProvider()` behavior remain stable, while
the built-in catalog owns them through four nested family plugins. The parent
`pixiecore.providers` plugin owns only shared HTTP/OpenAI-compatible transport,
URL validation, headers, environment parsing, and runtime services.

| Plugin ID | Public name | Required environment | Optional environment and defaults |
|---|---|---|---|
| `pixiecore.providers.openai` | `openai` | `OPENAI_API_KEY` | `OPENAI_BASE_URL=https://api.openai.com/v1`; `OPENAI_MODEL=gpt-4.1-mini` |
| `pixiecore.providers.anthropic` | `anthropic` | `ANTHROPIC_API_KEY` | `ANTHROPIC_MODEL=claude-sonnet-4-0`; `ANTHROPIC_MAX_OUTPUT_TOKENS=4096`; `ANTHROPIC_ENABLE_FILES_API=true` |
| `pixiecore.providers.azure` | `azure_openai` | `AZURE_OPENAI_ENDPOINT` and either `AZURE_OPENAI_API_KEY` or Azure AD | deployment from runtime model, `AZURE_OPENAI_DEPLOYMENT_NAME`, then legacy `AZURE_OPENAI_DEPLOYMENT`; `AZURE_OPENAI_API_VERSION=2024-10-21`; `AZURE_OPENAI_USE_AZURE_AD=false` |
| `pixiecore.providers.azure` | `azure_native` | `AZURE_NATIVE_ENDPOINT` and either `AZURE_NATIVE_API_KEY` or Azure AD | `AZURE_NATIVE_DEPLOYMENT_NAME=gpt-4o-mini`; `AZURE_NATIVE_USE_AZURE_AD=false` |
| `pixiecore.providers.gemini` | `gemini_native` | `GEMINI_NATIVE_API_KEY` | `GEMINI_NATIVE_MODEL`, then `GEMINI_MODEL`, then `gemini-2.5-flash`; `GEMINI_INLINE_FILE_SIZE_LIMIT=20971520` |
| `pixiecore.providers.gemini` | `gemini_openai` | `GEMINI_OPENAI_API_KEY` | `GEMINI_OPENAI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai`; `GEMINI_OPENAI_MODEL`, then `GEMINI_MODEL`, then `gemini-2.5-flash` |
| `pixiecore.providers.apisix` | `apisix` | `APISIX_GATEWAY_URL` | `APISIX_GATEWAY_MODEL=default`; `APISIX_GATEWAY_MODELS_URL`; gateway API key or Bearer token |

Runtime `model`, `environment`, `fetch`, and request-timeout options retain
precedence over family defaults. Azure OpenAI keeps deployment-path and
`api-version` query semantics; Azure Native uses the OpenAI-compatible `/v1`
surface. The remaining OpenAI-compatible, Anthropic Messages, and Gemini
GenerateContent wire formats and file-cleanup contracts are unchanged.

```text
pixiecore.providers  (shared support service)
├── pixiecore.providers.openai       -> openai
├── pixiecore.providers.anthropic    -> anthropic
├── pixiecore.providers.azure        -> azure_openai, azure_native
├── pixiecore.providers.gemini       -> gemini_native, gemini_openai
└── pixiecore.providers.apisix       -> apisix and owned APISIX capability plugins
```

See [Apache APISIX AI Gateway](apisix.md) for its recursive plugin tree,
configuration compiler, and responsibility boundary.

Children require the parent support service and never import a sibling's
private `src/`. Optional family dependencies preserve the historical public
factory order shown in the table above without creating a cycle.

Use the variables in [configuration](../guides/configuration.md), or pass an injected
`Provider` to `PromptRuntime`.

## Structured output and tools

OpenAI-compatible adapters send JSON Schema response formats. Anthropic uses a
dedicated structured-response tool, and Gemini Native sends a cleaned copy of
the schema without unsupported `format` and `additionalProperties` keywords.
The caller's schema is never mutated.

Tool continuation messages preserve provider-native linkage:

- OpenAI-compatible adapters keep assistant `tool_calls` and `tool_call_id`.
- Anthropic keeps `tool_use` and matching `tool_result` blocks.
- Gemini Native keeps `functionCall`, `functionResponse`, IDs, and thought
  signatures when supplied.

Individual tool failures are returned to the model as error results so other
calls in the same batch can complete.

## Files and images

Supported images are GIF, JPEG, PNG, and WebP. OpenAI-compatible adapters accept
PDF content parts. Anthropic supports inline images, PDFs, text documents, its
optional Files API, and the documented text fallback for older Claude models.
Gemini Native uses inline data up to `GEMINI_INLINE_FILE_SIZE_LIMIT` and its
resumable Files API above that limit.

Provider-uploaded files are owned by the adapter instance and are deleted on
`close()`. Local PixieCore inputs are never uploaded by the REST layer itself;
the provider adapter performs the actual translation.

## Errors, timeouts, and smoke tests

HTTP, parse, abort, and timeout failures are normalized as `LLMAPIError`.
Credential-like values and line breaks in upstream error details are sanitized.
Custom endpoint URLs reject embedded usernames or passwords.

The default suite uses injected transports and makes no paid calls. To run the
opt-in live smoke test with credentials already in the environment:

```bash
PIXIECORE_RUN_LIVE_TESTS=true \
PIXIECORE_LIVE_PROVIDERS=openai,anthropic \
npm run test:smoke
```
