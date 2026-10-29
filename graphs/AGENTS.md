# Graphs

Every project's **knowledge graph**, one directory per project:
`graphs/<workspace>/<project>/` with `graph.json`, `GRAPH_REPORT.md` and `graph.html`.

This folder is part of the **Webship Workspace** (`~/workspace`), a DDEV-only harness.

## Why the graph is not in the project

A graph is tens of megabytes, Leiden clustering is not bit-stable so it re-diffs entirely on every
rebuild, and half the projects worth mapping are git repositories we ship — `products/educare` must
not gain a `graphify-out/` because someone mapped it. `cmd-tools-graphify.sh` builds it in the
project (graphify writes nowhere else) and moves the result here.

## Agent

Use the **`webship-workspace`** agent, and the **`webship-workspace-graphify`** skill.

## Commands here

```bash
bash cmd-tools-graphs.sh                                  # every graph: nodes, edges, size
bash cmd-tools-graphs.sh -a collect                       # sweep up graphs left inside projects
bash cmd-tools-graphs.sh <workspace>/<project> -a remove   # delete one (it is regenerable)
bash cmd-tools-graphs.sh <workspace>/<project> -a mcp-register    # give it to the Claude Code CLI
bash cmd-tools-graphs.sh <workspace>/<project> -a mcp-unregister
bash cmd-tools-graphs.sh <workspace>/<project> -a serve    # foreground, for debugging
```

Build or rebuild one from the project's own workspace folder, never from here:

```bash
cd ~/workspace/<workspace> && bash cmd-tools-graphify.sh <project>
```

## Querying a graph

The graph is outside the project, so every read takes `--graph`:

```bash
G=~/workspace/graphs/<workspace>/<project>/graph.json
graphify query "what does this service depend on?" --graph $G
graphify explain "SomeClass" --graph $G
graphify path "ClassA" "ClassB" --graph $G
graphify god-nodes --top 15 --graph $G
```

Or from the project's workspace folder, which fills the path in:
`bash cmd-tools-graphify.sh <project> --query "…"`.

## Over MCP, for the Claude Code CLI

`-a mcp-register` registers graphify's own MCP server on **stdio** — no port, no daemon, the CLI
starts it per session. Ten tools: `query_graph`, `get_node`, `get_neighbors`, `shortest_path`,
`get_community`, `god_nodes`, `graph_stats`, `list_prs`, `get_pr_impact`, `triage_prs`. Rebuilding
the graph needs no re-registration: the path does not change.

The server is a separate dependency and its absence only shows at run time — `graphify-mcp` exists
either way and dies with `ModuleNotFoundError: No module named 'mcp'`, which the CLI reports as
"Connection closed". It also needs **`mcp<2`**: graphify 0.9.28 imports `AnyUrl` from `mcp.types`,
which 2.x moved. `ensure_graphify` installs both correctly.

## Know what a graph does not contain

PHP classes under `src/` (methods, `use`, extends, implements, traits, injected services), JS and
SQL. **Not** hooks in `.module`/`.theme`/`.install`, Twig, any `*.yml` — so routing, services and
plugin wiring are absent — Markdown, or PHP 8 attributes, so plugin-id to class never appears.
A recipe like `products/educare` is 0 PHP and 699 YAML files, so its graph is `composer.json` and
little else: a silent miss is not an answer.

The full architecture is in `products/workspace/CLAUDE.md`.

## Hard rules

- **Clean up after your own work, and ASK before you do.** A file or folder you created to try
  something out is yours to clear: when the goal is met, say plainly what you made and offer to
  remove it. Never delete it unasked — the user may still want to look — and never walk away leaving
  it unmentioned either.
