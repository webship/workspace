# Workspace Tips & Rules

Working rules for `~/workspace`, the dashboard at https://workspace.ddev.site,
and the repo github.com/webship/workspace (branch `1.0.x`).

## Hard rules

1. **DDEV-only.** Never raw `composer`/`drush`/`mysql` on the host — always
   `ddev composer`, `ddev drush`, `ddev delete -y -O`, `ddev export-db`.
2. **DDEV owns the database connection.** Never write a `$databases` block
   into `settings.php` — DDEV's `settings.ddev.php` include handles it.
   (`set_default_settings` only ensures the config sync directory, at a fixed `../config/sync`.)
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
8. **The repo ships team-installable configs**: no machine paths (they are
   derived from the checkout) and `CHANGE_ME` / `sk-change-this`
   placeholders — never push real passwords or API keys;
   `node_modules/` and `actions.log` stay ignored.
9. **Destructive dashboard actions ask in the confirm dialog** (Wait! / Yes / No,
   naming what is about to happen) and are recorded in `actions.log`.
10. Before running the smoke tests: `bash core/scripts/tests/cmd-smoke-test.sh`
    (162 scripts; exit code = failures; `--help` execution is safe only for
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
  --pdf-engine=weasyprint`, `pandoc x.md -o x.html --standalone`,
  `chromium --headless --no-sandbox --window-size=1440,1200
  --screenshot=shot.png <url>`. wkhtmltopdf is gone: Debian trixie (the
  DDEV 1.25 base image) dropped it, and upstream abandoned it.
- Backups live at `~/workspace/backups/<workspace>/` as
  `<ws>---<project>--<stamp>.tar.gz` (+ optional `-db.sql(.gz)`); Restore
  extracts and auto-imports the DB for DDEV projects; it refuses to
  overwrite an existing project dir.
- Cold-cache `composer create-project` can take 15+ minutes — build jobs
  get 60; watch the live terminal box rather than assuming a hang.
- Short of disk? Put whole workspace folders on a second disk:
  `storage.second` in `settings.yml`, then
  `bash core/scripts/storage.sh --move <workspace>` and `--mounts`, then a
  dashboard `ddev restart`. It verifies by checksum before swapping in a
  symlink, keeps `<name>.pre-move` until `--remove-pre-move`, and refuses a
  workspace with DDEV projects. On a `/run/media` automount, use the fstab
  line `--status` prints: the udisks path can change after a reboot.
- After a PR merges, sync the tooling into the live tree with
  `bash ~/workspace/core/scripts/sync-tooling.sh --pull`
  (`--dry-run` first if unsure). It never overwrites
  `core/config/settings.yml`, which holds your real keys.
- No setup step: clone, `rm -rf .git`, run. Every `cmd-*.sh` resolves
  `WORKSPACE_SCRIPTS` from its own path and `bootstrap.sh` derives
  the rest, so the tooling follows the checkout for whoever runs it.
  `settings.yml` lists no paths; export `WORKSPACE_*` (or set them
  there) only to point somewhere else.
- Upsun per project: `bash cmd-tools-upsun.sh <project>` shows the link
  and environments (read-only); `--link <id>` / `--init` / `--push` are
  the explicit mutating verbs. Deploys are client-facing — never push
  without being asked.
- Knowledge graph per project: `bash cmd-tools-graphify.sh <project>` in
  any project workspace (or the **Graph** button on the dashboard row).
  Code-only by default — local AST, no API key — and third-party trees
  are skipped. It maps PHP classes under `src/`, JS, SQL and Markdown;
  it does NOT see hooks in `.module`/`.theme`/`.install`, Twig, or the
  `*.yml` wiring, so do not promise a full Drupal map. `extract` alone
  writes only `graph.json`; `cluster-only` writes the report and
  `graph.html`.
- The dashboard's docker GID and the local https CA are set up by
  `core/scripts/install.sh` and re-checked on every `ddev start`; nothing is a
  manual per-machine edit. `bash core/scripts/docker-gid.sh --check` and
  `bash core/scripts/trust-https.sh --check` each answer in one line.
- A dashboard where EVERY project reads as Stopped is not a status bug: it is the
  container failing to reach `docker.sock`, or having no project registry. Check
  it with `docker exec ddev-workspace-web ddev list`.
- The chat still needs a logged-in host `claude` CLI — run `claude` once on the
  host.
- Stale ddev registry entries ("project directory missing") come from
  pre-migration paths — `ddev stop --unlist <name>`.
- Dark mode: toolbar toggle, light default, persisted in localStorage.
- When testing the dashboard or its AI assistant, use natural human-like
  phrasing ("can you back up my d114test site please", "what's running?"),
  not robotic command strings — tests should prove the system understands
  people, and the workspace agents follow the same rule.
- Default domain scheme: `<workspace>.workspace.ddev.site` opens that
  workspace's dashboard page; `<project>.<workspace>.workspace.ddev.site`
  serves the project's real site (Launch uses these; canonical
  `<project>.ddev.site` keeps working). Zero per-project config.
- Cloning takes two shapes. A **copy** (rsync + a database dump) shares nothing;
  a **git worktree** (`--worktree`, offered only for a git checkout) shares one
  `.git` and one history but is still its own DDEV project with its own database.
  Three rules the worktree path lives by, each learned by running it:
  the top-level `name:` is REMOVED from the worktree's `.ddev/config.yaml` so the
  DIRECTORY names the project (leave it and the worktree collides with its
  source); the database is never shared, it travels through a dump like any other
  clone; and the git-ignored build (`vendor/`, contrib, the files directory,
  `settings.local.php`) is copied across, because git does not carry it and DDEV's
  own generated state under `.ddev/` must NOT travel — a source project's
  `traefik/certs/<source>.crt` in the clone makes every `ddev start` warn
  "unexpected #ddev-generated".
- The worktree behaviour the clone command automates is DDEV's own, documented in
  <https://ddev.com/blog/git-worktree-contributor-training/> and
  <https://rfay.github.io/git-worktree-ddev/>. Two things from those worth knowing
  beyond what the command does: `git worktree add <path>` with no branch argument
  names the branch after the DIRECTORY, and
  `ddev config global --omit-project-name-by-default` makes every NEW project
  behave the same way (no `name:` written, so the folder decides). That global is
  off on this machine and is not flipped by the tooling — it changes how `ddev
  config` behaves for every project on the machine, which is the user's call.
- `git worktree remove` deletes a worktree even when it holds commits that were
  never pushed. Remove one with `cmd-tools-remove.sh` (or the row's Remove
  button), which refuses two cases before anything is deleted: **the main
  checkout while worktrees still depend on its `.git`** (they would be left files
  with no repository at all), and **any folder holding commits on no remote or
  uncommitted changes**. `--force` is the only way past either, and a worktree's
  stale registration in the main checkout is pruned afterwards — git refuses a
  new worktree at a path whose registration still stands.
