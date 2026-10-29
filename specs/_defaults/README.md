# The default specs

The templates every spec in this folder starts from, as files rather than as heredocs inside
`core/scripts/functions/fun-spdd.sh`. Three reasons they are files:

- **they are reviewed like anything else** — a change to how every future spec is written is a diff,
  not a shell edit;
- **they are shared** — `cmd-tools-specs.sh` syncs them with `Vardot/dev-ai-agents`, the same way
  agents, skills and prompts are shared, so one team's improvement reaches the others;
- **they are read by people, not only written by scripts.** A template with its reasons in it teaches
  the method; a heredoc teaches nothing because nobody opens it.

| File | What it is | Who writes it |
|---|---|---|
| `00-constitution.md` | The **general spec** of a product: what it is, who for, what it is built on, what it must never become. Written once per product, revised rarely. | A person |
| `01-story.md` | The ask for one change: problem, scope boundary, definition of done, acceptance criteria. | A person |
| `02-analysis.md` | What the tree already says: vocabulary, what it touches, risks, open questions. | Drafted, then corrected |
| `03-canvas.md` | The REASONS Canvas — the contract the implementation is built from. | Drafted, then corrected |
| `spec.yml` | Stage, links, and the commit the canvas was last true for. | The command |
| `REVIEW.md` | What a reviewer checks at each gate, and what makes a spec fail it. | A person |

## The two layers

A **constitution** is about the product and outlives every change to it. A **spec** is about one
change and is finished when that change ships. A story that contradicts the constitution is either
a wrong story or an out-of-date constitution — say which, and fix that one, before any code.

This is the layer the method as published does not have, and the one a distribution most needs: five
site templates that share a base will otherwise each rediscover what that base decided.

## Editing a template

Change the template, not the spec it produced. A spec already written is a record of what was agreed
at the time; rewriting it to match a new template destroys the only thing it was for.
