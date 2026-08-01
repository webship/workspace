# Themes

Contrib and private themes, checked out to work on.

Part of the **Webship Workspace** (`~/workspace`), a DDEV-only harness. The rules in the root
`CLAUDE.md` apply here too; what follows is what is specific to this folder.

## The rule that matters here

Everything goes through DDEV. Never a host `composer`, `drush` or `mysql`:

```bash
ddev composer require drupal/something
ddev drush cr
ddev export-db --file=…        # not mysqldump
ddev delete -y -O              # not a dropped database
```

`ddev start` takes `-y`; **`ddev stop` does not**. Never write a `$databases` block into
`settings.php` — DDEV's `settings.ddev.php` owns the connection.

## Commands here

```bash
bash cmd-all-back-end-build-themes.sh
bash cmd-all-back-end-install-themes.sh
bash cmd-all-front-end-build-themes.sh
bash cmd-all-front-end-install-themes.sh
bash cmd-backup-theme.sh                              # Bootstrap.
bash cmd-build-admin-theme.sh                         # Bootstrap.
bash cmd-build-drupal-template.sh
bash cmd-build-theme.sh                               # Bootstrap.
bash cmd-install-admin-theme.sh                       # Bootstrap.
bash cmd-install-theme.sh                             # Bootstrap.
bash cmd-tools-graphify.sh                            # Map a project in this workspace into a queryable knowledge graph with
bash cmd-tools-ragify.sh                              # Index a project in this workspace into the Milvus vector database
bash cmd-tools-remove.sh                              # Bootstrap.
bash cmd-tools-update-all.sh                          # Find the workspace tooling from this script, so a fresh clone needs no setup.
```

Every one locates the workspace from its own path, so there is nothing to export and nothing to
install. `--help` on any of them lists its arguments.
