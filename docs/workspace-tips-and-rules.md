# Workspace Tips & Rules

Working rules for `~/workspace`, the dashboard at https://workspace.ddev.site,
and the repo github.com/webship/workspace (branch `1.0.x`).

## Hard rules

1. **DDEV-only.** Never raw `composer`/`drush`/`mysql` on the host — always
   `ddev composer`, `ddev drush`, `ddev delete -y -O`, `ddev export-db`.
2. **DDEV owns the database connection.** Never write a `$databases` block
   into `settings.php` — DDEV's `settings.ddev.php` include handles it.
   (`set_default_settings` only ensures `config_sync_directory`.)
3. **`ddev start` takes `-y`; `ddev stop` does not.**
4. **Close stdin on programmatic ddev calls.** `docker exec -i` hangs
   forever on an open-but-silent stdin pipe — spawn with stdin `'ignore'`.
5. **Don't restart the dashboard app while jobs run.** The job registry is
   in-memory; a restart orphans running builds mid-flight.
6. **Every `cmd-*-project.sh` builder needs a `# workspace-name:` header** —
   it's the label the Build dropdown shows.
7. **Only projects are called projects.** Each workspace names its items
   (agents, skills, prompts, docs, modules, themes, …) via the
   PRESENTATION table in `workspaces.js`.
8. **The repo ships team-installable configs**: `/home/YOUR_USER` paths and
   `CHANGE_ME` passwords in the mirror — never push personal values;
   `node_modules/` and `actions.log` stay ignored.
9. **Destructive dashboard actions use two-step arm/confirm** (no modals,
   no `confirm()` popups) and are recorded in `actions.log`.
10. Before running the smoke tests: `bash core/scripts/tests/cmd-smoke-test.sh`
    (218 scripts; exit code = failures; `--help` execution is safe only for
    argparse scripts — never "test" non-argparse scripts by running them).

## Tips

- The dashboard reads `settings.yml`'s `workspaces:` list, the
  `workspace.<name>.settings.yml` files, and the script folders **live** —
  add a workspace or a builder script and it appears without code changes
  or restarts. Card order = list order.
- The assistant runs `claude -p` inside the container with agent powers
  (Bash/Read/Glob/Grep; Write/Edit disallowed; never deletes unasked); it
  gets the current page's live projects/builders/backups injected per
  message, and steers the browser with NAVIGATE/OPEN/REFRESH lines.
- Install targets from the UI: agents → `~/.claude/agents/`, skills →
  `~/.claude/skills/<name>/SKILL.md`, prompts → `~/.claude/commands/`
  (usable as `/<name>`). Restart Claude Code sessions to pick new ones up.
- Docs tooling in the container: `pandoc x.md -o x.pdf
  --pdf-engine=wkhtmltopdf`, `pandoc x.md -o x.html --standalone`,
  `wkhtmltoimage --width 1440 <url> shot.png`.
- Backups live at `~/workspace/backups/<workspace>/` as
  `<ws>---<project>--<stamp>.tar.gz` (+ optional `-db.sql(.gz)`); Restore
  extracts and auto-imports the DB for DDEV projects; it refuses to
  overwrite an existing project dir.
- Cold-cache `composer create-project` can take 15+ minutes — build jobs
  get 60; watch the live terminal box rather than assuming a hang.
- Per-machine setup for the dashboard: docker group GID in
  `.ddev/web-build/Dockerfile.workspace-app` (`getent group docker`), and
  a logged-in host `claude` CLI for the chat.
- Stale ddev registry entries ("project directory missing") come from
  pre-migration paths — `ddev stop --unlist <name>`.
- Dark mode: toolbar toggle, light default, persisted in localStorage.
