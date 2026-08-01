# Agents

AI agent definitions. Shared through the ai-agents repository and installable into
`~/.claude/agents`.

Part of the **Webship Workspace** (`~/workspace`), a DDEV-only harness. The rules in the root
`CLAUDE.md` apply here too; what follows is what is specific to this folder.

## What an item is here

One markdown file per agent. The dashboard writes and edits them, `cmd-tool-sync-agents.sh`
moves them between here, the shared repository and `~/.claude/agents`, and
`cmd-tool-propose-agents.sh` opens a pull request for one.

## Commands here

```bash
bash cmd-tool-backup-agent.sh                         # Bootstrap.
bash cmd-tool-git-change-filemode-to-false.sh         # Bootstrap.
bash cmd-tool-propose-agents.sh                       # Propose one agent back to the shared repository — webship/ai-agents by default, or whatever
bash cmd-tool-sync-agents.sh                          # Sync the agents workspace with the two places agents really live: the shared
```

Every one locates the workspace from its own path, so there is nothing to export and nothing to
install. `--help` on any of them lists its arguments.
