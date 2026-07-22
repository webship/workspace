# Webship Workspace

Helps Drupal developers manage the base-code development work cycle for custom recipes/distributions/profiles/starter-kit templates, on top of [DDEV](https://ddev.com) — no host-level Apache, PHP, or MySQL required.

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
    ~/workspace/forked      Forked/customized copies of any of the above
    ~/workspace/docs        Documentation projects/repos
    ~/workspace/agents      AI agent definition repos
    ~/workspace/skills      AI skill definition repos
    ~/workspace/recipes     Drupal recipe packages
    ~/workspace/components  Reusable SDC/component library repos
```

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

Edit the settings file for your system:
```
vim ~/workspace/core/config/settings.yml
```

You'll see something like:
```yaml
root: /home/YOUR_USER/workspace
path: /home/YOUR_USER/workspace/core
scripts: /home/YOUR_USER/workspace/core/scripts
config: /home/YOUR_USER/workspace/core/config
host: 127.0.0.1
web: http://127.0.0.1/core
protocol: http
backups: /home/YOUR_USER/workspace/backups
database:
  username: root
  password: CHANGE_ME
  host: localhost
  port: 3306
  namespace: Drupal\\Core\\Database\\Driver\\mysql
  driver: mysql
  collation: utf8mb4_general_ci
account:
  name: DRUPAL_WEBMASTER_NAME
  pass: DRUPAL_WEBMASTER_PASSWORD
  mail: DRUPAL_WEBMASTER_EMAIL
config_sync_directory: ../config/sync
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
  - forked
  - docs
  - agents
  - skills
  - recipes
  - components
```

`database.*` is no longer used by the build scripts (each DDEV project manages its own isolated database), but is kept for anything custom you add that still needs those values.

Install the global shell variables:
```
cd ~/workspace/core/scripts/install
bash install.sh
```

Close all terminal windows and open a new one. Test that it's ready:
```
echo ${WEBSHIP_WORKSPACE_CONFIG}
```
It should print `~/workspace/core/config`.

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
  site (e.g. `varbase11demo.dev.workspace.ddev.site`); the **Launch**
  button uses these, and the canonical `https://<project>.ddev.site`
  always keeps working

No per-project configuration is needed — wildcard hostnames + an nginx
tier in `core/workspace-app/.ddev/` route everything with valid TLS.

### Examples

Things you can do from the dashboard UI:

- `/dev` → pick **"Drupal 11.4.0 (recommended project)"** from the Build
  dropdown, name it `blog1`, press **Build** — and watch the real terminal
  output stream until the site is installed at `https://blog1.ddev.site`.
- Press **Stop** / **Start** / **Launch** on any project row (buttons follow
  the live DDEV status), **Backup** to archive it, or open
  `/dev/backups` to **Restore** an archive (files + automatic DB import).
- `/agents` → **Generate with AI** → describe the agent you want; then
  **Install** it into `~/.claude/agents/` for Claude Code.
- `/docs` → write a doc, press **PDF** or **HTML** to render it, or
  **Screenshot a site** to capture any URL into `docs/`.

Things you can ask the Workspace AI Assistant (it really does them):

- "Build a Drupal 11.4 site named d114test"
- "Create a Drupal CMS 2.1 site called cms1"
- "Create a Varbase 11 project called demo1 and open it"
- "can you back up my d114test site please, then show me the backups page"
- "what's running right now?"
- "Generate an agent that reviews cmd- scripts and save it as cmd-linter"
- "Write a doc about demo1 and make a PDF"


## Building a project

```
cd ~/workspace/dev/
bash cmd-drupal11-0-x-recommended-project.sh drupal11c1 --install
```

### Varbase 10.1.x distribution, for example:
```
cd ~/workspace/dev/
bash cmd-varbase10-1-x-project.sh varbase10c1 --install --add-users
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
source ${WEBSHIP_WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WEBSHIP_WORKSPACE_CONFIG}/workspace.dev.settings.yml);

echo "*---------------------------------------------------------------------------------------*";
echo "|  Build a Drupal project via DDEV";
echo "*---------------------------------------------------------------------------------------*";
```

Have your own YAML files, read them in as arrays of variables, and use them however you like:
```
eval $(parse_yaml ${path_to_the_yml_file}/name-of-file.yml);
```

Have a look at the other `cmd-*.sh` scripts under `themes/`, `profiles/`, or `test/` for more examples — use whatever naming or scripting style works for you.
