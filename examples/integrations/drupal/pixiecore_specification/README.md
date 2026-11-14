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
The demo role is fixed to `assistant`. The offline fixture server does not
inject caller identity into the strict business input schema. Provider model
selection is owned by trusted deployment settings, not editable Blueprint YAML.

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
endpoint. MOCK requires no token. REAL requires a separate trusted `allow_live`
opt-in and a server-side transport token; setting a mode name alone cannot
activate it. No request is automatically retried by this module.

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

An optional real-provider host is included for the existing editor. Use the
[explicit two-call container trial](../../../demo/README.md#optional-two-call-live-trial).
The API key remains in a read-only server mount; the UI cannot change model,
endpoint, tools or limits. REAL results include validated usage and an estimate,
while semantic correctness remains subject to review. Do not point the module
at stock `pixiecore serve`; its response is not this demo's metadata contract.

The separate runtime billing-ledger proposal in
[Issue #6](https://github.com/pixieworksinc/pixiecore/issues/6) remains closed;
PR #7 is not reopened. Provider billing controls remain with the provider.
This trial consumes two durable call permits instead of adding billing or
replenishment machinery. Paid activation needs separate approval of the model,
calls, budget, expiry and synthetic inputs.

Annual spending, regional rules,
exception precedence, and nonmatching inputs also require an owner-defined
business contract. The initial two cases do not establish natural-language
accuracy or superiority over all rules engines.

## Public demo pages

The existing module also renders the anonymous landing page at `/demos` and the
saved six-case replay at `/pixieagent/` using Drupal render arrays, Twig, and
attached libraries. `configure-theme.php` selects Claro for both site and admin
and sets `/demos` as the front page. These routes do not execute Blueprints or
call a provider. The authenticated editor and its storage remain separate.

The canonical landing markup/styles live in `examples/demo/public/index.html`;
the replay markup, styles, data and script live in
`examples/pixieagent/demo/replay/public/`. Do not edit generated module assets or
Twig fragments. From the repository root, prepare them before installing this
module outside Docker:

```sh
php examples/demo/prepare-pages.php /path/to/drupal/web/modules/custom/pixiecore_specification
```

The destination must already contain this module's source. Omit the argument to
generate beside the repository copy before copying that module into Drupal.
Run the same command after changes to either canonical page, then rebuild
Drupal caches. Docker runs it during the site build. Generated fragments are
literal Twig verbatim blocks; a verbatim terminator in source is rejected.
Replay JavaScript is copied unchanged and attached in data-before-app order.

The container enables `$settings['pixiecore_demo_replay_asset_prefix'] = TRUE`.
With this setting, only the replay route rewrites local library URLs beneath `/pixieagent/assets/`
so an existing prefix-only proxy can serve its Drupal/Claro assets. The bundled
nginx configuration allows only CSS, JavaScript, images and fonts in public
asset roots and denies other prefixed paths. The replay response retains a CSP
that forbids connections, form submissions and framing. No live endpoint is
introduced by the replay page.

A standard Drupal installation leaves this setting disabled and serves libraries
through its normal asset URLs. Enable the prefix only with the matching bundled
nginx alias or an equivalent reviewed reverse-proxy configuration.
