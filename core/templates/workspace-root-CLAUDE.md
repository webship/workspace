# Webship Workspace (live tree)

This is `~/workspace` — the live Webship Workspace, where Drupal projects are actually built. It is
NOT a git repository. The tooling's repo is **github.com/webship/workspace** (branch `1.0.x`, private,
standalone), cloned at `~/workspace/products/workspace` — commits and PRs happen there, and the full
architecture reference is that clone's `CLAUDE.md`.

## The two-checkout loop

- Change tooling → edit in the clone → issue + PR → merge → then sync it here:
  `bash ~/workspace/core/scripts/sync-tooling.sh --pull`
- Update ONLY the dashboard app to a released tag (no clone needed):
  `bash core/workspace-app/scripts/update.sh --check` then without `--check` to apply.
- Dashboard changes made live are pulled back into the clone with:
  `rsync -a --delete --exclude=node_modules --exclude=actions.log ~/workspace/core/workspace-app ~/workspace/products/workspace/core/`
- `core/config/settings.yml` is NEVER synced in either direction: this live copy holds the real
  account password and API keys; the committed one ships `CHANGE_ME` placeholders.

## Layout

Workspace folders (order = dashboard card order, from `settings.yml`'s `workspaces:`): `projects`,
`demos`, `sandboxes`, `recipes`, `site-templates`, `products`, `dev`, `test`, `profiles`, `modules`,
`themes`, `libraries`, `forked`, `components`, `agents`, `skills`, `prompts`, `graphs`, `rag`,
`docs`. Each holds
`cmd-*.sh` commands plus what it builds. `core/` holds the shared scripts, config and the dashboard.

**No setup step and no environment variables**: every `cmd-*.sh` locates the tooling from its own
path (`bootstrap.sh` derives `WORKSPACE_*` and exports them; exported values still win). There
is no installer and nothing in `~/.bashrc`.

## Hard rules

- **DDEV only** — `ddev composer`, `ddev drush`, `ddev delete -y -O`, `ddev export-db`. Never raw
  composer/drush/mysql on the host.
- **Never write a `$databases` block into `settings.php`** — DDEV's `settings.ddev.php` owns it.
- `ddev start` accepts `-y`; **`ddev stop` does not**.
- Validate tooling changes with `bash core/scripts/tests/cmd-smoke-test.sh` (exit code = failures;
  `--help` is safe only on argparse scripts).
- Upsun deploys are client-facing — `cmd-tools-upsun.sh <project>` is read-only by default; never
  `--push` without being asked.
- **Clean up after your own work, and ASK before you do.** A scratch site you built to check
  something, a folder or file you made to test with, a saved command output: when the goal is met,
  say plainly what you created and offer to remove it. Never delete it unasked — the user may still
  want to look at it — and never walk away leaving it unmentioned either.
- **Removing a project is a command, not `rm -rf`.** Use `bash cmd-tools-remove.sh <project>` from
  the workspace folder, or `ddev delete -y -O` inside the project. Deleting the folder alone leaves
  the DDEV registry entry, the database volume, the snapshots volume and the per-project built images
  behind — invisible until the disk is full. `products/cmd-tools-reclaim.sh` finds that debris
  afterwards, but not creating it is better.

## Web dashboard — https://workspace.ddev.site

`core/workspace-app` (Node + HTMX) runs in its own DDEV container with Docker-outside-of-Docker and
the docs tooling (pandoc, **weasyprint** for PDFs, **chromium** for screenshots — wkhtmltopdf is gone
from Debian trixie). Domains: `<workspace>.workspace.ddev.site` and
`<project>.<workspace>.workspace.ddev.site`; canonical `<project>.ddev.site` always works.

- Spawned commands MUST close stdin (`stdio: ['ignore','pipe','pipe']`).
- Don't restart the app while jobs run (in-memory registry). App-only restart:
  `docker exec ddev-workspace-web supervisorctl restart webextradaemons:workspace-app`; `ddev
  restart` only when `.ddev/` or the Dockerfile changed. **Never `pkill` inside the web container** —
  it shares the machine's pid namespace (screens), so a pattern match reaches host processes.

## Per-project tools (in the workspace folders)

- Build: `bash cmd-<name>-project.sh <project> [--install]` (Webship 9.1→11, Drupal 10/11 latest,
  Drupal CMS latest, Website Starter/Haven; Drupal CMS site templates live in `site-templates/`).
- `cmd-tools-backup-*.sh`, `cmd-tools-remove.sh`, `cmd-tools-add-users.sh`.
- `cmd-tools-graphify.sh <project>` — knowledge graph (local AST; maps PHP under `src/`, not hooks,
  Twig or `*.yml` wiring).
- `cmd-tools-ragify.sh <project>` — RAG index in the Milvus instance at `rag/milvus/` (BM25 inside
  the database, no key, nothing leaves the machine). Covers what graphify does not: Markdown, Twig,
  `*.yml`, `*.module` hooks. Read it with `rag/cmd-tools-rag.sh`, or over MCP after
  `rag/cmd-milvus-mcp.sh -a register`.
- `cmd-tools-upsun.sh <project>` — the DDEV ⇄ Upsun bridge (dev, test, sandboxes, demos, projects).

## Session docs

- `docs/webship-workspace-structure-study-2026-07-27.md` — structure study (DDEV + Upsun).
- `docs/workspace-tips-and-rules.md` — distilled rules + tips (synced from the clone).

## Working out where you are

Claude Code loads every `CLAUDE.md` between the working directory and the filesystem
root, so a session started **anywhere** under `~/workspace` — a project, its docroot, a
module three levels inside it — gets this file plus the workspace folder's own.

Before doing anything in this tree, place yourself:

1. **Which workspace?** It is the first path segment under `~/workspace`:
   `~/workspace/<workspace>/<project>/…`. `pwd` answers it.
2. **Read that folder's `AGENTS.md`** — it names the skills that apply there and lists
   the `cmd-*.sh` that folder actually ships. Each workspace differs: `upsun` only
   applies in `projects`, `demos` and `sandboxes`; `authoring` only in `agents`,
   `skills` and `prompts`.
3. **Use the `webship-workspace` agent** for anything that builds, installs, backs up,
   removes or maps a project. It knows the build chain and the DDEV rules.
4. **Run `cmd-*.sh` from the workspace folder**, never from the git clone in
   `products/workspace` — that clone ships the tooling and builds nothing.
5. **If the project has a `graphify-out/`**, its own `CLAUDE.md` says so: query the
   graph before grepping the tree, and read what it does *not* cover before trusting
   an empty answer.

These rules hold at any depth. Being inside
`dev/myproject/web/modules/custom/thing` does not make you outside the `dev`
workspace, and DDEV-only still applies.
