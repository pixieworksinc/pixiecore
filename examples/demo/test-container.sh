#!/bin/sh
# CI uses only fresh, explicitly named disposable state. No production volume.
set -eu
: "${DEMO_PASSWORD_FILE:?Required test password file}"
export COMPOSE_PROJECT_NAME=pixie-demos-ci
compose() { docker compose -p "$COMPOSE_PROJECT_NAME" -f examples/demo/compose.yaml "$@"; }
wait_ready() {
  for attempt in $(seq 1 120); do
    if curl --fail --silent http://127.0.0.1:8088/user/login > /dev/null; then return 0; fi
    sleep 2
  done
  compose logs
  return 1
}
cleanup() { compose down --volumes; }
trap cleanup EXIT
compose up --no-build -d
wait_ready
python3 examples/demo/smoke.py
container=$(compose ps -q demo)
# The container has only an internal bridge and no provider credentials.
test "$(docker inspect --format '{{.HostConfig.ReadonlyRootfs}}' "$container")" = true
docker exec "$container" node -e "fetch('http://198.51.100.1', {signal:AbortSignal.timeout(1500)}).then(()=>process.exit(1),()=>console.log('Outbound network denied'))"
# Inspect SQLite without publishing its contents. Recreating may change session/cache rows.
before=$(compose exec -T demo vendor/bin/drush sql:query 'SELECT count(*) FROM pixiecore_spec_run;')
compose down
compose up --no-build -d
wait_ready
python3 examples/demo/smoke.py --restored
after=$(compose exec -T demo vendor/bin/drush sql:query 'SELECT count(*) FROM pixiecore_spec_run;')
test "$before" = "$after"
# A new state volume must also bootstrap without a prebuilt database.
compose down --volumes
compose up --no-build -d
wait_ready
python3 examples/demo/smoke.py
