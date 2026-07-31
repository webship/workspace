# Webship Workspace

This is `~/workspace` — the Drupal development workspace for Webship/VDO-style projects. Previously lived at `/var/www/html` under a LAMP stack; now DDEV-only (no host Apache, PHP, or MySQL).

## Layout

- `core/` — shared tooling: `core/scripts` (bootstrap + build functions + `core/scripts/tests/cmd-smoke-test.sh`), `core/config` (`settings.yml` + `workspace.*.settings.yml` + `distributions/*.yml`), `core/workspace-app` (the web dashboard).
- Workspace folders (driven by `settings.yml`'s `workspaces:` list, in display order): `agents/`, `skills/`, `prompts/`, `docs/`, `products/`, `dev/`, `test/`, `demos/`, `sandboxes/`, `profiles/`, `modules/`, `themes/`, `libraries/`, `forked/`, `recipes/`, `components/` — each holds `cmd-*.sh` scripts plus built content. `components/` = Drupal SDC, React, Drupal Canvas code, HTMX and web components. `agents/`/`skills/`/`prompts/`/`docs/` are file-item workspaces (markdown items, editable from the dashboard, installable into `~/.claude/{agents,skills,commands}`).

## Web dashboard — https://workspace.ddev.site

`core/workspace-app`: basic Node.js (`node:http`) + HTMX + UIKit (vendored), running INSIDE its DDEV web container with Docker-outside-of-Docker (host docker.sock + `~/workspace` + `~/.claude` bind-mounted; docker, ddev, claude, pandoc, wkhtmltopdf in the image). It builds/starts/stops/backs-up/restores/removes real projects via the `cmd-*.sh` scripts with live streaming terminal output, and embeds the **Workspace AI Assistant** (full-height left sidebar on every page): `claude -p` in agent mode with per-page live context, steering the UI via NAVIGATE/OPEN/REFRESH directives. All actions append to `core/workspace-app/actions.log` (gitignored).

Critical dashboard rules:
- Spawned commands MUST close stdin (`stdio: ['ignore','pipe','pipe']`) — ddev's `docker exec -i` hangs forever on an open stdin pipe.
- Don't restart the node app while jobs run (in-memory job registry; running builds get orphaned). Restart with: `docker exec ddev-workspace-web sh -c 'pkill -f "node server.js"'` (supervisord respawns it).
- Per-machine: docker group GID in `.ddev/web-build/Dockerfile.workspace-app`; host `claude` login for chat.

## Workspace location (self-locating, no setup)

Every `cmd-*.sh` resolves `WORKSPACE_SCRIPTS` from its own path and sources `${WORKSPACE_SCRIPTS}/bootstrap.sh`, which derives `WORKSPACE_ROOT` / `_PATH` / `_CONFIG` and loads `core/config/settings.yml` plus the relevant `workspace.<dir>.settings.yml`. A fresh clone works with no env vars and no install step; exported `WORKSPACE_*` variables (or `root`/`path`/`scripts`/`config`/`backups` in `settings.yml`) still win as overrides. `settings.yml` carries no paths and no `database:` block.

## DDEV-only workflow

All project builds go through DDEV — never raw `composer`/`drush`/`mysql` against the host:
- `ddev config --project-type=drupal --docroot=<docroot> --project-name=<name> --auto` + `ddev start` before anything else in a build.
- `ddev composer ...` / `ddev drush ...` for all package and Drupal-console operations.
- `ddev delete -y -O` instead of dropping a host database; `ddev export-db --file=...` instead of `mysqldump`.
- `ddev start` accepts `-y`; **`ddev stop` does not**.
- **Never write a `$databases` block into settings.php** — DDEV's `settings.ddev.php` owns the DB connection (`set_default_settings` only ensures `config_sync_directory`).
- Site URLs are `https://<PROJECT_NAME>.ddev.site`.

## Builders (`cmd-*-project.sh`)

Families: Drupal (9/10/10.3/11/11.0.x/11.4.x/11.4.0 recommended-project), Drupal CMS (2.1.0/2.x), Webship(s). Each builder declares its own distribution values (`distribution_name`, title, webroot, profile_repo, project_template) — there is no `core/config/distributions/` — and each distribution's default user list lives in `set_<name>_users()` in `core/scripts/functions/fun-distribution-<name>.sh`. Every builder MUST carry a `# workspace-name: <Human Name>` header (shown in the dashboard Build dropdown). `test/cmd-automated-testing-webship11-0-x-project.sh` scaffolds the full Playwright automated-testing stack. Validate everything with `bash core/scripts/tests/cmd-smoke-test.sh` (`--help` execution is safe only for argparse scripts).

## Naming

The tooling was renamed from "VDO" — no `vdo` in filenames, variables, or folder names (the VDO drop logo from drupal.org/project/vdo is the dashboard logo). `vdo_*` env vars → `WORKSPACE_*`. Only real projects are called "projects" — each workspace names its items via the PRESENTATION table in `core/workspace-app/workspaces.js` (agents, skills, prompts, docs, modules, …).

## Related repo

The reusable tooling subset (`core/` + the `cmd-*.sh`/README/`*.code-workspace` files + `core/workspace-app` without `node_modules`, none of the built project content) is mirrored to **github.com/webship/workspace** (branch `1.0.x`, the default). A local clone lives at `~/workspace/products/workspace` — sync with `rsync -a --delete --exclude=node_modules --exclude=actions.log core/workspace-app products/workspace/core/`, commit and push from there. The mirror ships team-installable configs: `/home/YOUR_USER` paths and `CHANGE_ME` passwords — never push personal values.

## Session docs

- `docs/session-worklog-2026-07-22-workspace-dashboard.md` — full worklog of the dashboard build session.
- `docs/workspace-tips-and-rules.md` — the working rules + tips distilled from it.

## Outstanding follow-ups

- Theme-build scripts (`themes/cmd-all-*-build-themes.sh`, `themes/cmd-build-drupal-template.sh`) still use raw host `composer`/`sudo chown` — not yet converted to DDEV (flag before running).
- `cmd-tools-update-all.sh` in dev/test/demos/sandboxes/profiles/themes still runs raw `composer update` — flag before running.
- Host MySQL removal (`mysql-server` package) still needs manual sudo.
- Dashboard job registry is in-memory — consider persisting jobs so app restarts don't orphan builds.
