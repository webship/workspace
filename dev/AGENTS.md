# Dev

Day-to-day development builds. Where a site gets made to try something on.

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
bash cmd-drupal10-3-x-recommended-project.sh          # Drupal 10.3.x (recommended project)
bash cmd-drupal10-recommended-project.sh              # Drupal 10 (recommended project)
bash cmd-drupal11-0-x-recommended-project.sh          # Drupal 11.0.x (recommended project)
bash cmd-drupal11-4-0-recommended-project.sh          # Drupal 11.4.0 (recommended project)
bash cmd-drupal11-4-x-recommended-project.sh          # Drupal 11.4.x (recommended project)
bash cmd-drupal11-recommended-project.sh              # Drupal 11 (recommended project)
bash cmd-drupal9-recommended-project.sh               # Drupal 9 (recommended project)
bash cmd-drupalcms2-1-0-project.sh                    # Drupal CMS 2.1.0
bash cmd-drupalcms2-x-project.sh                      # Drupal CMS 2.x
bash cmd-tools-add-users.sh                           # Bootstrap.
bash cmd-tools-backup-dev.sh                          # Bootstrap.
bash cmd-tools-cancel-users.sh                        # Bootstrap.
bash cmd-tools-git-change-filemode-to-false.sh        # Bootstrap.
bash cmd-tools-graphify.sh                            # Map a project in this workspace into a queryable knowledge graph with
bash cmd-tools-ragify.sh                              # Index a project in this workspace into the Milvus vector database
bash cmd-tools-remove.sh                              # Bootstrap.
bash cmd-tools-testing.sh                             # Set up the automated-testing environment on an existing project in this workspace, or run its
bash cmd-tools-update-all.sh                          # Bootstrap.
bash cmd-webship11-0-0-project.sh                     # Webship 11.0.0
bash cmd-webship11-0-x-project.sh                     # Webship 11.0.x
bash cmd-webships2-0-0-project.sh                     # Webships 2.0.0
bash cmd-webships2-0-x-project.sh                     # Webships 2.0.x
```

Every one locates the workspace from its own path, so there is nothing to export and nothing to
install. `--help` on any of them lists its arguments.
