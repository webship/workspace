# Prompts

Reusable AI prompts. Run them from the dashboard or clone one to adapt; they are not
installed as slash commands, because a prompt with placeholders is meant to be filled in.

Part of the **Webship Workspace** (`~/workspace`), a DDEV-only harness. The rules in the root
`CLAUDE.md` apply here too; what follows is what is specific to this folder.

## What an item is here

One markdown file per prompt. They are run — handed to the assistant with the placeholders still
in them, to fill in — or cloned and adapted. They are deliberately NOT installed as slash
commands: a prompt nobody has filled in is not a command.

## Commands here

```bash
bash cmd-tool-backup-prompt.sh                        # Bootstrap.
bash cmd-tool-git-change-filemode-to-false.sh         # Bootstrap.
bash cmd-tool-propose-prompts.sh                      # Propose one prompt back to the shared repository — webship/ai-agents by default, or whatever
```

Every one locates the workspace from its own path, so there is nothing to export and nothing to
install. `--help` on any of them lists its arguments.
