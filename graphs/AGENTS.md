# Graphs

Every project's knowledge graph, one directory per project:
`graphs/<workspace>/<project>/` with `graph.json`, `GRAPH_REPORT.md` and `graph.html`.

Part of the **Webship Workspace** (`~/workspace`), a DDEV-only harness. The rules in the root
`CLAUDE.md` apply here too; what follows is what is specific to this folder.

## Why the graph is not in the project

A graph is tens of megabytes, its clustering is not bit-stable so every rebuild re-diffs in full,
and many of the projects worth mapping are repositories we ship — none should gain a generated
directory because somebody mapped it. `cmd-tools-graphify.sh` builds it in the project's own
workspace folder and the result is moved here.

**Build one from the project's workspace, never from here:**

```bash
cd ~/workspace/dev && bash cmd-tools-graphify.sh <project>
```

## Commands here

```bash
bash cmd-tools-graphs.sh                              # Graphs (list, collect, serve over MCP)
```

Every one locates the workspace from its own path, so there is nothing to export and nothing to
install. `--help` on any of them lists its arguments.
