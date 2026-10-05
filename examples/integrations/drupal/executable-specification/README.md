# PixieCore Blueprint demo in Drupal

This is an offline Drupal/PixieCore integration rehearsal, not an LLM evaluation.
Do not deploy it to a production Drupal site. No API key or paid request is needed.

## 1. Build and start the fixture runtime

From the PixieCore checkout, with Node.js meeting the package engine requirement:

```bash
npm ci
npm run build
node --import tsx examples/integrations/drupal/executable-specification/runtime/mock-server.ts
```

The server binds 127.0.0.1:3087 only and prints its startup ID and PID. It creates
one PromptRuntime, injects a fixture provider, disables external plugin/MCP/JIT
discovery and retries, and does not load .env. Leave this process running through
both edits. A different free port can be selected with PIXIECORE_SPEC_MOCK_PORT.

The [two fixtures](fixtures/customer-discount.json) are explicit acceptance
fixtures, not a rule interpreter. Unknown rendered instructions are rejected.
Each fixture accepts its LF and native HTML-form CRLF encodings. Neither the
runtime nor the fixture provider rewrites the delivered instruction. Drupal
compares newline-equivalent textarea display values for the dirty check only;
execution still sends the exact saved Blueprint, including after Reset.

## 2. Prepare an isolated Drupal 11 SQLite site

PHP must meet Drupal 11's requirements, with PDO SQLite, Composer, and Drush.
The following creates a separate disposable site, not a change to an existing
deployment. Run the first line from the PixieCore repository root:

```bash
PIXIECORE_ROOT="$PWD"
DEMO_ROOT="$(mktemp -d)"
composer create-project drupal/recommended-project:^11 "$DEMO_ROOT/site"
cd "$DEMO_ROOT/site"
composer require --dev drush/drush:^13 drupal/core-dev drupal/coder -W
composer require drupal/codemirror_editor:^2.0
## Pin and self-host the editor library instead of using the module's old CDN default.
npm pack --ignore-scripts --cache "$DEMO_ROOT/npm-cache" codemirror@5.65.21 --pack-destination "$DEMO_ROOT"
mkdir -p web/libraries/codemirror
tar -xzf "$DEMO_ROOT/codemirror-5.65.21.tgz" --strip-components=1 -C web/libraries/codemirror package/lib package/addon package/mode package/theme
mkdir -p web/modules/custom
cp -R "$PIXIECORE_ROOT/examples/integrations/drupal/pixiecore_integration" web/modules/custom/
cp -R "$PIXIECORE_ROOT/examples/integrations/drupal/pixiecore_specification" web/modules/custom/
vendor/bin/drush site:install minimal --db-url="sqlite://localhost/$DEMO_ROOT/site.sqlite" --site-name='PixieCore Blueprint demo'
vendor/bin/drush en pixiecore_specification -y
vendor/bin/drush config:set codemirror_editor.settings cdn 0 -y
vendor/bin/drush config:set codemirror_editor.settings minified 0 -y
vendor/bin/drush config:set codemirror_editor.settings theme dracula -y
vendor/bin/drush cr
```

Use an isolated local test account. Do not reuse production credentials. In
web/sites/default/settings.php, add this trusted local-only configuration:

```php
$settings['trusted_host_patterns'] = ['^127\\.0\\.0\\.1$', '^localhost$'];
$settings['pixiecore_specification'] = [
  'mode' => 'mock',
  'endpoint' => 'http://127.0.0.1:3087',
  'token' => '',
];
```

The [settings example](../pixiecore_specification/config/settings.example.php)
contains the same offline connection. No provider key belongs in Drupal config.

Start the local Drupal web server in a separate terminal:

```bash
cd "$DEMO_ROOT/site/web"
php -S 127.0.0.1:8087 -t . .ht.router.php
```

Log in at http://127.0.0.1:8087/user/login. Grant a dedicated demo user the
restricted `use pixiecore specification demo` permission, or use the isolated
site's administrator. Open `/admin/config/pixiecore/specification`.

## 3. Rehearse the specification change

1. Inspect the complete initial Blueprint and Gold/1200 input. Save revision 1.
2. Execute. In MOCK mode, the fixture runtime returns discount 0.20 and final_price
   960. Inspect the revision/hash and exact Blueprint sent to PixieCore.
3. Change `strictly greater than 1000` to `strictly greater than 2000`. Execute is disabled until Save.
4. Save, then Execute. The new revision returns 0 and 1200. The old result is
   labeled as belonging to an earlier revision until the next execution finishes.
5. Reload. The saved Blueprint and execution record remain in SQLite.
6. Reset to the initial Blueprint. This appends another saved revision, retaining
   previous history. Execute again to return to the 20% fixture.

Do not modify application/runtime code, build, deploy, or restart either server
between steps. Keep the mock server startup ID/PID and the application commit in
the verification record. This proves delivery/UI integration, not model accuracy.

Adding arbitrary natural-language rules is deliberately unsupported by the mock
server. Before implementing or evaluating annual spending/region/exception rules,
define their input fields, precedence, and expected outcomes with the owner.

## 4. Run owned Drupal tests

Keep both local servers running. From the Drupal site root:

```bash
mkdir -p web/sites/simpletest/browser_output
SIMPLETEST_BASE_URL=http://127.0.0.1:8087 \
SIMPLETEST_DB="sqlite://localhost/$DEMO_ROOT/test.sqlite" \
BROWSERTEST_OUTPUT_DIRECTORY="$DEMO_ROOT/site/web/sites/simpletest/browser_output" \
PIXIECORE_SPEC_TEST_ENDPOINT=http://127.0.0.1:3087 \
vendor/bin/phpunit -c web/core/phpunit.xml.dist \
  web/modules/custom/pixiecore_specification/tests/src \
  web/modules/custom/pixiecore_integration/tests/src
vendor/bin/phpcs --standard=Drupal,DrupalPractice --extensions=php,install \
  web/modules/custom/pixiecore_specification web/modules/custom/pixiecore_integration
vendor/bin/phpstan analyse --level=5 \
  web/modules/custom/pixiecore_specification/src web/modules/custom/pixiecore_integration/src
```

Without PIXIECORE_SPEC_TEST_ENDPOINT, only the HTTP-backed functional case is
skipped; contract, SQLite, permissions, and CSRF tests can still run. A full
verification must run that case rather than claim a skipped test passed.

From PixieCore, run its typecheck, normal offline suite, and package/doc checks.
Also type-check the Drupal browser behavior using its narrow Drupal/once ports:

```bash
node_modules/.bin/tsc -p examples/integrations/drupal/pixiecore_specification/config/tsconfig.browser.json
```

The PHP suite is separate from npm test and requires the Drupal development
environment. There is no automatic Composer installation or paid API call in npm
test. Use fixed owner-supplied acceptance cases here; ancillary generated test
data should follow the repository's seed/reproduction policy.

Also check the rendered desktop and narrow layouts, keyboard focus, dirty state,
and escaped instruction/result text. Do not publish test-site login links,
credentials, settings.php, or the SQLite database as evidence. Stop only the demo
processes when finished; removing an isolated site also removes its local history.
