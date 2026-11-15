# Several AI providers on one spec

Do not depend on one AI provider. On a change, one AI CLI writes, a different one reviews, a third may give a second opinion, what each said is kept beside the spec, and a person decides. This page is the part of that flow that is built: the runner by role.

## The flow

1. **A spec.** `specs/<workspace>/<project>/NNN-topic/` (`bash specs/cmd-spdd.sh <workspace>/<project> "what the change is"`). A person writes the story.
2. **Author.** The default AI CLI does the work the spec asks for and ends with notes.
3. **Reviewer.** A different AI CLI reads the spec, the author's notes and the evidence, and answers with a verdict: `agree`, `changes asked` or `cannot judge`.
4. **Second opinion.** A third AI CLI, when one is wanted.
5. **The record.** Every run is a file in `<spec>/collaboration/`, and `record.md` lists them.
6. **A person decides.** No run merges, releases or marks anything reviewed. "Reviewed by a human" and "Code review by maintainers" are ticked by a person only. Two providers agreeing is evidence, not approval.

## Who plays which part

`core/config/ai.settings.yml`, over the shipped `core/config/ai.defaults.yml`:

```yaml
default_cli: claude
roles:
  author: default          # the default CLI
  reviewer: gemini
  second_opinion: codex
```

```bash
bash core/scripts/ai-items.sh roles
# author           Claude Code          ready
# reviewer         Gemini CLI           skipped: Gemini CLI is signed out
# second_opinion   OpenAI Codex CLI     skipped: OpenAI Codex CLI is not installed (codex is not on the PATH)
```

## Running a role

```bash
bash core/scripts/ai-items.sh run --role author   --spec specs/dev/site/001-topic "Do operations 1 to 3 of the canvas."
bash core/scripts/ai-items.sh run --role reviewer --spec specs/dev/site/001-topic \
     --evidence dev/site/tests/reports/cucumber_report.json "Review the change against the story."
bash core/scripts/ai-items.sh run --role second_opinion --spec specs/dev/site/001-topic "Where do you differ?"
```

| Option | What it does |
| --- | --- |
| `--role` | `author`, `reviewer` or `second_opinion` |
| `--spec` | The spec folder, from the workspace root |
| `--evidence` | A file from the workspace root sent with the task: a Webship-js report is what a review should stand on |
| `--cli` | Another CLI than the role's, for this run |
| `--agent` | An agent that CLI has installed, when its non-interactive form can name one (`agent_arg` in the settings) |
| `--minutes` | The time limit (20) |

The run is the CLI's own documented non-interactive form (`clis.<id>.run`: `claude -p`, `gemini -p`, `codex exec`, …) with stdin closed, in the project the spec is about. It is sent its part, the rule above, the spec's files, what came before (the author's notes to a reviewer; both to a second opinion), the evidence and the task.

Exit code: `0` answered, `3` skipped, `1` failed.

## Skipped is written down, never faked

A role whose CLI is switched off, not installed, signed out, or the same as the author's is recorded as `skipped: <why>`. Nothing is sent, and no other CLI takes its place.

## What is kept

```text
specs/dev/site/001-topic/collaboration/
  20261115T011727Z-author-claude.md      role, CLI and version, the task, how it ended, the answer
  20261115T011749Z-reviewer-gemini.md
  record.md                              a row per run, and "Decision (a person)"
```

What a person writes under **Decision (a person)** in `record.md` is kept when the next run rewrites the table.

## Sign-ins, cost and what is sent

- Each CLI uses the person's own sign-in. The runner passes no key and shares nothing between CLIs.
- Every run uses that provider's quota or billing.
- The spec, the notes and the evidence are sent to each provider asked. A file that looks like it holds secrets (`.env`, a settings file, a key) is refused as evidence.
