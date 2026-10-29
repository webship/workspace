# Webship Workspace: reference

> **The full reference.** Every command, every flag and how the tooling is built. The short introduction is the
> [README](../../../README.md); the day-one walkthrough is the [user guide](USER-GUIDE.md). Paths in this file
> are relative to the repository root (`~/workspace`).


The Vardot team's Drupal development workspace: manage the base-code development work cycle for Vardot's distributions, recipes, profiles, and starter-kit templates on top of [DDEV](https://ddev.com) — no host-level Apache, PHP, or MySQL required.

Ships builders for Varbase plus plain Drupal:

| Distribution | Versions | Project template |
| --- | --- | --- |
| [Varbase](https://www.drupal.org/project/varbase) | 9.1, 9.2, 10.0, 10.1, 11.0 (`x` + pinned) | `drupal/varbase_project` |
| [Educare](https://www.drupal.org/project/educare) · [Horizon Aid](https://www.drupal.org/project/horizonaid) site templates | 1.0.x on Varbase 11 | `drupal/varbase_project` + the recipe |
| [Drupal](https://www.drupal.org/project/drupal) | latest 11 | `drupal/recommended-project` |
| [Drupal CMS](https://www.drupal.org/project/cms) | latest 2 | `drupal/cms` |

## Layout

Every folder in `~/workspace` is a **workspace**: its own `cmd-*.sh` commands and its own page in the
dashboard. A builder run from one creates a project in a subdirectory of it, with its own DDEV
containers and its own database — nothing is shared on the host.

| | |
| --- | --- |
| **Sites you build** | `dev` `test` `sandboxes` `demos` `projects` |
| **Code we maintain**, as git clones | `products` `modules` `themes` `profiles` `recipes` `site-templates` |
| **AI items** — drafts that install into the Claude Code CLI | `ai-agents` `ai-skills` `ai-commands` `ai-prompts` |
| **Documents** | `docs` `worklogs` `specs` `videos` `audio` |
| **Services** | `designs` (Penpot) `rag` (Milvus) `graphs` (graphify) |

`core/` holds the whole build chain — `core/scripts` (the libraries every `cmd-*.sh` sources) and
`core/config` (`settings.yml` plus one file per workspace). The `workspaces:` list in `settings.yml`
is what registers a folder; adding one is two entries and a directory, and the dashboard picks it up
with no restart. Settings → `workspaces:` adds one from the browser, and deletes one that nothing uses
after asking three times.

## Get started

Four steps, in this order. Everything after them can be done from the dashboard.

### 1. Get the files

Open **[github.com/webship/workspace](https://github.com/webship/workspace)** (sign in — it is a
private repository), switch the branch selector to **`1.0.x`**, then **Code ▾ → Download ZIP**.

Unzip it and rename the extracted `workspace-1.0.x` folder to **`workspace`** in your home
directory, so you end up with `~/workspace`.

### 2. Install the tools

```
bash ~/workspace/core/scripts/install.sh
```

It reports what is missing and installs it — everything the workspace needs, and nothing else:

| | |
|---|---|
| Runs the sites | Docker, [DDEV](https://ddev.readthedocs.io/en/stable/users/install/) |
| Runs the tooling | git, gh, Node.js (npm, npx — also the [skills.sh](https://skills.sh) CLI), jq, rsync, python3, gawk, sed, screen |
| Runs the agents | [Claude Code](https://code.claude.com/docs/en/quickstart) |
| Trusted https | mkcert, libnss3-tools / nss-tools |
| Shell and build basics | curl, wget, unzip, zip, p7zip, diffutils, vim, links, lynx, htop, gcc, g++, make |
| Pipelines locally | gitlab-ci-local |

It also **trusts the local https certificates** — every workspace URL is https, and without that
trust the browser refuses each one with `ERR_CERT_AUTHORITY_INVALID`. Snap browsers each get their
own store; see `core/scripts/trust-https.sh`.

This script is the only installer there is: it lives here, in this repository, so what a machine
gets is whatever this checkout says. Nothing is fetched from another repository to bootstrap it.

Idempotent, so it is also the update path. `--check` reports and changes nothing; `-y` skips the
per-group prompts. It installs nothing at the OS level beyond those tools and writes nothing to
your `~/.bashrc`.

**On a fresh Ubuntu, one thing needs you afterwards.** Installing Docker adds you to the
`docker` group, and a group is applied at **login** — so the shell you ran the installer in still
cannot reach Docker, and step 3 would fail with:

```
Docker error: permission denied while trying to connect to the docker API at unix:///var/run/docker.sock
```

That is a session that predates a group, not a broken tool. **Log out and back in.** The installer
tries Docker for real at the end and tells you which of these you are in:

```
Next steps:
  1. LOG OUT AND BACK IN. You are in the docker group, but a group only
     applies at login, so this shell still cannot reach Docker …
  2. gh auth login
  3. cd core/workspace-app && ddev start
  4. Open https://workspace.ddev.site
```

Then sign in to GitHub, which the release and PR tooling needs:

```
gh auth login
```

### 3. Start the dashboard

```
cd ~/workspace/core/workspace-app
ddev start
```

The first start does three things for you, so a fresh machine needs no per-machine edits:

- **Builds the container** with the docker group this host actually uses, so the dashboard can see
  what Docker is doing. Get this wrong and every project reads as Stopped forever while running
  perfectly well — `bash core/scripts/docker-gid.sh --check` reports it, and step 2 already set it.
- **Trusts the https certificate** through the project's own `post-start` hook, and names any
  browser that was open before the CA arrived (a trust store is read once, at startup).
- **Publishes every workspace hostname**, so `<project>.<workspace>.workspace.ddev.site` resolves
  without touching `/etc/hosts`.

### 4. Open it

**https://workspace.ddev.site** — and build your first site from the **Build** form.

That is the whole setup. Building, starting, stopping, backing up, restoring and removing projects
are all done from there.

### Make it come back after a reboot

Worth doing once, because nothing else will:

```
bash ~/workspace/core/scripts/autostart.sh --enable
sudo loginctl enable-linger $USER
```

A DDEV project's containers carry `restart: no`, so after a reboot the dashboard is simply not
running and **every workspace URL answers 404** from a router with nothing behind it. That is not
a fault to debug; it is the default. `--enable` installs a systemd *user* service that runs
`ddev start` once Docker is up. The `enable-linger` line is the difference between starting at
**boot** and starting when you next log in, and it is the one step that needs your password.

It also starts the **screen runner** each time, which is what the Screens page and every
item-sync button use. Sessions run on your machine rather than in the dashboard's container — so
`screen -r <session>` works in your own terminal, and a browser an agent drives opens on your
desktop — and a container cannot start a host process. Without the boot service, start it once with
`bash core/workspace-app/scripts/screen-host.sh --start`.

Check it any time with `bash core/scripts/autostart.sh` — it prints the service state, whether
lingering is on, and exactly which projects will come back.

**Which projects come back** is `dashboard.autostart` in `core/config/settings.yml`. It takes a
word, not just a list, because a hand-kept list is wrong within a week — you build a project and
never think about this file again:

| Value | What starts |
|---|---|
| `workspace` | Just the dashboard. The default: boots in seconds, and everything else is one click away from it. |
| `running` | Whatever was running when the machine last shut down cleanly. What most people mean by "bring my work back". |
| `all` | Every project DDEV has registered. Honest about the cost — each one is a web + db container competing for RAM at boot. |
| `dev1,test2` | Exactly those, in that order. |

The dashboard is always started first and is always included, whatever the value says: a boot that
brings back four sites and no dashboard is worse than one that brings back only the dashboard.

### Notes on the four steps

- **Platforms.** Linux (Debian/Ubuntu apt, Fedora dnf) and macOS ([Homebrew](https://brew.sh);
  Docker via Docker Desktop or OrbStack) install directly. On Windows, do all of this inside
  [WSL2](https://learn.microsoft.com/windows/wsl/install) — `wsl --install -d Ubuntu`, reboot, then
  step 2 in Ubuntu; the script detects a native Windows shell and says exactly this.
- **The location is yours.** Every script finds the tooling from its own path, so `/srv/workspace`,
  `~/Sites/vardot` or a second copy beside the first all work. The folder name only decides whether
  the URLs in this README match what you see.
- **Jira (optional).** The JIRA button on a project row, the tasks modal and the Jira agents all
  drive the **Teamwork Graph CLI**, `twg` — [teamworkgraph.com/cli](https://teamworkgraph.com/cli) ·
  [developer.atlassian.com/cloud/twg-cli](https://developer.atlassian.com/cloud/twg-cli/). Step 2
  offers to install it; by hand it is:
  ```bash
  curl -fsSL --retry 2 https://teamwork-graph.atlassian.com/cli/install | bash
  ~/.local/bin/twg doctor      # signs you in through the browser, then checks the setup
  ```
  It installs into `~/.local/bin` and holds one OAuth session per person, which is why it is
  offered rather than assumed. Then fill in `jira:` in `core/config/settings.yml` (`site`,
  `account`, `default_project`) and `ddev restart` so the dashboard can see the binary.

  Configured Jira but no button? The button is there, disabled, and its tooltip says which half is
  missing — the settings and the CLI are separate things.
- **https, if a browser still complains.** A browser reads its trust store **once, at startup**,
  so one that was already open when the CA arrived keeps refusing every workspace URL — a reload
  or a cache clear will not do it. Step 2 and every `ddev start` name the browsers in that state
  and how to restart each without losing tabs (`chrome://restart`, `brave://restart`).
  `bash core/scripts/trust-https.sh` reports and fixes the stores themselves, and
  `--restart-browsers` closes the stale ones for you. A snap browser (Brave, Chromium) is confined
  to its own store, so it needs the CA separately from a packaged Chrome.
- **Changing the tooling?** Keep a git clone for that, separate from the live tree above, and open
  pull requests from it:
  ```
  git clone --branch '1.0.x' https://github.com/webship/workspace.git ~/workspace/products/workspace
  ```
  After a PR merges, `bash core/scripts/sync-tooling.sh --pull` copies the scripts, the
  dashboard and the per-workspace settings into the live tree — and deliberately leaves
  `core/config/settings.yml` alone, since that file holds your real account details and API keys.

### Update — same place as the install

Installing brings the machine up to date; updating keeps it there. One command per thing that
moves, and neither touches `core/config/settings.yml`, which holds your real account details and
API keys:

| What | Command | What it does |
| --- | --- | --- |
| The tools | `bash core/scripts/install.sh --check` | Reports what is missing, then installs it without `--check`. Idempotent, so it is also the update path for git, gh, Node.js, Docker, DDEV and Claude Code. |
| The dashboard app, and the prompt templates | `bash core/workspace-app/scripts/update.sh --check` | Compares the installed version with the newest release; without `--check` it updates to it. |
| The `cmd-*.sh` tooling (clone only) | `bash core/scripts/sync-tooling.sh --pull` | Copies the scripts, the dashboard and the per-workspace settings out of the clone into the live tree. |

The dashboard updater is self-contained — plain bash, `curl`/`gh`, `tar` and `rsync`, no workspace
bootstrap — because it has to keep working while replacing the tooling around it:

```
bash core/workspace-app/scripts/update.sh --check          # installed vs the newest release
bash core/workspace-app/scripts/update.sh                  # update to it
bash core/workspace-app/scripts/update.sh --tag 1.0.0      # pin a release
bash core/workspace-app/scripts/update.sh --dry-run        # itemize, change nothing
```

Runtime state survives an update: `node_modules` is kept unless `package.json` changed (then
`npm install` runs in DDEV), and `actions.log`, screenshots and test reports stay where they are.

It also brings the release's **prompt templates** into `prompts/`, because the New screen form and
the Jira verbs offer them — a release that improves a prompt is no use if the prompt never reaches
the machine. That folder is where prompts are written as well as installed, so a prompt *you* have
edited is never overwritten:

```
  new prompt: varbase-canvas-component.md
  updated:    review.md
  yours, kept: explain.md
Prompts: 1 new, 1 updated, 1 left as yours.
```

Edited means edited, not "differs from the new release": each update records the checksum of every
prompt as it shipped, so one still matching the installed version is refreshed and only one you
changed is kept. Add `--force-prompts` to take the release's copy of those too, or `--no-prompts`
to skip the step.

### First build

A build is one command — or the **Build** form on the dashboard:

```
cd ~/workspace/dev
bash cmd-varbase11-0-x-project.sh varbase11c1 --install
```

## Settings

Set your own webmaster account and any extras in the settings file — either from the dashboard's
**Settings** page (https://workspace.ddev.site/settings), or by editing it directly:

```
vim ~/workspace/core/config/settings.yml
```

```yaml
host: 127.0.0.1
web: http://127.0.0.1/core
protocol: http
account:
  name: webmaster
  pass: d
  mail: webmaster@vardot.com
contributor:
  name: CHANGE_ME       # who commits/files issues from this machine (#32)
  email: CHANGE_ME
ai_providers:           # keys for the AI stack of the sites you build
  openai:
    api_key: sk-change-this
  anthropic:
    api_key: sk-change-this
  gemini:
    api_key: sk-change-this
workspaces:
  - products
  - dev
  - test
  - demos
  - sandboxes
  - profiles
  - modules
  - themes
  - libraries
  - recipes
  - components
  - agents
  - skills
  - prompts
  - docs
```

Keep real passwords and API keys in your own copy — never commit them back.

`ai_providers` feeds the AI stack of the sites you build: after an install, `set_ai_provider_keys` stores each real key on the site through the Key module and points the matching `ai_provider_<name>` module at it (Drupal CMS AI, Varbase AI). Placeholders are skipped, values travel over STDIN (never a command line), and everything runs inside the project's own DDEV containers.

No paths are listed: `root`, `path`, `scripts`, `config` and `backups` are derived from the checkout (`backups/` is created on first run). Add them to `settings.yml`, or export `WORKSPACE_ROOT` / `_PATH` / `_SCRIPTS` / `_CONFIG`, only to point the tooling somewhere else.

There is no `database:` section either: every DDEV project manages its own isolated database, and DDEV's `settings.ddev.php` owns the connection.

## Web dashboard (workspace.ddev.site)

A visual dashboard + AI assistant for the whole workspace lives in
`core/workspace-app` (basic Node.js + HTMX, served through DDEV):

```
cd ~/workspace/core/workspace-app
ddev start
```

Then open **https://workspace.ddev.site** — workspace cards with live project
counts, per-workspace pages (`/dev`, `/test`, …) with build/backup/remove
actions, and an AI assistant on every page. See
[`core/workspace-app/README.md`](../../../core/workspace-app/README.md) for details.

### Domains

The dashboard manages a hierarchical domain scheme by default:

- `https://workspace.ddev.site` — the dashboard home
- `https://<workspace>.workspace.ddev.site` — that workspace's page
  (e.g. `dev.workspace.ddev.site`, `test.workspace.ddev.site`)
- `https://<project>.<workspace>.workspace.ddev.site` — the project's real
  site (e.g. `varbase11demo.dev.workspace.ddev.site`); the **Launch**
  button uses these, and the canonical `https://<project>.ddev.site`
  always keeps working

No per-project configuration is needed — wildcard hostnames + an nginx
tier in `core/workspace-app/.ddev/` route everything with valid TLS.

All navigation links and the Launch buttons follow this scheme by
default, and they are all built from **one field** — `hub_domain:` in
`core/config/settings.yml`. Its first label is the DDEV project name and
the rest is the project TLD.

Change it through the command, not by hand, so the dashboard's links and
DDEV's routing cannot drift apart:

```
cd ~/workspace/products
bash core/scripts/autostart.sh --domain workspace.ddev.site
```

The TLD is set **globally**, with `ddev config global --project-tld`, so
one field moves everything together: the dashboard, every workspace page
under it, and each project's own canonical `<project>.<tld>`. No project
in this tree carries its own `project_tld`, so they all inherit it — and
any that does is named in the output as one that will not follow.

Projects already running keep answering on the old name until they
restart, since their containers were started against the previous TLD.
They are listed rather than restarted for you (restarting a site
mid-build is how a half-written database happens); `--restart-all` does
it when nothing is in flight.

It refuses two changes rather than half-applying them:

- **A TLD with no wildcard DNS.** `*.ddev.site` resolves to `127.0.0.1`
  *at any depth*, which is the only reason the nested scheme above works
  with an empty `/etc/hosts`. `/etc/hosts` cannot hold wildcards, so a
  custom TLD needs one hand-added line per hostname, with sudo, forever —
  and every new project 404s until someone adds it.
- **A first label that differs from the project name.** That is a rename,
  not a domain change: DDEV keys its volumes on the project name, so it
  strands the database and builds an empty one.

Both are allowed with `--force` once you mean them.

**On a Docker host or a dedicated server** the same system runs as one
shared **development workspace hub on a real domain** —
`workspace.example.com` → `dev.workspace.example.com` →
`myproject.dev.workspace.example.com`. There the custom TLD is the normal
case, not the exception, and the DNS check above passes on its own
because the record is real:

```
# 1. Point *.workspace.example.com at the host in your DNS. One wildcard
#    record covers every workspace and every project, forever.
# 2. Then:
cd ~/workspace/products
bash core/scripts/autostart.sh --domain workspace.example.com
```

One more thing is needed there, and the command says so rather than
leaving you to find it: DDEV binds its router to `127.0.0.1`, so on a
server the ports are open, the DNS resolves, and every request from
outside times out with nothing in any log. Open it deliberately, with a
firewall in front:

```
ddev config global --router-bind-all-interfaces=true
```

That exposes **every** DDEV project on the machine, and they are dev
sites. Put it behind a firewall or a reverse proxy. `core/scripts/autostart.sh`
reports which of the two situations a machine is in, so you are never
guessing:

```
reachable    : this machine only (ddev.site, router on 127.0.0.1)
reachable    : from the network — shared hub, router on all interfaces
```

### Examples

Things you can do from the dashboard UI:

- `/dev` → pick **"Varbase 11.0.x"** from the Build dropdown, name it
  `blog1`, press **Build** — and watch the real terminal output stream
  until the site is installed at `https://blog1.ddev.site`.
- Press **Stop** / **Start** / **Launch** on any project row (buttons follow
  the live DDEV status), **Backup** to archive it, or open
  `/dev/backups` to **Restore** an archive (files + automatic DB import).
- `/agents` → **Generate with AI** → describe the agent you want; then
  **Install** it into `~/.claude/agents/` for Claude Code.
- `/docs` → write a doc, press **PDF** or **HTML** to render it, or
  **Screenshot a site** to capture any URL into `docs/`.

Things you can ask the Webship Workspace AI Assistant (it really does them):

- "Build a Varbase 11 site named varbase11c1"
- "Create a Drupal 11.4 site called d114test"
- "can you back up my varbase11c1 site please, then show me the backups page"
- "what's running right now?"
- "Generate an agent that reviews cmd- scripts and save it as cmd-linter"
- "Write a doc about demo1 and make a PDF"


## Building a project

```
cd ~/workspace/dev/
bash cmd-varbase11-0-x-project.sh varbase11c1 --install --add-users
```

### Drupal and Drupal CMS, for example:
```
cd ~/workspace/dev/
bash cmd-drupal11-recommended-project.sh d11c1 --install
bash cmd-drupalcms2-x-project.sh cms1 --install
```

### Drupal CMS site templates:
```
cd ~/workspace/site-templates/
bash cmd-healthcare-project.sh healthcare1 --install
```

Builds Drupal CMS, requires the template package, and with `--install` installs it (answering the installer's site-template step non-interactively), then prints both URLs:

```
https://healthcare1.site-templates.workspace.ddev.site
https://healthcare1.ddev.site
```

One command per free template from [new.drupal.org/browse/site-templates](https://new.drupal.org/browse/site-templates): `healthcare`, `byte`, `haven`, `archimedes`, `everbright`, `provus_edu`, `convene`, `caresphere`, `convivial_gov`, `mercury_demo`, `local`, plus the four Vardot ones below (`horizonaid`, `educare`, `rightup`, `varbase_starter`). Without `--install` the build stops at the codebase and you pick the template in the browser installer. See [`site-templates/README.md`](../../../site-templates/README.md).

### Vardot site templates (Varbase Starter, Educare, Horizon Aid, The Rightup)

The Drupal CMS installer lists all four (Varbase Starter's card is named "Varbase") and downloads the package when one is picked, so a stock Drupal CMS is enough:

```
ddev config --project-type=drupal11 --docroot=web
ddev composer create-project drupal/cms
ddev launch            # then pick the template
```

```
cd ~/workspace/dev/
bash cmd-drupalcms2-x-educare1-0-0-project.sh educare1             # on Drupal CMS, released line, pick it in the browser
bash cmd-drupalcms2-x-educare1-0-0-project.sh educare1 --install   # on Drupal CMS, released line, installed by drush
bash cmd-educare1-0-0-project.sh educare2                          # on Varbase ~11, released line
```

Every folder that builds sites carries each template on both bases its project page publishes, one builder per line: `1-0-0` is the released template (`~1`) and `1-0-x` the development branch (`1.0.x-dev`). The Rightup has `1-0-0` on Drupal CMS only; its Varbase builders are `1-0-x`.

| | Drupal CMS — `cmd-drupalcms2-x-<template>1-0-?-project.sh` | Varbase — `cmd-<template>1-0-?-project.sh` |
| --- | --- | --- |
| Base | `drupal/cms`, PHP 8.4 | `drupal/varbase_project:~11` for the released lines, `11.0.x-dev` for the development lines, PHP 8.4 |
| Released line | nothing required, the installer fetches it; `--install` requires `drupal/<template>:~1`, the root's stability left as shipped | `drupal/<template>:~1` |
| Development line | `minimum-stability dev`, then `drupal/<template>:1.0.x-dev` | `drupal/<template>:1.0.x-dev` |

Without `--install` a builder stops at a codebase and prints the installer URL; with it the site template is installed non-interactively. A `composer` step that fails stops the build with the resolver output, rather than reporting the site as ready.

`test/` also carries `cmd-automated-testing-<template>1-0-?-project.sh` for Educare, Horizon Aid and The Rightup, which add the Playwright suite on top of the same build.

Run any builder with `--help` for its full argument list.

Each of these scripts creates the project folder, runs `ddev config` + `ddev start`, then `ddev composer create-project` and `ddev drush site:install` inside that project's own containers.

## Brand tokens from Figma

The dashboard's colours come from the [VDT Stylesheet](https://www.figma.com/design/Hwbkgkvxths84swEtWcmTv). Refresh them with:

```
cd ~/workspace/products/
bash core/scripts/brand-tokens.sh --show
```

It fetches live when a Figma personal access token is configured (`figma.token` in `core/config/settings.yml`, or `$FIGMA_TOKEN`), and **falls back to the last fetched values** in `core/config/brand-tokens.json` when it is not — either way it rewrites the stylesheet, so the dashboard is never left unstyled, and the output tells you the date and source of the values it used. `--cached` forces the cached path, `--no-apply` refreshes the cache only.

## Agents, skills and prompts: three sources

`agents/`, `skills/` and `prompts/` show what you have here, what is installed in `~/.claude` (what a Claude Code session actually loads), and what is in [Vardot/dev-ai-agents](https://github.com/Vardot/dev-ai-agents) — merged into one list, so it is obvious what is only a draft, only installed, or only shared.

```
cd ~/workspace/ai-skills/
bash cmd-tools-ai-items.sh                              # the three counts
bash cmd-tools-ai-items.sh --list-remote                # what the shared repo has
bash cmd-tools-ai-items.sh varbase-install --fetch      # repo  -> ~/.claude (use it now)
bash cmd-tools-ai-items.sh varbase-install --pull       # repo  -> here (read or edit it)
bash cmd-tools-ai-items.sh --pull --source claude       # this machine -> here (vardot-* only)
bash cmd-tools-ai-items.sh my-draft --install           # here  -> ~/.claude
```

Omit the name to act on all of them. On the dashboard the same rows carry **installed** / **workspace only** / **shared** labels, and anything that exists only in the shared repo gets **Fetch to ~/.claude** and **Copy here to edit** buttons. Restart your Claude Code session to pick up a fetch.

Sharing the other way — a draft here becoming a PR on dev-ai-agents — stays a deliberate act through the issue/PR agents, never automatic.

## GitLab CI locally (the green-gate)

Before pushing anything to git.drupalcode.org, the pipeline runs locally:

```
cd ~/workspace/modules/
bash cmd-tools-gitlab-ci-local.sh <project> --doctor   # setup check (installs the drupal-ci-local wrapper)
bash cmd-tools-gitlab-ci-local.sh <project> --list     # what jobs exist
bash cmd-tools-gitlab-ci-local.sh <project> phpcs      # one job
bash cmd-tools-gitlab-ci-local.sh <project> --slim     # the project's .gitlab-ci-local.yml subset
```

Green = push; red = fix first, never mask with `allow_failure` or `|| true`. Note: the **full** drupal/gitlab_templates pipeline currently cannot run under gitlab-ci-local at all ([firecow/gitlab-ci-local#1893](https://github.com/firecow/gitlab-ci-local/issues/1893) — the templates' `$variable`-in-regex rules crash its evaluator on every ref). The command detects that crash and explains it; until it's fixed upstream, `--slim` is the runnable path and template-only jobs gate on the remote pipeline.

## Upsun: the cloud side of a project

Workspace projects run locally on DDEV and, when they graduate, on [Upsun](https://upsun.com) — client demos, sandboxes, the public Varbase demo. `cmd-tools-upsun.sh` in the `projects`, `demos` and `sandboxes` workspaces is the bridge:

```
cd ~/workspace/demos/
bash cmd-tools-upsun.sh dcms2b1                       # status: linked ID, environments
bash cmd-tools-upsun.sh mydemo --link abc123xyz       # upsun project:set-remote
bash cmd-tools-upsun.sh mydemo --init                 # scaffold .upsun/config.yaml
bash cmd-tools-upsun.sh mydemo --push                 # deploy the current branch
bash cmd-tools-upsun.sh mydemo --activities           # last 10 Upsun activities
```

The default is read-only status. `--link` refuses to silently relink a project that already points at a different Upsun ID (use `--force`), `--push` goes through upsun's own confirmation, and nothing here ever creates or deletes an Upsun project or environment. The `upsun` CLI must be installed and authenticated (`upsun auth:browser-login`); the tool tells you how if it is missing.

Upsun's official AI toolkit ([upsun/ai](https://github.com/upsun/ai), MIT) complements this: an `upsun` agent skill with per-framework `.upsun/config.yaml` starters (including Drupal), a Claude Code plugin (`/plugin marketplace add upsun/ai`), and an MCP server (`claude mcp add --transport http upsun https://mcp.upsun.com/mcp` — token via the `upsun-api-token` header, writes disabled by default). The LLM-readable doc index is [developer.upsun.com/llms.txt](https://developer.upsun.com/llms.txt). For CI, use an API token with `UPSUN_CLI_NO_INTERACTION=1`.

## Syncing the tooling after a merged PR

Two checkouts exist: `~/workspace/products/workspace` is the git clone where commits and PRs happen, `~/workspace` is the live tree where projects are built. After a PR merges, pull the clone and copy the tooling across:

```
cd ~/workspace/products/
bash core/scripts/sync-tooling.sh --pull
```

That syncs `core/scripts`, the per-workspace settings files, `core/workspace-app`, and every workspace folder's `cmd-*.sh` / `README.md` / `*.code-workspace`; prunes commands the clone no longer ships; and runs the smoke test. Built project content is never touched. `--dry-run` shows what would change.

`core/config/settings.yml` is deliberately **not** synced — your copy holds the real account password and API keys, while the committed one ships `CHANGE_ME` placeholders. The command reports any workspace missing from your `workspaces:` list instead of editing the file.

If the dashboard's `.ddev/` config or Dockerfile changed, finish with `ddev restart` in `~/workspace/core/workspace-app`; for a `server.js` change alone, `docker exec ddev-workspace-web supervisorctl restart webextradaemons:workspace-app` is enough.

## Knowledge graph of a project (graphify)

[graphify](https://github.com/Graphify-Labs/graphify) parses a project with tree-sitter into a knowledge graph you query instead of grepping — local, deterministic, no vector store. Every project workspace has a `cmd-tools-graphify.sh`:

```
cd ~/workspace/dev/
bash cmd-tools-graphify.sh varbase11c1
bash cmd-tools-graphify.sh varbase11c1 --query "what does this controller depend on?"
```

It writes `varbase11c1/graphify-out/` — `graph.html` (clickable graph), `GRAPH_REPORT.md` (key concepts, suggested questions) and `graph.json` (queried by `graphify query|path|explain|god-nodes`). The default pass is code-only: local AST, no API key, nothing leaves the machine.

**What it covers on a Drupal project, honestly.** graphify maps PHP classes under `src/` — methods, `use` imports, `extends`, `implements`, trait `use`, and constructor-injected services — plus JS, SQL and Markdown. It does **not** cover hooks in `*.module` / `*.theme` / `*.install` (those extensions are not in its dispatch table), Twig templates, or the Drupal wiring YAML (`*.info.yml`, `*.services.yml`, `*.routing.yml`, `*.component.yml`, `recipe.yml`), and it has no PHP-attribute support, so plugin-id → class never appears. Useful for "what does this service depend on"; no use for "which route hits this controller". `--deep` adds a semantic pass over docs and PDFs but does not close that gap — it builds a parallel document graph.

Third-party trees (`vendor/`, `core/`, `contrib`, `libraries`, `node_modules`) are skipped by default. On a Varbase 11 build that is the difference between 1,236 nodes in 11s and 20,618 nodes in 139s, 84% of them vendored JS. `--all` disables the skipping, `--exclude` adds more paths.

The CLI is installed on first use (`uv tool install graphifyy==0.9.28`), and it ships in the dashboard image. On the dashboard, every project row has a **Graph** button and, once a graph exists, **Open graph** and **Report** links. `graph.html` loads vis-network from unpkg.com, so it needs internet to render.

## Second storage: workspaces on another disk

A workspace without DDEV projects can live on another disk as a symlink. Set the folder on that disk in `core/config/settings.yml` (per machine, never synced):

```yaml
storage:
  second: /mnt/workspace-storage/workspace
```

```
bash core/scripts/storage.sh                          # status: local or second storage, links, free space
bash core/scripts/storage.sh --move videos            # copy, verify by checksum, swap to a symlink
bash core/scripts/storage.sh --remove-pre-move videos # free the kept local copy
bash core/scripts/storage.sh --back videos            # the reverse; the drive copy is kept
bash core/scripts/storage.sh --mounts                 # let the dashboard container follow the links
bash core/scripts/storage.sh --relink --mounts        # after the drive got a new mount point
```

`--mounts` writes `core/workspace-app/.ddev/docker-compose.second-storage.yaml`; restart the dashboard (`ddev restart` in `core/workspace-app`) when it says so, once no build is running. `--dry-run` says what would happen. On a `/run/media` automount, the status prints an fstab line by UUID to a fixed mount point: run it with sudo yourself.

## Removing / backing up a project

```
cd ~/workspace/dev/
bash cmd-tools-remove.sh myproject
bash cmd-tools-backup-dev.sh myproject
```

`cmd-tools-remove.sh` runs `ddev delete -y -O` before removing the folder. `cmd-tools-backup-*.sh` tars the project folder and runs `ddev export-db` for the database dump — no host MySQL client involved.

## Add your own commands

The dashboard's **Commands** page (`/commands`, in the rail) is where commands are added, and most need no script at all.

### A command

A command is one line and what it runs on: a workspace folder, a project, a folder or a file. Add one from **Commands → New**, or in `core/config/commands.yml`. The built-in commands ship in `core/workspace-app/commands/defaults.yml`, and one of yours with a built-in id replaces it.

```yaml
commands:
  - id: rebuild-caches
    label: Rebuild caches
    group: Drupal
    on: project                    # workspace | project | folder | file
    when: [ddev, composer]         # which folders it is for; ! negates, workspace:<name> names one
    run: ddev drush cr
  - id: php-lint
    label: Check PHP syntax
    on: file
    when: [ddev]
    run: ddev exec --dir /var/www/html php -l {{file}}
  - id: switch-to-branch
    label: Switch to a branch
    on: project
    when: [git]
    confirm: true                  # ask in a dialog before it runs
    options:
      - { name: branch, value: main, regex: '^[A-Za-z0-9._/-]+$', required: true }
    run: git fetch --prune && git switch {{opt.branch}}
```

A line gets values only as `{{workspace}}`, `{{project}}`, `{{folder}}`, `{{file}}`, `{{path}}` and `{{opt.<name>}}`, each single-quoted for you, and it cannot contain `$` or a backtick. **Run** asks for the workspace, the project and the folder or file, and runs the command in a screen session. **Definition** shows your commands as YAML, and **Check** says what loading a pasted list would change.

### A script, when one line is not enough

**Commands → New → New script** (or **Generate a script with AI**) scaffolds a `cmd-*.sh` in the workspace folder it belongs to, and so does the CLI:

```bash
bash ~/workspace/commands/cmd-tools-commands.sh --new cmd-tools-list-sites.sh --workspace dev --label "List Sites"
```

The scaffold already has what every command needs:
- the `# workspace-name:` header that the smoke test and the Build dropdown read;
- a bootstrap that finds `core/scripts` from the script's own path, so a fresh clone needs no setup;
- the workspace's settings;
- an `argparse` block.

Write what it does (DDEV only: `ddev composer`, `ddev drush`, `ddev export-db`), then check it:

```bash
bash ~/workspace/core/scripts/tests/cmd-smoke-test.sh
```

Settings of your own go in YAML and are read as shell variables: `eval $(parse_yaml path/to/file.yml)` turns `distribution.webroot` into `$distribution_webroot`. The scripts under `dev/`, `themes/` and `profiles/` are the examples to read. Every script is listed on the Commands page with a page of its own, where **Use in a command** makes a command that calls it (`script: dev/cmd-tools-list-sites.sh`, `args: '{{project}}'`).

### On a project row

A command can go on any button of the project rows: **Add to a button** on its page, or **Use a command** under **Commands → Buttons → Add an action**. The steps of an action, kept in `core/config/row-actions.yml`, can mix command lines with `use: <command id>`:

```yaml
custom:
  - id: refresh-the-site
    label: Refresh the site
    button: ddev
    group: Drupal
    when: [ddev, composer]
    steps:
      - use: git-switch-branch
      - ddev composer install
      - use: drush-update-database
```

A used command runs on the row's project, asks for its own options, and keeps its own `when`.
