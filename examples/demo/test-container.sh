#!/bin/sh
# CI uses only fresh, explicitly named disposable state. No production volume.
set -eu
: "${DEMO_PASSWORD_FILE:?Required test password file}"
export COMPOSE_PROJECT_NAME=pixie-demos-ci
compose() { docker compose -p "$COMPOSE_PROJECT_NAME" -f examples/demo/compose.yaml "$@"; }
wait_ready() {
  for attempt in $(seq 1 30); do
    if curl --max-time 2 --fail --silent http://127.0.0.1:8088/user/login > /dev/null; then return 0; fi
    container=$(compose ps -aq demo)
    if [ -n "$container" ] && [ "$(docker inspect --format '{{.RestartCount}}' "$container")" -gt 0 ]; then
      compose logs
      return 1
    fi
    sleep 2
  done
  compose logs
  return 1
}
cleanup() { compose down --volumes; }
trap cleanup EXIT
compose up --no-build -d --wait --wait-timeout 180
wait_ready
python3 examples/demo/smoke.py
container=$(compose ps -q demo)
# The container has only an internal bridge and no provider credentials.
test "$(docker inspect --format '{{.HostConfig.ReadonlyRootfs}}' "$container")" = true
docker exec "$container" node -e "fetch('http://198.51.100.1', {signal:AbortSignal.timeout(1500)}).then(()=>process.exit(1),()=>console.log('Outbound network denied'))"
volume=$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/state"}}{{.Name}}{{end}}{{end}}' "$container")
if docker run --rm --network none --read-only -v "$volume:/state" pixiecore-demos:local > /tmp/duplicate-owner.log 2>&1; then
  echo "Duplicate state owner was not rejected." >&2
  exit 1
fi
grep -q 'Demo state is already in use.' /tmp/duplicate-owner.log
if [ -n "${DEMO_SCREENSHOTS_DIRECTORY:-}" ]; then
  mkdir -p "$DEMO_SCREENSHOTS_DIRECTORY"
  google-chrome --headless --no-sandbox --disable-dev-shm-usage --disable-background-networking --timeout=3000 --window-size=1280,960 --screenshot="$DEMO_SCREENSHOTS_DIRECTORY/landing.png" http://127.0.0.1:8088/ > /tmp/demo-browser.log 2>&1
  google-chrome --headless --no-sandbox --disable-dev-shm-usage --disable-background-networking --timeout=3000 --window-size=1280,960 --screenshot="$DEMO_SCREENSHOTS_DIRECTORY/replay.png" http://127.0.0.1:8088/pixieagent/ >> /tmp/demo-browser.log 2>&1
  google-chrome --headless --no-sandbox --disable-dev-shm-usage --disable-background-networking --timeout=3000 --window-size=390,844 --screenshot="$DEMO_SCREENSHOTS_DIRECTORY/landing-mobile.png" http://127.0.0.1:8088/ >> /tmp/demo-browser.log 2>&1
  google-chrome --headless --no-sandbox --disable-dev-shm-usage --disable-background-networking --timeout=3000 --window-size=390,844 --screenshot="$DEMO_SCREENSHOTS_DIRECTORY/replay-mobile.png" http://127.0.0.1:8088/pixieagent/ >> /tmp/demo-browser.log 2>&1
fi
# Inspect SQLite without publishing its contents. Recreating may change session/cache rows.
before=$(compose exec -T demo php -r '$db = new PDO("sqlite:/state/site.sqlite"); echo $db->query("SELECT count(*) FROM pixiecore_spec_run")->fetchColumn();' )
compose stop --timeout 10
app_exit=$(docker inspect --format '{{.State.ExitCode}}' "$container")
if [ "$app_exit" != 0 ]; then
  echo "Application did not stop cleanly: exit $app_exit" >&2
  compose logs
  exit 1
fi
compose down
compose up --no-build -d --wait --wait-timeout 180
wait_ready
python3 examples/demo/smoke.py --restored
after=$(compose exec -T demo php -r '$db = new PDO("sqlite:/state/site.sqlite"); echo $db->query("SELECT count(*) FROM pixiecore_spec_run")->fetchColumn();' )
test "$before" = "$after"
# The in-container shutdown path also retains data and exits without forced kill.
sh examples/demo/stop.sh docker compose -p "$COMPOSE_PROJECT_NAME" -f examples/demo/compose.yaml
compose down
compose up --no-build -d --wait --wait-timeout 180
wait_ready
python3 examples/demo/smoke.py --restored
test "$(docker inspect --format '{{.HostConfig.RestartPolicy.Name}}' "$(compose ps -q demo)")" = unless-stopped
# A new state volume must also bootstrap without a prebuilt database.
compose down --volumes
compose up --no-build -d --wait --wait-timeout 180
wait_ready
python3 examples/demo/smoke.py
