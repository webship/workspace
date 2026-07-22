# Session Worklog — Workspace Dashboard & Tooling Overhaul (2026-07-22)

One working session took `~/workspace` from bash-only tooling to a full web
dashboard with an agentic AI assistant, published to
**github.com/webship/workspace** (branch `1.0.x`, 30 commits).

## What was built

### Tooling & repo
- Removed the Gleap tooling and `core/assets` entirely (scripts, args, flags).
- New workspaces: **docs, agents, skills, prompts, recipes, components**
  (settings, per-folder scripts, backups dirs); reordered so AI Agents,
  AI Skills, Prompts, Docs lead the home page.
- Cloned `vardot/dev-ai-agents` + `barmoog/ai-agents`; installed their Claude
  Code agents/skills into `~/.claude`; authored 16 `webship-workspace-*`
  agents (one per workspace folder).
- Fixed `core/scripts/install/install.sh` (wrote empty env values on fresh
  installs); sanitized repo configs for team installs (`/home/YOUR_USER`,
  `CHANGE_ME`); branch corrected `11.0.x` → `1.0.x` and set as default.
- Builders: added **Drupal 11.4.x/11.4.0**, **Drupal CMS 2.1.0/2.x** (new
  `distributions/drupal_cms.yml` + `arg-drupal_cms.sh`), **Varbase
  9.2.x/9.2.0**; Varbase 11.0.x authored by the AI assistant on request;
  removed all Cucumber `cmd-` scripts; every builder carries a
  `# workspace-name:` header shown in the UI.
- `core/scripts/tests/cmd-smoke-test.sh`: syntax + safe `--help` execution +
  header check for every `cmd-*.sh` — **218/218 pass**.

### The dashboard (`core/workspace-app` → https://workspace.ddev.site)
- Basic Node.js (`node:http`, no framework) + HTMX + UIKit (all vendored);
  served through DDEV with Docker-outside-of-Docker (docker.sock +
  `~/workspace` + `~/.claude` mounted; docker/ddev/claude/pandoc/wkhtmltopdf
  in the web image).
- Home: workspace cards grid (live counts, per-workspace nouns/icons/
  subtitles, backups pills); per-workspace pages `/dev`, `/test`, … with
  builder dropdown (human-readable names), project rows with live DDEV
  status badges and Start/Stop/Launch/Backup/Remove; `/​<ws>/backups` pages
  with Restore (files + auto DB import) and Delete.
- **Workspace AI Assistant**: full-height fixed left sidebar on every page;
  agent mode (Bash/Read/Glob/Grep in-container) that really builds, starts,
  backs up and opens projects, steers the page via NAVIGATE/OPEN/REFRESH
  directives, and knows the current page's live contents on every message;
  voice input (Web Speech API); sparkle logo.
- Agents/skills/prompts/docs are editable from the UI: create from
  templates, inline editor, **Generate with AI**, Install into
  `~/.claude/{agents,skills,commands}`; docs manage .md + PDF + HTML +
  site screenshots (pandoc/wkhtmltopdf/wkhtmltoimage) with an AI site-doc
  generator.
- Jobs framework: long actions stream real terminal output (1s HTMX
  polling, ✅/❌, auto-refresh lists); global working bar + pill;
  "assistant is thinking…" indicator; append-only `actions.log` audit;
  dark mode (light default, persisted); VDO drop logo + toolbar breadcrumb;
  responsive 2560→390px.

## Bugs found and fixed by testing
1. `ddev stop -y` → stop has no `-y` flag (start keeps it).
2. Build jobs SIGKILLed at 15 min — cold composer cache needs more; now 60 min.
3. **Jobs hung at `composer create-project`** — Node spawn left stdin an
   open pipe; ddev's `docker exec -i` waits on it forever. Jobs now spawn
   with stdin `'ignore'`.
4. **`set_default_settings` wrote a LAMP-era `$databases` block**
   (localhost) over DDEV's settings — silently broke `drush site:install`
   and 500'd fresh sites. Now DDEV owns the DB connection.
5. App restarts orphan running jobs (in-memory registry) — deferred
   restarts during builds; audit log closes the attribution gap.
6. Container↔host networking: this host's firewall blocks all
   container→host traffic → the app runs inside the container (DooD), not
   as a host process behind a proxy.
7. Supervisord doesn't apply supplementary groups — docker access via
   `sg docker` in the daemon command.
8. Stale ddev registry entries from the `/var/www/html` era shadowed new
   projects (`ddev stop --unlist` cleanup).

## Verified live
- Drupal 11.0 (`d11round2.ddev.site`) and Drupal 11.4.4
  (`d114test.ddev.site`) built + installed through the dashboard.
- `sobki_profile_bootstrap` restored from backup (files + DB) via the UI.
- Playwright rounds at 2560/1920/1440/1366/834/390 px: all 16 pages, both
  themes, item round-trips, artifact serving, lifecycle badges — green.

## Commits (oldest → newest)
`fdceb18` dashboard + new workspaces + team-install fixes · `79e5b3b` UIKit
+ DDEV buttons + status · `e7e86e6` in-container assistant + voice ·
`39469dd` restyle + audit log · `08a3d0c` platform-neutral copy · `7089548`
indicators + palette · `72236e1` title case · `01295da` agent mode ·
`1828fa8` backups + sparkle logo · `9de5f1c` backups pills + delete ·
`e1f5f38` /​ws/backups pages · `aafe2fd` live terminal + stop fix ·
`68a8dab` Varbase 11 builders · `79a9844` 3-per-row · `841ed38` VDO logo ·
`627d5ef` toolbar + breadcrumb · `00513b6` 4-per-row sidebar · `20a087f`
context-aware assistant + prompts ws · `e97cc76` cucumber removal ·
`c3d2ebf` per-workspace nouns · `ce9b63a` spacing + responsive · `c3ca2f8`
dark mode · `d625c64` manage agents/skills/prompts + PDFs · `07dd7e5` AI
generation + screenshots · `c556c6b` full-height sidebar · `7956c22` new
builders · `260aa24` timeout + examples · `be71639` smoke test · `af016d4`
stdin fix + AI context · `227225a` settings fix + heading removal
