# AI items from several repositories, into any AI CLI

An agent, a skill, a command or a prompt is kept once, in its workspace folder (`ai-agents/`, `ai-skills/`, `ai-commands/`, `ai-prompts/`), in one shape: the Claude Code one. Two things happen around that folder:

```text
SOURCES                          the folder             the AI CLIs
GitHub, GitLab, Bitbucket,  ->   ai-skills/<name>/  ->  Claude Code (the default), Gemini CLI, Codex,
skills.sh                        ai-agents/<name>.md    and any other the settings list
```

`cmd-*.sh` commands come from repositories the same way (the `cmd` kind), into the workspace folder you name.

## Sources

In an `ai-*` folder:

```bash
bash cmd-tools-ai-items.sh --sources                              # each source, its state, its items and theirs
bash cmd-tools-ai-items.sh --source-add webship/ai-agents         # GitHub, short form (owner/repo, owner/repo@branch)
bash cmd-tools-ai-items.sh --source-add https://github.com/owner/repo/tree/main/skills
bash cmd-tools-ai-items.sh --source-add https://git.drupalcode.org/project/name/-/tree/1.0.x/folder    # GitLab, any host
bash cmd-tools-ai-items.sh --source-add https://bitbucket.org/workspace/repo/src/main/folder
bash cmd-tools-ai-items.sh --source-add skills.sh/owner/repo/skill    # ai-skills only
bash cmd-tools-ai-items.sh one-item --source-add owner/repo --as team # one item, listed under the id "team"
bash cmd-tools-ai-items.sh --source-check                         # ask upstream; changes no item
bash cmd-tools-ai-items.sh team --source-update                   # one source; --force replaces an item changed here
bash cmd-tools-ai-items.sh --source-remove team                   # --keep-items leaves what it placed
```

Anywhere, and for `cmd-*` commands:

```bash
bash core/scripts/ai-items.sh ai-skills sources
bash core/scripts/ai-items.sh cmd source-add https://github.com/owner/repo --to dev
bash core/scripts/ai-items.sh cmd sources
```

A repository is read over https with `git`, at the branch you name or its default one. Items are looked for in the folder you name, and in the folders they are kept in by convention: `skills/`, `.claude/skills/`, `.agents/skills/`, `ai/skills/` (a folder with a `SKILL.md`); `agents/`, `.claude/agents/`, `ai/agents/`; `commands/`, `.claude/commands/`, `ai/commands/`; `prompts/`, `ai/prompts/`; `commands/` and the folder named for `cmd-*.sh`.

**skills.sh.** `skills.sh/owner/repo/skill` (or the address of the skill's page) is turned into the GitHub repository `owner/repo` and the one skill. skills.sh is not called and its `npx` installer is not run.

**The lock.** `<folder>/.ai-sources.lock.json` (for `cmd`: `core/config/cmd-sources.lock.json`) has one entry per source: its address, the commit read, when it was last asked and what it answered, and each item it placed (its path upstream, git's id of it, a hash of what was placed, where it is). No token and no account name.

| State | Means |
| --- | --- |
| `reachable`, `unreachable`, `not checked` | The source, the last time it was asked (shown with how long ago) |
| `current` | The item is what the source has, unchanged here |
| `behind` | The source moved; the item here did not change |
| `changed locally` | The item was edited here: an update leaves it unless `--force` |
| `removed upstream` | The source no longer has it: it is left as is |
| `missing here` | It was deleted here: an update puts it back |

A name that is already in the folder and did not come from the source is never replaced.

## AI CLIs

```bash
bash cmd-tools-ai-items.sh --clis                                 # on or off, the default, installed or missing, signed in or out
bash cmd-tools-ai-items.sh --items                                # each item against every CLI that is on
bash cmd-tools-ai-items.sh <name> --install --cli gemini          # into one CLI
bash cmd-tools-ai-items.sh <name> --install --cli all             # into every CLI that is on
bash cmd-tools-ai-items.sh <name> --install --cli codex --to dev/site    # into one project only
bash cmd-tools-ai-items.sh <name> --uninstall --cli gemini
```

`--install` with no `--cli` is Claude Code, as before.

The CLIs are data. `core/config/ai.defaults.yml` ships these, each path and format read in that CLI's own documentation on 2026-11-15 (the `docs` link of each entry):

| CLI | Agents | Skills | Commands | Ships |
| --- | --- | --- | --- | --- |
| Claude Code (`claude`) | `~/.claude/agents/*.md` | `~/.claude/skills/` | `~/.claude/commands/*.md` | on, the default |
| Gemini CLI (`gemini`) | `~/.gemini/agents/*.md` | `~/.gemini/skills/` | `~/.gemini/commands/*.toml` | on |
| OpenAI Codex CLI (`codex`) | `~/.codex/agents/*.toml` | `~/.agents/skills/` | `~/.codex/prompts/*.md` (deprecated there, user only) | on |
| Grok Build (`grok`) | format not documented | `~/.grok/skills/` | a skill is the command | off |
| Mistral Vibe (`vibe`) | `~/.vibe/agents/*.toml` | `~/.vibe/skills/` | a skill is the command | off |
| Qwen Code (`qwen`) | `~/.qwen/agents/*.md` | `~/.qwen/skills/` | `~/.qwen/commands/*.md` | off |
| Kimi Code CLI (`kimi`) | `~/.kimi-code/agents/*.md` | `~/.kimi-code/skills/` | a skill is the command | off |

A prompt is the launch command of a new session: it is run, not installed into a CLI.

`core/config/ai.settings.yml` is this machine's file, merged over the shipped one key by key and never replaced by an update (Settings lists it too). Switching a CLI off, changing the default or adding a CLI is an entry there, with no code change:

```yaml
default_cli: gemini
clis:
  codex:
    enabled: false
  mycli:
    label: My CLI
    command: mycli
    signed_in: [~/.mycli/auth.json]
    kinds:
      ai-skills:
        user: ~/.mycli/skills
        project: .mycli/skills
        convert: skill-folder
      ai-commands:
        user: ~/.mycli/commands
        convert: command-toml
        extension: .toml
```

| `convert` | What is written |
| --- | --- |
| `skill-folder` | The skill's folder, as it is (the Agent Skills format) |
| `copy` | The file, as it is |
| `agent-markdown` | Markdown with `name` and `description`, and the body |
| `agent-toml` | TOML: `name`, `description`, `developer_instructions` |
| `agent-toml-vibe` | TOML: `agent_type`, `display_name`, `description`, `instructions` |
| `command-markdown` | Markdown with `description` and `argument-hint`; `$ARGUMENTS` kept |
| `command-markdown-args` | Markdown with `description`; `$ARGUMENTS` becomes `{{args}}` |
| `command-toml` | TOML: `description`, `prompt`; `$ARGUMENTS` becomes `{{args}}` |

What a conversion leaves out is said when it installs: an agent's `tools` and `model` are Claude Code's own names, so the agent has the other CLI's defaults there.

| State | Computed from |
| --- | --- |
| `on`, `off`, `default` | `enabled` and `default_cli` |
| `installed`, `missing` | The `command` is on the PATH |
| `signed in`, `signed out`, `sign-in unknown` | A file of `signed_in` exists or a variable of `signed_in_env` is set. No file is opened and no value printed; `unknown` when the entry names neither. The shipped file names are what those CLIs are seen to write, not from their documentation: correct them in your settings if one is wrong |
| `installed`, `installed, differs`, `not installed`, `no such thing` | The item is converted again and compared with what is at the CLI's place |

## In the dashboard

Each `ai-*` page has **Sources and AI CLIs** in its rail: a row per source with its state and Check, Update and Remove; a form to add one; the AI CLIs with their states; and each item with one cell per CLI that is on, with Install, Update and Remove. Commands → **From repositories** is the same for `cmd-*`. Every button runs the terminal command and shows what it printed.

The dashboard runs in a container. It sees a CLI whose command and folder are in there (`~/.claude` is mounted). For another CLI's own folder, use the terminal, or install into a project (`--to`), which is under the workspace.

## What is fetched is not trusted

- https only, no account in the address; nothing is read through a link in the repository.
- Files only: regular files are copied, without their execute bit, within a size limit, and each one is named when it is fetched. Nothing fetched is run, sourced or passed to an interpreter: not on add, check, update or remove.
- A `cmd-*.sh` is placed and never run by the sync. Read it before you run it.
- A private repository uses the credential that is already there: the `gh` login for github.com, the token of the GitLab or Bitbucket plugin's settings for its host, given to `git` through the environment of that one call. No token is written to an address, a file, the lock or the output.
- Review a third-party item before use: an AI session runs it with its full permissions.
