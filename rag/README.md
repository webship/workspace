# RAG

The workspace's **vector database**: a self-hosted Milvus running in DDEV at `rag/milvus/`, with
one collection per indexed project — `ws_<workspace>_<project>`.

Open the UI at <https://milvus.rag.workspace.ddev.site> (Attu), and the workspace card at
<https://workspace.ddev.site/rag>.

Build an index from the project's own workspace folder with `cmd-tools-ragify.sh <project>`;
list, search and drop them here with `cmd-tools-rag.sh`; hand the whole database to the Claude
Code CLI with `cmd-milvus-mcp.sh -a register`.

It is the complement of `graphs/`: graphify parses the **code** and reads no Markdown, Twig,
`*.module` hooks or Drupal wiring YAML — this indexes the **text** of exactly those and retrieves
passages from them. Retrieval is Milvus's built-in BM25 by default: no model, no key, nothing
leaves the machine. See `AGENTS.md` for the commands, the MCP wiring and the rules that bite.
