# Docs

Documentation, rendered to HTML and PDF.

This folder is part of the **Webship Workspace** (`~/workspace`), a DDEV-only harness. Everything
here is driven by the `cmd-*.sh` scripts in this folder — run them from here, never from the
git clone in `products/workspace`, which ships the tooling but builds nothing.

## Agent

Use the **`webship-workspace`** agent for work in this folder. It knows the build chain, the
DDEV rules and how to author a new command.

## Skills

- **`webship-workspace-dashboard`**

## Commands here

```bash
bash cmd-tool-backup-doc.sh --help
```

## Hard rules

- **DDEV only** — `ddev composer`, `ddev drush`, `ddev delete -y -O`, `ddev export-db`. Never raw
  composer, drush or mysql on the host.
- **Never write a `$databases` block into `settings.php`** — DDEV's `settings.ddev.php` owns it.
- `ddev start` accepts `-y`; **`ddev stop` does not**.
- Every `cmd-*-project.sh` carries a `# workspace-name:` header — the smoke test enforces it.
- Validate a change with `bash core/scripts/tests/cmd-smoke-test.sh`.
- **Clean up after your own work, and ASK before you do.** A file or folder you created to try
  something out is yours to clear: when the goal is met, say plainly what you made and offer to
  remove it. Never delete it unasked — the user may still want to look — and never walk away leaving
  it unmentioned either.

The full architecture is in `products/workspace/CLAUDE.md`.

**Google Drive.** `bash cmd-tools-google-drive-sync.sh` (or the **Sync to Drive** button) pushes this folder to its Google Drive folder, new and changed files only, never deleting; `--dry-run` previews and `-a register` adds the Google Drive MCP server to Claude Code. Settings: `google_drive:` in `core/config/settings.yml`.
