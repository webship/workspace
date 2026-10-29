# Skills

The skills, each a directory with a SKILL.md. Three places hold them, and this folder is only one of them:

| Source | Path | What it is |
|---|---|---|
| workspace | `~/workspace/ai-skills/` | this folder: drafts and work in progress |
| claude | `~/.claude/skills` | what a Claude Code session actually loads |
| repo | [webship/ai-agents](https://github.com/webship/ai-agents) | what the team has |

`cmd-tools-ai-items.sh` moves items between them, and the dashboard
(`https://ai-skills.workspace.ddev.site`) does the same from buttons.

```bash
bash cmd-tools-ai-items.sh                    # what each source has
bash cmd-tools-ai-items.sh --list-remote      # what the repo has
bash cmd-tools-ai-items.sh <name> --pull      # repo   -> this folder (to read or edit)
bash cmd-tools-ai-items.sh <name> --fetch     # repo   -> ~/.claude/skills (usable next session)
bash cmd-tools-ai-items.sh <name> --install   # this folder -> ~/.claude/skills
bash cmd-tools-ai-items.sh --pull --source claude   # this machine -> this folder
```

`--source claude` applies a name filter, `webship` by default, because a machine's
`~/.claude/skills` also holds client and third-party items. `--filter _all_` opts out.

## Clone one to customise it

Start from something that already works rather than a blank file:

```bash
bash cmd-tools-ai-items.sh <name> --clone-to <new-name>
```

This is not `cp`. A skill carries its own name in its frontmatter, its heading and often its
prose, and **Claude Code dispatches on the frontmatter `name`** — so two files claiming the same
name collide, and which one wins is undefined. The clone's identity is rewritten to its new name.
The original is never modified.

Add `--purpose` and Claude Code tailors the copy for that purpose, rather than leaving you a
renamed duplicate to edit by hand:

```bash
bash cmd-tools-ai-items.sh webship-issue-templates \
  --clone-to my-skill \
  --purpose "what this copy is for, in a sentence or two"
```

It rewrites the description, narrows the
instructions, and cuts what does not transfer. Cloning itself needs no AI and no network; only
`--purpose` calls `claude`, and if that fails you keep the untailored clone.

In the dashboard, **Clone** on any row asks for the new name and an optional purpose.

## After editing

Nothing here reaches a session until it is installed:

```bash
bash cmd-tools-ai-items.sh <name> --install   # then restart the session
```

Sharing a skill with the team stays manual, through an issue and a PR on
dev-ai-agents — deliberately, so nothing lands in a shared repository by a button press.
