# AI Commands

Claude Code **slash commands**: one `<name>.md` per command, installed into
`~/.claude/commands/` where it becomes `/<name>`.

Three places hold them, and this folder is one of them:

| Where | What it is |
|---|---|
| `~/workspace/ai-commands/` | this folder — drafts, and what you edit |
| `~/.claude/commands/` | what a Claude Code session actually loads |
| `webship/ai-agents` `.claude/commands/` | what the team has |

## Why it is `ai-commands` and not `commands`

`~/workspace/commands` is already taken: it is the Settings view over every `cmd-*.sh` shell
script in the workspace, and it is deliberately not a registered workspace. Two different things
called "commands" in one tree would collide on the folder name, so this one is `ai-commands`.
Its label in the dashboard is **AI Commands**.

## Use it

```bash
bash cmd-tools-ai-items.sh                     # what is here, installed, and in the repo
bash cmd-tools-ai-items.sh --list-remote       # what the shared repo has
bash cmd-tools-ai-items.sh review --pull       # repo  -> this folder, to read or edit
bash cmd-tools-ai-items.sh review --fetch      # repo  -> ~/.claude, usable next session
bash cmd-tools-ai-items.sh review --install    # here  -> ~/.claude
bash cmd-tools-ai-items.sh review --clone-to my-review --purpose "..."
bash cmd-tool-backup-command.sh review         # tar it into ~/workspace/backups/
```

Omit the name and every command is meant.

## Commands and prompts both land in `~/.claude/commands/`

A command is a markdown spec with `$ARGUMENTS`, typed mid-session. A **prompt**
(`~/workspace/ai-prompts/`) is a whole `claude …` launch command that opens a new screen session in
a folder or project. Six names exist in both — `drupal-patch`, `explain`, `phpcs-fix`, `review`,
`say`, `test` — and installing one writes over the other. Pick the kind you want before you run
`--install`.
