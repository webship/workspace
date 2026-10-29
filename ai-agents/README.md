# Agents

The subagent definitions Claude Code dispatches on. Three places hold them, and this folder is only one of them:

| Source | Path | What it is |
|---|---|---|
| workspace | `~/workspace/ai-agents/` | this folder: drafts and work in progress |
| claude | `~/.claude/agents` | what a Claude Code session actually loads |
| repo | [webship/ai-agents](https://github.com/webship/ai-agents) | what the team has |

`cmd-tools-ai-items.sh` moves items between them, and the dashboard
(`https://ai-agents.workspace.ddev.site`) does the same from buttons.

```bash
bash cmd-tools-ai-items.sh                    # what each source has
bash cmd-tools-ai-items.sh --list-remote      # what the repo has
bash cmd-tools-ai-items.sh <name> --pull      # repo   -> this folder (to read or edit)
bash cmd-tools-ai-items.sh <name> --fetch     # repo   -> ~/.claude/agents (usable next session)
bash cmd-tools-ai-items.sh <name> --install   # this folder -> ~/.claude/agents
bash cmd-tools-ai-items.sh --pull --source claude   # this machine -> this folder
```

`--source claude` applies a name filter, `webship` by default, because a machine's
`~/.claude/agents` also holds client and third-party items. `--filter _all_` opts out.

## Clone one to customise it

Start from something that already works rather than a blank file:

```bash
bash cmd-tools-ai-items.sh <name> --clone-to <new-name>
```

This is not `cp`. An agent carries its own name in its frontmatter, its heading and often its
prose, and **Claude Code dispatches on the frontmatter `name`** — so two files claiming the same
name collide, and which one wins is undefined. The clone's identity is rewritten to its new name.
The original is never modified.

Add `--purpose` and Claude Code tailors the copy for that purpose, rather than leaving you a
renamed duplicate to edit by hand:

```bash
bash cmd-tools-ai-items.sh webship-workspace \
  --clone-to my-agent \
  --purpose "what this copy is for, in a sentence or two"
```

It rewrites the description, narrows the `tools:` list to what this agent actually needs, the
instructions, and cuts what does not transfer. Cloning itself needs no AI and no network; only
`--purpose` calls `claude`, and if that fails you keep the untailored clone.

In the dashboard, **Clone** on any row asks for the new name and an optional purpose.

## After editing

Nothing here reaches a session until it is installed:

```bash
bash cmd-tools-ai-items.sh <name> --install   # then restart the session
```

Sharing an agent with the team stays manual, through an issue and a PR on
dev-ai-agents — deliberately, so nothing lands in a shared repository by a button press.
