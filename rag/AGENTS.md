# RAG

The Milvus vector database, and the per-project RAG indexes held in it.

Part of the **Webship Workspace** (`~/workspace`), a DDEV-only harness. The rules in the root
`CLAUDE.md` apply here too; what follows is what is specific to this folder.

## What lives here

A Milvus instance is a DDEV project like any other — start and stop it from its row. The indexes
themselves live inside Milvus, not on disk; `bindings.yml` records which instance holds which
project's index.

**Index a project from its own workspace, never from here:**

```bash
cd ~/workspace/dev && bash cmd-tools-ragify.sh <project>
```

Retrieval is BM25 by default: the database builds the vectors itself, so no model runs and nothing
leaves this machine.

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
bash cmd-milvus-backup.sh                             # Milvus (backup)
bash cmd-milvus-mcp.sh                                # Milvus (mcp)
bash cmd-milvus-project.sh                            # Milvus (vector database for RAG)
bash cmd-tools-rag.sh                                 # RAG indexes (list, search, serve over MCP)
```

Every one locates the workspace from its own path, so there is nothing to export and nothing to
install. `--help` on any of them lists its arguments.
