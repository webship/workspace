# Projects

Client projects — a site built on a distribution rather than the distribution itself.

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
bash cmd-tool-backup-project.sh                       # Bootstrap.
bash cmd-tool-git-change-filemode-to-false.sh         # Bootstrap.
bash cmd-tools-graphify.sh                            # Map a project in this workspace into a queryable knowledge graph with
bash cmd-tools-obsidian.sh                             # Turn a project graph into an Obsidian vault
bash cmd-tools-ragify.sh                              # Index a project in this workspace into the Milvus vector database
bash cmd-tools-remove.sh                              # Bootstrap.
bash cmd-tools-testing.sh                             # Set up the automated-testing environment on an existing project in this workspace, or run its
```

Every one locates the workspace from its own path, so there is nothing to export and nothing to
install. `--help` on any of them lists its arguments.
