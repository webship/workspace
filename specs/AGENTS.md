# Specs

The **design artifact of a change**, before the change exists: one folder per change, holding the
ask, what the tree already says about it, and the contract the implementation is built from.

This folder is part of the **Webship Workspace** (`~/workspace`), a DDEV-only harness.

## The method

[Structured-Prompt-Driven Development](https://martinfowler.com/articles/structured-prompt-driven/)
— prompts as first-class delivery artifacts: written, reviewed, versioned, and kept in sync with
the code rather than typed into a chat and lost.

```
specs/<workspace>/<project>/
  00-constitution.md              the GENERAL spec: what the product is, who for, what it must
                                  never become. One per product, revised rarely.
  NNN-topic/
    01-story.md      the ask — problem, scope, definition of done, acceptance criteria
    02-analysis.md   what exists today, the vocabulary, what it touches, risks, open questions
    03-canvas.md     the REASONS Canvas — the contract
    spec.yml         stage, issue/PR links, and the commit the canvas was last true for
```

### Two layers, and why the top one exists

A **constitution** is about the product and outlives every change to it. A **spec** is about one
change and is finished when that change ships.

SPDD as published has only the second. Every other tool in the field has both — Birgitta Böckeler's
[comparison of Kiro, Spec-kit and Tessl](https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html)
finds all three separating a *memory bank* of durable project context from the task-specific spec,
and [Spec Kit](https://github.github.com/spec-kit/concepts/sdd.html) calls its version a
constitution. The layer is not decoration: without it, every story restates what the product is, and
five site templates that share a base each rediscover what that base decided.

**A story that contradicts the constitution is either a wrong story or an out-of-date
constitution.** Say which, and fix that one, before any code.

### Brownfield: where a constitution comes from when the product already exists

The course this borrows the layer from
([Spec-Driven Development with Coding Agents](https://www.deeplearning.ai/courses/spec-driven-development-with-coding-agents))
puts it plainly: greenfield, you *develop* the constitution in conversation; brownfield, you
**generate it from the existing codebase** and then correct it. Every product here is brownfield.

So the sources are the repository, not a memory of it: `composer.json` and `recipe.yml` for what it
is built on, `AGENTS.md` and `CHANGELOG.md` for how it is worked on, the tag history for where the
line actually is, the config and content directories for what it ships.

And then the part that is not generated. The course's own example is a generated mission that left
out the target audience — *how could the agent know your business?* The two sections a repository
cannot answer are **Mission** (who it is for, and what they are trying to get done) and **Roadmap**
(what is next, and why not yet). Those are written, and until they are, they are marked as open
questions rather than filled with something plausible.

### The level of detail, which is the actual skill

More about goals, mission, audience and constraints; less about the low-level decisions a capable
pair programmer works out on their own. A spec that dictates variable names and skips why the change
exists has it exactly backwards, and it is the most common way these documents become long and
useless at the same time.

### Replanning

Between changes, not only before them: revise the constitution, update the roadmap, improve the
templates. A constitution written once and never revisited stops describing the product within about
two releases — and a stale constitution is worse than none, because the next story is checked
against it.

### Where this sits on the maturity scale

IBM's framing names three levels: **spec-first** (written before the code, never maintained),
**spec-anchored** (evolves with the software, kept true), and **spec-as-source** (the spec changes
and the code regenerates).

This workspace is deliberately **spec-anchored**, and deliberately not the third. `-a drift` and
`-a sync` exist to keep a canvas true; nothing here generates code from one. That is a position,
not a gap — Böckeler's warning about spec-as-source is that it repeats Model-Driven Development and
risks "the downsides of both MDD and LLMs: inflexibility *and* non-determinism." A canvas is a
contract a person implements or hands to a session, and stays reviewable because it is prose.

The **REASONS Canvas** is seven sections: **R**equirements, **E**ntities, **A**pproach,
**S**tructure, **O**perations, **N**orms, **S**afeguards. Operations are ordered, individually
reviewable steps, each naming the file it touches, how it is verified, and which definition-of-done
item it serves. A plan is a suggestion; the canvas is a contract.

## Commands

```bash
bash cmd-spdd.sh                                     # every spec: target, stage, topic
bash cmd-spdd.sh <workspace>/<project> -a constitution   # the product's general spec
bash cmd-spdd.sh <workspace>/<project> "the change"  # start one (writes 01-story.md)
bash cmd-spdd.sh <spec> -a analysis                  # draft 02-analysis.md
bash cmd-spdd.sh <spec> -a canvas                    # draft 03-canvas.md
bash cmd-spdd.sh <spec> -a review                    # the mechanical half of the checklist
bash cmd-spdd.sh <spec> -a read                      # constitution + story + analysis + canvas, as one
bash cmd-spdd.sh <spec> -a drift                     # has the tree moved since the canvas?
bash cmd-spdd.sh <spec> -a sync                      # record that the canvas is true again

bash cmd-tools-specs.sh                              # what is shared, and what differs here
bash cmd-tools-specs.sh --diff                       # what a pull would change, before taking it
bash cmd-tools-specs.sh --pull                       # take the shared templates and constitutions
bash cmd-tools-specs.sh --share                      # how to propose one of yours back
```

A spec is named by its number (`001`), its slug, or `<workspace>/<project>/NNN-slug`.

### Reading and reviewing, because writing was never the hard part

`-a read` prints the whole spec **in reading order, as one document** — the constitution first, then
the ask, then what the tree says, then the contract. A spec spread over four files is read by nobody
at the moment it matters; this is what you hand to a session, or to somebody on their first day.

`-a review` runs the mechanical half of `_defaults/REVIEW.md`: is there an Out list, a definition of
done, acceptance criteria, all seven canvas sections, an operation for every done-item, has the tree
moved since the canvas was stamped. **It never says "approved"** — it ends by naming what it cannot
judge and leaving that to the reviewer. The sharpest complaint in the tool comparison is the review
burden ("I'd rather review code than all these markdown files"), and a tool that *pretends* to have
done the reading makes that worse rather than better.

## Shared specs

The templates in `_defaults/` and every `00-constitution.md` are **shared**, through the same
repository and the same mechanism as the agents, skills and prompts — `Vardot/dev-ai-agents`, read
with `git archive` from the fetched remote branch. SPDD's own claim is that successful patterns
"accumulate into a reusable prompt library"; accumulation does not happen by itself.

A **numbered** spec is not shared. It is about one change, in one tree, at one commit — the most
valuable artifact locally and pure noise to everybody else. Sharing those would bury the templates
nobody could then find.

Nothing pushes. A template everyone inherits is proposed and reviewed like any other change.

## The rules that make it worth doing

- **You write the story.** The ask is the one artifact nobody should generate. The command writes
  a template and stops.
- **Every stage is a gate.** Analysis needs a story; a canvas needs an analysis. Each file is read
  and corrected by a person before the next is asked for — that review IS the method. A canvas
  written from an unread analysis is the failure it exists to prevent.
- **When reality diverges, fix the prompt first, then the code.** `-a drift` compares the target's
  HEAD against the commit the canvas was stamped for and refuses to be quiet about the gap.
- **Norms and safeguards come from `core/config/norms.yml`**, injected into every draft, so a rule
  is stated once instead of remembered per prompt.
- **Nothing here generates code.** The canvas is handed to a session, or implemented by hand. The
  artifact is the deliverable of this folder.

## What it is good for, and what it is not

Worth a spec: work on `products`, `modules`, `themes`, `recipes`, `profiles`, `site-templates` and
the tooling itself — repeated, reviewed, standard-bearing changes that already go through an issue
and a PR.

Not worth a spec, and the article says so directly: firefighting hotfixes, exploratory spikes in
`sandboxes/`, throwaway builds in `test/`, one-off scripts, and pure visual work. Forcing a canvas
there is pure overhead.

**And watch the size.** The tool comparison's first finding is a problem-size mismatch — these
workflows "overshoot" small bugs and generate more markdown than a mid-sized feature is worth. The
test is not "is this change important" but "will somebody read this in six months and be glad it
exists". A one-file fix with an obvious cause is a good issue and a bad spec. If the story, the
analysis and the canvas together are longer than the diff will be, that is a signal, not a
milestone.

## Why the analysis is better here than the method assumes

SPDD's weakest step is analysis — "scan the codebase" — because a model guesses. This workspace has
two deterministic sources and `cmd-spdd.sh` feeds both in: the project's **graphify** knowledge
graph (structure: classes, injected services) and its **Milvus RAG index** (the prose, templates
and configuration the graph does not read). The first real spec written here used them to catch a
factual error in its own story.

## Hard rules

- **Clean up after your own work, and ASK before you do.** A file or folder you created to try
  something out is yours to clear: when the goal is met, say plainly what you made and offer to
  remove it. Never delete it unasked — the user may still want to look — and never walk away leaving
  it unmentioned either.

**Google Drive.** `bash cmd-tools-google-drive-sync.sh` (or the **Sync to Drive** button) pushes this folder to its Google Drive folder, new and changed files only, never deleting; `--dry-run` previews and `-a register` adds the Google Drive MCP server to Claude Code. Settings: `google_drive:` in `core/config/settings.yml`.
