# Sandboxes

Throwaway experiments.

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
bash cmd-drupal11-recommended-project.sh --help
bash cmd-drupalcms2-x-educare1-0-x-project.sh --help
bash cmd-drupalcms2-x-horizonaid1-0-x-project.sh --help
bash cmd-drupalcms2-x-project.sh --help
bash cmd-drupalcms2-x-varbase_starter1-0-x-project.sh --help
bash cmd-educare1-0-x-project.sh --help
bash cmd-horizonaid1-0-x-project.sh --help
bash cmd-tools-add-users.sh --help
bash cmd-tools-backup-sandboxes.sh --help
bash cmd-tools-cancel-users.sh --help
bash cmd-tools-graphify.sh --help
bash cmd-tools-reclaim.sh --help
bash cmd-tools-remove.sh --help
bash cmd-tools-update-all.sh --help
bash cmd-tools-upsun.sh --help
bash cmd-varbase10-0-0-project.sh --help
# … and 11 more
bash cmd-wordpress-project.sh --help
bash cmd-wpbedrock1-project.sh --help
bash cmd-odoo20-project.sh --help
```

## Upsun: the demos and sandboxes here come FROM Upsun

Each project in this folder is a local copy of an Upsun environment, and each has its **own agent**
carrying its project id, environment and local path — use that rather than guessing an id:

- `upsun-varbase-sandbox-1-manager`, `upsun-educare-sandbox-1-manager`
- `upsun-horizonaid-sandbox-1-manager`, `upsun-rightup-sandbox-1-manager`
- `upsun-varbase-sandbox-1-playground-3-demo-reset`, `upsun-varbase-template-manager`

The shared mechanics are in the **`webship-workspace-upsun`** skill: getting an environment down into
DDEV, the two credentials (the dashboard needs an API token in `upsun.cli_token`; `upsun login` on
the host is not enough for it), and the pgsql rule.

**The pgsql rule, before `composer install`:** `composer.json` may `replace` `ext-pgsql` so the Upsun
runtime satisfies `drupal/ai_provider_amazeeio`, and a root package that replaces an extension cannot
coexist with that extension being present. So the DDEV web image has to match the manifest —
`.ddev/web-build/Dockerfile.nopgsql` when it replaces, no such file when it does not. Both cases
exist in this folder. No `--ignore-platform-req` flag helps, and editing `composer.json` breaks the
Upsun build.

**From the dashboard:** the project's **UPSUN** menu → **Get database & files**, which does the whole
sync in a screen session.

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
