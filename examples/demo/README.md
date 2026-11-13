# Rebuildable PixieCore and PixieAgent demos

An isolated application container runs the existing Drupal Blueprint editor, its loopback
PixieCore fixture runtime, and the existing six-card PixieAgent replay. It makes
no model-provider requests. It contains no API key, production database, live
trial ledger, or prebuilt maintainer runtime.

- **PixieCore:** save a Blueprint, run it through PixieCore, inspect the result.
  Only the two documented Gold/1200 pricing fixtures are supported. This is a
  real runtime with a **mock provider**, not a natural-language rule interpreter.
- **PixieAgent:** choose one of six synthetic issues and replay its saved **mock**
  decision/classification/confirmation. The original card layout is unchanged.
- The separate [restricted live example](../pixieagent/demo/README.md) is not
  activated by this deployment. Starting containers or viewing pages costs $0.

## Build and start from a clean checkout

Install Docker with Compose v2. Run from the repository root on the `0.2.x`
branch or a reviewed commit. The Dockerfile uses official Node 24 and Drupal 11
images, the repository npm lock, and the demo's Composer/editor-asset locks.
The build needs Internet access. The application has only an internal Docker
network and no external access. A small nginx gateway publishes the loopback
port and forwards only HTTP to the application; it contains no application code
or provider credentials. Keep Docker/host security updates current.

Create a private operator directory outside this checkout. The container runs as
UID 82 (`www-data`); the containing directory protects the readable secret file
on the host. Do not put secrets in shell history, Git, image layers or URLs.

```sh
install -d -m 700 "$HOME/pixie-demo-operator"
umask 077
openssl rand -hex 24 > "$HOME/pixie-demo-operator/password"
chmod 644 "$HOME/pixie-demo-operator/password"
export DEMO_PASSWORD_FILE="$HOME/pixie-demo-operator/password"
docker compose -f examples/demo/compose.yaml up --build -d
```

The first boot installs a fresh minimal SQLite site and takes up to several
minutes. It creates the `demo` user with only the Blueprint demo permission,
blocks the installer administrator, and disables self-registration and automated
cron. The password is consumed only during initial installation. Retrieve it
locally from your private file to log in; do not paste it into an Issue.

Open <http://127.0.0.1:8088/>. The landing page links to both experiences:

- `/user/login?destination=/admin/config/pixiecore/specification`: restricted editor.
- `/pixieagent/`: anonymous six-case replay.
- `/pixieagent/live/`: deliberately unavailable in this container.

Use `docker-compose` instead of `docker compose` on hosts with the standalone
Compose v2 binary. `DEMO_PORT` changes the loopback host port. Set `DEMO_HOSTS`
to a comma-separated list of exact permitted DNS hostnames (no URLs or wildcards)
before creating the container. `DEMO_USER` can change the initial user name; it
does not rename an existing database user on restart.

## Try the existing sample

1. Log in and open the editor. Save the initial Blueprint and Gold/1200 input.
2. Execute: the mock fixture returns `discount: 0.2`, `final_price: 960`.
3. Change `strictly greater than 1000` to `strictly greater than 2000`.
4. Save, then Execute: `discount: 0`, `final_price: 1200`.
5. Reload to see the saved revision and result. Reset appends a revision using
   the initial Blueprint; execute again to return to 960.
6. Open PixieAgent and try the six cards. These are saved mock outcomes, not
   newly generated model responses or the historical accepted live evaluation.

Authentication, Drupal form CSRF protection, per-user revision ownership, dirty
state and result labels are inherited from the existing modules. A shared demo
account shares its history; create separate restricted users for separate
reviewers if needed. Do not enter real customer data into this synthetic demo.

## HTTPS deployment

Build off-host when the server has limited disk/RAM. The CI workflow exports the
exact tested image for a short retention period; download its archive, checksum,
and image metadata from the successful **push** run for the reviewed commit.
Verify the checksum before `docker load`. Alternatively build directly from that
commit. Do not depend on CI artifact retention as a source backup: this directory
and the pinned checkout are the rebuild instructions.

Before importing, compare uncompressed image size plus transfer/extraction
headroom with free disk space and the host's backup reserve. Do not use Docker
prune or delete other applications to bypass the capacity gate. A compressed
image can be streamed to `docker load` without leaving an archive on the server.
After loading, set `DEMO_IMAGE` and `DEMO_WEB_IMAGE` to the verified application/gateway image
tags or IDs and use
`docker compose -f examples/demo/compose.yaml up --no-build -d`.

Keep the application port bound to loopback. Put your existing HTTPS reverse
proxy in front, forwarding the original Host and `X-Forwarded-Proto: https`.
Example Apache directives inside an already configured TLS virtual host:

```apache
ProxyPreserveHost On
RequestHeader set X-Forwarded-Proto "https"
ProxyPass / http://127.0.0.1:8088/
ProxyPassReverse / http://127.0.0.1:8088/
Header always set X-Robots-Tag "noindex, nofollow"
```

Use the host's normal certificate and HTTP-to-HTTPS redirect configuration.
Snapshot the current virtual-host configuration before switching its backend;
validate the new configuration before a graceful reload. The core demo uses
root-relative Drupal paths, so give it a dedicated hostname rather than adding
an arbitrary path prefix. The replay can also be proxied at `/pixieagent/`.
If an older live trial is already there, preserve its **more specific** route,
service and persistent ledger; do not implicitly replace `/pixieagent/live/`.

Verify the public landing, login, editor and replay, including narrow-screen and
keyboard operation. Verify HTTPS session cookies and denial of administrative
and sensitive-file paths. Keep the old backend and proxy snapshot until owner
review. Roll back by restoring only those reviewed proxy directives and reloading
Apache; stop only this new Compose project if necessary.

## Stop, recreate, back up and recover

`demo-state` holds SQLite records, Drupal files and the session hash salt. The
image contains source/dependencies only. Keep the Compose project name stable;
changing it selects a different named volume. Never share one state volume with
two containers: startup holds an exclusive process lock and refuses a second
owner. Docker health detects web failures; the supervisor stops all children if
one exits. A normal restart does not reset history or create executions.

```sh
# Retains the named volume and operator password file.
docker compose -f examples/demo/compose.yaml down
docker compose -f examples/demo/compose.yaml up --no-build -d
```

**Do not use `down --volumes` for retained data.** To back up, stop this container
first so SQLite and files are consistent. Copy `/state` from the stopped
container with `docker cp`, store it in a private directory, and record the image
ID, source commit, Compose settings and password-file location separately. Keep
the backup encrypted according to your host policy; it contains password hashes
and saved input. Restart the same service after the copy.

For restore, create a new volume/container without starting it, copy the complete
state backup to `/state`, ensure ownership `82:82` and private permissions, then
start with the matching image/configuration. Verify the last saved revision and
result before proxying traffic. Do not restore while another writer is running.
The process lock file may be copied; its kernel lock is not retained by a backup,
and startup reacquires it without deleting the file.

A fresh empty volume is also reconstructible using the source and a new operator
password. It has no historical revisions. Deleting both the volume and its backup
loses history even though the demo itself can still be rebuilt. An interrupted
first install refuses to overwrite an existing SQLite file; preserve that volume
for inspection and initialize a new one or restore a known-good backup.

## Verification

The `Reproducible demos` workflow builds this image from source and verifies
fresh installation, non-admin authentication, CSRF rejection, Save/Execute/Reset,
both existing fixtures, container replacement retaining the saved result, and a
second fresh-volume installation. Its test project is disposable and is the only
place that uses `down --volumes`. Existing PixieAgent CI still checks all 88 tests,
the six offline cases and the separate live container with mocked communication.

For the container smoke check after a local build, set `DEMO_PASSWORD_FILE` to a
**test-only** password file and run `sh examples/demo/test-container.sh`. It owns
the `pixie-demos-ci` Compose project and its disposable volumes. Do not run it
against a live demo. It probes only a documentation-reserved IP to confirm egress
failure, never a provider endpoint.

This deployment is a bounded example, not a production multi-tenant service or
an assessment of model accuracy. Refresh locked packages and base images through
reviewed changes, then repeat build/recreation checks before replacing an image.
