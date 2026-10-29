# AI Commands

Claude Code slash commands — `<name>.md` here becomes `/<name>` in a session.

This folder is part of the **Webship Workspace** (`~/workspace`), a DDEV-only harness. Everything
here is driven by the `cmd-*.sh` scripts in this folder — run them from here, never from the
git clone in `products/workspace`, which ships the tooling but builds nothing.

## Not the same thing as Prompts

Both install into `~/.claude/commands/`, and both give you `/<name>`, but they are written for
different moments:

| | AI Commands (here) | AI Prompts |
|---|---|---|
| Shape | A markdown spec with `$ARGUMENTS` | A whole `claude …` launch command |
| Used | Typed mid-session: `/review src/` | Opens a **new** screen session in a folder or project |
| Shared repo | `.claude/commands/` | `prompts/` |

Six names exist in both, and the two files behind each name are unrelated. Installing one over
the other is the only way they interact — decide which kind you want before running `--install`.

## Agent

Use the **`webship-workspace`** agent for work in this folder. It knows the build chain, the
DDEV rules and how to author a new command.

## Skills

- **`webship-workspace-authoring`**

## Commands here

```bash
bash cmd-tool-backup-command.sh --help
bash cmd-tools-ai-items.sh --help
```

## Hard rules

- **DDEV only** — `ddev composer`, `ddev drush`, `ddev delete -y -O`, `ddev export-db`. Never raw
  composer, drush or mysql on the host.
- **Never write a `$databases` block into `settings.php`** — DDEV's `settings.ddev.php` owns it.
- `ddev start` accepts `-y`; **`ddev stop` does not**.
- Every `cmd-*-project.sh` carries a `# workspace-name:` header — the smoke test enforces it.
- Validate a change with `bash core/scripts/tests/cmd-smoke-test.sh`.
- **Clean up after your own work, and ASK before you do.** A file or folder you created to try
  something out is yours to clear: when the goal is met, say plainly what you made and offer to
  remove it. Never delete it unasked — the user may still want to look — and never walk away leaving
  it unmentioned either.

The full architecture is in `products/workspace/CLAUDE.md`.
