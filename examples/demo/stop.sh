#!/bin/sh
# Gracefully stop only the two selected demo services from inside their namespaces.
set -eu
if [ "$#" -eq 0 ]; then
  echo 'Usage: sh examples/demo/stop.sh docker compose -f examples/demo/compose.yaml' >&2
  exit 1
fi
web=$("$@" ps -aq web)
demo=$("$@" ps -aq demo)
project=
for service in web demo; do
  case "$service" in web) container=$web ;; demo) container=$demo ;; esac
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
for service in web demo; do
  case "$service" in web) container=$web; signal=QUIT ;; demo) container=$demo; signal=TERM ;; esac
  if [ "$(docker inspect --format '{{.State.Running}}' "$container")" = true ]; then
    docker exec "$container" sh -c "kill -$signal 1"
  fi
  attempts=0
  while [ "$(docker inspect --format '{{.State.Running}}' "$container")" = true ]; do
    attempts=$((attempts + 1))
    if [ "$attempts" -ge 30 ]; then
      echo "$service did not stop; inspect it before continuing. No forced kill was sent." >&2
      exit 1
    fi
    sleep 1
  done
  [ "$(docker inspect --format '{{.State.ExitCode}}' "$container")" = 0 ] || {
    echo "$service exited unsuccessfully; preserve its state and inspect it." >&2
    exit 1
  }
done
echo 'Both demo services stopped cleanly. State is retained; use down then up to recreate.'
