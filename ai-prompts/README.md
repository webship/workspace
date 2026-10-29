# Prompts

The reusable prompts, run as /<name> slash commands. Three places hold them, and this folder is only one of them:

| Source | Path | What it is |
|---|---|---|
| workspace | `~/workspace/ai-prompts/` | this folder: drafts and work in progress |
| claude | `~/.claude/commands` | what a Claude Code session actually loads |
| repo | [webship/ai-agents](https://github.com/webship/ai-agents) `prompts/` | what the team has |

## A prompt is not an AI Command

Both install into `~/.claude/commands/`, and both give you `/<name>`, but they are written for
different moments:

| | AI Prompts (here) | AI Commands (`~/workspace/ai-commands/`) |
|---|---|---|
| Shape | A whole `claude …` launch command | A markdown spec with `$ARGUMENTS` |
| Used | Opens a **new** screen session in a folder or project | Typed mid-session: `/review src/` |
| Shared repo | `prompts/` | `.claude/commands/` |

Six names exist in both — `drupal-patch`, `explain`, `phpcs-fix`, `review`, `say`, `test` — and
installing one writes over the other. Pick the kind you want before you run `--install`.

A prompt is the whole launch command, so the dashboard's **New screen** form can list it as a
template: it lifts the `claude` flags out of the fenced block and fills the session's opening
prompt with the rest. The screen's working directory is the context.

`cmd-tools-ai-items.sh` moves items between them, and the dashboard
(`https://ai-prompts.workspace.ddev.site`) does the same from buttons.

```bash
bash cmd-tools-ai-items.sh                    # what each source has
bash cmd-tools-ai-items.sh --list-remote      # what the repo has
bash cmd-tools-ai-items.sh <name> --pull      # repo   -> this folder (to read, edit, or run)
```

**There is no `--install`, and no `--fetch`.** A prompt is the whole `claude …` launch command
for a new session, so the only way to use one is to start a session with it — the dashboard's
**New screen** form lists them as templates, and the CLI runs one by hand:

```bash
cd ~/workspace/test/webship11c1
claude --permission-mode bypassPermissions """…"""
```

Nothing here reaches `~/.claude`, because a running session does not load prompts. If you want
a slash command — a `$ARGUMENTS` spec you type mid-session — that is a different kind, and it
lives in `~/workspace/ai-commands/`.

## Clone one to customise it

Start from something that already works rather than a blank file:

```bash
bash cmd-tools-ai-items.sh <name> --clone-to <new-name>
```

This is not `cp`. A prompt carries its own name in its frontmatter, its heading and often its
prose, and **Claude Code dispatches on the frontmatter `name`** — so two files claiming the same
name collide, and which one wins is undefined. The clone's identity is rewritten to its new name.
The original is never modified.

Add `--purpose` and Claude Code tailors the copy for that purpose, rather than leaving you a
renamed duplicate to edit by hand:

```bash
bash cmd-tools-ai-items.sh release-notes \
  --clone-to my-prompt \
  --purpose "what this copy is for, in a sentence or two"
```

It rewrites the description, narrows the
instructions, and cuts what does not transfer. Cloning itself needs no AI and no network; only
`--purpose` calls `claude`, and if that fails you keep the untailored clone.

In the dashboard, **Clone** on any row asks for the new name and an optional purpose.

## After editing

Nothing to install — the next screen you start from this prompt picks the edit up, because the
New screen form reads the file at the moment you open it.

Sharing a prompt with the team stays manual, through an issue and a PR on
dev-ai-agents — deliberately, so nothing lands in a shared repository by a button press.
