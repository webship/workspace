# Graphs

Project knowledge graphs, one directory per project: `graphs/<workspace>/<project>/`.

Browse them at <https://graphs.workspace.ddev.site> — each row has **Open** (the interactive
graph), **Report**, **Download** and **Rebuild**, with its node and edge counts.

They are kept here rather than inside each project because a graph is tens of MB, it re-diffs
entirely on every rebuild, and many of the projects are repositories we ship. Build one from the
project's own workspace folder with `cmd-tools-graphify.sh <project>`; manage them here with
`cmd-tools-graphs.sh`. See `AGENTS.md` for querying, the MCP wiring, and what a graph does not cover.
