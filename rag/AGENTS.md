# RAG

The **vector database** this workspace retrieves from, and the per-project indexes inside it:
a self-hosted **Milvus** running as a DDEV project at `rag/milvus/`, with one collection per
indexed project — `ws_<workspace>_<project>`.

This folder is part of the **Webship Workspace** (`~/workspace`), a DDEV-only harness.

## What this is for, next to `graphs/`

They are complements, and the split is the whole point:

| | `graphs/` (graphify) | `rag/` (Milvus) |
|---|---|---|
| Reads | PHP/JS **code**, parsed with tree-sitter | the **text** of the tree |
| Covers | classes, methods, extends/implements, injected services | Markdown, Twig, `*.yml`, `*.module` hooks, README, CHANGELOG — everything graphify classifies as a document and never reads |
| Answers | "what injects this service", "what extends this class" | "where is this explained", "which template renders that", "what does the recipe set" |
| Result | a `graph.json` file per project | rows in Milvus |

If a question is about structure, ask the graph. If it is about wording, configuration or prose,
ask the index.

## Agent

Use the **`webship-workspace`** agent.

## The database

One DDEV project, four containers plus DDEV's own: Milvus standalone, etcd (metadata), MinIO
(segments) and Attu (the UI). Since Milvus 2.6 the write-ahead log is the built-in **Woodpecker**,
so there is no Pulsar or Kafka — that is what makes standalone viable on a laptop.

```bash
bash cmd-milvus-project.sh                 # build/start the default instance, named milvus
bash cmd-milvus-project.sh milvus --force  # rebuild — DELETES every collection in it
bash cmd-milvus-backup.sh                  # archive etcd + MinIO + data, with a collection manifest
cd milvus && ddev start                    # just start it again
```

| What | Where |
|---|---|
| Attu, the web UI | <https://milvus.rag.workspace.ddev.site> |
| Milvus WebUI | <https://milvus.rag.workspace.ddev.site/webui/> |
| REST API | `https://milvus.rag.workspace.ddev.site/v2/vectordb/...` |
| MinIO console | <https://milvus.rag.workspace.ddev.site/minio/> (minioadmin / minioadmin) |
| gRPC, for pymilvus / MCP / LangChain | `http://127.0.0.1:19530` |

The gRPC port is the one thing here published on the host. It has to be: the DDEV router
terminates HTTP(S) only, and every real Milvus client speaks gRPC. Everything that *can* go
through the router does.

## Building an index

From the project's own workspace folder, never from here — same rule as graphify:

```bash
cd ~/workspace/<workspace> && bash cmd-tools-ragify.sh <project>
cd ~/workspace/products    && bash cmd-tools-ragify.sh ai_penpot
cd ~/workspace/dev         && bash cmd-tools-ragify.sh myproject --scope custom
```

Retrieval is **BM25**, built by Milvus's own function inside the database: no embedding model, no
API key, nothing leaves this machine. `--embedding openai` adds a dense vector per chunk from the
OpenAI API and searches dense + sparse together with reciprocal rank fusion — better on
paraphrase, and the only mode that sends content anywhere.

A re-index **replaces** its collection, which is what keeps a deleted file from staying findable.
`--append` adds instead.

## Commands here

```bash
bash cmd-tools-rag.sh                                     # every index: collection, chunks
bash cmd-tools-rag.sh products/ai_penpot -a info
bash cmd-tools-rag.sh products/ai_penpot -a search -q "how does the access token authenticate"
bash cmd-tools-rag.sh products/ai_penpot -a remove        # drop one (it is regenerable)
bash cmd-milvus-mcp.sh -a register                        # give the database to the Claude Code CLI
bash cmd-milvus-mcp.sh -a status
bash cmd-milvus-mcp.sh -a unregister
```

You can also ask from the project's own folder, without changing directory:

```bash
cd ~/workspace/products && bash cmd-tools-ragify.sh ai_penpot --query "where is the token stored"
```

## Claude Code CLI access

Both work, and they are for different things.

**MCP (stdio).** `bash cmd-milvus-mcp.sh -a register` adds `rag-milvus` to the CLI's user scope,
running `zilliztech/mcp-server-milvus` through `uvx`. One registration covers the **whole
database** — its tools list and search every collection — so a new index needs no new
registration. Open a NEW session to see the 13 tools: `milvus_list_collections`,
`milvus_text_search`, `milvus_vector_search`, `milvus_hybrid_search`, `milvus_query`,
`milvus_get_collection_info`, `milvus_create_collection`, `milvus_insert_data`,
`milvus_delete_entities`, `milvus_load_collection`, `milvus_release_collection`,
`milvus_list_databases`, `milvus_use_database`.

The published wheel declares `fastmcp` but imports `mcp.server.fastmcp`, so the command injects
`--with "mcp<2"`. Without it the server dies at import and the CLI reports only
"Connection closed" — the registration command proves it starts before registering it.

**API.** No MCP needed for a one-off: the REST API answers over the project's https origin, and
`pymilvus` over gRPC.

```bash
curl -s -X POST http://127.0.0.1:19530/v2/vectordb/collections/list \
  -H 'Content-Type: application/json' -d '{}'
uv run --with "pymilvus>=2.6,<3" python3 -c "
from pymilvus import MilvusClient
print(MilvusClient(uri='http://127.0.0.1:19530').list_collections())"
```

## Rules that bite

- **DDEV only.** `ddev start`, `ddev delete -y -O`. Never a standalone `docker compose up` for
  Milvus — the compose file here is DDEV's, and its network, router and TLS come with it.
- **`--force` deletes data.** It removes the volumes: etcd's metadata, MinIO's segments and the
  data directory. Every collection goes with them.
- **The client must match the server.** pymilvus is pinned `>=2.6,<3` against the default Milvus
  2.6 server; a 3.x client fails at connect time, not at install time.
- **An index is derived data.** Losing one is a re-run of `cmd-tools-ragify.sh`, not a restore.

## Hard rules

- **Clean up after your own work, and ASK before you do.** A scratch project you built to check
  something, a folder or file you made to test with: when the goal is met, say plainly what you
  created and offer to remove it. Never delete it unasked — the user may still want to look — and
  never walk away leaving it unmentioned either.
- **Removing a project is a command, not `rm -rf`.** This folder ships no `cmd-tools-remove.sh`, so
  use `ddev delete -y -O` inside the project. Deleting the folder alone leaves the DDEV registry
  entry, the database volume, the snapshots volume and the per-project built images behind —
  invisible until the disk is full. `cmd-tools-reclaim.sh` in this folder finds that debris afterwards, but
  not creating it is better.
