# Skills

AI skill definitions — a directory per skill, each holding `SKILL.md`. Installable into
`~/.claude/skills`.

Part of the **Webship Workspace** (`~/workspace`), a DDEV-only harness. The rules in the root
`CLAUDE.md` apply here too; what follows is what is specific to this folder.

## What an item is here

One DIRECTORY per skill, each holding `SKILL.md` — a skill can carry scripts and references beside
its instructions. `cmd-tool-sync-skills.sh` moves them; `cmd-tool-propose-skills.sh` proposes one.

## Commands here

```bash
bash cmd-tool-backup-skill.sh                         # Bootstrap.
bash cmd-tool-git-change-filemode-to-false.sh         # Bootstrap.
bash cmd-tool-propose-skills.sh                       # Propose one skill back to the shared repository — webship/ai-agents by default, or whatever
bash cmd-tool-sync-skills.sh                          # Sync the skills workspace with the two places skills really live: the shared
```

Every one locates the workspace from its own path, so there is nothing to export and nothing to
install. `--help` on any of them lists its arguments.
