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
The demo role is fixed to `assistant`. The required empty `permissions: {}`
mapping lets PixieCore separate authenticated server-injected caller context
from the strict business input schema; it does not grant Blueprint privileges.
Provider model selection is owned by trusted deployment settings, not editable
Blueprint YAML.

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
validated before transport. The HTTP client does not follow redirects and has
bounded connect/request timeouts. This example accepts only a loopback HTTP
fixture endpoint without credentials. Any non-MOCK mode is disabled before
transport; no request is automatically retried by this module. A separately
reviewed real-provider integration is tracked in
[Issue #6](https://github.com/pixieworksinc/pixiecore/issues/6).

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

This repository example does not provide real-provider execution or metered
usage evidence. Do not point it at `pixiecore serve` with an OpenAI provider;
the only supported backend is the provided offline fixture server. A real
adapter must first define its response and budget contracts and prove them with
offline tests. Any later paid evaluation requires separate approval of model,
calls, USD cap, retries, and exact fixtures. Annual spending, regional rules,
exception precedence, and nonmatching inputs also require an owner-defined
business contract. The initial two cases do not establish natural-language
accuracy or superiority over all rules engines.
