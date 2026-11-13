#!/bin/bash
set -euo pipefail
umask 077
# The lock is held for the lifetime of this supervisor. Never delete it on restart.
exec 9>/state/process.lock
flock -n 9 || { echo "Demo state is already in use." >&2; exit 1; }
if [ ! -f /state/initialized ]; then
  if [ -e /state/site.sqlite ]; then
    echo "Incomplete initialization; preserve and inspect the state before recovery." >&2
    exit 1
  fi
  php -r '$p = trim(file_get_contents("/run/secrets/demo_password")); if (strlen($p) < 20 || strlen($p) > 200) exit(1);' || { echo "Password file must contain 20-200 bytes." >&2; exit 1; }
  mkdir -p /state/files /state/private /state/config
  php -r 'file_put_contents("/state/hash-salt", bin2hex(random_bytes(32)));'
  if ! vendor/bin/drush site:install minimal --yes --quiet \
      --db-url=sqlite://localhost/state/site.sqlite \
      --site-name='PixieCore Blueprint demo' --account-name=site-admin \
      --account-pass="$(php -r 'echo bin2hex(random_bytes(32));')" \
      > /tmp/site-install.log 2>&1; then
    echo "Site initialization failed. Inspect private /tmp/site-install.log before removing this container." >&2
    exit 1
  fi
  rm /tmp/site-install.log
  vendor/bin/drush pm:enable pixiecore_specification --yes --quiet
  vendor/bin/drush php:script /demo/bootstrap.php --quiet
  printf '1\n' > /state/initialized
fi
node /runtime/examples/integrations/drupal/executable-specification/runtime/mock-server.js &
runtime_pid=$!
php-fpm --nodaemonize &
php_pid=$!
nginx -e /dev/stderr -g 'daemon off;' &
web_pid=$!
stop_children() {
  kill -TERM "$runtime_pid" "$php_pid" "$web_pid" 2>/dev/null || true
  wait "$runtime_pid" "$php_pid" "$web_pid" 2>/dev/null || true
}
trap stop_children EXIT
trap 'exit 0' TERM INT
set +e
wait -n "$runtime_pid" "$php_pid" "$web_pid"
status=$?
# An unexpected clean child exit also makes the container unhealthy.
[ "$status" -ne 0 ] || status=1
exit "$status"
