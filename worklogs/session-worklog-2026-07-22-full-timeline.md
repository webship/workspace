# Session Worklog — Full Timeline (2026-07-22, ~00:30–20:00 +03)

The complete, timestamped record of the session that built the Webship
Workspace dashboard and modernized the tooling. Companion docs:
`session-worklog-2026-07-22-workspace-dashboard.md` (feature narrative) and
`workspace-tips-and-rules.md` (distilled rules).

## Timeline (commit times, Asia/Amman +03)

| Time | Event |
|---|---|
| ~00:30 | Session start: remove Gleap tooling + `core/assets`; new workspaces (docs/agents/skills/recipes/components); clone dev-ai-agents + ai-agents; 16 `webship-workspace-*` agents authored |
| 01:48 | `fdceb18` first push: dashboard v1 + new workspaces + team-install fixes (branch corrected to `1.0.x`, made default) |
| ~02:30–03:30 | Dashboard iterations: DDEV-hosting battle (host firewall blocks container→host → Docker-outside-of-Docker), Express → basic `node:http` + HTMX rewrite |
| 03:38 | `79e5b3b` UIKit design system + DDEV lifecycle buttons + live status badges |
| 03:51 | `e7e86e6` AI assistant fixed in-container (claude CLI in image + ~/.claude mounts) + voice input |
| 04:01–04:06 | `39469dd`–`7089548` assistant restyle, **audit log** (resolved the "data loss" scare — removals were the user's own dashboard clicks), platform-neutral copy, working indicators, brand palette |
| 04:15–04:23 | `72236e1`–`1828fa8` title case; **agent mode** (real actions + NAVIGATE/OPEN/REFRESH); backups browse/restore (recovered `sobki_profile_bootstrap` from a 134 MB archive + DB); sparkle logo |
| 04:32–04:53 | `9de5f1c`–`aafe2fd` backups pills + delete; `/ws/backups` pages; **live terminal job streaming**; `ddev stop -y` fix |
| 05:03 | `68a8dab` Varbase 11 builders (assistant-authored on request, replicated) |
| 12:55–13:09 | `79a9844`–`00513b6` 3-per-row → VDO logo (drupal.org/project/vdo) → toolbar + breadcrumb → assistant left sidebar + 4-per-row |
| 13:21–13:45 | `20a087f`–`c3ca2f8` context-aware always-open assistant + prompts workspace; Cucumber scripts removed; per-workspace item nouns; spacing polish (tested 2560→390px); dark mode (light default) |
| 13:58–14:11 | `d625c64`–`07dd7e5` manage agents/skills/prompts/docs from the UI (create/edit/install into ~/.claude, PDFs via pandoc); AI generation + site screenshots |
| 14:34 | `c556c6b` assistant becomes full-height fixed left sidebar on every page |
| 14:44–14:51 | `7956c22`–`260aa24` Drupal 11.4 + Drupal CMS + Varbase 9.2 builders (Packagist-verified); build timeout 15m→60m |
| 15:07 | `be71639` **cmd- smoke test** (218 → later 221 scripts, all green) |
| 15:23 | `af016d4` **stdin-hang root cause fixed** (`docker exec -i` waits on open stdin pipes → spawn with stdin 'ignore') |
| 15:27 | `227225a` **set_default_settings fixed** (LAMP-era `$databases` block was breaking fresh installs — found by the Drupal 11.4 e2e build) |
| 16:06 | `c711235` session worklog + tips&rules + CLAUDE.md saved (and to persistent memory) |
| 16:28–16:41 | `bcad767`–`3df249e` NAVIGATE /ws/backups; **10-round iteration pass** (markdown chat replies shipped; negative/security cases, concurrency, mobile, dark — all green) |
| 16:49 | `95353ac` **PR #1 merged by the user** (11.0.x fast-forwarded) |
| 16:51–17:01 | `81ca7cd`–`b151d25` README examples + PR demo flow; Varbase 11 in test/; AI workspaces to the last home row |
| 17:09 | `e9533be` build_distribution re-aligns DDEV config after create-project (varbase-project 11 ships its own .ddev) — found by the Varbase 11 e2e |
| 17:21–17:30 | `7057e31`–`d319da5` Varbase 11 automated-testing script (webship-js) with legacy --run options; build form takes args |
| 17:49–18:02 | `d386c09`–`412b306` **structured Arguments group** (collapsed, HTMX-swapped, read from the cmd- script's real argparse schema); Build echoes the final command |
| ~17:00–18:30 | Varbase verification round: 11.0.x in dev(test/demos/sandboxes) + 9.2.x + 10.1.x — all files-ok; 584 webship-js steps passed against live v11t1 before a cleanup-timing mistake cut the suite; `--profile=minimal` args proof |
| 18:24 | `69fe650` **workspace + project subdomains** (`dev.workspace.ddev.site`, `varbase11demo.dev.workspace.ddev.site`) — DNS any-depth, wildcard certs, nginx tier to ddev-router |
| 18:37–18:41 | `9f9a4e2`+`b34e7f8` (PR #2, awaiting review): hierarchical domains as default for all navigation + Launch; `hub_domain` setting marking the **remote workspace hub on a public domain** direction; TTL perf caches |
| ~18:45 | Branch mistake (commit landed on 1.0.x) caught and fixed: force-restored 1.0.x, cherry-picked to the feature branch |
| ~20:00 | This timeline saved |

## User prompts (chronological requests)

Remove Gleap/assets · clone agent repos · install agents+skills to ~/.claude ·
per-workspace agents · new workspaces (docs/agents/skills → +recipes/components → +prompts) ·
web UI like the VDO screenshot, title "workspace" · DDEV-hosted at workspace.ddev.site ·
read from .yml · Node+HTMX, then UIKit + UIKit icons · no modals · assistant on all pages,
then left, then full-height, same as home on all pages · human-readable cmd names ·
DDEV Start/Launch buttons + live status · no Filemode · terminal output for jobs ·
fix ddev stop · backups browse/restore/delete → own /ws/backups pages + card icon ·
agent mode ("let it read the interface and click and navigate") · voice mic · dark mode
(light default) · VDO logo · toolbar+breadcrumb · 3-per-row → 4-per-row → AI row last ·
only projects are projects · platform-neutral copy · manage agents/skills/prompts/docs
from the UI + AI generation + PDFs/screenshots · examples (for a team demo, no personal
projects, drupal+drupal cms+varbase) · test rounds (full size, human-like words, 10 rounds) ·
Drupal 11.4 + Varbase 11/10.1/9.2 builders tested in all four build folders ·
automated testing in test workspace with --run options · args from the UI → grouped
collapsed args read from cmd- + final command echo · subdomains per workspace + per
project → make default → all navigation links · save worklog/tips/rules · PRs for review

## Rules (see workspace-tips-and-rules.md for the full list)

DDEV-only; DDEV owns settings.php DB config; `stop` has no `-y`; close stdin on spawned
ddev calls; no app restarts during jobs; `# workspace-name:` headers; only projects are
"projects"; sanitized team configs; two-step confirms + audit log; smoke test before PRs;
test with natural human phrasing; hierarchical hub domains are the default navigation.

## Comments & lessons

- Testing paid for itself: 8+ real bugs found only by running real builds/browsers.
- The audit log turned an unexplainable "data loss" into a five-minute answer.
- In-memory job registry + app restarts don't mix — twice bitten (build orphaned;
  cleanup verdicts "lost"); persist jobs someday.
- Don't clean up test fixtures while a suite is still using them (v11t1).
- Branch discipline: commit on a feature branch *before* touching the working tree.
- The assistant writing its own Varbase 11 builder scripts — correctly — was the
  session's best proof that the agent-mode design works.
