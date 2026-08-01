# Docs

Documentation projects, and what is generated from them — PDFs, HTML, screenshots.

Part of the **Webship Workspace** (`~/workspace`), a DDEV-only harness. The rules in the root
`CLAUDE.md` apply here too; what follows is what is specific to this folder.

## What an item is here

A markdown document, plus whatever has been generated FROM it — a PDF, an HTML render, a
screenshot. The generated files sit beside the source and are listed as artifacts.

## Commands here

```bash
bash cmd-tool-backup-doc.sh                           # Bootstrap.
bash cmd-tool-git-change-filemode-to-false.sh         # Bootstrap.
```

Every one locates the workspace from its own path, so there is nothing to export and nothing to
install. `--help` on any of them lists its arguments.
