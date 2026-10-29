# Reviewing a spec

The method's claim is that **the review is the method**. Five gates, each small enough to actually
engage with — that is the whole reason the work is split into story, analysis and canvas rather than
one document. A gate nobody stops at is not a gate.

`bash cmd-spdd.sh <spec> -a review` runs the mechanical half of this list and prints what it cannot
judge. It never says "approved": a checklist can see that a section is missing, not that it is right.

## Gate 0 — the constitution

Before any of it. Does this product have a `00-constitution.md`, and does the ask fit inside it?

- [ ] The ask is in the constitution's **In scope** column, not its **Out of scope** one.
- [ ] If it contradicts the constitution, that is said out loud and one of the two is fixed **first**.

A story that quietly widens the product is how a site template becomes a distribution nobody chose
to build.

## Gate 1 — the story

- [ ] **A person wrote it.** The ask is the one artifact nobody should generate.
- [ ] The problem is stated as a problem, not as its solution. "Cards are unscannable at twenty" is a
      problem; "add group headings" is already an answer, and it forecloses better ones.
- [ ] There is a **scope boundary** with an *Out* list. An In list alone constrains nothing.
- [ ] **Definition of done** is a list of observable states, each one checkable by somebody who did
      not write the change.
- [ ] **Acceptance criteria** are Given/When/Then, in the vocabulary of the people who asked.
- [ ] Nothing in it is a guess about the code. That is the next stage's job.

## Gate 2 — the analysis

- [ ] It names **what is actually there** — files, functions, config keys — and each claim could be
      checked in a minute.
- [ ] It used the deterministic sources (the graph, the RAG index) rather than recalling the tree.
- [ ] **Risks** are specific: what breaks, for whom, how it would be noticed.
- [ ] **Open questions** are listed, each with who answers it.
- [ ] Where it **contradicts the story**, it says so. An analysis that agrees with everything was not
      an analysis.

This is the stage that most rewards reading. The published method's weakest step is "scan the
codebase", because a model guesses; the corrections made here are where a person's knowledge enters.

## Gate 3 — the canvas

All seven sections present, and:

- [ ] **R** — requirements and definition of done, traceable to the story.
- [ ] **E** — the entities and their relationships, in the domain's words.
- [ ] **A** — the approach, with the alternatives that were rejected and why. An approach with no
      rejected alternative was not chosen, it was assumed.
- [ ] **S** — structure: where it fits, what it depends on, what depends on it.
- [ ] **O** — operations: **ordered**, each naming the file it touches, how it is verified, and which
      definition-of-done item it serves. An operation that serves no D-item is scope creep with a
      number on it.
- [ ] **N** — norms, from `core/config/norms.yml`, not retyped.
- [ ] **S** — safeguards: the boundaries this change must not cross.
- [ ] Every definition-of-done item is served by at least one operation. Anything unserved is either
      out of scope or forgotten — decide which, in writing.

## Gate 4 — the code

- [ ] The diff does what the operations say, in the order they say.
- [ ] Anything it does that the canvas does **not** say is either removed or added to the canvas
      before merge. This is the gate the method exists for: drift starts here, silently, and every
      later spec written against this code inherits it.
- [ ] Norms and safeguards hold.

## Gate 5 — the verification

- [ ] The acceptance criteria were run, not reasoned about.
- [ ] What was verified is stated with its evidence; what was not is stated as not.
- [ ] A test exists for anything a future change could break without noticing.

## When reality diverges

The rule is one sentence and it is the whole discipline: **fix the prompt first, then the code.**

| What happened | What to do |
|---|---|
| The behaviour was wrong | Fix the canvas, then change the code to match it |
| The code was refactored | Change the code, then `-a sync` so the canvas is a true record again |
| The tree moved under a spec | `-a drift` says so; re-read the analysis before trusting the canvas |

A canvas that no longer describes the code is not documentation with a small error in it. It is a
contract that lies, and the next person to trust it will be wrong in a way that is hard to see.
