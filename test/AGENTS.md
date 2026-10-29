# Test

Test sites, including the automated-testing builders.

This folder is part of the **Webship Workspace** (`~/workspace`), a DDEV-only harness. Everything
here is driven by the `cmd-*.sh` scripts in this folder — run them from here, never from the
git clone in `products/workspace`, which ships the tooling but builds nothing.

## Agent

Use the **`webship-workspace`** agent for work in this folder. It knows the build chain, the
DDEV rules and how to author a new command.

## Skills

- **`webship-workspace-build`**
- **`webship-workspace-backups`**
- **`webship-workspace-upsun`**
- **`webship-workspace-graphify`**

## Commands here

```bash
bash cmd-automated-testing-educare1-0-x-project.sh --help
bash cmd-automated-testing-horizonaid1-0-x-project.sh --help
bash cmd-automated-testing-varbase10-1-x-project.sh --help
bash cmd-automated-testing-varbase11-0-x-project.sh --help
bash cmd-automated-testing-varbase9-2-x-project.sh --help
bash cmd-drupal11-recommended-project.sh --help
bash cmd-drupalcms2-x-educare1-0-x-project.sh --help
bash cmd-drupalcms2-x-horizonaid1-0-x-project.sh --help
bash cmd-drupalcms2-x-project.sh --help
bash cmd-drupalcms2-x-varbase_starter1-0-x-project.sh --help
bash cmd-educare1-0-x-project.sh --help
bash cmd-horizonaid1-0-x-project.sh --help
bash cmd-tools-add-users.sh --help
bash cmd-tools-backup-test.sh --help
bash cmd-tools-cancel-users.sh --help
# … and 8 more
bash cmd-wordpress-project.sh --help
bash cmd-wpbedrock1-project.sh --help
bash cmd-odoo20-project.sh --help
```

## Hard rules

- **DDEV only** — `ddev composer`, `ddev drush`, `ddev delete -y -O`, `ddev export-db`. Never raw
  composer, drush or mysql on the host.
- **Never write a `$databases` block into `settings.php`** — DDEV's `settings.ddev.php` owns it.
- `ddev start` accepts `-y`; **`ddev stop` does not**.
- Every `cmd-*-project.sh` carries a `# workspace-name:` header — the smoke test enforces it.
- Validate a change with `bash core/scripts/tests/cmd-smoke-test.sh`.
- **Clean up after your own work, and ASK before you do.** A scratch project you built to check
  something, a folder or file you made to test with: when the goal is met, say plainly what you
  created and offer to remove it. Never delete it unasked — the user may still want to look — and
  never walk away leaving it unmentioned either.
- **Removing a project is a command, not `rm -rf`.** `bash cmd-tools-remove.sh <project>` from this
  folder, or `ddev delete -y -O` inside the project. Deleting the folder alone leaves the DDEV
  registry entry, the database volume, the snapshots volume and the per-project built images behind —
  invisible until the disk is full. `cmd-tools-reclaim.sh` in this folder finds that debris afterwards, but
  not creating it is better.

The full architecture is in `products/workspace/CLAUDE.md`.

**Google Drive.** `bash cmd-tools-google-drive-sync.sh` (or the **Sync test reports** button) pushes the test reports, failure screenshots and recordings of each project (not the projects) to the `test` folder of your Drive, as `<project>/<module>/reports|screenshots|videos`; new and changed files only, never deleting. `--dry-run` previews, `--item <project>` pushes one project. Settings: `google_drive:` in `core/config/settings.yml`.
