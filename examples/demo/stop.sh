#!/bin/sh
# Stop the selected demo services from inside their namespaces.
set -eu
if [ "$#" -eq 0 ]; then
  echo 'Usage: sh examples/demo/stop.sh docker compose -f examples/demo/compose.yaml' >&2
  exit 1
fi
web=$("$@" ps -aq web)
demo=$("$@" ps -aq demo)
agent=
services='web demo'
for configured in $("$@" config --services); do
  if [ "$configured" = agent-api ]; then
    agent=$("$@" ps -aq agent-api)
    [ -n "$agent" ] || { echo 'Missing agent-api container.' >&2; exit 1; }
    services="$services agent-api"
  fi
done
project=
for service in $services; do
  case "$service" in web) container=$web ;; demo) container=$demo ;; agent-api) container=$agent ;; esac
  [ -n "$container" ] || { echo "Missing $service container." >&2; exit 1; }
  [ "$(docker inspect --format '{{index .Config.Labels "com.docker.compose.service"}}' "$container")" = "$service" ]
  selected_project=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$container")
  [ -n "$selected_project" ] && [ "$selected_project" != '<no value>' ]
  [ -z "$project" ] || [ "$selected_project" = "$project" ]
  project=$selected_project
done
# Self-termination is an application exit, so explicitly prevent automatic restart.
# down + up recreates the containers with the policy from Compose afterwards.
docker update --restart=no "$web" "$demo" > /dev/null
[ -z "$agent" ] || docker update --restart=no "$agent" > /dev/null
for service in $services; do
  case "$service" in web) container=$web; signal=QUIT ;; demo) container=$demo; signal=TERM ;; agent-api) container=$agent; signal=TERM ;; esac
  if [ "$(docker inspect --format '{{.State.Running}}' "$container")" = true ]; then
    docker exec "$container" sh -c "kill -$signal 1"
  fi
  attempts=0
  limit=30
  # Allow the gateway to drain an in-flight bounded agent request.
  if [ "$service" = web ] && [ -n "$agent" ]; then
    limit=110
  fi
  while [ "$(docker inspect --format '{{.State.Running}}' "$container")" = true ]; do
    attempts=$((attempts + 1))
    if [ "$attempts" -ge "$limit" ]; then
      echo "$service did not stop; inspect it before continuing. No forced kill was sent." >&2
      exit 1
    fi
    sleep 1
  done
  exit_code=$(docker inspect --format '{{.State.ExitCode}}' "$container")
  # The unchanged Node trial exits on SIGTERM and retains its process lock.
  if [ "$service" = agent-api ] && [ "$exit_code" = 143 ]; then
    continue
  fi
  [ "$exit_code" = 0 ] || {
    echo "$service exited unsuccessfully; preserve its state and inspect it." >&2
    exit 1
  }
done
echo 'Demo services stopped. State is retained; inspect any agent process lock before restarting.'
