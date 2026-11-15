#!/bin/sh
# CI-only, disposable project. The real harness receives synthetic responses.
set -eu
[ "${CI:-}" = true ] || { echo 'This fixture suite is restricted to CI.' >&2; exit 1; }
: "${DEMO_PASSWORD_FILE:?Required CI demo password file}"
agent_tmp=$(mktemp -d)
agent_source=$(pwd)
chmod 755 "$agent_tmp"
export DEMO_PORT=${DEMO_PORT:-8088}
export PIXIEAGENT_ORIGIN="http://127.0.0.1:$DEMO_PORT"
export PIXIEAGENT_LIVE_CONFIG_FILE="$agent_tmp/config.json"
export PIXIEAGENT_ACCESS_CODE_FILE="$agent_tmp/access-code"
export DEMO_API_KEY_FILE="$agent_tmp/fake-key"
export DEMO_AGENT_ACCESS_CODE_FILE="$PIXIEAGENT_ACCESS_CODE_FILE"
export DEMO_AGENT_LIVE_TEST=1
export DEMO_TEST_URL="$PIXIEAGENT_ORIGIN"
export DEMO_SCREENSHOTS_DIRECTORY="${DEMO_SCREENSHOTS_DIRECTORY:-$agent_tmp/screenshots}/agent-live"
mkdir -p "$DEMO_SCREENSHOTS_DIRECTORY"
printf 'synthetic-agent-ci-access-code-for-browser-34\n' > "$PIXIEAGENT_ACCESS_CODE_FILE"
printf 'fixture-not-a-provider-credential-ci\n' > "$DEMO_API_KEY_FILE"
printf '{"enabled":false}\n' > "$agent_tmp/disabled.json"
node --input-type=module <<'JS'
import { writeFileSync } from 'node:fs';
const config = {
  enabled: true, model: 'gpt-6-luna', maxCostUsd: 1, maxRequests: 30,
  runtimeRoot: '/runtime', stateDirectory: '/state',
  credentialFile: '/run/secrets/openai_api_key', accessCodeFile: '/run/secrets/pixieagent_access_code',
  origin: process.env.PIXIEAGENT_ORIGIN, port: 3098,
  expiresAt: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
};
writeFileSync(process.env.PIXIEAGENT_LIVE_CONFIG_FILE, JSON.stringify(config));
JS
chmod 644 "$PIXIEAGENT_LIVE_CONFIG_FILE" "$PIXIEAGENT_ACCESS_CODE_FILE" "$DEMO_API_KEY_FILE" "$agent_tmp/disabled.json"
cat > "$agent_tmp/snapshot.mjs" <<'JS'
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
const ledgerBytes = readFileSync('/state/ledger.json');
const fixtureBytes = readFileSync('/state/provider-fixture.json');
const ledger = JSON.parse(ledgerBytes);
assert.equal(ledger.requests, 18);
assert.equal(ledger.pending, 0);
assert.equal(ledger.halted, false);
assert.equal(Object.keys(ledger.cases).length, 6);
assert.ok(Object.values(ledger.cases).every(entry => entry.status === 'completed' && entry.result.requests === 3));
assert.equal(JSON.parse(fixtureBytes).calls, 18);
assert.ok(statSync('/state/process.lock').isDirectory());
assert.equal(statSync('/state').uid, 82);
assert.equal(statSync('/state/ledger.json').uid, 82);
console.log(JSON.stringify({ ledger, fixtureCalls: 18, lockRetained: true,
  ledgerSha256: createHash('sha256').update(ledgerBytes).digest('hex'),
  fixtureSha256: createHash('sha256').update(fixtureBytes).digest('hex') }));
JS
chmod 644 "$agent_tmp/snapshot.mjs"
cat > "$agent_tmp/compose.yaml" <<EOF
services:
  agent-api:
    entrypoint: ["node", "--import", "/ci/agent-fixture.mjs", "/runtime/examples/pixieagent/demo/live/start.mjs"]
    environment:
      PIXIEAGENT_CI_FIXTURE: "1"
    # Only synthetic CI input is used; retain the lock rejection for assertions.
    logging:
      driver: json-file
      options:
        max-size: "1m"
        max-file: "1"
    volumes:
      - $agent_source/examples/demo/agent-fixture.mjs:/ci/agent-fixture.mjs:ro
      - $agent_tmp/snapshot.mjs:/ci/snapshot.mjs:ro
EOF
compose() {
  docker compose -p pixie-demos-agent-ci -f examples/demo/compose.yaml -f examples/demo/compose.agent-live.yaml -f "$agent_tmp/compose.yaml" "$@"
}
cleanup() { compose down --volumes; rm -rf "$agent_tmp"; }
trap cleanup EXIT
# The default image configuration must not enable or start the Agent sidecar.
if docker compose -p pixie-demos-agent-ci -f examples/demo/compose.yaml config --services | grep -qx agent-api; then
  echo 'Default Compose unexpectedly enables the Agent.' >&2
  exit 1
fi
if docker run --rm --network none --read-only --entrypoint node \
  -e TRIAL_CONFIG=/ci/disabled.json -v "$agent_tmp/disabled.json:/ci/disabled.json:ro" \
  "${DEMO_IMAGE:-pixiecore-demos:local}" /runtime/examples/pixieagent/demo/live/start.mjs > "$agent_tmp/disabled.log" 2>&1; then
  echo 'Disabled Agent configuration unexpectedly started.' >&2
  exit 1
fi
grep -q 'Trial is not enabled' "$agent_tmp/disabled.log"
compose up --no-build -d --wait --wait-timeout 180
agent=$(compose ps -q agent-api)
app=$(compose ps -q demo)
[ -n "$agent" ] && [ -n "$app" ]
[ "$(docker inspect --format '{{.Image}}' "$agent")" = "$(docker inspect --format '{{.Image}}' "$app")" ]
[ "$(docker inspect --format '{{.HostConfig.RestartPolicy.Name}}' "$agent")" = no ]
[ "$(docker inspect --format '{{.HostConfig.Init}}' "$agent")" = true ]
[ "$(docker exec "$agent" id -u)" = 82 ]
# Compose array merging retains edge. Disconnect it explicitly before any run.
docker network disconnect pixie-demos-agent-ci_edge "$agent"
[ "$(docker inspect --format '{{len .NetworkSettings.Networks}}' "$agent")" = 1 ]
docker inspect --format '{{json .NetworkSettings.Networks}}' "$agent" | grep -q 'pixie-demos-agent-ci_offline'
[ "$(docker network inspect --format '{{.Internal}}' pixie-demos-agent-ci_offline)" = true ]
docker exec "$agent" node -e "fetch('http://198.51.100.1', {signal:AbortSignal.timeout(1500)}).then(()=>process.exit(1),()=>console.log('Agent fixture egress denied'))"
docker exec "$agent" node --input-type=module -e '
  import assert from "node:assert/strict";
  import { readFileSync, statSync } from "node:fs";
  import { createHash } from "node:crypto";
  const config = JSON.parse(readFileSync(process.env.TRIAL_CONFIG));
  assert.equal(config.runtimeRoot, "/runtime");
  assert.equal(statSync("/state").uid, 82);
  const manifest = JSON.parse(readFileSync("/runtime/bundle-manifest.json"));
  for (const [file, hash] of Object.entries(manifest.files)) {
    assert.ok(!file.startsWith("/") && !file.split("/").includes(".."));
    assert.equal(createHash("sha256").update(readFileSync("/runtime/" + file)).digest("hex"), hash);
  }
  console.log("Packaged runtime manifest verified: " + Object.keys(manifest.files).length + " files");
'
ready=false
for attempt in $(seq 1 30); do
  status=$(curl --max-time 2 --silent --output /dev/null --write-out '%{http_code}' "$DEMO_TEST_URL/pixieagent/api/status" || true)
  if [ "$status" = 401 ]; then ready=true; break; fi
  [ "$(docker inspect --format '{{.State.Running}}' "$agent")" = true ] || { echo 'Agent fixture exited.' >&2; exit 1; }
  sleep 1
done
[ "$ready" = true ] || { echo 'Agent proxy did not become ready.' >&2; exit 1; }
# The browser uses the real Drupal/live UI and real harness, with only provider
# transport substituted. No access code or provider key is embedded in the UI.
node examples/demo/browser-test.mjs
docker exec "$agent" node /ci/snapshot.mjs > "$DEMO_SCREENSHOTS_DIRECTORY/agent-state-before-stop.json"
volume=$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/state"}}{{.Name}}{{end}}{{end}}' "$agent")
[ -n "$volume" ]
sh examples/demo/stop.sh docker compose -p pixie-demos-agent-ci -f examples/demo/compose.yaml -f examples/demo/compose.agent-live.yaml -f "$agent_tmp/compose.yaml"
for service in web demo agent-api; do
  container=$(compose ps -aq "$service")
  [ "$(docker inspect --format '{{.State.Running}}' "$container")" = false ]
done
snapshot() {
  docker run --rm --network none --read-only --entrypoint node \
    -v "$volume:/state:ro" -v "$agent_tmp/snapshot.mjs:/ci/snapshot.mjs:ro" \
    "${DEMO_IMAGE:-pixiecore-demos:local}" /ci/snapshot.mjs
}
snapshot > "$DEMO_SCREENSHOTS_DIRECTORY/agent-state-after-stop.json"
cmp "$DEMO_SCREENSHOTS_DIRECTORY/agent-state-before-stop.json" "$DEMO_SCREENSHOTS_DIRECTORY/agent-state-after-stop.json"
# Recreate only this sidecar. Its retained process.lock must reject startup;
# never remove the lock, reset the ledger, or unlock completed cases in a test.
compose up --no-build --no-deps --force-recreate -d agent-api
recreated=$(compose ps -aq agent-api)
for attempt in $(seq 1 30); do
  [ "$(docker inspect --format '{{.State.Running}}' "$recreated")" = true ] || break
  sleep 1
done
[ "$(docker inspect --format '{{.State.Running}}' "$recreated")" = false ]
[ "$(docker inspect --format '{{.State.ExitCode}}' "$recreated")" != 0 ]
[ "$(docker inspect --format '{{.RestartCount}}' "$recreated")" = 0 ]
docker logs "$recreated" > "$DEMO_SCREENSHOTS_DIRECTORY/agent-restart-rejected.log" 2>&1
grep -q 'EEXIST' "$DEMO_SCREENSHOTS_DIRECTORY/agent-restart-rejected.log"
grep -q 'process.lock' "$DEMO_SCREENSHOTS_DIRECTORY/agent-restart-rejected.log"
snapshot > "$DEMO_SCREENSHOTS_DIRECTORY/agent-state-after-recreate.json"
cmp "$DEMO_SCREENSHOTS_DIRECTORY/agent-state-before-stop.json" "$DEMO_SCREENSHOTS_DIRECTORY/agent-state-after-recreate.json"
echo 'Agent CI: six browser cases, 18 fixture calls, rejected requests, clean stop, and retained-lock restart rejection passed.'
