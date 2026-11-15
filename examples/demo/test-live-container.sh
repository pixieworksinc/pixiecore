#!/bin/sh
# Isolated CI project: the existing live host has an injected fixture provider.
set -eu
: "${DEMO_PASSWORD_FILE:?Required test password file}"
trial_tmp=$(mktemp -d)
printf 'synthetic-transport-token-for-container-ci-only\n' > "$trial_tmp/token"
chmod 755 "$trial_tmp"
chmod 644 "$trial_tmp/token"
trial_source=$(pwd)
cat > "$trial_tmp/compose.yaml" <<EOF
services:
  demo:
    environment:
      DEMO_MODE: real
    volumes:
      - $trial_source/examples/demo/live-fixture.mjs:/runtime/examples/demo/runtime.mjs:ro
      - $trial_tmp/token:/run/secrets/runtime_token:ro
    restart: "no"
EOF
compose() { docker compose -p pixie-demos-live-ci -f examples/demo/compose.yaml -f "$trial_tmp/compose.yaml" "$@"; }
cleanup() { compose down --volumes; rm -rf "$trial_tmp"; }
trap cleanup EXIT
compose up --no-build -d --wait --wait-timeout 180
python3 examples/demo/smoke.py --live
app=$(compose ps -q demo)
docker exec "$app" node -e "fetch('http://198.51.100.1', {signal:AbortSignal.timeout(1500)}).then(()=>process.exit(1),()=>console.log('Live-mode CI provider egress denied'))"
sh examples/demo/stop.sh docker compose -p pixie-demos-live-ci -f examples/demo/compose.yaml -f "$trial_tmp/compose.yaml"
compose down
compose up --no-build -d --wait --wait-timeout 180
python3 examples/demo/smoke.py --live --restored
