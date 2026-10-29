# Constitution — <Product>

> The **general spec**. What this product is, who it is for, what it is built on, and what it must
> never become. Read it before writing any change spec against this product.
>
> A story that contradicts this document is either a wrong story or an out-of-date constitution.
> Say which, and fix that one, before any code is written.
>
> Revised rarely, and never as a side effect of a change: a constitution that is edited to permit
> whatever is being built this week is not governing anything.

## Identity

| | |
|---|---|
| **Package** | `vendor/name` |
| **Type** | `drupal-recipe` / `drupal-profile` / `drupal-theme` / … |
| **Lives at** | the canonical repository, and the mirror if there is one |
| **Release line** | which branch is current, and what its versions look like |
| **Built on** | the base this stands on, at the version it requires |
| **Checked out here** | `<workspace>/<project>` |

## Mission

**What it is**, in one sentence a person outside the team would understand.

**Who it is for.** The audience, named. Not "users" — the actual role that opens it, and what they
are trying to get done that day.

**The job it does.** What someone uses this instead of. If the honest answer is "nothing, they would
build it themselves", say that: it is the strongest statement of why the product exists.

## Scope

| In scope | Out of scope |
|---|---|
| what this product owns and may change | what belongs to the base, a sibling, or the site builder |

The right-hand column is the one that earns its keep. Most bad changes are not wrong, they are
*somewhere else's* — a fix to the base made here, a per-site decision baked into a product, a feature
that belongs to a sibling template.

## Tech stack

What it is built on, and — the part that matters — **what that decides for every change**. A stack
line with no consequence beside it is trivia.

| Layer | What | What it decides |
|---|---|---|
| | | |

## Structure

Where things live, and the rule that puts them there. Enough that somebody can find the file a
change belongs in without reading the whole tree.

## Norms

Product-specific standards. The workspace-wide ones live in `core/config/norms.yml` and are injected
into every draft — do not repeat them here. A rule stated in two places drifts.

## Safeguards

The boundaries this product must not cross, each with its consequence. "Never X" without "because Y"
gets argued away the first time X is convenient.

## Roadmap

Phases rather than dates: what is done, what is next, what is deliberately not being done yet and
what would have to be true first.

| Phase | State | What it means |
|---|---|---|

## How a change here is verified

The commands that actually prove it, in order. If a step is manual, say it is manual — a verification
list that quietly includes a step nobody runs is worse than a short one.

## Open questions

Things genuinely undecided, each with who decides and what it blocks. An empty section is a fine
answer; an omitted one is not.
