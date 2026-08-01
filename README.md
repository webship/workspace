# Webship Workspace

A Drupal development workspace that runs entirely on [DDEV](https://ddev.com) — no host-level Apache, PHP or MySQL — with a web dashboard for the whole of it.

Every project you build gets its own containers and its own database. Nothing is shared, nothing is
installed on the host, and a fresh clone works with no setup: each script locates the workspace from
its own path.

What it is for, in one line each:

- **Build** a Drupal, Drupal CMS or Webship site from a single command, or from a dropdown.
- **Test** it with [webship-js](https://github.com/webship/webship-js) (Playwright + Cucumber-js),
  scaffolded for you and reported back into the dashboard.
- **Ask** it questions — a project's code as a queryable knowledge graph, its prose and config as a
  searchable index, and an AI assistant on every page that can build, start and back things up.
- **Release** the modules, themes and distributions the workspace holds.

## Layout

Each of the folders below holds a set of `cmd-*.sh` scripts. Running one builds a fresh Drupal project into a subdirectory named after the project, wired up with its own DDEV environment (own containers, own database — nothing shared on the host).

```
    ~/workspace/products    Custom distributions/profiles base code
    ~/workspace/dev         Development, enhancements, and optimization work
    ~/workspace/test        Testing and functional automated testing
    ~/workspace/demos       Demo templates and default content
    ~/workspace/sandboxes   Private custom content templates
    ~/workspace/projects    Development on a project based on a distribution/profile
    ~/workspace/profiles    Other contrib or private installation profiles
    ~/workspace/themes      Other contrib or private themes
    ~/workspace/modules     Other contrib or private modules
    ~/workspace/libraries   Other contrib or private libraries
    ~/workspace/docs        Documentation projects/repos
    ~/workspace/agents      AI agent definition repos
    ~/workspace/skills      AI skill definition repos
    ~/workspace/designs     Design instances, sources and exports
    ~/workspace/graphs      Knowledge graphs of a project's code
    ~/workspace/rag         Vector databases and project RAG indexes
    ~/workspace/recipes     Drupal recipe packages
    ~/workspace/prompts     Reusable AI prompts
    ~/workspace/specs       Structured prompts and specifications
    ~/workspace/videos      Screen recordings and their posters
    ~/workspace/worklogs    Dated session worklogs
```

`agents`, `skills`, `prompts`, `docs`, `specs`, `videos` and `worklogs` hold **files** rather than
projects: markdown items you can write and edit in the dashboard, and install into
`~/.claude/{agents,skills,commands}`.

### `core/`

Where the shared configs and script libraries live.

```
    ~/workspace/core/scripts
    ~/workspace/core/config
```

## Setup

```
git clone --branch '1.0.x' https://github.com/webship/workspace.git ~/workspace
cd ~/workspace
```

That's the whole setup. There is nothing to install and no shell variables to export: every script locates the workspace from its own path, so the clone works for the user running it, wherever it lives — `~/workspace`, `/srv/workspace`, a second checkout side by side.

```
cd ~/workspace/dev
bash cmd-webship11-0-x-project.sh webship11c1 --install
```

Set your own webmaster account and any extras in the settings file:
```
vim ~/workspace/core/config/settings.yml
```

```yaml
account:
  name: webmaster
  pass: CHANGE_ME
  mail: info@webship.co

# How the dashboard looks: the palette, the marks, and what a list does before it pages.
style:
  workspace_name: Workspace
  theme: default          # a directory under core/workspace-app/public/themes
  mode: light             # light | dark | system — the half of the theme you see first
  page_size: 50
  page_sort: newest

# The assistant panel. Voice is a preference about the room you work in.
assistant:
  voice_input: true
  voice_output: true
  intro: true

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
  - designs
  - graphs
  - rag
  - agents
  - skills
  - prompts
  - docs
  - specs
  - videos
  - worklogs
```

Keep real passwords and API keys in your own copy — never commit them back.

No paths are listed: `root`, `path`, `scripts`, `config` and `backups` are derived from the checkout (`backups/` is created on first run). Add them to `settings.yml`, or export `WORKSPACE_ROOT` / `_PATH` / `_SCRIPTS` / `_CONFIG`, only to point the tooling somewhere else.

There is no `database:` section either: every DDEV project manages its own isolated database, and DDEV's `settings.ddev.php` owns the connection.

Make sure [DDEV](https://ddev.readthedocs.io/en/stable/users/install/) and Docker are installed — that's the only runtime dependency now; there's nothing to install at the OS/package level.

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
[`core/workspace-app/README.md`](core/workspace-app/README.md) for details
(including the one per-machine docker-group tweak).

### Domains

The dashboard manages a hierarchical domain scheme by default:

- `https://workspace.ddev.site` — the dashboard home
- `https://<workspace>.workspace.ddev.site` — that workspace's page
  (e.g. `dev.workspace.ddev.site`, `test.workspace.ddev.site`)
- `https://<project>.<workspace>.workspace.ddev.site` — the project's real
  site (e.g. `webship11demo.dev.workspace.ddev.site`); the **Launch**
  button uses these, and the canonical `https://<project>.ddev.site`
  always keeps working

No per-project configuration is needed — wildcard hostnames + an nginx
tier in `core/workspace-app/.ddev/` route everything with valid TLS.

All navigation links and the Launch buttons follow this scheme by
default. The hub base domain is configurable (`hub_domain:` in
`core/config/settings.yml`) — the same system is designed to run as one
**remote development workspace hub on a public domain**, e.g.
`workspace.example.com` → `dev.workspace.example.com` →
`myproject.dev.workspace.example.com` (add matching `additional_fqdns`,
DNS wildcards, and nginx server_names).

### Examples

Things you can do from the dashboard UI:

- `/dev` → pick **"Drupal 11.4.0 (recommended project)"** from the Build
  dropdown, name it `blog1`, press **Build** — and watch the real terminal
  output stream until the site is installed at `https://blog1.ddev.site`.
- Every project row carries four menus — **DDEV** (start, stop, launch, restart,
  describe, logs, cache rebuild, login link, database export), **Graph**,
  **RAG**, and **More** (tests, backup, remove). Each reports real state: a
  stopped site is not offered a login link, and an unmapped project is only
  offered "Build the graph".
- `/dev/backups` to **Restore** an archive (files + automatic DB import).
- `/agents` → **Generate with AI** → describe the agent you want; then
  **Install** it into `~/.claude/agents/` for Claude Code.
- `/docs` → write a doc, press **PDF** or **HTML** to render it, or
  **Screenshot a site** to capture any URL into `docs/`.

Things you can ask the Workspace AI Assistant (it really does them):

- "Build a Drupal 11.4 site named d114test"
- "Create a Drupal CMS 2.1 site called cms1"
- "Create a Webship 11 project called demo1 and open it"
- "can you back up my d114test site please, then show me the backups page"
- "what's running right now?"
- "Generate an agent that reviews cmd- scripts and save it as cmd-linter"
- "Write a doc about demo1 and make a PDF"


### Themes

The dashboard's stylesheet is assembled per request: a base layer, one file per component, then a
theme. A theme is a single file that sets the tokens every component asks for, in both halves —
dark is not a separate theme, it is the other half of the one you picked, which is why the toggle
keeps working across all of them.

```
core/workspace-app/public/
  css/base.css              structure — names no colour of its own
  css/components/*.css      one file per component
  themes/<name>/theme.css   the palette, light and dark
  themes/<name>/logo.svg    optional: a mark drawn for that palette
```

Three ship — **Default**, **Slate**, **Ember** — and `style.theme` picks one. Adding a fourth is
adding a directory: the settings dropdown is built from what is on disk.

A theme may carry its own `logo.svg`, `logo-dark.svg` and `favicon.*`. A mark drawn for a purple
dashboard is wrong on an amber one, so the logo travels with the palette unless `style.logo` names
something else.

### Testing the dashboard itself

```
cd ~/workspace/core/workspace-app
ddev test-dashboard            # both halves
ddev test-dashboard unit       # just the fast one
ddev test-dashboard browser    # just webship-js
```

Two layers, both **inside DDEV**, because that is where the dashboard runs:

- **Unit** — `node --test`, no dependencies. The list state, the theme assembly, and the action
  registry, including the assertion that every path the interface posts to has a handler.
- **Browser** — [webship-js](https://github.com/webship/webship-js) (Playwright + Cucumber-js), the
  same stack the workspace scaffolds for every project it builds. The features are read-only: a
  suite that mutates a working machine is one nobody runs twice.

## Building a project

```
cd ~/workspace/dev/
bash cmd-drupal11-0-x-recommended-project.sh drupal11c1 --install
```

### Webship 11.0.0 distribution, for example:
```
cd ~/workspace/dev/
bash cmd-webship11-0-0-project.sh webship11c1 --install --add-users
```

Each of these scripts creates the project folder, runs `ddev config` + `ddev start`, then `ddev composer create-project` and `ddev drush site:install` inside that project's own containers.

## Removing / backing up a project

```
cd ~/workspace/dev/
bash cmd-tools-remove.sh myproject
bash cmd-tools-backup-dev.sh myproject
```

`cmd-tools-remove.sh` runs `ddev delete -y -O` before removing the folder. `cmd-tools-backup-*.sh` tars the project folder and runs `ddev export-db` for the database dump — no host MySQL client involved.

## Create your own custom script

```
cd ~/workspace/dev/
vim cmd-example.sh
```

```bash
#!/bin/usr/env bash

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.dev.settings.yml);

echo "*---------------------------------------------------------------------------------------*";
echo "|  Build a Drupal project via DDEV";
echo "*---------------------------------------------------------------------------------------*";
```

Have your own YAML files, read them in as arrays of variables, and use them however you like:
```
eval $(parse_yaml ${path_to_the_yml_file}/name-of-file.yml);
```

Have a look at the other `cmd-*.sh` scripts under `themes/`, `profiles/`, or `test/` for more examples — use whatever naming or scripting style works for you.
