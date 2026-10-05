# PixieCore Blueprint demo Drupal module

Drupal owns the editor, permissions, Form API CSRF protection, owner-specific
revision storage, and execution records. A separately operated PixieCore runtime
owns Blueprint validation and execution. This demo uses Drupal 11 and its
Database API, tested with SQLite. It does not replace Drupal Core.

See the [setup and verification instructions](../executable-specification/README.md).

## What the screen does

- Left: edit the complete Blueprint YAML and synthetic JSON inputs, then Save
  and Execute. Reset creates a new revision containing the initial Blueprint;
  it does not delete history or make a provider request.
- Right: the actual runtime response and its saved revision/source hash,
  validation state, backend identity, elapsed time, and measurement availability.
- Below: inspect the complete saved Blueprint sent across the HTTP boundary.
- SQLite preserves revisions and results across page reloads and process restarts.
  Each authenticated user sees only their own records.

The [bundled Blueprint](blueprints/customer-discount/customer-discount.yaml) is
the complete editable default, not a wrapper around a separate prompt field.
Save validates the bounded demo contract and preserves the YAML document
verbatim; Execute sends that exact saved Blueprint to PixieCore. The example
declares its input and output schemas, Mustache placeholders, role, instruction,
and examples in one place. Its initial rule applies a 20% discount only to Gold
purchases strictly above 1000; the nonmatching examples explicitly produce no
discount.
The two schemas are a fixed demo contract: Save rejects additional schema
keywords instead of accepting a revision that PixieCore might reject later.

## Ownership and safety

The route is `/admin/config/pixiecore/specification` and is linked from Drupal's
Configuration page. An authenticated Drupal user needs `use pixiecore
specification demo`, a restricted permission. Neither
user IDs nor provider credentials come from editable input. Drupal's form token
guards state-changing submissions. An owner lock guards Save and Execute;
stale/dirty revisions are rejected server-side even without JavaScript.

Backend settings are supplied through settings.php, never exported configuration
or the browser. Use Drupal trusted_host_patterns and normal web-server request
limits. Editable Blueprint/input byte limits and the demo schema contract are
validated before transport.
The HTTP client does not follow redirects and has bounded connect/request
timeouts. Non-loopback endpoints require HTTPS. No request is automatically
retried by this module.
The only non-loopback HTTP exception is a real-mode endpoint explicitly
matched by `private_http_endpoint` in trusted settings. Keep that endpoint on
an isolated private network; the module cannot prove a DNS name is private.
Public IP literals are rejected even when configured as the exception.

Output is escaped text, not HTML. The module checks the fixed output shape and
arithmetic but does not manufacture results or implement the discount rule.
These checks cannot prove that an arbitrary Blueprint was understood correctly.
Transport failures are saved without raw exception bodies or credentials.

Only synthetic inputs belong in this demo. It makes no payments, sends no email,
and mutates no customer entities. Revisions and synthetic execution inputs are
retained until module uninstall drops its tables; add a reviewed retention policy
before considering real data. Reset is not an erasure operation.

## Current evidence boundary

The default mock backend supports only two exact Gold/1200 threshold fixtures. It is
always labeled MOCK, does not interpret arbitrary natural-language rules, and
rejects unsupported Blueprints. Its usage fields remain null, not zero.

The optional real-provider deployment
uses a separate authenticated, non-public PixieCore container. It accepts only
the bounded Blueprint contract, makes at most one
bounded OpenAI request per Execute, and stores observed token usage and an
estimated cost in both its durable budget ledger and Drupal's run record. A
failed or unmetered call retains its worst-case reservation. The Drupal screen
labels the mode REAL. `business_accuracy` remains `not_measured`; output shape
and arithmetic checks are not an evaluation of arbitrary Blueprints.

Unknown modes are disabled before transport. Trust the configured endpoint:
the mock label is not a network sandbox and cannot stop a misconfigured endpoint
from making a paid call. Point it only at the provided offline fixture server.

Before any further real evaluation, approve model, calls, USD cap, retries, and
exact fixtures independently of deployment.
Annual spending, regional rules, exception precedence, and nonmatching inputs
also require an owner-defined business contract. The initial two cases do not
establish natural-language accuracy or superiority over all rules engines.
