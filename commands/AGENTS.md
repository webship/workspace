# Commands

A view over every `cmd-*.sh` in the workspace, and the operations that are awkward when
they are scattered across twenty folders.

Part of the **Webship Workspace** (`~/workspace`), a DDEV-only harness. The rules in the root
`CLAUDE.md` apply here too; what follows is what is specific to this folder.

## What this folder is

A view, not a home. Every `cmd-*.sh` lives in the workspace it runs from — a builder for `dev`
sits in `dev/` — and moving one here would break every path in the harness.

`workspace-repo/` is a gitignored mirror of the tooling repository, refetched as needed.

## Commands here

```bash
bash cmd-tools-commands.sh                            # Workspace Commands
```

Every one locates the workspace from its own path, so there is nothing to export and nothing to
install. `--help` on any of them lists its arguments.
