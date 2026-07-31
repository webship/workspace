# Specs

The **design artifact of a change**, before the change exists: one folder per change, holding the
ask, what the tree already says about it, and the contract the implementation is built from.

This folder is part of the **Webship Workspace** (`~/workspace`), a DDEV-only harness.

## The method

[Structured-Prompt-Driven Development](https://martinfowler.com/articles/structured-prompt-driven/)
— prompts as first-class delivery artifacts: written, reviewed, versioned, and kept in sync with
the code rather than typed into a chat and lost.

```
specs/<workspace>/<project>/NNN-topic/
  01-story.md      the ask — problem, scope, definition of done, acceptance criteria
  02-analysis.md   what exists today, the vocabulary, what it touches, risks, open questions
  03-canvas.md     the REASONS Canvas — the contract
  spec.yml         stage, issue/PR links, and the commit the canvas was last true for
```

The **REASONS Canvas** is seven sections: **R**equirements, **E**ntities, **A**pproach,
**S**tructure, **O**perations, **N**orms, **S**afeguards. Operations are ordered, individually
reviewable steps, each naming the file it touches, how it is verified, and which definition-of-done
item it serves. A plan is a suggestion; the canvas is a contract.

## Commands

```bash
bash cmd-spdd.sh                                     # every spec: target, stage, topic
bash cmd-spdd.sh <workspace>/<project> "the change"  # start one (writes 01-story.md)
bash cmd-spdd.sh <spec> -a analysis                  # draft 02-analysis.md
bash cmd-spdd.sh <spec> -a canvas                    # draft 03-canvas.md
bash cmd-spdd.sh <spec> -a drift                     # has the tree moved since the canvas?
bash cmd-spdd.sh <spec> -a sync                      # record that the canvas is true again
```

A spec is named by its number (`001`), its slug, or `<workspace>/<project>/NNN-slug`.

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

## Why the analysis is better here than the method assumes

SPDD's weakest step is analysis — "scan the codebase" — because a model guesses. This workspace has
two deterministic sources and `cmd-spdd.sh` feeds both in: the project's **graphify** knowledge
graph (structure: classes, injected services) and its **Milvus RAG index** (the prose, templates
and configuration the graph does not read). The first real spec written here used them to catch a
factual error in its own story.
