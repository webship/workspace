# workspace-app

The **workspace** web dashboard — a visual UI + AI assistant for this tooling,
served at **https://workspace.ddev.site** through DDEV.

Basic Node.js (`node:http`, no framework) + [HTMX](https://htmx.org) (vendored
in `public/htmx.min.js`). All pages are server-rendered; interactions swap in
HTML fragments. No modals anywhere — destructive actions use a two-step
click-to-arm confirm.

## What it does

- **Home** (`/`): the workspace cards grid — one card per folder in
  `core/config/settings.yml`'s `workspaces:` list (read live, so adding a
  workspace there shows up without code changes), with live project counts.
- **Per-workspace pages** (`/dev`, `/test`, `/demos`, …): each workspace's own
  project list with per-project **Backup / Filemode / Remove** actions, plus a
  **Build** form listing that folder's `cmd-*-project.sh` builder scripts.
- **AI Assistant** on every page (inline on home, floating 🤖 widget on
  workspace pages): quick actions (New Drupal 11, New Varbase, Status) and a
  free-text chat backed by the local `claude` CLI in restricted, tool-free
  print mode.
- All actions run the real `cmd-*.sh` scripts (and `ddev`) against
  `~/workspace` — this is a control panel, not a mock.

## Setup

```bash
cd ~/workspace/core/workspace-app
ddev start
```

Then open https://workspace.ddev.site.

### How it runs

The Node app runs **inside** the DDEV web container as a `web_extra_daemon`,
with Docker-outside-of-Docker so it can manage sibling DDEV projects:

- `.ddev/docker-compose.dood.yaml` bind-mounts the host's
  `/var/run/docker.sock` and your `~/workspace` tree (at the same absolute
  path, via `${HOME}` interpolation).
- `.ddev/web-build/Dockerfile.workspace-app` installs the `docker` CLI and the
  `ddev` binary in the web image, and aligns the container's `docker` group
  GID with the host's.
- `.ddev/nginx_full/nginx-site.conf` proxies the site to the app on
  `127.0.0.1:3000` inside the container.

### Per-machine adjustments

- **docker group GID**: the Dockerfile assumes the host's `docker` group is
  GID `984`. Check yours with `getent group docker` and adjust the `groupmod`
  line if it differs, then `ddev restart`.
- **Chat**: the assistant chat shells out to the `claude` CLI **inside the
  container** (installed in the web image via `npm install -g
  @anthropic-ai/claude-code`); it authenticates through your host's
  `~/.claude` + `~/.claude.json`, which are bind-mounted in. If you've never
  logged in to Claude Code on the host, run `claude` there once first.
- **Voice input**: the mic button uses the browser's Web Speech API
  (Chrome/Edge; hidden automatically on browsers without support).

## Security note

This app executes shell scripts with real side effects (build, backup,
**delete**) and has host-Docker access. The AI assistant runs in **agent
mode**: its `claude -p` calls are allowed Bash/Read/Glob/Grep inside the
container (Write/Edit stay disallowed, and its instructions forbid deleting
anything unasked), so a chat message can really build, start, stop, back up
and open projects — and steer the page afterwards via NAVIGATE/OPEN/REFRESH
directives. Every action and chat message is appended to `actions.log`.
It binds only to the DDEV-internal port and is meant for local development
machines — do not expose `workspace.ddev.site` beyond localhost without
adding authentication.
