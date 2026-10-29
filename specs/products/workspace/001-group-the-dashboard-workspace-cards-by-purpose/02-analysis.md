## What exists today

**The list that is the order.** `core/config/settings.yml` ends in a `workspaces:` block — a flat YAML sequence of names. That list does two jobs at once: membership (a name in it registers a workspace) and presentation order (the sequence is the card order). There is no third axis today.

The two checkouts do not agree on it, and by design cannot: `settings.yml` is never synced in either direction. The target clone (`products/workspace/core/config/settings.yml`) lists 20 names, including `libraries`, and has no `rag` and no `specs`. The live tree (`~/workspace/core/config/settings.yml`) lists 21, including `rag` and `specs`, and does *not* include `libraries`. The 21 names quoted in the ask are the live tree's list, not the target's; the ask calls it "twenty" and then names twenty-one.

**Per-workspace settings.** Each workspace has `core/config/workspace.<name>.settings.yml`. The minimum is a `doc:` block (`workspace.dev.settings.yml` is two lines). An optional `presentation:` block overrides the dashboard's built-in table. Keys observed in real files: `icon`, `label`, `subtitle`, `noun`, `plural`, `kind`, `also_files` (`workspace.rag.settings.yml` uses six of them; `workspace.specs.settings.yml` and `workspace.graphs.settings.yml` use four or five). These files *are* synced between the clone and the live tree.

**Where a card's look comes from.** `core/workspace-app/workspaces.js` holds `PRESENTATION`, a hardcoded default table with 20 rows. It has no row for `graphs`, `rag` or `specs` — those three carry their whole presentation in their own settings file, which is the working precedent that a purely presentational key can live in `presentation:` and nowhere else. `_loadWorkspacesFresh()` iterates `settings.workspaces`, merges `{ ...(PRESENTATION[name] || {icon:'tabler:folder', subtitle:name}), ...wsSettings.presentation }`, and returns an object keyed by name whose **insertion order is the settings order**. `loadWorkspaces()` memoises that for 2 s; `invalidateWorkspaces()` clears it, and is called after an order write precisely so a dragged grid does not re-render stale.

**The home grid.** `server.js` `homeCardsHtml(message)` (≈1976–2008) maps `Object.values(workspaces)` to one `.ws-card-wrap[data-ws]` per workspace and emits them into a **single** container:

- `#workspace-cards-wrap` — the htmx swap target; the result message goes *inside* it, and a code comment records that appending the message as a sibling broke the flash handler.
- `#workspace-cards` — `uk-grid uk-grid-small uk-child-width-1-2 uk-child-width-1-3@s uk-child-width-1-4@m`, plus `uk-sortable="handle: .ws-card-handle"` and the three data attributes `data-order` (comma-joined keys), `data-file="settings.yml"`, `data-key="workspaces"`.

`homePage()` (≈2010) is a thin wrapper: one `uk-card` body containing `homeCardsHtml()`.

**The drag, end to end.** `public/ui.js` (≈114–137) listens for UIKit's `moved` event, does `e.target.closest('#workspace-cards')`, collects `[...grid.querySelectorAll('.ws-card-wrap')].map(el => el.dataset.ws)`, and posts to `/actions/list-order` with `order`, `was` (from `grid.dataset.order`), `file`, `key`, and `view: 'home'`, swapping `#workspace-cards-wrap` by `outerHTML`.

`/actions/list-order` (≈4048–4089) then: validates the target through `listTarget` (settings file only, key must be an existing list); refuses any key not in `ORDERED_LISTS = new Set(['workspaces'])`; refuses with 409 if `was` no longer matches the file (an explicit anti-clobber guard, added after a real scrambling incident); refuses with 400 unless the submitted order is an **exact permutation** of the current list — same names, same count, because "an entry lost from this list unregisters a workspace"; then `writeListBlock`, `invalidateWorkspaces()`, `HX-Trigger: refresh-projects`, and returns `homeCardsHtml(msg)` when `view=home`.

`readListBlock`/`writeListBlock` (≈1318–1342) rewrite only the `- item` lines under the key, leaving the rest of the file's comments and formatting alone.

**A second view over the same order.** `listEditorHtml` (≈1394) renders `workspaces:` in Settings as an `.ws-list` sortable of `.ws-item` rows with `.ws-handle` and a 1-based number, plus up/down buttons posting to `/actions/list-move` (kept explicitly for keyboard use). `LIST_META.workspaces.note` says "The workspaces this dashboard shows, in card order." One order, two editors.

**Adjacent things that already assume the flat list.** `addWorkspace()` (≈1347–1390) creates the settings file, the folder, the `workspaces:` entry and a DDEV wildcard hostname — and hardcodes a placement rule: *"Keep docs and worklogs last, as they are in the shipped order."* `/actions/workspace-presentation` + `writeWorkspacePresentation(file, icon, subtitle)` (≈1537–1559) rewrite the **entire** `presentation:` block from two form fields. `commandMenuGroups()` and `listAllCommands()` already use the word "groups" for a different thing (commands grouped by workspace).

**What deliberately does not list workspaces.** The actions rail. A comment at ≈3145 records that a full workspace list there duplicated the cards "in a worse form — nineteen links to scroll past" and filled a phone's first screen; the rail was cut back to a single "All workspaces" link. The home cards are the only workspace chooser, which is why their scannability is the whole problem.

**CSS.** `public/style.css` carries `.workspace-card` (≈164, 561, 658–666, 1710–1711), `.ws-backups` (≈563), `.ws-card-handle` (≈2578–2602, 2634–2638), and `#workspace-cards .uk-sortable-placeholder` rules (≈2615–2632) that are scoped to that one id. Phone rules live at ≈694, ≈1726 and ≈1752.

**The norms already covering this.** Dashboard work is Node + HTMX in `core/workspace-app`, no framework, no build step. A new workspace is a settings file plus a folder, never a dashboard code change. Comments say why, and say what a thing does not cover.

## Domain vocabulary

- **workspace** — one first-level folder under the workspace root, registered by a name in `workspaces:`, with a `workspace.<name>.settings.yml` beside it. Not "category", not "section".
- **card** — the home-page tile for one workspace. `.ws-card-wrap` is the sortable unit; `.workspace-card` is the link inside it.
- **card order** — the order of `workspaces:` in `settings.yml`. The phrase the code itself uses ("in card order", "the order IS the card order").
- **`presentation:`** — the per-workspace block of purely presentational keys that overrides the built-in `PRESENTATION` table. Where `group:` is proposed to live.
- **`PRESENTATION`** — the hardcoded default table in `workspaces.js`. Explicitly "presentational-only"; everything functional is read live.
- **label vs directory** — `label` is what the card says, the folder name is what the path says. `rag`'s file makes the point: *"the dashboard card says RAG… `label` is the presentational name and never the directory."*
- **kind** — `projects` (has DDEV sites and builders) or `files`. Independent of any purpose grouping the ask describes, and does not line up with it: `graphs`, `rag` and `docs` are all knowledge, but `rag` is `kind: projects` with `also_files: true`.
- **noun / plural** — what one item in the folder is called, used in the card's count label.
- **ordered list vs set** — `ORDERED_LISTS` is the code's own distinction: `workspaces:` is the only list whose sequence carries meaning; `modules:`, `themes:` etc. are sets.
- **`was` / permutation** — the two guards on an order write: optimistic concurrency, and same-names-same-count.
- **fragment / swap target** — an htmx-returned chunk of HTML and the element it replaces. `#workspace-cards-wrap` is the home grid's.
- **rail** — the right-hand actions column. Not a navigation list of workspaces, by decision.
- **live tree vs clone** — `~/workspace` (where things are built) vs `~/workspace/products/workspace` (the git checkout, and this change's target).
- **group** — new. Note the collision: `commandMenuGroups()` and `listAllCommands()` already produce things called groups, keyed by workspace.

## What it touches

- **`core/config/workspace.<name>.settings.yml`** (21 files live, 20 in the clone) — the `presentation:` block gains `group:`. This is the only place the scope allows the value to live, and it is also the only per-workspace file that actually syncs between the two checkouts.
- **`core/workspace-app/workspaces.js`, `_loadWorkspacesFresh()`** — must read `pres.group` into the returned map so it is live (AC 4: a settings edit takes effect on reload, no restart). Anything baked into a module-level constant fails that.
- **`core/workspace-app/workspaces.js`, `PRESENTATION`** — the decision point for shipped defaults. Putting groups here is a code change and does not sync; putting them in the per-workspace files does sync and satisfies "adding a group is a settings edit". The three workspaces with no `PRESENTATION` row (`graphs`, `rag`, `specs`) show the second path already works.
- **`core/workspace-app/server.js`, `homeCardsHtml()`** (≈1976–2008) — the only function that renders the grid, and the function the reorder endpoint returns. Every structural change lands here: headings, per-group containers, and whatever `data-order` / sortable arrangement replaces the single `#workspace-cards`.
- **`core/workspace-app/server.js`, `homePage()`** (≈2010) — only if the single enclosing `uk-card` body is wrong for a grouped page.
- **`core/workspace-app/public/ui.js`, the `moved` handler** (≈114–137) — `closest('#workspace-cards')` and the single `data-order`/`data-file`/`data-key` read are what break first if the grid is split into one sortable per group.
- **`core/workspace-app/server.js`, `/actions/list-order`** (≈4048) — the permutation and `was` checks are written against one flat list. Whether they need to change is entirely determined by what the client is allowed to post (see Risks).
- **`core/workspace-app/public/style.css`** — `#workspace-cards`-scoped sortable/placeholder rules (≈2615–2632), the card and handle rules, and the phone breakpoints. New heading styling belongs here; there is no build step, so it is plain CSS.
- **`core/workspace-app/server.js`, `writeWorkspacePresentation()`** (≈1537) — it re-renders `presentation:` from `icon` and `subtitle` alone, so it silently deletes every other key in the block. A `group:` written by hand is destroyed the next time anyone presses Save in the presentation editor. (This is already true of `label`, `noun`, `kind`, `also_files`; grouping is what makes the loss visible on the home page.)
- **`core/workspace-app/server.js`, `addWorkspace()`** (≈1347) — its hardcoded "keep docs and worklogs last" placement is a primitive grouping rule that a real grouping supersedes or contradicts.
- **`core/workspace-app/server.js`, `listEditorHtml()` / `LIST_META.workspaces`** (≈1394, ≈1264) — the Settings view of the same list, and the note that calls it "in card order". If the home page groups and this stays flat, the two views describe the same data differently.
- **`core/config/settings.yml` `workspaces:`** — not edited by this change in principle, but it is where contiguity lives (see Risks) and it is the file every drag writes.
- **`core/scripts/tests/cmd-smoke-test.sh`** — named by the workspace rules as the validation for tooling changes. The provided context does not show whether it exercises the dashboard at all; it is described as a smoke test over argparse shell scripts, so assume it does not cover `homeCardsHtml`.

Not touched, per the scope: `workspacePage()` and every `/<workspace>` route; the rail; the card's own contents.

## Risks

**The drag contract is a flat-list contract, in three places at once.** The client collects `.ws-card-wrap` from one element found by `closest('#workspace-cards')`; it sends `was` from that one element's `data-order`; the server demands an exact permutation of the whole list. Splitting the DOM into one sortable per group breaks all three in the same motion: `closest` returns the group container or null, the posted `order` holds only that group's members, and the server answers *"That order does not match the current workspaces, so nothing was changed."* This is the single most likely way the change ships broken while looking fine in review — AC 3 fails only after an actual drag.

**Contiguity is not guaranteed and nothing enforces it.** A grouped page with a global order only round-trips cleanly if each group's members are contiguous in `workspaces:`. Nothing in `settings.yml` makes them so, and the current live order interleaves kinds freely (`docs, videos, graphs, specs, rag, designs` sits between `demos` and `projects`; `worklogs` is last). If members are scattered, either rendering silently re-orders relative to the file (which strains AC 1's "in the order `settings.yml` lists them") or a drag has to write a list whose global sequence differs from what was dragged. Whichever is chosen has to be chosen deliberately, not discovered.

**Cross-group drag has no defined meaning.** The scope says moving a workspace between groups is a settings edit with no code change (AC 4), which implies dropping a card into another group's region must not change its group. But UIKit sortable with a shared group name will happily accept the drop, and the user will read the result as a move. Either the drop is prevented, or it is accepted and then visibly undone on the swap-back — the second is worse than not offering it.

**`writeWorkspacePresentation` eats the new key.** Any user who opens a workspace's Settings and presses Save on the presentation widget rewrites `presentation:` to just `icon` and `subtitle` — dropping `group`, and with it `label`, `noun`, `kind`, `also_files`. The card silently leaves its group and, for `rag`, also loses its name and its file list. Easy to miss because the grouping code itself is correct.

**Cards lost or doubled by grouping logic.** AC 2 ("every workspace appears exactly once") is exactly the invariant that a group-then-render loop breaks: iterate a fixed list of known groups and any workspace whose `group:` is a typo vanishes; iterate groups and then append ungrouped and a mis-keyed lookup renders one twice. The safe shape is to walk the settings list once and bucket, never to walk a group list and look workspaces up.

**Live/clone divergence quietly determines whether the defaults arrive.** `settings.yml` is never synced, so grouping defaults expressed there reach nobody; `workspace.<name>.settings.yml` files are synced, so defaults expressed there do. And the clone has no `workspace.rag.settings.yml` or `workspace.specs.settings.yml` at all — a change written and tested against the live tree's 21 workspaces will render 20 different ones in the clone, without `rag` or `specs`, with `libraries`.

**Staleness and the 2 s memo.** AC 4 holds only because `_loadWorkspacesFresh` re-reads the YAML. A group value cached at module load, or derived once into a constant, gives a card that moves group only after a container restart — and "no restart" is stated in the acceptance criteria, not implied.

**The swap target's message placement.** The response is the whole `#workspace-cards-wrap`, and there is a recorded bug where the "✅ Card order saved" message placed outside it was never flashed. Grouped markup must keep the wrapper and keep the message inside it.

**Phone legibility is a real constraint, not a checkbox.** Base width is `uk-child-width-1-2`, so 21 cards are already ~11 rows; four or five headings add height to a page that has no other navigation (the rail deliberately carries no workspace list). Headings that look like landmarks on desktop can read as noise at 2-up. Note also that the handle's touch rule (`opacity: .7` at the small breakpoint) means handles are always visible on phones — heading styling must not sit where a handle already is.

**Accessibility and heading semantics.** The cards are currently `<h4>` inside a flat grid. Adding group headings above them either introduces a heading level above `h4` (fine) or leaves the document outline inverted (not). A grouped list also wants each region labelled by its heading; UIKit's `uk-grid` nesting makes it easy to get the wrapper element wrong.

**No automatic guard.** The workspace's validation story is a shell smoke test; nothing shown covers `server.js` rendering. A regression in `homeCardsHtml` is caught by a person loading the page, or not at all.

**Naming collision.** `commandMenuGroups()` and `listAllCommands()` already return things called `groups`. A new `groups` concept in the same file needs a name that does not read as those.

## Open questions

1. **What are the groups, and what are they called?** The ask sketches four kinds — sites you build and run; code we ship; knowledge about the others; AI items a session loads — but names none of them and assigns no workspace to any. Nothing can be designed until each of the 20/21 names has a group.
2. **Where does group *order* come from?** First appearance in `workspaces:`, or an explicit ordered `groups:` block in `settings.yml`? The first keeps a single source of order and satisfies "a settings edit"; the second is a second order to keep in sync with every drag, and would need its own concurrency guard.
3. **Where does the heading *text* come from?** Is `group: knowledge` rendered verbatim, title-cased, or looked up against a label map? A map is a second place to edit and risks a group with no label; verbatim means the settings file carries display text, which the codebase already accepts for `label` and `subtitle`.
4. **Must a group's members be contiguous in `workspaces:`?** This decides whether rendering may re-order relative to the file, or whether a drag write must produce a contiguous list. It is the question that determines the whole drag design.
5. **One sortable over all cards, or one per group?** And if per-group: does the client post the full reconciled list, or does `/actions/list-order` learn to accept a partial order? The existing permutation guard exists to stop a workspace being unregistered by a bad write; relaxing it needs a replacement guarantee.
6. **Can a card be dragged into a different group?** If no, the drop must be refused, not accepted-then-reverted. If yes, it contradicts "moving a workspace between groups is a settings edit — no dashboard code".
7. **Where do the shipped defaults live** — 20/21 edits to the per-workspace settings files (syncs, matches the `graphs`/`rag`/`specs` precedent, satisfies the norm) or new rows in `PRESENTATION` (one edit, does not sync, and makes every future workspace land ungrouped until someone edits code)?
8. **Where do ungrouped workspaces go?** "A sensible place" is not a decision. Last, first, or under a named catch-all heading — and does a card with no group get a heading of its own or none?
9. **Does the presentation editor need a group field?** The scope excludes "changing what a card shows", which arguably excludes the editor. But `writeWorkspacePresentation` will delete `group:` whether or not a field exists, so the *preservation* fix is needed regardless. Is fixing it in scope, or is it a separate change this one depends on?
10. **Does `addWorkspace()`'s "docs and worklogs last" rule survive?** A new workspace currently lands second-from-the-end; under grouping it lands in whatever group that position falls in, which may be nonsense.
11. **Does the Settings list editor group too?** The ask excludes per-workspace pages but says nothing about `/settings`. Leaving it flat means two views of one list disagree about its shape; grouping it is unscoped work.
12. **Which checkout's `workspaces:` is authoritative for testing and for the definition of done?** The clone (20, with `libraries`, without `rag`/`specs`) is the stated target; the live tree (21, the other way round) is what renders at `workspace.ddev.site`. AC 1 says "20 workspaces" and the motivation names 21.
13. **What happens to an empty group** — one whose every member was removed or regrouped? Heading suppressed, or rendered empty?
14. **How is this verified?** The provided context shows no test that exercises the dashboard's HTML. Is a manual check at two viewport widths the accepted evidence, or does this change need to bring a check with it?
