# Group the dashboard workspace cards by purpose

## Problem / motivation

The dashboard home page renders every workspace as one card in a single flat grid. That was fine at
eight cards. It is now **twenty** — projects, dev, test, demos, sandboxes, products, recipes,
site-templates, profiles, modules, themes, docs, videos, graphs, rag, specs, designs, agents,
skills, prompts, worklogs — and the grid has stopped being scannable: the eye has no landmarks, so
finding "rag" means reading names one by one rather than looking in a region.

The cards are also of genuinely different kinds, and the flat grid hides that. Some hold sites you
build and run (dev, test, demos). Some hold code we ship (products, modules, themes, recipes).
Some hold knowledge about the others (graphs, rag, specs, docs, worklogs). Some hold the AI items a
Claude Code session loads (agents, skills, prompts). Somebody new to the workspace has to learn
that distinction from a person; the page could simply show it.

The order is already user-controlled — the cards are drag-sortable and the order persists to
`settings.yml` — so this must add grouping **without** taking that away.

## Scope

**In:**
- A `group:` value in each workspace's `presentation:` block.
- Grouped rendering on the dashboard home, with a heading per group.
- Dragging still reorders, and still persists.
- A workspace with no `group:` still appears, in a sensible place, with no code change.

**Out:**
- Any change to the per-workspace pages (`/dev`, `/rag`, …).
- Renaming, merging, splitting or removing any workspace.
- Collapsing groups, remembering collapsed state, or filtering by group.
- Changing what a card shows (icon, subtitle, counts, badges).

## Definition of done

- [ ] The home page shows the workspaces under group headings rather than as one flat grid.
- [ ] Every workspace listed in `settings.yml` appears exactly once, grouped or not.
- [ ] A workspace whose settings file states no group still renders, and the page does not break.
- [ ] Dragging a card still reorders it and still writes the new order to `settings.yml`.
- [ ] Adding a group, or moving a workspace between groups, is a settings edit — no dashboard code.
- [ ] The grouping is legible on a phone-width viewport as well as a desktop one.

## Acceptance criteria

| # | Given | When | Then |
| - | ----- | ---- | ---- |
| 1 | 20 workspaces, each with a `group:` | I open `https://workspace.ddev.site` | the cards appear under one heading per group, in the order `settings.yml` lists them |
| 2 | a workspace with no `group:` in its settings | I open the home page | it still renders as a card, and no other card is lost |
| 3 | any two cards in the same group | I drag one over the other | the order changes and survives a reload |
| 4 | a settings file edited to change one workspace's `group:` | I reload the home page | that card has moved to the other group, with no restart and no code change |
