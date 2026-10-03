# PixieCore REST API

PixieCore exposes Blueprint execution through a small HTTP API. Build and start
the packaged CLI with:

```bash
npm run build
PIXIECORE_API_PORT=8000 npm start
```

The CLI listens only on `127.0.0.1` by default. To bind externally, configure a
Bearer token at the same time:

```bash
PIXIECORE_API_HOST=0.0.0.0 \
PIXIECORE_API_TOKEN='replace-with-a-secret' \
npm start
```

Requests to `POST /execute` must then include
`Authorization: Bearer replace-with-a-secret`. API environment variables use
the `PIXIECORE_*` namespace exclusively.

## Routes

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Return `{"status":"ok"}`. |
| `POST` | `/execute` | Validate and execute a YAML Blueprint. |
| `GET` | `/openapi.json` | Return the OpenAPI 3.1 document. |
| `GET` | `/docs` | Serve Swagger UI for the OpenAPI document. |
| `GET` | `/redoc` | Serve ReDoc for the OpenAPI document. |

Every response has a UUID in the `x-request-id` header. JSON endpoints use
`application/json`. Unknown routes return a structured `not_found` error.

## Execute a Blueprint

`POST /execute` accepts this JSON shape:

```json
{
  "blueprint": "name: Greeting\nversion: '1.0'\nrole: assistant\n...",
  "inputs": {
    "name": "World"
  },
  "messages": [
    { "role": "user", "content": "Use a friendly tone" }
  ],
  "files": {
    "image_path": [
      { "filename": "chart.png", "content": "<base64>" }
    ],
    "file_path": [
      { "filename": "report.pdf", "content": "<base64>" }
    ]
  }
}
```

`blueprint` is required. `inputs` must be an object. By default, `messages`
accepts only `user` messages with string content; an embedding application can
explicitly allow additional roles with `remoteMessageRoles`. Each file
field must be an array of `{ filename, content }` objects. Documented extra
top-level, message, and file-object fields are ignored and cannot override
server-side provider configuration. The `files` object itself accepts only the
documented `file_path` and `image_path` keys.

Remote callers cannot submit `image_path` or `file_path` directly in `inputs`.
Use `files` so PixieCore can validate and own the temporary-file lifecycle.
Each upload must use canonical base64, is assigned a collision-resistant name,
written with owner-only permissions, and removed before the response is sent.
Cleanup also runs when validation or runtime execution fails.

Remote callers also cannot assert `user_role`, `user_id`, or `user_scopes` in
`inputs`. Those authorization fields are reserved for trusted server-side code.
Use `callerResolver` to derive them from authenticated request metadata. An
explicit resolver takes precedence over environment-based Bearer authentication:

```ts
const server = createApp({
  callerResolver(request) {
    const credential = request.headers.authorization;
    if (credential !== `Bearer ${process.env.PIXIECORE_API_TOKEN}`) {
      return undefined;
    }
    return {
      role: 'operator',
      userId: 'authenticated-subject',
      scopes: ['blueprint:execute'],
    };
  },
});
```

Throwing rejects the request with `401`; returning `undefined` explicitly keeps
the request anonymous. Blueprint permission rejection after successful identity
resolution returns `403`.

A successful response has this shape:

```json
{
  "status": "success",
  "data": {
    "greeting": "Hello, World!"
  },
  "metadata": {
    "provider": "openai",
    "model": "gpt-4.1-mini",
    "duration_ms": 42.7
  }
}
```

## Errors

All errors use one envelope:

```json
{
  "status": "error",
  "error": {
    "type": "input_type_error",
    "message": "Input count must be an integer"
  }
}
```

| HTTP status | Error type | Meaning |
|---|---|---|
| 400 | `validation_error` | Malformed JSON, invalid request shape, or forbidden remote path input. |
| 400 | `file_upload_error` | Invalid base64 or a decoded file over the configured limit. |
| 400 | `blueprint_validation_error` | Invalid Blueprint YAML or fields. |
| 401 | `unauthorized` | The server-side caller resolver rejected the credential. |
| 403 | permission error | The authenticated caller is not allowed by the Blueprint. |
| 422 | `input_validation_error` | Required input is missing or otherwise invalid. |
| 422 | `input_type_error` | An input has the wrong type. |
| 502 | `llm_api_error` | The configured provider failed. |
| 502 | `schema_validation_error` | The provider output failed its schema contract. |
| 504 | `max_retry_exceeded` | Output correction exhausted its retry budget. |
| 500 | `internal_error` | An unexpected server error; internal details are not returned. |

## Server configuration

| Variable | Default | Description |
|---|---:|---|
| `PIXIECORE_API_HOST` | `127.0.0.1` | CLI listen address. Non-loopback values require a token. |
| `PIXIECORE_API_PORT` | `8000` | CLI listen port. |
| `PIXIECORE_API_TOKEN` | unset | Bearer token. Required for a non-loopback CLI bind. |
| `PIXIECORE_API_CALLER_ROLE` | unset | Trusted caller role attached after valid Bearer authentication. |
| `PIXIECORE_API_CALLER_ID` | unset | Trusted caller ID attached after valid Bearer authentication. |
| `PIXIECORE_API_CALLER_SCOPES` | unset | Comma-separated trusted caller scopes. |
| `PIXIECORE_CORS_ORIGINS` | unset | Comma-separated allowed origins; unset disables CORS headers. |
| `PIXIECORE_API_MAX_FILE_SIZE` | `20971520` | Maximum decoded bytes for each uploaded file. |
| `PIXIECORE_API_MAX_REQUEST_SIZE` | derived | Aggregate encoded request-body limit. |

Caller identity variables without a token are rejected during server
configuration, and an empty token is never treated as authentication.

The aggregate limit is independent of the per-file limit and defaults high
enough for eight maximum-size base64 files plus JSON overhead. A configured
aggregate limit must still accommodate one maximum-size encoded file.

## Embedding and shutdown

The `@pixieworks/pixiecore/api` export exposes `createApp()` without starting a listener:

```ts
import { createApp } from '@pixieworks/pixiecore/api';

const server = createApp({
  corsOrigins: ['https://app.example.com'],
  maxFileSize: 20 * 1024 * 1024,
  remoteMessageRoles: ['user'],
});

server.listen(8000);

// During application shutdown:
await new Promise<void>((resolve, reject) => {
  server.close(error => error ? reject(error) : resolve());
});
await server.closeResources();
```

Closing the HTTP server triggers idempotent cleanup of its shared runtime,
provider resources, plugins, logger, and MCP children. Calling
`closeResources()` explicitly lets an embedding application await that work.
