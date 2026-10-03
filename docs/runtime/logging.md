# PixieCore logging and audit

PixieCore attaches one trace ID to each runtime execution and HTTP request. The
same ID appears in normal logs, structured audit records, and the HTTP
`x-request-id` header, making provider, validation, and tool events correlatable
without exposing raw credentials.

## Configuration

Pass logging options to `PromptRuntime`, or configure the shared logger:

```ts
import { PromptRuntime, configureLogging } from '@pixieworks/pixiecore';

configureLogging({
  logLevel: 'INFO',
  logToFile: true,
  logDir: './logs',
  logFullPayloads: false,
});

await using runtime = new PromptRuntime({
  logToFile: true,
  logDir: './logs',
  sanitizeCredentials: true,
});
```

| Variable | Default | Description |
|---|---:|---|
| `PIXIECORE_LOG_LEVEL` | `INFO` | `DEBUG`, `INFO`, `WARNING`, `ERROR`, or `CRITICAL`. |
| `PIXIECORE_LOG_TO_FILE` | `false` | Enable normal and audit files. |
| `PIXIECORE_LOG_DIR` | `./logs` | Base directory for relative log names. |
| `PIXIECORE_LOG_FILE` | `pixiecore.log` | Normal rotating text log. |
| `PIXIECORE_LOG_MAX_BYTES` | `10485760` | Rotation threshold for the text log. |
| `PIXIECORE_LOG_BACKUP_COUNT` | `5` | Number of text-log backups. |
| `PIXIECORE_AUDIT_FILE` | `pixiecore_audit.jsonl` | Structured JSON Lines audit log. |
| `PIXIECORE_AUDIT_MAX_BYTES` | `52428800` | Rotation threshold for the audit log. |
| `PIXIECORE_AUDIT_BACKUP_COUNT` | `10` | Number of audit-log backups. |
| `PIXIECORE_SANITIZE_CREDENTIALS` | `true` | Redact credential-looking fields and values. |
| `PIXIECORE_SENSITIVE_FIELDS` | unset | Comma-separated additional sensitive field names. |
| `PIXIECORE_CUSTOM_VALUE_PATTERNS` | unset | Comma-separated regular expressions to redact. |
| `PIXIECORE_LOG_FULL_PAYLOADS` | `false` | Log sanitized payload content instead of summaries. |
| `PIXIECORE_MAX_PAYLOAD_SIZE` | `102400` | Maximum serialized payload bytes before truncation. |

The earlier `PROMPT_RUNTIME_*` logging names remain accepted as lower-precedence
aliases. New configuration should use the `PIXIECORE_*` names above.

File permissions are owner-only when PixieCore creates or appends a log. On
rotation, suffix `.1` is the newest backup.

## Trace context

`PromptRuntime` generates a UUID when execution starts outside an existing
trace. Async-local context isolates concurrent executions:

```ts
import { generateTraceId, getTraceId, runWithTraceId } from '@pixieworks/pixiecore';

const traceId = generateTraceId();
const result = await runWithTraceId(traceId, async () => {
  console.log(getTraceId()); // the same UUID
  return runtime.executeYaml(blueprint, inputs);
});
```

`setTraceId()` is available for integration boundaries. Prefer
`runWithTraceId()` for scoped concurrent work. Outside a trace,
`getTraceId()` returns `no-trace`.

## Credential safety and payload limits

Sanitization recursively clones payloads; it never mutates the caller's object.
Built-in sensitive keys include API keys, authorization headers, tokens,
passwords, client secrets, private keys, and credentials. Bearer tokens and
common provider key forms are also redacted inside messages. Additional field
names and value patterns can be configured per logger.

Binary buffers are represented only by their byte count. Full execution,
provider, and tool payloads are disabled by default; audit events store a type
and size summary instead. When full payload logging is enabled, sanitization
runs before size enforcement. Oversized values become:

```json
{
  "_truncated": true,
  "_original_size": 152341,
  "_content": "<bounded preview>[TRUNCATED]"
}
```

Disabling `sanitizeCredentials` can expose secrets and should be limited to
controlled debugging environments.

## Audit events

The JSONL audit stream records these stable `step` values:

| Step | Events |
|---|---|
| `execution_start` | `started` |
| `llm_call` | `request`, `response` |
| `validation` | `passed`, `failed` |
| `tool_execution` | `completed`, `failed` |
| `execution_retry` | `scheduled` |
| `execution_complete` | `success`, `failed` |

Each line also includes an ISO timestamp, level, logger name, message,
`trace_id`, and `kind: "audit"`. The HTTP layer uses the independently
identifiable `pixiecore.api` logger; its audit child is `pixiecore.api.audit`.
The retry event carries its owner, reason code, and completed attempt number;
[`@pixieworks/pixiecore/telemetry`](telemetry.md) consumes it without retaining payloads.

For tests or embedding, subscribe without writing files:

```ts
import { LoggingConfig, PixieCoreLogger, captureLogs } from '@pixieworks/pixiecore';

const logger = new PixieCoreLogger(
  new LoggingConfig({ logToConsole: false }).validate(),
);
using captured = captureLogs(logger);

// captured.records contains records emitted after subscription.
```
