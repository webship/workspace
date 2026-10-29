# workspace-app

The **workspace** web dashboard — a visual UI + AI assistant for this tooling,
served at **https://workspace.ddev.site** through DDEV.

Basic Node.js (`node:http`, no framework) + [HTMX](https://htmx.org) (vendored
in `public/htmx.min.js`). All pages are server-rendered; interactions swap in
HTML fragments. Destructive actions ask in one shared confirm dialog — Wait!
Are you sure you want to proceed with this action? — and fire on its Yes alone.

## What version is this machine on?

The toolbar says, beside the product name, and `core/workspace-app/scripts/update.sh --check`
says the same thing. Both read **`core/workspace-app/.app-version`**, a file holding a tag and
nothing else.

It is written by all three things that install this tree, which is the point:

| | writes the stamp |
| --- | --- |
| `core/scripts/install.sh` | the latest release tag, read from the repository |
| `core/scripts/sync-tooling.sh --pull` | the tag the clone is sitting on |
| `core/workspace-app/scripts/update.sh` | the tag it just installed |

Before that only the **updater** wrote it, so a machine installed any other way answered
`Installed: (untracked)` and was told an update was available to the version it already had —
for ever. With one person that is a curiosity; across a team it is the support question nobody
can answer, and an update prompt everyone learns to ignore.

**When it cannot be told, it says so** — `version unknown` in the toolbar, with the three
commands that would set it in the tooltip. A wrong version is worse than an absent one, because
it stops the question being asked.

`package.json`'s `"version"` is **not** it. That is npm metadata for an app that is never
published, it has said `1.0.0` since the first commit, and a unit test fails if anything starts
displaying it.

## One `ddev start` at a time

Every router-mutating verb — `start`, `stop`, `restart`, `poweroff`, `delete` — tears down the
**one shared** `ddev-router` and rebuilds it with the routes of whatever is running. Two at once
race on a single container, and the loser can leave it removed: every `*.ddev.site` address dies,
the hub included, with healthy web containers behind it, and DDEV then refuses to start anything
until `ddev poweroff`. Five clicks in thirty-eight seconds did exactly that.

`core/scripts/ddev-shim/ddev` is a wrapper that holds a lock for those five verbs and `exec`s the
real binary for everything else. It is **first on PATH inside the dashboard's container**
(`/usr/local/sbin` precedes `/usr/local/bin`), so it covers the assistant's Bash calls, the
`cmd-*.sh` scripts, the Web IDE's terminals and anyone in `ddev ssh` — not just the buttons.
`install.sh` offers the same file on the host, where it needs root.

Four rules it lives by, because a wrong wrapper breaks *every* `ddev` call including the
dashboard's own twenty-second status reads:

1. the real binary is found by **absolute path** and checked not to be the wrapper — resolving
   through PATH would find the wrapper again and fork for ever;
2. anything that is not a router verb is `exec`'d with **no lock and no subshell** —
   `ddev list --json-output` costs what it always cost, and read-only verbs still run in parallel;
3. **nothing is fatal** — a missing `flock`, an uncreatable lock file, and it says so once and runs
   the command anyway, because refusing to run `ddev` is worse than the fault being prevented;
4. it **never re-locks a lock already held**. The dashboard wraps its own calls, and taking the same
   lock from inside deadlocks for the full 1800s timeout — proven by experiment before
   `DDEV_ROUTER_LOCK_HELD` existed. Whoever holds the lock sets it; the wrapper exports it onward.

The shim exists twice, because Docker cannot `COPY` from outside its build context:
`core/scripts/ddev-shim/ddev` is the source, `.ddev/web-build/ddev-shim-ddev` is the copy the image
takes, and a unit test fails if they differ.

## The Web IDE (code-server)

Every project row carries a **Codebase** menu, right after SCREENS, and every document
workspace (`docs`, `worklogs`, `specs`, the `ai-*` folders) carries a **Files** one. Both offer
the same three destinations, and the split is the point — it is GitLab's, and it is what stops
a link that silently does nothing:

| | opens | needs |
| --- | --- | --- |
| **Web IDE** | VS Code in the browser, at `https://ide.<hub_domain>/?folder=<path>` | nothing — works from any device |
| **Visual Studio Code** | `vscode://file<path>` — the VS Code on the machine the *browser* is running on | the `vscode://` handler, which VS Code registers on install |
| **IntelliJ IDEA** | `jetbrains://idea/open?file=<path>` — likewise, IDEA on that machine | the JetBrains Toolbox URL handler |
| **Copy the path** | the path, for `code <path>` or `idea <path>` in a terminal | nothing |

**It is code-server, pinned, on its own hostname.** `4.135.0` is baked into
`.ddev/web-build/Dockerfile.workspace-app` from the standalone tarball — pinned because an
editor that changes under people between image rebuilds is a support question nobody can
answer. It runs as a `web_extra_daemon` bound to **127.0.0.1:8443**, and
`.ddev/nginx_full/nginx-site.conf` proxies `ide.workspace.ddev.site` to it. Loopback plus that
one vhost is the whole access control.

A **hostname, not a subpath**: code-server is a single-page app that builds absolute URLs for
its workers, its websocket and its static assets, and upstream's guidance is a dedicated
(sub)domain. It costs nothing here — `*.workspace` is already in `additional_hostnames`, so
DDEV's router routes it and the project certificate already covers it. The vhost uses an
**exact** `server_name` so it wins over the regex block that sends everything else to the Node
app, and carries the websocket `Upgrade`/`Connection` headers plus long read timeouts —
without those the editor loads and then hangs "reconnecting…", because the terminal, the
extension host and the file watcher are all websockets.

**Its state lives in the workspace tree**, at `.code-server/` (gitignored): settings,
keybindings and installed extensions survive an image rebuild, which they would not if they
sat in the container.

**When it is down the menu says so** rather than offering a dead link — a cached loopback
probe, warmed at boot so the first render after a restart already knows. The note names the
fix: `ddev restart`, or `docker exec ddev-workspace-web supervisorctl status`.

### What makes it work — the actual options

**Serving it** (`scripts/code-server-start.sh`, run as a `web_extra_daemon`):

| flag | why |
| --- | --- |
| `--bind-addr 127.0.0.1:8443` | loopback only; the `ide.*` vhost is the whole access control |
| `--auth none` | see the security note below — not a casual choice |
| `--user-data-dir`, `--extensions-dir` under `.code-server/` | settings and extensions survive an image rebuild |
| `--disable-telemetry`, `--disable-update-check` | nothing phones home; the version is pinned in the image |
| `--app-name 'Webship Workspace IDE'` | the title bar and welcome page say where you are |

**Nginx**, in `.ddev/nginx_full/nginx-site.conf`: an **exact** `server_name ide.workspace.ddev.site`
(beats the regex block that routes everything else to the Node app), `proxy_set_header Upgrade` +
`Connection $connection_upgrade` with a `map` for it, `proxy_read_timeout 86400s`,
`proxy_buffering off`, `client_max_body_size 0`. The websocket headers are not optional: the
terminal, the extension host and the file watcher are all websockets, and without them the editor
loads and then hangs *reconnecting…*.

**Editor settings**, seeded once into `.code-server/data/User/settings.json` (never overwritten, so
your own changes stick):

| setting | why |
| --- | --- |
| `security.workspace.trust.enabled: false` | VS Code opens every folder in **Restricted Mode** and refuses to start a terminal until you answer *"Do you trust the authors…"*. That prompt is for code you downloaded; here every folder is a project on this machine, opened from a dashboard that already offers a shell |
| `terminal.integrated.profiles.linux` → **Claude Code**, **Claude Code (accept edits)** | the terminal dropdown offers them by name, so agents and skills are one click away instead of requiring you to know to type `claude` |
| `files.associations` → `.module`, `.install`, `.theme`, `.profile`, `.engine`, `.inc` as PHP | without it the editor treats the files a Drupal developer opens most as plain text: no highlighting, no outline |
| `files.exclude` / `search.exclude` → `node_modules`, `vendor`, `web/core`, `web/modules/contrib` | a Drupal site is ~21,000 PHP files of which almost none are yours; search is useless otherwise |
| `files.watcherExclude` → the same trees plus `.git/objects`, `graphify-out`, `.ddev` | **one** built Drupal project is ~21,000 directories, 11,800 of them in those three trees, against a kernel limit of 65,536 watches **shared across the machine**. Without this, two open projects and the editor reports *Unable to watch for file changes* and silently stops noticing edits made outside it — a `composer install`, a `git checkout`, an agent |
| `extensions.autoUpdate: "off"` | the same reason code-server is pinned |
| `workbench.startupEditor: "none"`, `update.mode: "none"`, `telemetry.telemetryLevel: "off"` | no welcome page, no update nag, no telemetry |

### Claude Code is in the editor, when it is configured

The official extension (**`Anthropic.claude-code`**, on Open VSX — which is the registry
code-server queries, so no marketplace switch and no `.vsix` juggling) is installed by
`scripts/code-server-start.sh` on first start, and appears in the activity bar with its own
chat (`Ctrl+Alt+I`).

**Gated on Claude Code being usable here**, which means two things: the `claude` CLI on PATH, and
a credentials file in `~/.claude` (the container bind-mounts it from the host). On a machine where
Claude Code has never been logged in, installing it would put a panel in the editor whose only
behaviour is to ask for a login that belongs on the host — so there the IDE keeps the terminal
profiles and nothing else, and the script says so. Log in on the host with `claude`, then
`ddev restart`.

Installed **once**, when missing, with a timeout, and never fatally: an editor that will not start
because a registry was slow is worse than an editor without one extension. `extensions.autoUpdate`
is `"off"` for the same reason the code-server version is pinned.

### Agents and skills are already loaded

Nothing to install per project. The IDE runs **inside the dashboard's container**, which bind-mounts
`~/.claude` — so a terminal there has the `claude` CLI with the **same agents, skills and commands as
a session on the host** (86 / 42 / 6 on this machine), and Claude Code reads `CLAUDE.md` and
`AGENTS.md` from the working directory upwards, so the folder's own rules apply automatically.

In the IDE: **Terminal → new terminal dropdown → Claude Code**. Or type `claude` in any terminal.
Inside it, `@` and `/` list the same items the dashboard's assistant offers, because they are the
same files.

**For local VS Code / IntelliJ** (the other two entries in the menu) nothing is configured — they
open the folder on your own machine, with your own settings and your own extensions. Agents and
skills come from your own `~/.claude` there, which is the point of that split.

### Security posture, stated plainly

**This dashboard has no authentication, and that is only safe because it is loopback-only.**
It runs shell commands, serves an interactive terminal at `/terminal/<session>`, and a Web IDE
with write access to the whole tree and a terminal of its own — in a container that mounts the
Docker socket and the DDEV registry. Anyone who can reach the port has all of it.

What keeps that acceptable is that nothing is reachable from the network: DDEV's router binds
`127.0.0.1` (`router_bind_all_interfaces: false`, its default) and the machine answers nothing
on its LAN address.

**Two settings end that**, and both get changed for a good-looking reason:

| setting | why someone changes it |
| --- | --- |
| `router_bind_all_interfaces: true` | DDEV documents it for Let's Encrypt, and for reaching a project from a phone |
| `hub_domain: <a public domain>` | this README says the same system runs as a remote hub |

So both are watched for, in the two places a person will be:

- **`install.sh --check`** prints `✓ exposure loopback only` or a block naming the setting that
  changed and what is reachable because of it;
- **the dashboard itself** shows a banner on every page, not dismissible, because the person who
  flips that setting a month later is not running the installer.

If the hub is ever put on a public domain, the dashboard **and** the IDE need real
authentication in front of them. One decision, not two.

### Other things the security pass fixed

- `core/config/settings.yml` (real API keys) and `.screens/.runner-token` (the screen runner's
  entire access control) were **world-readable at `775`** while the CLI-managed secrets beside
  them were correctly `600`. Both are `600` now.
- One **high-severity** dependency advisory (`js-yaml`, exponential parsing → DoS) — fixed.
- Security headers were set at **three** `writeHead` sites out of fifty-six, so every page but
  the graph viewer went without. They are set once in the request handler now: `nosniff`,
  `no-referrer`, `SAMEORIGIN`.

### The IDE’s own posture

`--auth none`. The dashboard has no login of its own until Sign in with Google (`auth.google`) is
turned on, and it already serves a real interactive terminal at `/terminal/<session>`, so a second
password in front of one door would be theatre.
What this means concretely: **anyone who can reach the dashboard's origin can edit any file in
`~/workspace` and run commands in that container**, which has the Docker socket and the DDEV
registry mounted.

That is acceptable for a local tool on `*.ddev.site` and **not** acceptable on a public
`hub_domain`. If the hub is ever put on a public domain, the IDE *and* the dashboard need real
authentication in front of them — the same decision, not two.

## What it does

- **Home** (`/`): the workspace cards grid — one card per folder in
  `core/config/settings.yml`'s `workspaces:` list (read live, so adding a
  workspace there shows up without code changes), with live project counts.
- **Per-workspace pages** (`/dev`, `/test`, `/demos`, …): each workspace's own
  project list with per-project **Backup / Filemode / Remove** actions, plus a
  **Build** form listing that folder's `cmd-*-project.sh` builder scripts.
- **AI Assistant** on every page (inline on home, floating 🤖 widget on
  workspace pages): quick actions (New Drupal 11, New Webship, Status) and a
  free-text chat backed by the local `claude` CLI in restricted, tool-free
  print mode.
- All actions run the real `cmd-*.sh` scripts (and `ddev`) against
  `~/workspace` — this is a control panel, not a mock.

## Setup

You need the workspace files and DDEV. The quickest way to the files is the ZIP — no git, no
clone: on [github.com/webship/workspace](https://github.com/webship/workspace) switch to the `1.0.x`
branch, press **Code ▾ → Download ZIP**, unzip it and rename the folder to `~/workspace` (the full
walkthrough, and two other ways, are in the [root README](docs/REFERENCE.md#get-started)).

Then, once:

```bash
cd ~/workspace/core/workspace-app
ddev start
```

Then open https://workspace.ddev.site. Everything else — building, starting, stopping, backing up,
restoring and removing projects — can be done from there without another command.

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

- **docker group GID — handled for you.** The container has to share this
  host's docker GID or every `ddev` command inside it fails with a permission
  error, and the symptom is a dashboard where every project reads as Stopped
  forever while running perfectly well. Two files carry the number: the
  `groupmod`/`usermod` line in `.ddev/web-build/Dockerfile.workspace-app`
  (which is what `sg docker` in the supervisord command resolves) and
  `group_add` in `.ddev/docker-compose.dood.yaml` (which is what actually puts
  the running process in the group — DDEV pins `user: 1000:1000`, so a
  build-time `usermod` never reaches it).

  `core/scripts/docker-gid.sh` writes both from the host's socket.
  `core/scripts/install.sh` runs it at setup and reports it in its survey, and
  `core/scripts/sync-tooling.sh` runs it **after** mirroring — this directory is
  mirrored wholesale, so a hand edit would be overwritten by the next `--pull`.
  Check it any time:

  ```
  bash core/scripts/docker-gid.sh --check
  ```
- **The DDEV project registry** (`~/.ddev`) is bind-mounted in, so `ddev list`
  in here sees the same projects as the host. Without it the container has its
  own empty registry and reports one project — itself — which produces the same
  "everything is Stopped" symptom by a different route.
- **Bind-mounted host paths are a trap Docker sets.** A bind mount whose source
  does not exist is *created* — as a directory, owned by root. Every optional tool
  the dashboard shares from the host is such a source, so on a machine without
  `twg` the first start used to create `~/.local/bin/twg` **and `~/.local/bin`**
  as root: the JIRA button then never appeared however complete `jira:` was, and
  nothing could install a user binary there any more, including the
  `drupal-ci-local` wrapper the GitLab CI green-gate writes.

  `core/scripts/host-mounts.sh` creates each of those paths as you before Docker
  can, and comments the `twg` volume out of `.ddev/docker-compose.twg.yaml` while
  `twg` is not installed — restoring it the moment it is. It runs from the
  project's own `pre-start` hook and from `install.sh`. `--check` reports without
  changing anything, and it names the paths only root can hand back.
- **Jira** needs the Teamwork Graph CLI on the host:
  [teamworkgraph.com/cli](https://teamworkgraph.com/cli) ·
  [developer.atlassian.com/cloud/twg-cli](https://developer.atlassian.com/cloud/twg-cli/)
  ```
  curl -fsSL --retry 2 https://teamwork-graph.atlassian.com/cli/install | bash
  ~/.local/bin/twg doctor
  ```
  It is mounted in rather than installed in the image: one binary, one OAuth
  session, and `twg login` on the host reaches the container instantly. When it is
  absent the JIRA button renders **disabled**, with the reason in its tooltip,
  rather than vanishing.
- **Upsun** needs its CLI on the host, mounted in the same way and for the same
  reason as `twg` — one binary, one session:
  [developer.upsun.com/cli](https://developer.upsun.com/cli)

  Upsun's own installer sets up an apt repository, so it needs root and an
  interactive password; in a pipe it fails with *"sudo: A terminal is required to
  authenticate"*. `install.sh` therefore prefers the **release tarball** — one
  static binary into `~/.local/bin`, no root at all — and falls back to the
  official installer only if GitHub is unreachable:

  ```
  ver=$(wget -qO- https://api.github.com/repos/upsun/cli/releases/latest \
        | sed -n 's/.*"tag_name": *"v\([^"]*\)".*/\1/p' | head -1)
  wget -qO- https://github.com/upsun/cli/releases/download/v$ver/upsun_${ver}_linux_amd64.tar.gz \
    | tar -xz -C /tmp upsun && install -m 0755 /tmp/upsun ~/.local/bin/upsun
  upsun login          # browser OAuth; writes SSH certificates
  ```

  **The dashboard needs its own credential, and this is not optional.** `upsun login`
  writes a session into the host keyring, and a container cannot reach a keyring — so
  every UPSUN action in the dashboard (the environment list, the live URLs, *Get
  database & files*) authenticates with an API **token** instead:

  ```yaml
  # core/config/settings.yml
  upsun:
    cli_token: …        # Upsun console → My profile → API tokens
  ```

  `upsunJobEnv()` injects it as `UPSUN_CLI_TOKEN` for each CLI call. Without it the
  actions answer *"No Upsun API token configured"*; with the wrong **kind** of token
  they answer *"The request could not be authorized. Unable to authenticate the
  provided API token"* — which reads like an expiry. An **Atlassian** token in that
  field, recognisable because they start `ATATT`, produces exactly that message.
  `bash core/scripts/install.sh --check` reports the field by shape, never its value.

  Two related details worth keeping:

  - **The CLI prints the reason FIRST and a usage synopsis LAST.** These errors are
    rendered through `cliError()` in `format.js`, which drops the synopsis and keeps
    the head — a tail slice showed a list of flags and threw the reason away.
  - **It hard-wraps mid-word.** The real output is `provided AP` / newline / `I token.`,
    so matching its text has to survive the wrap; the check in `actions/upsun.js` does.
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
