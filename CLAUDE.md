# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

The **Webship Workspace** tooling: a DDEV-only harness that builds and manages many Drupal projects
from bash `cmd-*.sh` scripts, plus a Node.js + HTMX web dashboard (`core/workspace-app`) that drives
those same scripts.

**Varbase plus plain Drupal.** Seeded from the original workspace tooling this grew from and trimmed to Varbase
(9.1, 9.2, 10.0, 10.1, 11.0), Drupal core and Drupal CMS. Vardoc, Uber Publisher, CV, Cucumber,
the other legacy distribution builders and the third-party profile builders (Lightning, Thunder,
OpenY, deGov, …) were removed — do not re-add them here.

Drupal and Drupal CMS carry **one builder per supported major, tracking that major's latest release**
(`^11`, `^12`, `^2`) — no pinned patch versions, no per-minor builders, and no `cmd-bulk-*` loops. Plain
Drupal 10 was dropped: new work starts on Drupal 11. Varbase keeps its per-line builders because its
releases are pinned to specific Drupal cores, so Varbase 9.x/10.x (on Drupal ~10.6/~11.4) are
unaffected.

**Drupal 12 arrived before it was installable**, and the builder says so in three declarations the
shared functions read and everything else leaves unset — a copy of the 11 builder with `^12` does
not build:

- `site_version_stability="alpha"` — composer's default minimum is `stable`, so `^12` matches only
  `12.0.0-alpha1` and resolves to nothing. The floor needs no edit later: composer still prefers the
  highest match, so 12.0.0 wins over every pre-release of it on its own.
- `site_php_version="8.5"` — `drupal/core` 12 declares `php: >=8.5.0` and DDEV's default is 8.4.
- `site_drush_version="14.x-dev"` — core 12 requires guzzle 8 and every TAGGED Drush needs `^7`, so
  14.x is the only branch that can sit beside it. Swap for `^14` once 14.0.0 exists.

Drop all three as 12 stabilises; the builder is then a copy of the 11 one, which is the point.

It ships **only** the tooling — the shared `core/`, one `cmd-*.sh` script set + `README.md` +
`*.code-workspace` per workspace folder, and `core/workspace-app` without `node_modules`. Built
project content is never committed.

Two checkouts exist on a dev machine and they are not the same thing:

- `~/workspace` — the live working tree, where projects are actually built into the workspace folders.
- `~/workspace/products/workspace` — this git clone (branch `1.0.x`, remote
  `https://github.com/webship/workspace.git`, a private standalone repo, not a fork). Commits and PRs happen here.

Dashboard changes made in the live tree are pulled into this clone with:

```bash
rsync -a --delete --exclude=node_modules --exclude=actions.log \
  ~/workspace/core/workspace-app ~/workspace/products/workspace/core/
```

The other direction — after a PR merges, getting the tooling back into the live tree — is a command:

```bash
bash ~/workspace/core/scripts/sync-tooling.sh --pull
```

It mirrors `core/scripts`, copies the per-workspace settings, `core/workspace-app` and each folder's
`cmd-*.sh`/`README.md`/`*.code-workspace`, prunes commands the clone dropped, and runs the smoke test.
It never syncs `core/config/settings.yml` (the live copy holds real secrets); it reports missing
`workspaces:` entries instead. Run it after every merge rather than hand-rolling rsync.

Machines that consume **releases** instead of carrying the clone update only the dashboard app with
the self-contained updater it ships:

```bash
bash core/workspace-app/scripts/update.sh --check     # installed vs the latest tag
bash core/workspace-app/scripts/update.sh             # update to the latest tag
```

It touches nothing but `core/workspace-app` (runtime state survives; npm install runs only when
package.json changed; it says when `.ddev/` changed and a full restart is needed). Fresh tooling,
config or settings still come from `core/scripts/sync-tooling.sh` — the updater refuses that job.

The published files are team-installable templates: no machine paths at all (they are derived), and
`CHANGE_ME` / `sk-change-this` placeholders for the account and API keys. **Never commit real
credentials, API keys, or project names here** — keep those in your own working copy.

## Commands

```bash
# Validate every cmd-*.sh (162 covered by the runner): syntax, --help bootstrap chain, workspace-name header.
# Exit code = number of failures. No environment setup needed — the scripts locate the workspace themselves.
bash core/scripts/tests/cmd-smoke-test.sh

# Build a project (run from the workspace folder, never from this clone).
cd ~/workspace/dev
bash cmd-varbase11-0-x-project.sh varbase11c1 --install --add-users
bash cmd-drupal11-recommended-project.sh d11c1 --install
bash cmd-<any>-project.sh --help      # argparse usage, safe on any argparse script

# Project lifecycle.
bash cmd-tools-remove.sh myproj        # ddev delete -y -O, then rm -rf
bash cmd-tools-backup-dev.sh myproj    # tar + ddev export-db into ~/workspace/backups/dev/

# Dashboard.
cd ~/workspace/core/workspace-app && ddev start     # then https://workspace.ddev.site
docker exec ddev-workspace-web supervisorctl restart webextradaemons:workspace-app   # restart (supervisord respawns)
bash core/scripts/autostart.sh --enable                            # bring it back after a reboot
bash core/scripts/storage.sh                                       # workspaces on a second disk: --move, --back, --mounts
```

There is no PHP/JS test suite, no linter config, and no build step — `cmd-smoke-test.sh` is the test
suite, and the dashboard is plain `node:http` with vendored HTMX/UIKit (no bundler).

## Architecture

### The bash build chain

Every `cmd-*.sh` is a thin declaration; the work lives in `core/`. A builder resolves like this:

1. Each script resolves `WORKSPACE_SCRIPTS` from its own `${BASH_SOURCE[0]}` (`../core/scripts`)
   before sourcing `bootstrap.sh`, which in turn derives `WORKSPACE_PATH`, `_ROOT` and `_CONFIG`
   from itself and exports all four. **A fresh clone works with no setup — clone, `rm -rf .git`, run.**
   There is no installer and no `.bashrc` edit; exported `WORKSPACE_*` values still win, which is
   how the dashboard container points at its bind-mounted tree. `bootstrap.sh` then loads
   `bootstrap-libraries.sh` (`libs/argparse.sh`, `libs/bash-yaml.sh`, `libs/progress-bar.sh`) +
   `bootstrap-functions.sh` (an explicit `source` list, not a glob — a new `functions/fun-*.sh` stays
   invisible until it is added there), reads `core/config/settings.yml`, and
   fills `root`/`path`/`scripts`/`config`/`backups` from the checkout unless the file overrides them
   (`backups/` is created there and then). `parse_yaml` flattens YAML into shell variables —
   `distribution.webroot` becomes `$distribution_webroot`.
2. `eval $(parse_yaml core/config/workspace.<folder>.settings.yml)` → `$doc_name`, and that is all a
   workspace file holds (no `doc.path`: the folder is `<root>/<doc_name>`). It used to carry
   `database.prefix` and `web.url` as well — both from before DDEV, both with zero readers, since DDEV
   gives every project its own database and the dashboard derives every URL from `hub_domain`.
3. The script sets `site_version` and, **inline in the script itself**, the five distribution facts:
   `distribution_name`, `distribution_title`, `distribution_webroot`, `distribution_profile_repo`,
   `distribution_project_template`. There is no `core/config/distributions/` — a builder is readable
   on its own, and changing what one builder builds touches only that file.
4. `source core/scripts/args/arg-${distribution_name}.sh` → argparse defines `PROJECT_NAME`, `--install`,
   `--add-users`, `--profile`, `--require`, `--enable` (per-distribution).
5. `build_distribution` (`functions/fun-build-distribution.sh`) sources
   `functions/fun-distribution-${distribution_name}.sh` and runs the whole flow: `ddev config` + `ddev start`
   → `ddev composer create-project` → re-align `.ddev` config the template may have overwritten (and adopt
   the template's real docroot) → `set_default_settings` → `install_<name>_with_drush` →
   `enable_<name>_extra_components` → optional `add_users`.

So a new distribution = one `args/arg-<name>.sh` + one `functions/fun-distribution-<name>.sh`
(`install_<name>_with_drush`, `enable_<name>_extra_components`, and `set_<name>_users` for the
`--add-users` list) + the `cmd-*-project.sh` scripts that declare the distribution values and pick a
version. A new workspace folder = one entry in `settings.yml`'s `workspaces:` list + a
`workspace.<name>.settings.yml`; nothing else needs to change.

`add_users` / `cancel_users` call `load_distribution_users`, which sources
`fun-distribution-${distribution_name}.sh` and runs `set_<name>_users`; when the caller knows only the
project (`cmd-tools-add-users.sh`), the docroot is read from the project's own `.ddev/config.yaml`.

**A release line that cannot resolve or install on its own declares what it needs**, in the builder, as bash arrays
that `build_distribution` and `install_varbase_with_drush` read. A builder that declares none builds in one step:

- `site_composer_requires` — root requirements added before the first install, usually an alias. The Varbase dev
  branches ask for packages that have since moved to Drupal 11 (9.1.x wants `varbase_editor 9.2.x-dev`, 10.0.x wants
  `varbase_ai 2.0.x-dev`), so the line aliases the last Drupal 10 release: `"drupal/varbase_editor:9.2.13 as 9.2.x-dev"`.
- `site_patches_ignore` — `"<package> <patch-url>"` pairs written to `extra.patches-ignore` for `vardot/varbase-patches`,
  for a patch the release already contains (it then fails to apply and stops composer). The two-step flow is
  `create-project --no-install --no-scripts`, `require --no-update`, `install`, then `post-create-project-cmd`.
- `site_install_args` — extra profile form values for `drush site:install` (`<form>.<key>=<value>`). **A Drupal checkbox
  is off only when its value is `NULL`**: `0` and `false` still count as checked.

Around those, every build now waits for `ddev drush` (DDEV rewrites its shared command directory whenever any project on
the machine starts, and the helper is missing for a moment), tries the first `composer install` once more (it can fail on
a git cache hiccup and pass at once), stops when `drush site:install` fails, and fails when the site does not bootstrap after
the extra components, instead of printing "has been installed" over a broken site. `enable_modules_present` skips a module
the release line does not have. **A builder declares the docroot its template uses**: `web` for Varbase 11.0, `docroot` for
the rest. `tests/unit/build-distribution.test.js` stubs ddev and reads the calls.

**Version strings follow the file name.** A builder named `cmd-<distro><major>-<minor>-0-project.sh`
pins `site_version="~<major>.<minor>.0"` — the three-segment form, so the constraint means "that minor,
latest patch" rather than a whole minor range (`~10.0` would resolve up to 10.x). A `-x-` builder
tracks the branch (`11.0.x-dev`), and the latest-per-major builders use a caret (`^11`, `^2`).

**WordPress and Odoo are examples, not distributions**, and only in `dev`, `test` and `sandboxes`, with no
workspace of their own: `cmd-wordpress-project.sh` (WordPress latest, wp-cli), `cmd-wpbedrock1-project.sh`
(roots/bedrock, WordPress on Composer, docroot `web`) and `cmd-odoo20-project.sh` (the official `odoo:20.0`
image as a compose service behind the web container's nginx, on DDEV's own `postgres:16`, so
`ddev export-db` and the backups work; custom modules go in the project's `addons/`). `fun-wordpress.sh` /
`fun-odoo.sh` + `args/arg-wordpress.sh` / `args/arg-odoo.sh`; `--install` makes the `account:` user the
administrator. `LAST_ORDER` in `build-order.js` keeps them at the end of the Build list.

Present distribution set: `varbase`, `drupal`, `drupal_cms`. One gap inherited from upstream:
`drupal_cms` has no `install_drupal_cms_with_drush`, so `--install` on the Drupal CMS builders stops
there — the recipes install through the browser installer. `profiles/` builds
`cmd-build-profiles-{varbase,drupal_standard,drupal_minimal,drupal_demo_umami}.sh`, driven by the
`profiles:` list in `core/config/workspace.profiles.settings.yml`.

`core/config/settings.yml` has no `database:` section, and no `host`/`web`/`protocol` either — DDEV owns
every project's database and the hub domain owns every URL, so those pre-DDEV keys had no readers left.
Nothing in the scripts may write a `$databases` block into `settings.php`.

`settings.yml` also carries **`contributor.name` / `contributor.email`** — who commits, merge requests
and pull requests are authored as. Per machine: the committed copy ships `CHANGE_ME`, the live copy
holds the real values, and the file is never synced in either direction. After `bootstrap.sh` they are
`$contributor_name` / `$contributor_email` in any `cmd-*.sh`. The Vardot agents resolve the same setting
(Vardot/dev-ai-agents `.claude/agents/RULES.md`, "Contributor identity"), so **never hardcode a person
in a script, a template or an agent** — a shared tool that names one author makes everyone else's
commits claim someone else's work.

Not every builder goes through `build_distribution`. The site-template builders call
`build_site_template` / `build_site_template_drupalcms` and source `args/arg-varbase-site-template.sh` or
`args/arg-site-template.sh`, and the `cmd-automated-testing-*` scripts carry their own inline argparse heredoc
and drive `ddev` directly. The dashboard's **`builder-args.js`** reads a builder's arguments from what the
script actually runs — its inline heredoc, or its first `source ${WORKSPACE_SCRIPTS}/args/…` line (a literal
file, or `arg-${distribution_name}.sh` resolved from the script) — and expands `${var:-fallback}` defaults from
the builder's own assignments, so the Build form's Arguments panel offers exactly the flags the script's parser
accepts. It used to guess `arg-<distribution_name>.sh`, which was wrong for 96 builders: no panel for the Drupal
CMS site-template builders, and flags the Varbase site-template parser refuses. `tests/unit/builder-args.test.js`
checks every builder against its real `--help`.

**`project-name.js` proposes the name**, from the same read of the script. The field said
`new-project-name` and nothing else, so every build began by inventing a name under pressure — and the
tree shows what that costs: `my-drupal-site`, `my-drupal-site-rightup`, `my-drupal-site-rightup2`,
`my-drupal-site-the-rightup10`. Now choosing a builder fills it, with a code rather than a sentence:

```
<code><major>x<minor><patch>b<n>

v11x0xb1        Varbase, the 11.0.x branch, first build
v11x00b1        Varbase, the ~11.0.0 release
v9x2xb1         Varbase, the 9.2.x branch
ha1x00b1        Horizon Aid ~1.0.0
rightup1x0xb1   The Rightup, the 1.0.x branch
educare1x00vb1  Educare ~1.0.0 on Varbase, which the trailing v marks
byte1x00b1      Byte ^1
atv11x0xb1      the automated-testing twin of v11x0x
penpot1         nothing versioned to read
```

Short because it goes in a hostname, a DDEV project name and a folder, and is typed and read far more
often than written. Every part answers a question somebody asks at a folder listing: what is this,
which line of it, which of my attempts.

- **The code comes from the TITLE, not the machine name.** `horizonaid` is one word on disk and two in
  the world. Several words give their initials (`ha`, `vs`, `dc`); a single word keeps its **word** —
  reducing it to a letter is where a code stops being readable and starts being a puzzle, and it
  collides: Haven and Healthcare are both `h`, CareSphere and Convene both `c`.
  **`short_codes:` in `settings.yml`** overrides any of them, and ships three: `varbase: v` and
  `drupal: d`, typed often enough to have earned a letter, and `rightup: rightup`, because "The
  Rightup" derives to `tr` — a code for the word *the*.
- **The last segment is written the way the constraint writes it.** `11.0.x-dev` ends in `x` and gives
  `11x0x`; `~11.0.0` ends in `0` and gives `11x00`. That one character is the branch against the
  release, which is the difference most often needed at a glance. A segment the constraint omits is 0,
  so `^1` is `1x00`.
- **A site template is named by its TEMPLATE and versioned by the template's own constraint** — the
  base is `drupal/cms` for nearly all of them and distinguishes nothing. **Varbase is the exception**
  and gets a trailing `v`: the same recipe at the same version on the two bases is two different
  sites, and without the mark `cmd-educare1-0-0-project.sh` and
  `cmd-drupalcms2-x-educare1-0-0-project.sh` proposed one name in six workspaces. A builder that picks
  its base from `--distribution` assigns `distribution_name` **twice**, in the halves of an if/else,
  and `scriptAssignments` is last-one-wins — so it claims neither base rather than reporting the
  `else` branch.
- **`b` marks the build counter**, so `v11x0xb2` never reads as part of the version, and it is one past
  the HIGHEST taken rather than the first gap: `b1` and `b3` give `b4`, because the hole left by a
  deleted `b2` may still be in a bookmark, a DDEV router entry or somebody's notes. A stem with no
  version keeps the plain form (`penpot1`), since there is nothing there for a number to be confused
  with.
- **A builder with nothing to declare is read from its file name**, less the words that say what KIND
  of build it is (`recommended`, `tools`, `build`, `drupalcms2`). `automated-testing` is compressed to
  `at` rather than dropped: `test/` holds both `cmd-varbase11-0-x-project.sh` and its automated-testing
  twin, and a name that cannot tell them apart sends somebody to the wrong project.
- **Every workspace with a Build form gets it**, because it is one field rendered once; and the
  Commands page's script Run form prefills the same name into its arguments box for a builder (and
  nothing for a tool, which takes a project that already exists).
- **It never overwrites typing.** The suggestion rides on the `HX-Trigger` of the same
  `/fragments/<ws>/builder-args` request the Arguments panel already makes — one change event, so the
  panel and the name cannot arrive for different scripts — and `ui.js` fills the field only while it is
  empty or still holds the last suggestion. The trigger value is an OBJECT: htmx builds the event
  detail with `Object.assign({}, detail)`, and a bare string spread that way arrives as `{0:'b',1:'y',…}`.

Four builders still share a stem, and the test says so on purpose: `cmd-<template>-project.sh` against
`cmd-drupalcms2-x-<template>1-0-0-project.sh` is the same template, same base, released line — `^1`
against `~1.0.0`, differing only in how far the constraint floats. They build the same site, so one
name is the honest answer and the counter keeps the folders apart.

`site-templates/` is the Drupal CMS side of the same idea, built like `profiles/`: one
`cmd-<name>-project.sh` per free template, a `site_templates:` list in
`core/config/workspace.site-templates.settings.yml`, shared arguments in `args/arg-site-template.sh`, and
one shared `build_site_template` in `functions/fun-build-site-template.sh`. Unlike the Varbase ones these
**do install**: `drush site:install drupal_cms_installer installer_site_template_form.add_ons=<recipe dir>`
answers the installer's template step, so the command ends with a working site on both
`https://<project>.site-templates.workspace.ddev.site` and `https://<project>.ddev.site`. Adding a template
= copy a script, change the three `site_template_*` values, add it to the list. Only free, open-source
templates belong here. The four Vardot templates are in the list too, since the Drupal CMS installer lists
them (28 September 2026, drupal_cms!997); their `cmd-<name>-project.sh` default to Drupal CMS and the latest
release, and `--distribution varbase` builds on Varbase 11.

**Two lists name the templates, and they do not agree.**
[new.drupal.org/browse/site-templates](https://new.drupal.org/browse/site-templates) is the shop window;
`drupal_cms_installer`'s own
[`site-templates.yml`](https://git.drupalcode.org/project/drupal_cms_installer/-/blob/HEAD/site-templates.yml)
is what the installer actually offers, fetched live from git.drupalcode.org and cached. Being in one is no
guarantee of the other: `dashi` is browsable but not in the installer's list, and `forma` and
`lupus_decoupled_starter` are in the installer's list with no browse page. So the folder carries the
**union of the two, free only** — 22 templates, the four Vardot ones among them — and reading only one
list is how a template goes missing. Dripyard's *Meridian Charter* is excluded on both counts: $899, and
not on Packagist at all but in a private repository behind a bearer token.

**Every site-template builder declares its release line** — `site_template_version`, `^1` for almost all of
them and `^2` for Nuxt Starter — and repeats it in the `# workspace-name:` header, which is the label the
Build dropdown shows. Two reasons, both visible in that dropdown: an unconstrained require takes whatever is
newest, so the same command would build a different major the day one ships; and a list of thirty-two entries
that says `Educare (Drupal CMS site template)` twice cannot be chosen from. It is applied with
`SITE_TEMPLATE_VERSION="${SITE_TEMPLATE_VERSION:-${site_template_version}}"` AFTER argparse, which defaults
that variable to the empty string — so `-v` still wins, and the two stay equal when it is not passed, which
is what keeps `site_template_fetched_by_installer` true on the default build. A builder whose name carries a
version (`1-0-0`, `1-0-x`) states it the same way; the dev line says `1.0.x-dev`, not `1.0.x`, because a bare
`1.0.x` reads like a release that exists.

A **Vardot site template** (`drupal/varbase_starter`, `drupal/educare`, `drupal/horizonaid`,
`drupal/rightup` — all `drupal-recipe` packages) has builders on both bases its project page publishes, in
every folder that builds sites: `cmd-drupalcms2-x-<template>1-0-0|1-0-x-project.sh` on `drupal/cms`
(`build_site_template_drupalcms`) and `cmd-<template>1-0-0|1-0-x-project.sh` on `drupal/varbase_project`
(`build_site_template`). `1-0-0` is `~1.0.0` — the three-segment form, so it means "the 1.0 line, latest
patch" rather than the whole major (`~1` would resolve up to 1.x), the same convention the Varbase and
Drupal builders follow — and `1-0-x` is `1.0.x-dev`. The Rightup has `1-0-0` on Drupal CMS only. Both use PHP 8.4 and docroot `web`, stop at the installer URL by default, and install non-interactively
with `--install`.

**The Drupal CMS installer fetches a listed template itself.** Its curated `site-templates.yml` lists Horizon
Aid, Educare, The Rightup and Varbase Starter (card "Varbase"), and picking one runs `composer require` for it.
So a builder that sets `site_template_listed="yes"` (the four in `site-templates/` and every
`cmd-drupalcms2-x-<template>1-0-0`) skips its own require when it stops at the installer, which is the plain
`composer create-project drupal/cms` the project pages publish (`site_template_fetched_by_installer`).
`--install` and an explicit `--site-template-version` still require it, because drush cannot download
anything and the installer always takes the latest release. The `1-0-x` builders always require: the
installer only offers the released package. A failed `create-project` or site-template `require` stops the build. Adding a template = copy
one pair of builders and swap the recipe name.

`settings.yml` also carries `ai_providers:` (openai/anthropic/gemini keys, `sk-change-this` in the
committed copy): `fun-ai-providers.sh`'s `set_ai_provider_keys` pushes real ones into an installed
site's AI stack via the Key module + `ai_provider_<name>.settings` — values over STDIN, placeholders
and missing modules skipped. The varbase install calls it from `enable_varbase_extra_components`,
which also gates the legacy `openai.settings` write so a fresh checkout no longer writes the literal
placeholder into site config.

Hard rules for anything the scripts do:

- **DDEV only** — `ddev composer`, `ddev drush`, `ddev delete -y -O`, `ddev export-db`. No host
  composer/drush/mysql.
- **Drupal CMS telemetry is off in every build.** `ddev_telemetry_off` (`functions/fun-ddev-telemetry.sh`) runs
  `ddev config --web-environment-add=DRUPAL_CMS_TELEMETRY=0` after every `ddev config` of a Varbase, Drupal CMS or
  site-template builder, and again after `create-project`, because a project template ships its own `.ddev/config.yaml`.
  Drupal CMS skips GitLab CI and Tugboat on its own, not a local DDEV site. The variable is read by the Site recipe
  installer only; a plain profile install needs `$settings['drupal_cms_telemetry'] = FALSE;`.
- **Never write a `$databases` block into `settings.php`** — DDEV's `settings.ddev.php` owns it;
  `set_default_settings` only ensures the config sync directory, at a fixed `../config/sync`.
- `ddev start` accepts `-y`; **`ddev stop` does not**.
- **A DDEV project does not come back by itself.** Its containers carry `restart: no`, so after a
  reboot (or a Docker restart) the dashboard is simply not running and every workspace URL answers
  **404 from a router with nothing behind it** — an easy hour lost to debugging a fault that is not
  one. `core/scripts/autostart.sh --enable` installs the systemd user service that fixes it.
  Do NOT reach for a Docker `restart: unless-stopped` policy instead: DDEV rebuilds its containers
  and re-pushes router config on `ddev start`, so a container resurrected behind its back comes up
  with no router entry and answers nothing — the same 404, harder to find.
- **A Docker restart AFTER login stops the dashboard too**, and the boot service (a one-shot) never runs again.
  `autostart.sh --enable` also installs `webship-workspace-watch.timer`: every two minutes
  `core/scripts/autostart-watch.sh` compares Docker's `ActiveEnterTimestamp` with the one it last saw and, when it
  changed, runs `autostart-run.sh` once (the stamp is written first, so a failing start is not retried). It never
  starts anything only because the dashboard is down: one stopped on purpose stays stopped. Machines enabled before
  this need `bash core/scripts/autostart.sh --enable` once more.
- **The base domain is one field, `hub_domain:`**, and `urls.js` / `workspaces.js` already read it
  for every URL the dashboard builds. Change it with `core/scripts/autostart.sh --domain`, which also
  points DDEV's `project_tld` at it; editing the YAML alone leaves the links and the routing
  disagreeing. `*.ddev.site` is wildcard DNS to 127.0.0.1 at any depth, which is the only reason the
  nested scheme works with an empty `/etc/hosts` — and `/etc/hosts` cannot hold wildcards, so a
  custom TLD needs real DNS behind it.
- Every `cmd-*-project.sh` must carry a `# workspace-name: <Human Name>` header — the smoke test enforces it
  and the dashboard's Build dropdown shows it.
- `--help` execution is safe only for argparse scripts; never "test" a non-argparse `cmd-*.sh` by running it.

### Agents, skills, commands and prompts across three sources

Those **four** workspaces are `kind: 'files'` and show **three sources merged by name**: the
workspace folder (drafts), `~/.claude/{agents,skills,commands}` (what a session loads), and
`Vardot/dev-ai-agents` (what the team has).

**Prompts pull, and stop there.** `NO_CLAUDE_SYNC` still refuses every direction that touches
`~/.claude` — fetch, install, check, update, and the `--source claude` pull — because a prompt
is the whole `claude …` launch command for a **new** session. The only way to use one is to
start a session with it: the dashboard's New screen form, or the CLI by hand in the folder or
project it should act on. It is not something a running session loads, so there is nothing to
install. What changed is only where they come from: `Vardot/dev-ai-agents` `prompts/` now,
instead of being committed here.

**All four carry the `ai-` prefix**, and only the WORKSPACE FOLDER does: `ai-agents`,
`ai-skills`, `ai-commands`, `ai-prompts`. The destinations they sync to are the Claude Code CLI's
own directories and keep their names — `~/.claude/agents`, `~/.claude/skills`,
`~/.claude/commands` — as does `prompts/` in `Vardot/dev-ai-agents`. So a rename here touches the
key, never the two things the key points at.

`ai-commands` also has to be prefixed for a second reason: `<root>/commands` is the Settings view
over every `cmd-*.sh` in the tree, a different thing entirely, and two folders called `commands`
would collide. That one keeps its name.

**Two kinds share one destination.** Commands and prompts both install into
`~/.claude/commands/`, and six names exist in both (`drupal-patch`, `explain`, `phpcs-fix`,
`review`, `say`, `test`) — a command is a `$ARGUMENTS` spec typed mid-session, a prompt is a
whole `claude …` launch command that opens a new session in a folder or project. Installing one
writes over the other. Nothing in the tooling picks for you.

**The repo path is not always the project path.** `AI_ITEMS_REPO_PATHS` says where a kind sits
in `Vardot/dev-ai-agents` (`prompts` is top-level there, the rest are under `.claude/`);
`AI_ITEMS_PROJECT_PATHS` says where it installs inside a project, which is always that project's
own `.claude/`. The two were one map until prompts moved, and reusing the repo map for a project
install would have written a project's prompts to `<project>/prompts`. Same split in bash:
`ai_items_repo_path` vs `ai_items_project_path`.

- CLI: `cmd-tools-ai-items.sh` in each of the three folders, backed by `functions/fun-ai-items.sh` +
  `args/arg-ai-items.sh`. Default prints the three counts; `--list-remote`; `--fetch <name>` (repo →
  `~/.claude`, usable after a session restart); `--pull <name>` (repo → workspace folder, to read or
  edit); `--install <name>` (workspace folder → `~/.claude`). Name omitted means all.
- Fetching uses one sparse `git clone` of the repo, not N contents-API calls, because skills are
  directories. `AI_ITEMS_REPO` / `_REF` override the source.
- Dashboard: each row carries `installed` / `workspace only` / `shared` labels; items that exist only
  in the repo are listed under their own heading with **Fetch to ~/.claude** and **Copy here to edit**.
  The repo listing is cached 5 minutes.
- **The container needs its own GitHub auth.** `gh` is in the image and `~/.config/gh` is mounted, but
  the host stores its token in a keyring the container cannot read, so the repo column reports itself
  unreachable until `GH_TOKEN` is set in the dashboard's `.ddev/config.yaml` `web_environment`. The
  host CLI path works regardless.
- **Three sync directions, one command** (the shape the original tooling's issue #11 arrived at):
  `--pull` (repo → workspace folder), `--pull --source claude` (this machine → workspace folder),
  `--install` (workspace folder → `~/.claude`), plus `--fetch` (repo → `~/.claude` directly).
  Dashboard buttons for the first three.
- The repo source keeps its checkout at `<workspace>/dev-ai-agents` and reads files out of the
  **fetched remote branch** with `git archive`, never the checkout's working tree — so whatever branch
  that clone sits on, and any work in progress in it, is left alone. The checkout is gitignored and
  hidden from the item list.
- `--source claude` applies a **name filter** (`--filter`, default `vardot`, `_all_` opts out): a
  machine's `~/.claude` also holds client and third-party items, and a workspace folder can end up in
  a shared repository.
- Promotion (workspace → a PR on dev-ai-agents) stays manual, through the issue/PR agents.
- **Cloning to customise**: `--clone-to <new-name>` copies an item inside the workspace folder and
  **rewrites its identity** — Claude Code dispatches on the frontmatter `name`, so a plain `cp` leaves
  two files claiming one name and which wins is undefined. `rewrite_ai_item_identity` bounds the
  substitution with `(?<![\w-])…(?![\w-])`, not `\b`: these names are hyphenated, and `\b` treats a
  hyphen as a boundary, so cloning `webship-workspace` to `webship-workspace-client-x` would rewrite the
  slug inside the name just written. Adding `--purpose` hands the clone to `claude -p` to tailor and
  reformat it (`tailor_ai_item`, read-only tools); the copy and the AI pass are separate functions so
  cloning works with no AI and no network, and a failed `claude` keeps the untailored clone. The
  dashboard's **Clone** button posts to `/actions/clone-item`, which shells out to the same command
  rather than reimplementing it.

### Commands, the command center (`/commands`, `commands.js`, `cmd-tools-commands.sh`)

**The Commands page is a command center modelled on Rundeck**: one catalog of every command the dashboard
can run, and what each one runs on — a workspace folder, a project, a folder or a file. It replaced the
Settings tabs Commands and Row actions, because none of it is a setting; `/settings/commands` and
`/settings/row-actions` redirect to `/commands` and `/commands/buttons`. Its tabs are **Commands** (the
list), **New**, **Buttons** (the project-row layout and its actions, `row-layout.js`) and **Definition**
(your commands as YAML). The rail's `Go` group links it from every page.

- **Commands are data, not code.** The built-in ones ship in `core/workspace-app/commands/defaults.yml`;
  yours live in `core/config/commands.yml` (gitignored, never synced). One of yours with a built-in id is
  your version of it, in the same place in the list; deleting yours brings the built-in one back, and a
  built-in one cannot be deleted, only copied. `commands.js` merges, checks and runs them,
  `commands-page.js` draws them, and `actions/commands-center.js` writes them.
- A command has `on` (workspace | project | folder | file), `when` (the same node filter as a row action),
  and either `run` (a shell line) or `script: <workspace>/cmd-….sh` with `args`, plus `options`,
  `confirm` and `open`. A line gets values only as `{{workspace}}` `{{project}}` `{{folder}}` `{{file}}`
  `{{path}}` `{{opt.name}}`, each single-quoted, and only where its target has one (`{{file}}` needs
  `on: file`). No line or value may hold `$` or a backtick: the screen runner hands the line to an outer
  shell, which would expand them first.
- **A target stays inside its workspace or project.** `.` and `..` segments are refused, then the path is
  resolved with `realpath` and refused when a link leads out of it.
- Every write carries the file's mtime and refuses with 409 when it changed since. A refused save answers
  with the form still holding what was typed.
- **Buttons hold commands** (part 2, issue #469). A row action's step is a command line or
  `use: <command id>`. `commands.js` `expandSteps` turns a `use:` step into that command's line for the
  row's project: a project or folder command runs in the project, while a workspace command or a script
  runs from its own folder in `( cd … && … )`. A command that runs on a file cannot be used, because a row
  gives no file. A used command's options are asked for with the action's, and its own `when` must match
  too. `row-layout.js` reaches the catalog through a lazy `require`, since `commands.js` requires it.
  Every Add an action box has a command picker, and a command's page lists **On buttons** with **Add to a
  button**. A command of yours that a button uses cannot be deleted (409), removed in Definition, or reset.
- Still to come: the built-in menus moving out of `actions/*.js`, one menu per PR; running on many
  targets; Activity; Schedules. The default project rows must stay identical after each part.

`commands/` owns no builders, and it is **not a registered workspace**. It is not in `workspaces:`, has no
`PRESENTATION` row and **no `workspace.commands.settings.yml`** — a settings file for a workspace that does
not exist only shows up as a tab that configures nothing, so `cmd-tools-commands.sh` sets
`doc_name="commands"` inline instead of reading one. The dashboard derives its directory as
`<root>/commands`, `listScripts` in `commands.js` appends it to the workspace list so its own script is
still listed, and `cmd-smoke-test.sh` iterates `"${workspaces[@]}" commands` so that script stays under
test — deregistering it silently dropped it from the run until that was added.

The scripts stay in the folder they run from — a `dev` builder lives in `dev/`, and moving them would
break every path in the harness — so **every `cmd-*.sh` is listed as a script** in the catalog
(`listScripts`, which `listAllCommands` in `server.js` delegates to; `commands_list` in
`functions/fun-commands.sh` + `args/arg-commands.sh` on the CLI), with Run, Edit, Use in a command, and
the operations that are awkward with 165 commands across twenty folders:
`--list`, `--new`, `--clone`, `--list-remote`, `--diff`, `--pull`, `--propose`.

- `commands_workspaces` reads the `workspaces` **bash array** `bootstrap.sh` already evaluated. Never
  re-`eval` `settings.yml`: `parse_yaml` emits `workspaces+=("…")`, so a second eval appends the whole
  list again and every workspace is visited twice.
- `--clone --workspace <other>` **retargets**: `workspace.<old>.settings.yml` → the new one, and `<old>/`
  paths repointed. A builder moved from dev to demos still reading dev's settings would build into the
  wrong folder. Prose naming the old workspace is deliberately left alone — rewriting a bare name like
  `test` would corrupt ordinary words.
- `--workspace` doubles as the `--list` filter, so it defaults to `_all_`; for a clone that means "leave
  it where it is", not a workspace called `_all_`.
- **A `--pull` can move you backwards**: the release branch does not carry work still in review. When the
  local copy differs it is saved into `backups/commands/` before being overwritten, and the path printed.
- The mirror of the tooling repository lives at `commands/workspace-repo` (gitignored, hidden from the
  listing) and files are read from the **fetched remote branch** with `git archive`, never its working tree.
- `--propose` hands one command to the AI agent to file the issue and open the PR. It is **confirm-gated**:
  without `--confirm` it prints the plan and creates nothing, because filing an issue and opening a pull
  request are public and must never be a side effect of asking a question. When the repository cannot be
  read it says the status is unknown rather than asserting one. Dashboard: **Show me first** and **File the
  issue and open the PR**.
- **HTMX only swaps a 2xx by default**, so every error response this dashboard returns — 67 `send(…, 4xx)`
  plus 9 fragment ones — used to be discarded silently: the refused save, the 409 when a settings file
  changed underneath, `Unknown workspace`, the whole `bash -n` report. The user clicked and nothing
  happened, which reads as a broken button. The `htmx:beforeSwap` handler in `ui.js` sets
  `shouldSwap = true` for 4xx/5xx so the rendered message is shown while the status stays honest.
- A save result goes into `#editor-result` at the **top** of the editor, sticky, and is scrolled into
  view. Appending it after the form put it below a 620px editor — off-screen inside the modal, so a
  successful save looked like nothing had happened.
- **Edit opens in a modal, with Ace.** A command list is 162 rows and an item list can be longer, so
  editing inline meant scrolling to the bottom and losing sight of the row. `#editor-modal` lives in
  `pageShell`, both editors target `#editor-modal-body`, and `ui.js` shows the modal on
  `htmx:afterSwap` into it and empties it on close, so unsaved text never lingers. This is the **one**
  modal in the dashboard besides the confirm dialog, and the two stack, so an action armed inside the
  editor is still asked about.
- **Ace** (`ajaxorg/ace`, BSD-3) is vendored in `public/vendor/ace` and loaded **on demand**: 780KB of
  editor has no business on a page that is not editing. It attaches to `textarea[data-ace="<mode>"]`,
  hides the textarea but **leaves it in the DOM** — it is what the form posts — and mirrors every change
  back into it, so no endpoint changed. `sh` for commands, `markdown` for the item editors; the theme
  follows the dark toggle. If Ace fails to load the textarea is simply still there and still works. Only
  `worker-yaml.js` is vendored, so `useWorker` is off for the other modes — the JS/HTML/CSS workers are
  873KB and only lint fenced blocks inside markdown.
- **Edit** opens the script in a textarea and `/actions/command-save` writes it, but only after
  `bash -n` accepts it — a broken `cmd-*.sh` takes out the Build dropdown and the smoke test, and whoever
  broke it is not necessarily whoever finds out. It also normalises CRLF (a shell script with CR endings
  fails as `$'\r': command not found`), preserves the executable bit, refuses an empty file, and says when
  the `# workspace-name:` header has gone. `resolveCommand` checks the name, the folder, and that the
  RESOLVED path is still inside the workspace root.
- Every dashboard action shells out to `cmd-tools-commands.sh`, so the buttons and the CLI cannot drift.
  The block-local job helper is `runJob`, deliberately not `run`: naming it `run` shadowed the
  module-level process runner, so `bash -n` became a background job with `ROOT` as its timeout and the app
  crashed.

### GitLab CI green-gate (`cmd-tools-gitlab-ci-local.sh`)

The git-clone workspaces (modules, themes, profiles, recipes, products) carry
`cmd-tools-gitlab-ci-local.sh`, backed by `functions/fun-gitlab-ci.sh` and
`args/arg-gitlab-ci-local.sh`. It enforces the Vardot green-gate: run the project's pipeline locally
and push only when every job is green. `--doctor` checks gitlab-ci-local, Docker, SSH to
git.drupal.org, and installs the `~/.local/bin/drupal-ci-local` wrapper (the
drupal/gitlab_templates remote variables, over SSH). `--list`, one `JOB`, `--variable`, `--slim`.

**Known blocker, stated rather than hidden**: gitlab-ci-local crashes evaluating any rule whose `=~`
regex embeds a `$variable` (firecow/gitlab-ci-local#1893), and drupal/gitlab_templates has used that
pattern on every ref for years — so the FULL templates pipeline cannot run locally today, on any
version of either. The command detects that exact crash and points at `--slim`, which runs the
project's committed `.gitlab-ci-local.yml` (the reproducible subset, self-contained, no templates).
Template-only jobs gate on the remote pipeline.

### Penpot, self-hosted (`designs/cmd-penpot-*.sh`)

The `designs` workspace runs **Penpot** as DDEV projects beside the Figma exports:
`cmd-penpot-project.sh` (build + register the first account), `-backup` (Postgres dump **and** the
asset volume — either alone is useless), `-token` (an access token for the Drupal AI Penpot module,
printed once and stored nowhere) and `-mcp` (`-a start|stop|status|register` for the Penpot MCP
server). Backed by `functions/fun-penpot.sh` and four `args/arg-penpot*.sh`; every default is in
`penpot:` in `core/config/workspace.designs.settings.yml`, so the commands normally take a project
name and nothing else. It automates `products/ai_penpot/docs/penpot-on-ddev.md`.

The stack is DDEV custom compose services on the project's `default` network (frontend, backend,
exporter, postgres:15, valkey, mailcatcher) with the DDEV web container's nginx reverse-proxying to
`penpot-frontend:8080` — so DDEV owns the router and the TLS certificate and there is no standalone
`docker-compose` to keep in sync. The project is `--project-type=php` with settings management off
and no docroot: nothing in it is served from disk.

Four things that are not obvious, each of which cost a rebuild to find:

- **An instance serves exactly ONE origin.** Penpot's frontend fetches the API from
  `PENPOT_PUBLIC_URI`; from any other hostname every call is cross-origin and CORS blocks it, which
  presents as a **blank page**, not an error. `public_uri: hub` (the default) makes that origin the
  hierarchical `<project>.designs.workspace.ddev.site`, because that is the address the workspace
  hands out. The canonical `<project>.ddev.site` remains useful for the RPC API — curl has no CORS —
  but it is not a browser alias.
- **`enable-access-tokens` is not optional** for `drupal/ai_penpot`: without it a token is ignored
  *silently*, resolving to Anonymous rather than 401. `enable-plugins` is what the Penpot MCP needs.
  Both are in the default flag set.
- **Each instance publishes a mail-catcher port**, so a fixed 1080 makes the second instance fail to
  start; `penpot_free_mail_port` takes the next free pair and the run prints it.
- **`parse_yaml` keeps a value's quotes.** `version: "2.16"` arrives as `"2.16"` — which lands in an
  image tag verbatim — and `secret_key: ""` arrives as a NON-empty string, so every
  `${x:-fallback}` default silently stops working. `penpot_setting` strips one layer of quotes, and
  anything read from settings goes through it.

**The MCP server needs five non-obvious things**, all of them found by making it actually run.
argparse-bash emits an assignment per defined argument, so several `store_const` aliases sharing a
dest overwrite each other — `--start` parsed as `status`, hence the single `-a` option. pnpm 11 has
moved its supply-chain answer from `onlyBuiltDependencies` to `allowBuilds` (given only the old key
it writes a stub and fails anyway), `corepack enable` cannot symlink into `/usr/local/bin` as a
non-root user, and running as root leaves a `node_modules` tree the user cannot delete. Finally the
servers bind **IPv6 loopback only** and the editor page is https, so the container joins the
instance's web-container namespace and nginx publishes `/mcp`, `/mcp-plugin/` and `/mcp-bridge` on
the instance's own origin with `[::1]` upstreams — which also means the MCP container starts after
the project and must be restarted with it. Installing the plugin inside the editor is still refused;
that is stated in `designs/AGENTS.md` rather than implied to work.

Server-to-server access is the **canonical** hostname, not the hub one: from another container the
hub hostname fails TLS (`no alternative certificate subject name matches`), which is what the Drupal
AI Penpot module hits. Browser origin = hub, PHP/curl origin = canonical.

`designs` is the first **hybrid** workspace: `kind: projects` plus `also_files: true` in its own
settings file, so its page carries the Build form and the project table (Penpot instances, with the
DDEV actions) *and* the file list as a second section below. `alsoFiles` also renames that section
("Design files") and gives it its own target, since two identically titled lists with two identical
search bars reads as a rendering bug — and with no files it collapses to one line rather than a
second search and pager.

### Avatars (`avatars/cmd-avatar-project.sh`, `cmd-tools-avatar-*.sh`)

The `avatars` workspace holds **talking AI characters**: a VRM character on a three.js page that speaks,
moves and lip-syncs, with a Claude Code agent as its mind and a browser, Piper or ElevenLabs voice. Each
avatar is a DDEV project cloned from the avatar app (`avatar.repo` in `workspace.avatars.settings.yml`,
shipped as `CHANGE_ME`): a Node app with **no database**. Backed by `functions/fun-avatar.sh` and five
`args/arg-avatar*.sh`; `remove`, `reclaim` and `screen` are the generic tools.

- `cmd-avatar-project.sh <name>` clones the app, names the DDEV project after the folder and **drops any
  extra hostname the repository declares**: every clone carries the same `.ddev/config.yaml`, and two
  projects on one hostname is a router conflict where the last to start wins. It refuses a name that is
  already a project name OR an additional hostname anywhere in the tree (`ddev_hostname_owner`).
- `cmd-tools-avatar-character.sh` writes `characters/<id>.json` in the project, which the app reads on
  start (the app must support that folder). `--model osa:<name>` fetches a VRM from the Open Source Avatars
  registry: the licence is on the **collection**, so it reads `projects.json`, then each collection's
  `avatar_data_file`; the top-level `avatars.json` carries older ids that join to nothing. A downloaded
  file must start with the glTF magic bytes. The registry's licence is saved with the character and
  reported as "as the registry lists it": it and an avatar's own page do not always agree.
- `cmd-tools-avatar-agent.sh -a create` writes `claude/agents/avatar-<id>.md` in the project and links
  it into `~/.claude/agents/`; `-a link` links a project's agents. Every clone also carries the app's own
  agents, so **a link that already points at another project's copy is left alone** unless `--replace`:
  linking them all would silently move those agents to whichever clone was linked last.
- `cmd-tools-avatar-voice.sh` installs Piper voices from `rhasspy/piper-voices` into
  `~/.local/share/piper-voices` (mounted read-only into every avatar) and links the ElevenLabs key from
  `settings.yml` through the app's own script, never printing it.
- `cmd-tools-avatar-catalog.sh` lists voice engines and avatar libraries with their licences (checked
  October 2026), and with `--list` every public VRM in the registry.
- **argparse-bash evaluates values in the shell**, so every free-text argument has a `text` type that
  refuses quotes, `$`, backticks and backslashes; a persona comes from `--persona-file`. JSON is written by
  `python3` with values passed in the environment, never spliced into code.
- A new character or agent restarts only the app process (`supervisorctl restart
  webextradaemons:avatar`), not the container.

### Google Drive (`cmd-tools-google-drive-sync.sh`, the `google-drive-sync` plugin)

`videos`, `audio`, `docs`, `specs` and `test` carry `cmd-tools-google-drive-sync.sh` and a **Sync to Drive**
button (rail group *Google Drive*; **Sync test reports** on `test`), over `functions/fun-drive-sync.sh`.

**It is a node module plugin, with a settings file of its own.** The package is
`core/workspace-app/plugins/google-drive-sync` (`@vardot/workspace-google-drive`, a `file:` dependency in the
dashboard's `package.json`, loaded by name through the plugin loader's `module:` key; the folder is only the
fallback before `npm install`). Inside: `index.js` (`register(api)`, the panel and its actions), `lib/drive.js`
(the Drive v3 calls), `lib/cli.js` (what the command and the Screen run), `lib/mcp.js` (the MCP server),
`lib/reports.js` and `lib/context.js` (paths, the settings file, the migration), and its own `tests/`. It
requires nothing outside its folder: a test fails if it does, because the command line and the MCP server run
outside the dashboard and must not need it. From the dashboard it gets only the plugin `api`
(`api.lib.screenAction`, `api.lib.auth`, `api.settings`).

**Its settings are `core/config/plugin.google-drive-sync.settings.yml`**, flat (no `google_drive:` block), and
nothing of them lives in `settings.yml` any more. Each plugin gets a file like this (`api.settings` reads and
edits it in place, creating it mode 600; the Settings page lists it and masks `client_secret` and
`refresh_token`), and `sync-tooling` never copies it, like `settings.yml`. A machine that still has the old
`google_drive:` block in `settings.yml` is read as before and **moved once**, by the first run of the plugin, the
command or the MCP server (`migrate()`: values and comments copied, file made private, block removed from
`settings.yml`). The OAuth client in it is also what the dashboard's Google sign-in uses.

**Team setup, made to be done in the panel.** Once, by whoever owns the Google Workspace: enable the
Drive API and create a *Web application* OAuth client on an **Internal** consent screen (no
verification, no 7-day token expiry), with the redirect URI the panel shows
(`https://<hub_domain>/fragments/p/google-drive-sync/callback`, the same for everyone on the default
hub domain). Then each person: open **Sync to Drive** on any of those pages, paste the client id and
secret (saved on their machine only), press **Connect** with their own Google account, and **Choose the
storage folder**. That is all; nobody edits YAML.

- **Where it goes.** `root_folder` is one storage folder (any folder, or one in a Google
  Workspace **shared drive**), and
  every workspace stores into `<root_folder>/<workspace>`. `destinations.<workspace>` gives
  one workspace a folder of its own. Nothing about a person or a Drive is committed.
- **Which places the picker offers is a setting.** `locations` lists any of `my_drive`,
  `shared_with_me`, `shared_drives` and the sidebar views `starred` and `recent` (a view only decides what
  the picker offers; the folder picked is still judged by where it lives); **My Drive alone is the default**, and an unknown value falls back to
  that rather than allowing everything. It is enforced in the library, not just hidden in the picker: a folder
  pasted as a link is judged by where it lives (`driveId` means a shared drive, `ownedByMe: false` means shared
  with me), so a disallowed one is refused, and the MCP's `drive_list_folders` follows the same rule. A
  destination already saved is not re-checked.
- **It runs as a Screen, like every other command.** Preview and Sync start the session `<workspace>--google-drive-sync`
  through `screenAction` (the plugin API's `lib.screenAction`), so they show on the Screens page, survive a
  dashboard restart and can be attached from a terminal; the panel answers with the standard "watch on Screens"
  toast and does not echo the command. One session name for both, so a Preview and a Sync never overlap.
- **Plan, then write, and ask before replacing.** A push first compares the tree with Drive and sorts
  every file into new, unchanged, or *would overwrite a file already there*, and notes the existing sub
  folders it would write into. If there are any overwrites or merges **nothing is written** until
  approved: the command lists them and exits 3 (`--overwrite` approves), the panel shows the list with
  **Approve and sync**, and the MCP tool returns it and writes only with `approve_overwrite`. A folder
  counts only when something would actually be written into it, so a re-push with nothing changed asks
  nothing. New files, unchanged files and `--dry-run` never need approval. Nothing on Drive is deleted.
- **Only selected, targeted files go.** `targets.<workspace>` is the list of what a workspace may
  push, and a workspace with **no targets pushes nothing**, never "everything". A name with no slash
  (`*.mp4`) matches at any depth, a path with a slash (`guide/*.pdf`) matches from the workspace root, a folder
  (`guide/`) means everything in it. Shipped starters are deliverables only: videos `*.mp4`, `*.webm`, `*.mov`,
  posters and captions; audio `*.mp3`, `*.wav`, `*.ogg`, `*.m4a`; docs `*.pdf`, `*.docx`, `*.pptx`, `*.xlsx`;
  specs `*.md`. The Sync panel edits them (Save targets); the `test` workspace pushes its reports and needs
  none. Naming an item (`cmd-tools-google-drive-sync.sh ITEM`) is an explicit selection and needs no target.
  A Drive folder is made only when something is pushed into it, and hidden files and folders are never pushed
  (a scratch folder such as `.work-…` once held 7,800 files and a Python install).
- **What never goes, whatever the settings say.** A built-in baseline (`BASELINE_EXCLUDE` in `drive-sync.js`;
  `exclude` adds to it and cannot remove from it): `cmd-*.sh`, the workspace's own `AGENTS.md`,
  `CLAUDE.md`, `README.md` and `*.code-workspace` at the top level only (a README inside a project is content),
  and files that hold passwords or keys by name (`.env*`, `*.pem`, `*.key`, `id_rsa*`, `*secret*`,
  `*password*`, `*credential*`, and so on). On top of the names, small text files are read and one that
  gives away a private key, a known token format or a `password:`-style value is skipped and named in the
  output; placeholders (`CHANGE_ME`, `${VAR}`) and plain words do not trip it. `scan_for_secrets:
  false` turns the reading off; the name rules stay. Nothing already on Drive is deleted when a rule is added.
- **What happens to a file that is selected.** Changed files are updated in place (same Drive id, so links and sharing survive),
  unchanged ones skipped by size and MD5. `exclude` globs (`node_modules`, `.git`,
  `dev-ai-agents`, …) and symbolic links are skipped. `sources.test: test-reports` makes
  `test` push each project's report, failure screenshots and recordings as
  `<project>/<module>/reports|screenshots|videos`, not the 9 GB of built sites.
- **Why not the claude.ai Drive connector.** It uploads by passing the file's content through a tool
  call as text, so a video cannot go that way. This streams resumable 8 MiB chunks over Drive's REST API
  with your own OAuth client, not rclone.
- **Scope is full `drive`.** Choosing a folder you already have needs it: `drive.file` only sees files
  the app itself created. A Drive *Workspace* (the drive.google.com/drive/workspaces view, limited to
  25 files) is not a folder and is not offered.
- **Settings survive an update that never saw them.** `sync-tooling.sh` never overwrites a machine's
  `settings.yml` or a `plugin.*.settings.yml`, so `upsertSettingsValue` / `upsertSettingsList` (in
  `settings-file.js`, behind `api.settings`) create a key on first save, and the loader ships this plugin
  **on by default** (`SHIPPED_PLUGINS` in `plugin-loader.js`, which also names its `module:`; a `plugins:` line
  with `enabled: false` still turns it off). `client_secret` and `refresh_token` are secret rows: never sent to
  the browser. An empty value is written as `""`, because
  a bare `key:` stops being an editable row.
- **MCP:** `cmd-tools-google-drive-sync.sh -a register` adds `google-drive-workspace` to the Claude Code CLI over
  stdio (`drive_status`, `drive_list_folders`, `drive_create_folder`, `drive_upload_file`,
  `drive_sync_workspace`). It reads the same settings, so no secret sits in the registration, and
  `drive_upload_file` refuses a path outside the workspace tree. `register` proves the server answers
  `initialize` before adding it.
- Tests run against a local stand-in for Google (`GOOGLE_DRIVE_API`, `GOOGLE_DRIVE_UPLOAD_API`,
  `GOOGLE_TOKEN_URL` override the endpoints), so `drive-sync.test.js` covers chunked upload,
  update-in-place, the approval rule and the storage folder without a Google account.

### Sign in with Google for the dashboard (`auth-google.js`)

Off by default, and right to be off on a laptop, where the dashboard answers only that laptop. On a remote
hub (`hub_domain` set to a public domain) it must be on: the dashboard starts builds, opens terminals and
edits settings. `auth.google` in `settings.yml`:

```yaml
auth:
  google:
    enabled: true
    allowed_domains: [vardot.com]      # and/or allowed_emails: [someone@example.org]
    session_hours: 12
```

- **One OAuth client.** It reuses the Drive plugin's OAuth client (`client_id` / `client_secret` in `plugin.google-drive-sync.settings.yml`); add
  `https://<hub_domain>/auth/google/callback` to that client's redirect URIs beside the Drive one.
- **Who gets in.** A Google account whose email Google has verified, on an allowed Workspace domain, and
  whose token carries a matching `hd` (hosted domain) claim: a personal account cannot claim
  `@vardot.com`. `allowed_emails` names individual addresses. Nothing allowed means nobody.
- **Fails closed.** Enabled with no OAuth client or no allow-list answers 503 saying what to set, rather
  than letting everyone through. Locked out: set `auth.google.enabled: false` in `settings.yml`; settings
  are read live, so it applies at once.
- **It is the first thing every request meets**, in `server.js` before any route, so a route added later is
  covered without remembering it. A page goes to sign-in, an htmx call gets 401 plus `HX-Redirect`, an
  action gets 401, and the **terminal WebSocket upgrade is refused** without a session (a terminal is a
  shell). `/auth/signin`, `/auth/google/login|callback`, `/auth/signout` and `/auth/me` are the only
  exempt paths.
- **The session** is an HMAC-signed cookie (`ws-session`, `HttpOnly; Secure; SameSite=Lax`) on the hub
  domain, so one sign-in covers every `<workspace>.<hub>` page. The signing secret is generated on first
  use into `core/workspace-app/.auth/` (gitignored, kept out of `sync-tooling --pull`'s `--delete`).
  Where to go back to after sign-in is checked against the hub domain, so it cannot bounce somebody to
  another site.
- **The ID token is not signature-checked**, deliberately: it arrives straight from Google's token
  endpoint over TLS in exchange for our one-time code, which is what OpenID Connect allows for that flow.
  Issuer, audience, expiry, nonce and the claims above are all checked.
- **Not covered:** project sites at `<project>.<workspace>.<hub>` are served by the DDEV router, not this
  app. And a signed-in session is same-site with those project sites, so a hub that runs untrusted project
  code is not made safe by this alone.
- **One account for both.** The Drive panel's Connect is the standard Google button and pre-selects the
  account you signed in with, or the plugin's `account` setting (your own Google address, set per machine in
  the plugin settings, blank in the shipped file) when there is no dashboard sign-in (`login_hint`), warning if
  Drive ends up connected as another. `auth.google.allowed_emails` names individual addresses that may sign in.
  They stay two grants: dashboard sign-in asks only `openid email profile`, because on a shared hub one
  person's sign-in must never replace the Drive token another person connected.

### The assistant's avatar (`public/assistant-avatar*.js`, `reader.js`)

The AI Assistant can be shown as an avatar, free on the page, drawn in 2D by default: by default the **Vardot
Bot**, the assistant's own character, the dot at the end of the Vardot wordmark brought to life as a clock (in
the brand colours from Figma's VDT - Stylesheet: a thin brand-blue disc for a body with a clock's face drawn on
it in white; the round Vardot emblem at each hour with its number upright in the emblem's circle, in Figtree;
the square emblem at each minute out at the edge, every mark turned to open outwards; hands that keep the real
time, the hub its nose; steady eyes under straight brows and a small smile; rubber-hose arms with ringed cuffs and
big white gloves, thin bowed legs in round shoes on white soles. Every logo and mark is the SVG's own path from
`public/vendor/vardot-icons/logo/`, holes found by nesting as the even-odd rule draws them), or
**Druplicon**, a friendly cartoon Drupal drop. Both are built in code (`tools/build-vardot-bot.mjs` and
`tools/build-druplicon.mjs` in github.com/Natshah/druplicon-avatar, run with that project's three.js:
`docker exec ddev-workspace-web node <that path>/tools/build-vardot-bot.mjs core/workspace-app/public/avatar/vardot-bot.vrm`). No
separate project runs it: the dashboard serves the model (`public/avatar/druplicon.vrm`, built in code by
`tools/build-druplicon.mjs` in github.com/Natshah/druplicon-avatar) and three.js r185 + three-vrm 3.5.5
(MIT, vendored in `public/vendor/`), and fetches them only the first time it is shown, the way Ace is loaded.

- **Show and Hide are the first item of the robot button's menu**, and hidden means silent (the voice
  stops, its windows close, the scene is let go). Shown, Druplicon is free on the page and carries nothing:
  no card, no frame, no button. Drag it anywhere; it flies there itself on `MOVE: left | center | right |
  panel`, beside a window when one opens, and every 15 to 25 seconds while nothing is happening (an option;
  never with reduced motion, never over the conversation). Its place and size are cookies on the hub domain.
- **Every option is on the assistant's side.** Under the conversation, the avatar app's voice dock: voice on
  or off, the big **Hold to talk** button (or the Space bar anywhere you are not typing; sent when you let
  go) and **Keep listening** (each sentence sent as you finish it). deep-chat's container copies its host's
  height (`height: inherit`), so the dock is pinned in the body's bottom padding rather than taking height
  from deep-chat. **The robot button in the header opens a menu that holds the rest**: show or hide the
  avatar, the board, the open windows (show or close each), and settings (which avatar, size,
  where it stands, wandering, and the voice: which one, volume, speed, pitch, kept per browser). The menu
  carries `data-keep-open`, because `ui.js` closes any dropdown when a button in it is clicked, and this
  one is a panel of tools rather than a list of choices; the board closes it, since it opens a window.
  There is no list of moves: which move fits is the reply's to choose.
  Under the header, the quick replies (Yes, No, Next, Continue; Pause, +10 s, Quieter and Loop while a video plays). A test keeps the
  stage free of buttons.
- **It acts out the reply.** While it is shown the request says so (`avatar: true`) and only then is the
  assistant told about its lines: gesture tags (`[wave]`, `[point]`, … — `AVATAR_GESTURES` in `assistant.js`
  must stay a subset of the moves in `assistant-avatar.js`, and a test says so), `BOARD:` (a line, `clear`,
  or `note <text>`), `DRAW:`, `SHOW:` (a YouTube video) and `VIDEO:` (play, pause, forward/back seconds,
  seek, louder, quieter, volume, mute, speed, restart, loop, close), `BROWSE:` (a link, or back, forward,
  reload, down, up, top, bottom, find, click, zoom, read, newtab, close), `SEARCH:` and `MOVE:`. All of
  them are taken out of the reply text. With the browser open, each message also carries what it shows
  (title, address, how far down, the text in view, its links), so the assistant reads and clicks on.
- **The board is a place to work and to draw on**: dotted paper, a pen in eight colours and four widths,
  sticky notes, undo, clear, and saving the drawing as SVG and the notes as Markdown. The assistant draws
  like an artist: thin lines by default, `color=` `fill=` `width=` `opacity=` `dash` on any shape, and
  `curve`, `poly`, `polygon` and `ellipse` besides boxes, circles, arrows and text. Every window resizes
  from its corner or fills the page; each video has its own player and controls.
- **Pages open through `reader.js`** (`/fragments/reader?u=`), because most sites refuse to be framed.
  The fetch runs inside the dashboard's container, which reaches the Docker network and every DDEV
  project, so only https, a public NAME (never an IP, never `*.ddev.site`), every resolved address public,
  and each redirect checked again; the page is served without scripts, frames or forms under a
  `default-src 'none'` policy, in a sandboxed frame. A web search is DuckDuckGo's plain results through the
  same reader. A bot check (drupal.org) is reported, never worked around.
- **Other avatars, only the ones settings.yml names** (`assistant-cast.js`). `assistant.avatars:` lists
  them; `druplicon` ships here, and any other name is looked up in the avatars workspace: a character
  file (`characters/<name>.json` or `osa-<name>.json`, which gives the model, the name and the credit) or
  a bare `public/models/<name>.vrm`. Models are served from there (`/avatar/model/<name>.vrm`, only a
  listed name, only a real file inside `<root>/avatars` after `realpath`) and never copied into this
  repository: licences are per model, and some are for personal use only. The settings pop shows the
  credit of the one picked. A VRM 0 model turns the other way about x and z, so the pose is mirrored for
  it (`metaVersion === '0'`); without that the arms go up at rest.
- **Its voice is the narration's**: the browser's best free voice when none is configured (neural
  "Natural"/"Online" voices first), and the mouth follows the spoken words. **ElevenLabs voices** join the
  list once `elevenlabs.api_key` is a real key: listing them is free (`/fragments/assistant/voices`,
  cached ten minutes), and speaking spends credits, so it happens only when someone picks one, in a group
  labelled so. The page posts the words to `/actions/assistant/speak` (JSON, same origin only) and gets
  the mp3 back: the key never leaves the server. What was spoken is kept in `.voice-cache/` (gitignored,
  never synced, 400 clips), so a sentence heard again costs nothing; when the server cannot speak, the
  browser's voice says it instead. Piper, which is free, would need adding to the dashboard image.
- **The Vardot icons** (`public/vendor/vardot-icons/`, from Figma VDT - Stylesheet: "features" and
  "aesthetic"). The interface set (sound on/off, play, pause, stop, headset, share, menu, heart, support,
  bookmark) is drawn as a CSS mask in the text colour at the size the design gives each icon, so it is ink at
  rest, brand blue on hover and light in dark mode without editing the files: the dock's mute and Keep
  listening, the video player, Read aloud and Open in a real tab, Save notes, and the assistant header's
  menu. The brand sets (value, service, industry, in every colourway) are images in their own colours, and
  each sticky note carries one of the value marks in turn. The robot menu's board, windows and settings
  buttons carry the dashboard's own Tabler icons (`iconHtml`), drawn by the server like the rest of the header. Windows sit above the avatar (z-index 993 over 990/991), so it never covers them.
- **Model links carry the file's time** (`/avatar/model/<id>.vrm?v=…`), so a rebuilt model is fetched at once
  rather than after the hour a browser may keep it. The 3D look has a cool rim light from behind.
- **The agent's status, as the Claude Code CLI shows it.** While a reply is on its way a bubble
  at its feet shows a spinner (✻), a verb and the seconds so far, and the avatar acts each verb out, every 4 s: Thinking
  (think), Pondering (look), Tempering (hammer), Searching and Reading (scan), Brewing (stir), Coding (type),
  Crafting (hammer). The moves are shared, so every avatar does them. The reply ends it with Done and a thumbs
  up; a failed request (`ws-assistant-working` with `failed`) with Stopped and a shrug. The bubble uses the
  Figma alert colours: info while it works, success for Done, danger for Stopped (`--success`,
  `--success-soft` and `--success-ink` were added to every theme for it).
- **Colours of your own.** The settings list the avatar's parts (its materials by name, every hair material as
  one Hair part; outlines and the face excepted) with a colour picker each and Original colours, kept per avatar
  and per browser. 2D lights the figure with one even light as bright as the 3D lights together, so it is not dimmed.
- **It is drawn across the whole browser.** The canvas is a click-through layer over the whole window
  (`.avatar-layer`), and the figure is framed for the card it stands in (`.avatar-float`, invisible, the part
  you drag) and drawn at that card's place with a camera view offset, updated every frame as the card flies,
  resizes or is dragged. So no move or flight is ever cut at a square edge, and the page under it stays usable.
- **Big moves travel the page** (`BIG` in `assistant-avatar-ui.js`): `[tour]` a loop round the page and home,
  `[dash]` a walk across and back, `[jump]` a leap up the page, `[zoom]` Huge for a moment, `[present]` to the
  middle, bigger, explaining, and `[spin]`. The card follows a path frame by frame while the body walks, flies
  or leaps (`walk`, `leap` and `spin` are moves of their own). The assistant is told to use at most one per
  reply; with reduced motion only the move on the spot is done.
- **2D or 3D** (the Look setting, per browser, 2D unless 3D was chosen): 2D draws the figure flat, with an
  orthographic camera and one even light, like a cartoon drawing with its outlines; 3D is lit and in perspective.
- **A clock that keeps time.** A model with parts named `HourHand`, `MinuteHand` and `SecondHand` (the Vardot
  Bot's) has them turned to the viewer's local time every frame; a move can add turns (`o.clockSpin`), so the
  hands race round the dial for `spinhands` and `tada`.
- **A voice per avatar.** Each avatar keeps the voice picked for it, an ElevenLabs one included; until one is
  picked, the best free voice. ElevenLabs is never a default: a `voice_name` in settings.yml naming one is
  ignored, since it spends credits.
- **Sizes, and where it lives.** Small, Medium, Large, Very big and Huge (most of the page height), in the
  settings or from the reply (`SIZE: small | medium | large | xl | huge | bigger | smaller`), keeping its
  feet where they were. It lives by the assistant's text box (`MOVE: home`), starts there each time it is
  shown, and its moving about now and then stays near there, unless "Roam the whole page" is ticked.
- **An avatar's own moves, hair and agent.** A move set (`public/assistant-avatar-moves.js`) adds moves to
  the shared ones and replaces the shared ones of the same name. `clock` is the Vardot Bot's: fists on hips,
  a welcome with palms up, an arm swept out to show something, a fist pump, a thumb at itself, a wink, a sidelong
  look, a strut, and the hands racing round the dial; a move curls the fingers with `p.hand(side, shape, e)`.
  `labiba` is Labiba's own, from her avatar app, chosen for work (a bow, no, reading, a magnifier, drawing on the board, a launch…), without the
  headscarf or the moves meant for children; a test keeps it so. The assistant is told only the moves of the
  avatar shown (`avatarId` travels with each message). `assistant.avatar_hair.<id>` sets the hair colour it
  starts with (any material named for hair is recoloured; the settings offer the brand's blue and navy,
  everyday colours and any colour), and `assistant.avatar_agents.<id>` the Claude Code agent it brings while
  shown, when installed.
- **The Workspace's language, `language:`** (top level, en-US by default): the assistant answers in it
  unless spoken to in another, and it is what the microphone listens for and the voice speaks, unless
  `assistant.speech_language` pins those on their own.
- **Settings, in `assistant:`**: `avatar:` (the one it starts as, or `none`), `avatars:`, `memory:` (a folder inside the tree, default
  `core/workspace-app/.memory`, gitignored and never synced; the assistant keeps what the team teaches
  it in `MEMORY.md` there, which is the one change it makes without asking) and `agent:` (the Claude Code
  agent it runs as, `webship-workspace` by default, used only when installed).

### Upsun (`cmd-tools-upsun.sh`)

The `dev`, `test`, `sandboxes`, `demos` and `projects` workspaces carry `cmd-tools-upsun.sh` — every
folder that builds a site, since any of them may need to be put in front of somebody,
backed by `functions/fun-upsun.sh` (`ensure_upsun`, `upsun_linked_id`, `upsun_project_tool`) and
`args/arg-upsun.sh`. A project links to Upsun via `.upsun/local/project.yaml` + an `upsun` git remote
(`upsun project:set-remote <id>`); the tool shows that link and the environment list (default,
read-only), and gates the mutating verbs behind explicit flags: `--link` (refuses to relink without
`--force`), `--init` (`upsun project:init`), `--push` (upsun's own confirmation), `--logs`,
`--activities`. It never creates or deletes Upsun projects/environments, and it never installs the
upsun CLI silently — that carries cloud credentials, so it prints the install command instead.

The dashboard shows an UPSUN menu on every project in a workspace that carries the command, linked
or not: a linked one lists its id, environments, activities and deploy log, and an unlinked one says
so and prints the `--link` command. Hiding the control until a project was linked made the feature
look like it existed only for demos, which are simply the projects that happen to be linked.

### New folder (`folders.js`, `actions/folders.js`)

Project workspaces whose type allows `folder` (Sites and Code) carry **New folder** in their Create group,
so it is also a *What would you like to create?* tile. It makes an empty `<workspace>/<name>` (lowercase,
digits, `-` and `_`, nothing that exists, never `node_modules`), writes the optional "what is it for" as
the folder's note, and can then start a terminal or Claude Code there through the same `/actions/screen-new`
handler New screen uses (`p:<workspace>:<name>`). The folder is listed like any project without DDEV, so
Screens, IDE, GIT, the note and every project or folder command work on it with no further wiring.

It can set the folder up in the same step, as ONE setup screen session so each step waits for the one it
needs (`setupLine`): `ddev config` in the folder, then `cmd-tools-testing.sh` (varbase-e2e), then
`git init` and `cmd-tools-upsun.sh --link <id>`. The two AI tasks, a Jira workitem through the
jira-workitem-manager agent and a NEW Upsun project with a deploy, go into one Claude Code prompt
(`claudePrompt`). Creating an Upsun project is billed, so it is never a command here: the prompt makes the
session ask for the organization, region and plan and wait, which keeps the Upsun tool's rule that it
never creates projects. Every option is checked before the folder is made (`formProblem`).

**The project workspace's card is "What would you like to create?"**, with New folder beside the builder
form. A files workspace has the same card: its create actions as a row of buttons under the heading, New folder on
the right, then its list; there is no separate tiles section any more.

**Start AI after a build** (`build-ai.js`, `scripts/screen-then.js`; the Claude Code options and the local
agent list are New screen's own, `claudeArgsHtml` with `agentSelect`). Its checkbox makes `/actions/build`
append `&& node <ROOT>/core/workspace-app/scripts/screen-then.js <payload>` to the build line, so the session
starts only after a good build (and install). It cannot simply chain `claude`: the runner pipes any command
that does not start with `exec` through `tee`, which turns claude into print mode, so the helper asks the
runner for a NEW `exec` session, `<ws>--<project>--claude`. The helper path is built from ROOT, not
`__dirname`, because the step runs on the host and the dashboard runs in its container at `/var/www/html`.
The prompt and payload are 0600 files in `.screens/prompts/`, and the prompt reaches claude through
`$(cat …)`, never the shell line.

**What `ddev config` accepts lives in `ddev-options.js`**, taken from the DDEV docs and `ddev config --help`
(v1.25.4): all 27 project types, PHP 5.6 to 8.5, every MariaDB, MySQL and Postgres version the docs list,
the web server types, Node.js (`auto`/`engine`/empty as well as versions) and Composer versions, plus
`--omit-containers=db` and Python as `--webimage-extra-packages=python3-pip,python3-venv` (DDEV has no
Python version). `PRESETS` are the DDEV quickstarts' own settings. Both New folder and the row's Configure
DDEV render `fieldsHtml` and turn the form into flags with `configArgs`, which drops anything off the
lists, so a value never reaches the shell line unchecked. "DDEV's default" sends no flag at all.

**New folder in every workspace but the AI items.** The `files` and `media` types carry `folder` too (their only
action; the AI items keep none, because a folder there is a skill). In a files workspace it is a Create tile
and a rail entry, the folder goes inside the one being viewed (`folderFormFor` reads `?path=` from the
`HX-Current-URL` htmx sends, then the page cookie), names may carry capitals, spaces and dots, and the form has
no setup options. The form and the action live in `actions/folders.js`; `server.js` only routes to them.

**Exit and resume Claude Code** (`actions/claude-session.js`). `/actions/claude-exit` checks the session really
runs `claude` (`agentSessions`), then types into it with `screen -X stuff`: Escape (closes a trust prompt or a
permission ask), `/exit`, and Enter on its own. `/actions/claude-resume` reads the session's folder from
`.screens/<session>.cwd` (or takes a workspace and project), picks the newest resumable conversation from
`claude-sessions.sessionsFor`, and starts `exec claude --resume <id>` through the runner; the id is never taken
from the request. The card's SCREENS menu (`menuItems`) and the Screens page draw the buttons.

### Cloning a project (`cmd-tools-clone.sh`, `--worktree`)

Eight workspaces carry `cmd-tools-clone.sh` (demos, dev, products, profiles, projects, sandboxes,
site-templates, test), backed by `functions/fun-clone-project.sh` + `args/arg-clone.sh`. Two shapes,
one command, and the dashboard's **Clone** control posts to the same script:

- **the default** — rsync + `ddev config --project-name` + an export/import of the database. Nothing
  is shared.
- **`--worktree`** — `git worktree add`, so one `.git` and one history serve a folder per branch. The
  contributor-review shape: someone's merge request running beside your own build.

`--worktree` is **offered only where it can work**: `project_has_git` asks git
(`rev-parse --git-dir`), not the filesystem, because a project that is itself a worktree carries
`.git` as a FILE — and a worktree of a worktree is legal and useful. A non-git source is refused with
the reason rather than silently copied.

Three things the worktree path must do, each found by running it:

1. **The directory names the project.** `ddev_config_drop_name` removes the top-level `name:` from the
   worktree's `.ddev/config.yaml` (a nested `name:` belongs to a service or a hook and survives).
   Leave it and the worktree inherits the source's name through git and collides with it. This is
   DDEV's own documented worktree behaviour — the same idea as
   `ddev config global --omit-project-name-by-default`.
2. **The database is never shared.** Two DDEV projects on one database is a corruption waiting for the
   first `drush updatedb`, so the dump-and-import is the same as on the copying path. `--no-db` skips.
3. **Git does not carry the build.** `vendor/`, `web/core`, contrib, the files directory and
   `settings.local.php` are git-ignored in every Drupal project template, so a bare worktree is a
   source tree, not a running site. The git-ignored set is copied from the source
   (`git ls-files --others --ignored`), which is exactly what git has nothing to say about;
   `--no-build-copy` opts out. **DDEV's own generated state must not travel** — `.ddev/traefik`,
   `.ddev/db_snapshots` and the `.ddev/.*` dotfiles are named after the SOURCE, so copying them makes
   every `ddev start` warn "unexpected #ddev-generated"; `.ddev/config.yaml` must NOT be filtered out,
   because in a project that git-ignores `.ddev/` it is the one file the clone cannot start without.

And one footgun stated in the output, the docs and the tips: **`git worktree remove` deletes a
worktree that holds unpushed commits.** Removal goes through `cmd-tools-remove.sh`, which asks.

In the dashboard the checkbox appears only for a git checkout — absent, not disabled — labelled with
the source's current branch, and the endpoint re-checks `projectHasGit` rather than trusting the form.
**Clone is also offered on a project with no DDEV at all**: it used to live only inside the DDEV
dropdown, which made it unreachable for exactly the `products/` module checkouts where a worktree is
most useful.

### Extra hostnames (`cmd-tools-hostnames.sh`, `fun-ddev-hostnames.sh`)

The five workspaces that build sites (dev, test, sandboxes, demos, projects) carry
`cmd-tools-hostnames.sh`, over `fun-ddev-hostnames.sh` + `fun-hostnames-cli.sh` + `args/arg-hostnames.sh`.
A project already has two addresses — the canonical `<name>.<project_tld>` from its DDEV **name**, and
the hierarchical `<project>.<workspace>.<hub_domain>` from the dashboard's nginx tier. This adds the
third shape people ask for: a flat hostname of their choosing, `--with-workspace` suggesting
`<project>-<workspace>`.

**It ADDS, it does not rename**, and that is the design decision, not a limitation:

- adding is reversible and costs nothing; a rename kills the old URL, recreates the containers and
  volumes under the new name, and leaves the DDEV project name no longer matching the folder — which
  is precisely what makes a git worktree collide with its source;
- several addresses can coexist, and every link already printed or written down keeps working.

Written through `ddev config --additional-hostnames=`, **never** by editing the YAML: DDEV owns that
file. That flag **replaces** the list, so anything adding one reads the current list and writes it
back whole — an add that silently dropped the others would be worse than no add.

Three things that are not obvious:

- **`ddev_hostnames_list` must not read DDEV's own comments.** A stock `config.yaml` ships
  `# additional_hostnames:` and `#  - somename`, so a naive parser hands every project two hostnames
  it never had. Tested.
- **A hostname is a LABEL, not an FQDN** — `project_tld` is appended, so a dot gives
  `name.example.com.ddev.site`, which resolves to nothing. Refused before `ddev config` sees it.
- **Two projects on one hostname is a router conflict**, and it is invisible from either project's
  page: the last to start wins and the other quietly stops answering. `ddev_hostname_owner` checks the
  whole tree, against both the additional hostnames and the project NAMES (the canonical hostname comes
  from the name and would be shadowed the same way).

A change reaches the router only on the next start, so `--start` exists and the dialog defaults to it.
`--start` is honoured whether or not anything changed — gating it on "changed" made `--start` on an
already-added hostname print a report and do nothing, which looks exactly like the feature not working.

The dashboard's **DDEV → Domains this answers at…** and the clone form's address option both shell out
to the command, so the button and the CLI cannot disagree — including about the collision check. The
clone flags are `--extra-hostname` and `--with-workspace-hostname`; **not `--hostname`**, because
argparse assigns the dest as a shell variable and `HOSTNAME` is a bash builtin.

### Create a video or audio from a project's row (`project-make.js`)

The More menu of a project in `products`, `dev`, `test`, `sandboxes` and `demos` offers **Create a video…** and
**Create audio…**. The form (`/fragments/projects/make-form/<ws>/<project>?kind=video|audio`) has a set of
**pre-prompts** that fill an editable prompt (video: tour, one feature, what changed, install and run, before and
after a fix, an editor task; audio: read the README, a one-minute summary, release notes, a handover briefing, narrate
my own words), a language and a length. Start posts `/actions/project-make`, which hands a brief to the same handler
New screen uses: a Claude Code session in the project, named `<ws>--<project>--video-xxxx`, so it is on Screens. The
brief says where it is (and starts a DDEV project with `ddev start -y`, never `ddev stop`), what to use (the
varbase-demo-video-manager skill, or voice-narration and `audio/cmd-tools-voice.sh`), to show the words first, and the
rules: write to `videos/` or `audio/` only, change nothing in the project, stop at an ElevenLabs plan until the person
says yes, no client names or secrets on screen. The person's words go last, and travel in the prompt file like every
Claude screen's prompt. A name that is not a project folder of those workspaces is refused.

**It is also a place to start one from nothing.** The Videos workspace has **Create a video** and the Audio workspace
**Create audio from a prompt** (`/fragments/make-form?kind=video|audio`): the same pre-prompts and prompt, plus **a
project** from any of those five workspaces (the session starts in it) and **a link**, any http or https page, which
is handed over as external input to look at and record, never to obey, and never to log in to or change. With neither,
the session starts in `videos/` or `audio/` and works from what the person wrote. A project's own row takes a link too.

### Removing a project that git cares about (`fun-git-worktrees.sh`)

Once a project can be a worktree, a workspace folder holds three things that look identical in `ls`,
and `git_worktree_role` is the one place that tells them apart: `plain` (a checkout nothing depends
on), `primary` (other folders live off its `.git`) and `linked` (a worktree; its `.git` is a FILE).
`linked` is detected by `--absolute-git-dir` differing from `--git-common-dir`, which is the only test
that is right for a worktree of a worktree.

`remove_project` runs `remove_project_worktree_guard` **before anything is deleted** — after
`ddev delete` would be too late — and refuses two cases, both overridable only with `--force`:

1. **The main checkout with dependents.** Its `.git` is the only copy of the repository those
   worktrees have, so deleting it leaves each of them files with no branch, no history and nothing to
   push. `rm -rf` warns about none of this.
2. **Work that is on no remote.** `git_worktree_unpushed` counts `HEAD --not --remotes` rather than
   against `@{upstream}`, because a worktree branch created locally has no upstream and `@{upstream}`
   simply errors — which is exactly the case that most needs an answer. Uncommitted changes are
   counted too. `git worktree remove` refuses a dirty worktree for the same reason; a workspace remove
   that was more destructive than git's own would be a trap.

Afterwards `remove_project_worktree_after` prunes the stale registration in the primary: git calls it
prunable on every `worktree list` until then, and **refuses a new worktree at that path** — which is
what somebody re-cloning after a mistake will immediately try.

**Removing asks for the project's name.** The Remove form had a tick-box ("Yes, I am sure"); it now asks for the name
typed out and keeps the button off until it matches exactly (GitHub's repository delete, GitLab's high-severity
ladder). `/actions/remove` refuses a `confirm_name` that does not match the project, whatever else came with it, and
still accepts `sure=yes` from a caller that predates the form. The git guard and the backup choice are unchanged,
and the form still posts straight to the action (it does not go through the shared confirm dialog).

`FORCE` is read as `${FORCE:-}`: `remove_project` is also called from the dashboard and from other
scripts that know nothing about the flag.

The dashboard asks the same questions through `gitWorktreeInfo` — deliberately the same set, so the
button and the command cannot disagree about what is safe — shows the relationship on the row
(`worktree · <branch>`, `main checkout · N worktree(s)`), states the consequence in the Remove dialog
before the confirm, and only ever *forwards* the answer: the refusal itself lives in the script.

### Knowledge graphs (`graphify`)

Every project workspace carries `cmd-tools-graphify.sh`, backed by `functions/fun-graphify.sh`
(`ensure_graphify`, `graphify_backend_args`, `graphify_project`, `graphify_query_project`) and
`args/arg-graphify.sh`. Two CLI calls, both needed: `graphify extract <project> --code-only` writes
`graph.json`, and `graphify cluster-only <project> --no-label` is what writes `GRAPH_REPORT.md` and
`graph.html`. Never pass `--no-viz` — it deletes an existing `graph.html`.

**Know what it does not cover before promising anything.** On Drupal it maps PHP classes under `src/`
(methods, `use`, `extends`, `implements`, traits, injected services), JS, and SQL — the last only
because the pinned package carries the `[sql]` extra; without `tree_sitter_sql` graphify parses no
`.sql` file at all and says so in a warning, not an error. It skips
`.module`/`.theme`/`.install`/`.profile`/`.engine` (not in its dispatch table), all Twig, every
`*.yml`, and **all Markdown** — graphify classifies `.md` as a document, and documents are read only
by the semantic pass, so `--code-only` drops them; `.inc` is mis-parsed as Pascal; PHP 8
attributes are unsupported, so plugin-id → class is absent. `--deep` needs an LLM backend, sends file
contents to it, and still does not link YAML to PHP.

- **A built graph writes itself into the project.** `graphify_write_project_note` appends a
  `<!-- graphify:begin -->` block to the project's own `CLAUDE.md`, so a `claude` session started
  there reads it without anyone remembering to mention the graph. It carries the live node/edge
  counts, the four query commands, how to rebuild, and — deliberately — what the graph does **not**
  contain, because a graph trusted for what it lacks is worse than none: ask it about routing and the
  empty answer reads as "no such route". Bounded by markers and only rewritten between them, so a
  project's own `CLAUDE.md` survives. The dashboard assistant is told the same thing, and which
  projects have a graph at all.
- **Only third-party trees are excluded — a manifest is content, not noise.** On a built Drupal site
  `composer.json` *is* the architecture, since the site is defined by what it requires rather than by
  custom PHP, and `graphify query "what does composer require"` returns it. It does make the graph
  JSON-heavy (a node per key, so `composer.json` alone is ~286), which surfaces in `god-nodes` as
  `require` and `scripts` — a ranking artefact, not a reason to drop the data. Ask the graph a
  question rather than reading the hub list.
- **`--deep` resolves its backend from `settings.yml`.** `graphify_backend_args` falls back to
  `ai_providers.<provider>.api_key` (skipping `CHANGE_ME`/`sk-change-this`, which would otherwise fail
  deep in the run as an auth error), then to the `claude` CLI, which needs no key of its own. `--deep`
  is what reads docs and Markdown, and it **sends their contents** to that provider — the run says so
  before it starts, because these are client projects.
- **`--store <url>`** fetches a page into the project's `./raw` and folds it into the graph, so the
  graph is somewhere to *keep* things — an upstream issue, a spec — that a later session can query
  alongside the code instead of being handed the same context again.
- **A graph is only as useful as the code in the tree.** A built Drupal site has no custom PHP — its
  21,611 PHP files are all `web/core` and `web/modules/contrib`, correctly excluded — so its graph is
  thin whatever you do (`v11canvasi18n`: 141 nodes, mostly `.ddev` shell commands). The graph earns
  its keep on `modules/`, `products/` and `themes/`, where the code is: `toc_api` gives 143 nodes and
  176 links of real structure, with `Toc`, `TocBlockBase` and `TocTypeForm` as its hubs.
- Third-party trees are excluded by default (`GRAPHIFY_DEFAULT_EXCLUDES`): without them 84% of a
  Varbase graph is vendored JS. `--all` keeps everything, `--exclude` adds paths.
- The version is pinned (`graphifyy==0.9.28`) in the function and the dashboard Dockerfile: the CLI
  silently ignores unknown flags, so an unpinned upgrade degrades without erroring.
- `graphify-out/` is gitignored: tens of MB, and Leiden clustering is not bit-stable, so it diffs
  fully on every rebuild.
- Dashboard: **Graph** per project row (`/actions/graphify`, refused with 409 while one is running —
  graphify has no cross-process lock), and `/graph/<workspace>/<project>[/report]` serves the files
  through a realpath containment check, `nosniff` and a sandbox CSP.

Prefer querying a project's graph over grepping **for the layer it covers**: `graphify query`,
`graphify path A B`, `graphify explain X`, `graphify god-nodes`.

### RAG indexes (`Milvus`, the `rag` workspace)

The other half of the same question, and deliberately the layer graphify does **not** cover. Every
project workspace also carries `cmd-tools-ragify.sh`, backed by `functions/fun-ragify.sh`,
`functions/fun-rag.sh`, `functions/fun-milvus.sh` and `args/arg-ragify.sh` — it indexes the *text*
of the tree (Markdown, Twig, `*.yml`, `*.module`/`*.install` hooks, README, CHANGELOG: exactly what
a code graph classifies as a document and never reads) into a self-hosted Milvus, one collection per
project, `ws_<workspace>_<project>`.

- **The database is a DDEV project**, `rag/milvus/`, built by `rag/cmd-milvus-project.sh`. Milvus
  2.6 standalone is four containers — milvus, etcd (metadata), MinIO (segments) and Attu (the UI) —
  with the built-in **Woodpecker** WAL, which is what removed the Pulsar dependency that used to make
  standalone a five-container stack. DDEV's web container reverse-proxies Attu, the REST API
  (`/v2/…`, the plain-HTTP half of the same 19530 listener), the Milvus WebUI and the MinIO console
  onto one https origin.
- **The gRPC port is published on the host**, and it is the only place in this tooling that does
  that. It has to be: the DDEV router terminates HTTP(S) only, and pymilvus, the MCP server and every
  other real client speak gRPC. `milvus_free_port` takes the first free port from `milvus.grpc_port`
  up, so a second instance does not fail to start, and `milvus_host_port` reads the port back out of
  the generated compose file rather than out of the settings.
- **Retrieval is BM25, built inside the database.** Milvus's own `Function(FunctionType.BM25)`
  tokenises the `text` field and writes the sparse vectors, so the default run needs no embedding
  model, no API key, and sends nothing anywhere. `--embedding openai` adds a dense vector per chunk
  and fuses both with RRF — better on paraphrase, and the run says so before it starts, because these
  are client projects.
- **Chunks are line windows, not tokens** (`rag.chunk_lines`/`chunk_overlap`), so a hit reports a
  path and a line range you can open, and a function straddling a boundary is findable from either
  side. The relative path is indexed with the text, so "the hero section" matches `hero.twig` even
  when the words are not inside it.
- **A re-index replaces its collection**, which is what keeps a deleted file from staying findable;
  `--append` adds instead. An index is derived data — losing one is a re-run, not a restore.
- **`pymilvus` is pinned `>=2.6,<3`** against the 2.6 server, and run through `uv run --with`, so
  there is no venv of ours to install or keep in sync. A 3.x client against a 2.6 server fails at
  connect time, not at install time.
- **MCP:** `rag/cmd-milvus-mcp.sh -a register` adds `zilliztech/mcp-server-milvus` to the Claude Code
  CLI over stdio, `uvx`-resolved. One registration covers the whole database — its 13 tools list and
  search every collection — so a new index needs no new registration. The published wheel declares
  `fastmcp` but imports `mcp.server.fastmcp`, so the command injects `--with "mcp<2"`; without it the
  server dies at import and the CLI reports only "Connection closed", which is why `register` proves
  the server starts before registering it.
- `rag/cmd-tools-rag.sh` is the store command (list, info, search, remove, and the MCP verbs), and
  `rag/cmd-milvus-backup.sh` archives all three volumes together plus a collection manifest — a dump
  of any one of them restores nothing.

Ask the graph about structure; ask the index about wording, configuration and prose.

### Second storage (`core/scripts/storage.sh`, `fun-storage.sh`)

Whole workspace folders can live on another disk. `storage.second` in `settings.yml` names the folder
on that disk; it is per machine and never synced, like `contributor:`, and the committed copy ships `""`.
A moved workspace is a symlink, `<root>/<name> -> <storage>/<name>`, so every script and the dashboard
keep using `<root>/<name>` and nothing else changes.

```bash
bash core/scripts/storage.sh                         # each workspace, the links, both disks' free space
bash core/scripts/storage.sh --move videos           # copy, checksum compare, swap to a symlink
bash core/scripts/storage.sh --remove-pre-move videos
bash core/scripts/storage.sh --back videos           # the reverse
bash core/scripts/storage.sh --mounts                # the dashboard container's mounts
```

- **Nothing is deleted without a flag that says so.** A move keeps `<name>.pre-move` until
  `--remove-pre-move`, which refuses while the link is broken, since the kept copy may then be the only
  one. A move back keeps the copy on the drive; this tool never deletes on the drive.
- **A copy is swapped in only when `rsync -c` finds no difference.** `rsync -aHAX`, then a dry
  checksum compare; any line of difference stops it with the source untouched.
- **Refused:** a workspace that holds DDEV projects (DDEV bind-mounts each project into its containers,
  not verified across a symlink onto another disk), a target folder that already holds files, a storage
  path on the same filesystem as the tree (the drive is not mounted, and a move would free nothing), and
  too little room (5% spare, at least 1 GiB).
- **The dashboard container sees only what it mounts.** `--mounts` writes
  `core/workspace-app/.ddev/docker-compose.second-storage.yaml` from the setting and from wherever the
  existing links point, gitignored, and says a dashboard `ddev restart` is needed when it changed.
  `sync-tooling.sh` runs it after mirroring, like `docker-gid.sh`, and its rsync of `core/workspace-app`
  has no `--delete`, so the file survives a `--pull`. Under `/run/media/<user>` it mounts the **parent**
  with `rslave`: udisks picks the folder name at mount time, and a bind of the parent also sees a drive
  mounted after the dashboard started. Never mount a `/run/media` path that may not exist: Docker
  creates a missing bind source as an empty root-owned folder, and that leftover is exactly what makes
  udisks mount the drive at `<label>1` next time.
- **A udisks automount is not a stable path**, so under `/run/media` the status prints the fix: an
  fstab line by UUID to `/mnt/workspace-storage` with `nofail`, for the user to run with sudo (the tool
  never does). Then `storage.second` moves to the new path and `--relink --mounts` repoints the links.
- **The dashboard follows the link.** Every containment check resolves the workspace folder with
  `realpath` too, so a whole-folder symlink is still "inside"; a link from inside it to anywhere else is
  still refused. `/files/<ws>/…` goes through `files-browser.js` `realFileIn`, and
  `tests/unit/second-storage.test.js` proves both halves.
- `sync-tooling.sh` skips a workspace whose link is broken, rather than writing through it into the
  empty mount point on the wrong disk.

### The dashboard (`core/workspace-app`)

`server.js` (~1200 lines, single file, no framework) + `workspaces.js` + `public/` (vendored HTMX and UIKit).
Server-rendered pages; every interaction swaps an HTML fragment. Every important action — delete, remove,
reset, a command that says it asks — goes through **one confirm dialog** (`#confirm-modal` in `pageShell`,
driven by `.arm-step` in `ui.js`): *Wait! Are you sure you want to proceed with this action?*, with the
action and what it belongs to named under it, and No before Yes. The request fires on the dialog's Yes
alone (`hx-trigger="confirmed-remove"`), so the X, Escape and the backdrop all mean No; with no UIkit on
the page it falls back to the browser's own dialog rather than acting unasked. It replaced a two-step
click-to-arm, where a double click did the whole thing and nothing ever said what was about to happen.
Every action is appended to `actions.log` (gitignored).

- **`workspaces.js` is the config bridge.** It reads `settings.yml` + each `workspace.<name>.settings.yml`
  live (2s memo), so adding a workspace or a builder script shows up with no code change. The only
  hardcoded table is `PRESENTATION` (icon, subtitle, `noun`, `kind`) — `kind: 'files'` marks the markdown
  workspaces (ai-agents/ai-skills/ai-commands/ai-prompts/docs), everything else lists real project directories. Script discovery
  is by filename regex (`findBuilderScripts`, `findBackupScript`, …), not a hand-maintained map.
- **Jobs** are an in-memory `Map` (`startJob`/`jobFragment`) streaming live terminal output; build jobs get a
  60-minute timeout because a cold-cache `composer create-project` can exceed 15 minutes.
- **Spawned commands MUST close stdin** (`stdio: ['ignore','pipe','pipe']`) — ddev's `docker exec -i` hangs
  forever on an open stdin pipe.
- **Don't restart the app while jobs run** — the registry is in-memory; running builds get orphaned.
- **File-item workspaces** edit markdown in place and install into the Claude Code CLI via `INSTALL_TARGETS`:
  agents → `~/.claude/agents/`, skills → `~/.claude/skills/<name>/SKILL.md`, prompts → `~/.claude/commands/`.
- **Four ways to show it, after Drupal AI's own chatbot** (`assistant-views.css`, `styleSettings`).
  `ai_chatbot`'s DeepChat block offers Placement, Collapsed minimal, an Expansion method and a
  remembered Toggle state, with Clear history in a header menu; this is the same idea in this
  dashboard's terms. A **switch at the far left of the toolbar** shows and hides the panel — closed,
  the page gets the whole width back. The panel's header carries **⋮ / wider / close**: the menu holds
  New chat and the four views, because those are the rare things and the header stays a title and two
  icons. **Sidebar** is the 25rem column, **Wide** is `min(45rem, 60vw)` for an answer a column cannot
  hold, **Floating** puts it over the page with a launcher in the corner, and **Full page** is
  `/assistant` — a place, not a layout, so choosing it goes there and leaving it comes back (two panels
  on one screen would be two live views of one conversation). State lives on `<html>`
  (`data-assistant-view`, `.assistant-closed`) and is applied by the **pre-paint script**, next to the
  theme's and the rail's: the panel is a quarter of the layout, so deciding it in the deferred `ui.js`
  would draw the page one way and reflow it a frame later. `style: assistant_view:` /
  `assistant_open:` in `settings.yml` are the **defaults** — a view chosen from the menu is in
  `localStorage` and wins, as with `style: mode`.
- **The conversation carries across pages** (`chat-threads.js`). Every ask used to be a one-shot
  `claude -p --no-session-persistence`, and deep-chat's transcript lived only in the page that drew it —
  so moving from `/dev` to `/test`, or following the assistant's own `NAVIGATE:`, threw the whole
  conversation away. A **thread** now keeps both halves: the transcript, which `/fragments/chat/history`
  hands back in deep-chat's own `history` shape on every page, and **claude's session id**, which the
  next turn resumes (`--session-id` on the first turn, `--resume` after; a session that has gone answers
  on a fresh one rather than reporting itself broken). A redrawn transcript in front of an agent that
  remembers none of it reads as memory and is not, which is why the session travels with it.
  The id is a **cookie on the hub domain**, and it has to be: the dashboard spans
  `<workspace>.<hub>` subdomains and `localStorage` is per-origin, so a thread kept there would be a
  different thread on every workspace page. No `Max-Age` — the conversation belongs to the browsing
  session. Threads live in `core/workspace-app/.chats/<id>.json` (gitignored, 0600, excluded from both
  rsyncs), 60 turns each, pruned after 30 days. **New chat** in the panel header starts one over, through
  the confirm dialog; it is labelled rather than an icon alone, because a bare glyph in a chat header
  could as easily mean reload or retry.
- **AI assistant** (`/actions/chat`) shells out to `claude -p --output-format json` with an
  `--append-system-prompt` built per message from live page context (current workspace, its projects,
  builders, backups). Tools are limited to Bash/Read/Glob/Grep; Write/Edit/WebFetch/Agent disallowed. The
  reply's trailing `NAVIGATE:` / `OPEN:` / `REFRESH` lines are stripped server-side and re-emitted as an
  `HX-Trigger` header that `public/ui.js` acts on. Markdown is rendered through `pandoc -f gfm-raw_html`
  so model output cannot inject markup.
- **Runs inside its own DDEV web container** with Docker-outside-of-Docker: `.ddev/docker-compose.dood.yaml`
  bind-mounts the host docker.sock, `~/workspace` and `~/.claude`; `.ddev/web-build/Dockerfile.workspace-app`
  adds docker + ddev + claude + pandoc + weasyprint + chromium; `.ddev/nginx_full/nginx-site.conf` proxies to
  `127.0.0.1:3000`.

**The container needs the host's docker GID and the host's DDEV registry**, or the dashboard is
blind: `ddev` inside it fails with a socket permission error, or reports one project, and every row
reads Stopped forever while the projects run perfectly well. `group_add` in
`.ddev/docker-compose.dood.yaml` is what grants the group — DDEV pins `user: 1000:1000`, so a
build-time `usermod` in the Dockerfile never reaches the running process — and `${HOME}/.ddev` is
bind-mounted for the registry. Both numbers are written by `core/scripts/docker-gid.sh`, which
`install.sh` runs at setup and `sync-tooling.sh` runs **after** mirroring, because that directory is
mirrored and a hand edit would not survive a `--pull`. Still per-machine: a host `claude` login for
chat.

### Branding (Vardot, from Figma)

`core/workspace-app/public/style.css` opens with the **Vardot brand tokens taken from the VDT
Stylesheet in Figma** (`figma.com/design/Hwbkgkvxths84swEtWcmTv`), named exactly as the Figma
variables so a change there maps to one line here:

| Token | Value | Figma name |
|---|---|---|
| `--brand-primary` | `#0074e0` | brand/primary |
| `--brand-secondary` | `#2b447c` | brand/secondary |
| `--brand-accent` | `#e4dcff` | brand/accent |
| `--brand-dark` | `#000000` | brand/dark |
| `--brand-light` | `#ebe8e5` | brand/light |
| `--subtle-light` / `--subtle-brand` / `--subtle-accent` | `#f5f3f2` / `#deedff` / `#f6f3ff` | subtle/* |

The old `--brand-1..3`, `--ink`, `--surface`, `--line` names are kept as aliases onto those, so every
existing rule keeps working. **UIKit is untouched** — only these values feed it; never fork the
vendored UIKit CSS. No off-brand hex literals remain in the stylesheet: paint with the tokens.

**`uikit.min.css` is linked AFTER the assembled stylesheet**, so a rule of ours at the same specificity
loses the tie: styling a `.uk-button` with a single class of our own simply does not apply, silently.
Out-specify it (`.assistant-head .uk-button.assistant-new`) rather than reaching for `!important` or
editing the vendored file. That is what left the assistant's "New chat" button rendering UIKit's dark
outline ink on the brand gradient — 2.06:1 against one end of it and 1.00:1 against the other.

Logos are exported from that same Figma file into `public/` — re-export, never hand-draw SVG. The
**toolbar carries the Vardot wordmark**, from `7989-1383` (light) and `7989-1385` (dark): identical
geometry, the wordmark ink is the only difference (black vs white, the dot always `#0074e0`), so the
file is swapped by `.brand-logo-on-light` / `.brand-logo-on-dark` under `html.dark` rather than the
artwork being recoloured. Beside it sits **`Workspace`** alone, behind a hairline divider — "Vardot
Workspace" next to a Vardot wordmark said Vardot twice. `.uk-logo` sets a font-size on that anchor, so
the product name needs `.toolbar .toolbar-product` to win. `vardot-emblem.svg` remains the SVG favicon
and `vardot-favicon.png` the PNG fallback and apple-touch-icon; the emblem is brand blue and needs no
variant. Swap the file; never recolour the artwork.

**The brand typefaces are actually loaded now.** `--font-primary`/`--font-secondary`/`--font-code` named
Figtree, DM Serif Text and JetBrains Mono, but there was **no `@font-face` anywhere** — every page had
been rendering in Helvetica and Georgia while claiming to be on brand. Seven faces are vendored as woff2
(latin) in `public/vendor/fonts`, 148KB total, OFL-1.1 with licences beside them: Figtree 400/600 with
italics, DM Serif Text 400 + italic, JetBrains Mono 400. Locally served, because a Google Fonts link
dies on an offline DDEV box and the artifact CSP blocks it outright; `font-display: swap` so text is
readable before the font arrives.

**The type scale is the design's** (Figma `2070-473`): H1 and H2 are Secondary at `line-height: 1.3`;
H3–H6 are Primary **SemiBold** at 1.4, and H6 adds `letter-spacing: 1px` and uppercase. `h3` and the card
titles used to be on the serif, which the design does not do — only H1 and H2 are Secondary. The 62px/50px
H1/H2 are the *landing-page* scale, so the dashboard keeps the family and uses a UI-sized step: a 62px h1
over a project table would be absurd.

**Sizes are `rem`, letter-spacing and media queries `em`** — 297 declarations converted, and the rendered
geometry is byte-identical afterwards (every probe measured before and after matched exactly). What stays
in `px` is deliberate: **borders** (a 1px hairline in rem lands on a fractional pixel and blurs),
box-shadows, outlines, transforms and `background-size` — effects, not layout.

**Responsive, verified at 360/414/768/1440.** Two real bugs were found by measuring rather than guessing:
a long project name (`amd-educare-1-0-x-site-template-manager`) is one unbroken token and pushed the whole
page sideways at 360px, and UIKit's `.uk-label` is `white-space: nowrap`, so a card status like "0 site
templates · buildable" dragged its card to 267px inside a 144px column — a horizontal scrollbar on the
home page, and cards of unequal width at *every* size. Home is now 2 cards per row on a phone (4530px of
scroll → 2704px), 3 at `@s`, 4 at `@m`; on a workspace page the name and its actions stack below 767px and
the action buttons grow from 26px to 38px, which is the first size that is usable on a touch screen.
`1-5@l` was tried and reverted: the 400px assistant rail leaves ~950px, so five across gave 149px cards.

Buttons carry the Vardot default: pill radius, primary in brand blue with a soft brand shadow,
secondary in the brand navy, default a quiet outline that turns brand on hover, and a
`--subtle-brand` focus ring — all via tokens, so dark mode follows automatically. In the composer the
mic is a 34px round icon button that pulses while `.listening`, and a **command picker** sits on the
left of the toolbar, writing `Run <script> in <workspace>: ` into the prompt and resetting. It never
runs anything by itself — the assistant does, from the prompt.

On **`/settings`** the picker carries **no commands at all** — none of them edit these files, and every
command in the tree would just be noise — and the Auto option, the picker label and the placeholder all
say *Settings*. The chat's page context there names the files and the secret **keys**, never a value, and
tells the assistant plainly never to print, `cat` or `grep` a secret or put one on a command line: it has
Bash, this is the one page whose file holds real credentials, and the chat log is written to disk.

**The picker is scoped to the page.** On a workspace page (`workspace:<key>` / `backups:<key>` in
`pageShell`'s context) it lists only that workspace's `cmd-*.sh`, flat and with the workspace named in
the Auto option; on the home page it lists everything, grouped and ordered products → dev → test →
demos → the rest. `commandMenuGroups(scope)` takes the scope. On `/dev` no other workspace's command
can sensibly run, and the full 164-entry list buries the 21 that can.

A workspace's own settings belong in **its own** `workspace.<key>.settings.yml`, which `workspaces.js`
reads live (2s memo) — no code change and no restart. Nothing consumes a per-workspace assistant
setting today; wiring one back is a single line there, next to `doc:` and `database:`.

**A right-hand rail on every page, collapsed by default.** `pageActionsHtml(context)` builds it from the
page's context string: the page's own actions first, grouped (Create / Sync / Archives / the repo / Go to),
then **Workspaces** — Home plus a link to all 19, with the current one marked (`is-current`,
`aria-current="page"`, an inset brand bar when collapsed). It is what makes an always-present rail worth
its width on a page with no actions of its own, and collapsed it is the icon column the workspace cards
never gave us. The rail never disappears: one that came and went made the layout jump between pages and
gave the eye no fixed place to look for "what can I do here". A row of buttons under the list put
them below the fold on any long workspace (on `/modules`, 112 rows below "New module"); fixed, they stay
reachable at any scroll position. **Collapsed is the default** and only an explicit `'0'` keeps it open, because the
content — a project table, a diff, a job's output — wants the width more than the labels do. The class is
set by the **pre-paint inline script in `<head>`**, next to the theme's: applying it from the deferred
`ui.js` instead showed the rail wide for a frame and snapped it shut. Collapsed, the actions become 36px
square icon tiles with hairline group dividers. Under 960px the rail becomes a static horizontal bar with
labels shown — except the workspace nav, which stays icon-only there: twenty labelled links laid out
horizontally made the rail **893px tall on a 900px viewport**, the whole first screen before any content
(190px after). Collapsing is a desktop idea, so the toggle is hidden.

The collapsed preference and the theme both live in `localStorage`, which is per-origin — so neither
carries across the hierarchical subdomains (`workspace.ddev.site` → `dev.workspace.ddev.site`). Expanding
on the hub and then following a rail link lands you collapsed again. Inherent to the subdomain scheme and
consistent with the existing theme toggle; a cookie on the parent domain is the fix if it ever matters. Both rails are
`box-sizing: border-box` so the declared width IS the footprint — UIKit sets that on its own components
but not on a bare `aside`, which is why the assistant rail had been 424px wide against a 400px margin.

**Every field that wants typing gets a mic**, injected by `addFieldMics` in `ui.js` on load and on
`htmx:afterSwap` — so a field arriving in a fragment gets one without being touched, and no markup
repeats per form. Skipped: the composer (it has its own round mic), disabled/readonly fields, and
password fields, since dictating a secret through a speech service is not something to offer. Dictation
**appends** rather than replaces, so a stray press cannot wipe what was typed, and the button is
`type="button"` so it can never submit the form it sits in.

**Tokens are refreshed, not retyped.** `core/scripts/brand-tokens.sh` (`functions/fun-brand-tokens.sh`
+ `args/arg-brand-tokens.sh`) fetches the brand colours from Figma when `figma.token` is set in
`settings.yml` (or `$FIGMA_TOKEN`), updates `core/config/brand-tokens.json`, and rewrites the generated
half of the `:root` block. **Without a token it falls back to the cached values and still applies them**,
so the run never leaves the dashboard unstyled; the output always states the date and source of the
values in use. `--cached` skips the fetch, `--show` prints the values, `--no-apply` refreshes the cache
only. It reads nodes rather than `/variables/local`, which is Enterprise-only.

The AI prompt and the Build form share one shape — a bordered composer card (14px radius, brand focus
ring) with the input on its own row and the controls in a `.chat-tools` toolbar underneath, after the
Drupal CMS prompt pattern. UIKit pins `.uk-input` to 40px, so `.chat-input .uk-input` must override
`height` itself; `min-height` alone loses.

### The dashboard log (`event-log.js`, `logs/dashboard.log`)

`actions.log` says what was done; this says what was refused or broke. One JSON object per line in
`core/workspace-app/logs/dashboard.log` (gitignored, mode 600, excluded from both rsyncs, rotated at 5 MB
keeping three): `app.started` (version, pid), `action.rejected` (every 4xx an action answers, with the
workspace, the status and the message), `action.failed` (an exception in a handler, with its stack) and
`process.crashed`. A rejected **New screen** also keeps its target and its **prompt**, clipped to 500
characters, because a refused form is the one place a typed prompt was lost. Everything written goes through
`redact()` (known token shapes and `password`/`token`/`secret`/`api_key` pairs) and `clip()`: a log is the one
file nobody reviews. Read it with `tail -f core/workspace-app/logs/dashboard.log`.

**An action with no workspace belongs to the page it came from.** `handleAction` used to default to `dev`
from any host, so a form on `test.workspace.ddev.site` that named none acted on dev. It now reads the
workspace from the request host (`hostWorkspaceOf`: `dev.workspace.ddev.site` is `dev`), and the New screen
form opens on that workspace's folder. `root` is accepted for `/actions/screen-new` only: it is a place to
run, not a workspace, and the form's own first option sent it, so choosing "Workspace root" answered
"Unknown workspace."

**On a workspace's own address the workspace is not asked.** The New screen form keeps a hidden `workspace`
field and says "in the dev/ workspace" instead of offering the dropdown (it stays on the hub, where there is
a choice). A started session also **knows where it is**: `WEBSHIP_WORKSPACE`, `WEBSHIP_PROJECT` and
`WEBSHIP_WORKSPACE_DIR` are exported before the shell, command or `claude` runs.

### The editor modal fits the screen (`public/css/components/modal-fit.css`)

`#editor-modal` used to grow with its content and scroll as a whole: at 1080px high **New screen** was 1205px (1565
with Claude Code) with Start 130 to 490px below the fold and its title scrolled away, and **Sections** of the video
editor was 1404px. The dialog is now capped to the viewport (`max-height: calc(100dvh - 7rem)`, which allows for the
54px UIKit leaves above it) and is a column: **`.modal-head`** (title and tabs) pinned at the top, the form
scrolling between with `overscroll-behavior: contain`, **`.modal-actions`** pinned at the bottom. A form opts in with
those two classes; a form that does not still gets the cap, its own scroll, and its last row pinned when that row is
a submit button (`:has`). The body has no padding on the side of a pinned part, or the form scrolls through that strip.
**Editors take the height that is left**, `clamp(12rem, 100dvh - 19rem, 46rem)`, in place of a fixed `62vh`; New
screen's prompt gets `100dvh - 44rem` because three fieldsets sit above it. **New screen asks for the prompt before
the Claude options** (CSS `order`: the fields are unchanged), since the prompt is what a person writes and the
options have good defaults. Measured with Playwright at 2505x1080: New screen 969px, Start in view; Claude Code
variant and Sections fit the cap and scroll inside it with title and buttons held.
The dialog is also a dialog for assistive technology: `#editor-modal` carries `role="dialog" aria-modal="true"`, is
named after its heading when it opens, and everything else under `body` is `inert` while it is open (restored to
what it was on close; the confirm dialog that stacks above it is left alone), so Tab cannot land on the page behind
the overlay. The card's own top margin and the empty result boxes' are zeroed so the pinned parts sit flush, a
focus ring on the pinned buttons and a checkbox edge are 3:1 or better, and the accordion honours
`prefers-reduced-motion`.

### The command palette, the shortcut sheet and the go-to chords (`public/palette.js`)

Nothing in the dashboard answered the keyboard. **Ctrl or Cmd + K**, or **/**, opens one list over the workspaces,
a few pages (Screens, Commands, Settings, Help), every project folder of the workspaces that hold projects, and a
few actions (New screen, switch light and dark). **?** is the sheet of shortcuts, and **g then a letter** goes to a
workspace or page (`g d` Dev, `g v` Videos, `g s` Screens, `g ,` Settings). A project opens its site when it is a
DDEV project and its workspace otherwise. None of it fires while someone types in a field, an editor or a terminal, or
while a modal is open. The data is `/fragments/palette.json` (`palette-index.js`: workspaces, pages and at most 800
project folders, kept 10 seconds), fetched the first time it is needed; matching is a substring first and
letters-in-order only when nothing contains the query. It is a dialog with a combobox and a listbox, announces the
number of results, holds the rest of the page `inert` while open and returns focus to where it was. A search button
with the key in the toolbar is the visible way in. Found by comparing Vercel, Railway, Cloudflare, GitHub, GitLab,
Grafana, WordPress, Linear and Notion: all of them have one.

### Comfortable or compact project rows (`density.css`, `data-density`)

A project card carries about a dozen buttons, each with a small caption under it ("36 commands", "linked", "locked").
**Compact** folds the captions away and changes nothing else: every button stays. A switch beside the page width on
pages that list projects (and **Rows: compact / comfortable** in the palette) writes `ws-density`, a cookie on the hub
domain with localStorage behind it exactly like the width, and a pre-paint script sets `data-density` so the page
is not drawn one way and moved. The caption is clipped, not `display: none`, so a screen reader still reads it, and
`syncRowCaptions` appends it to the button's tooltip so a pointer gets it too. Measured on Dev: every card 40px
shorter, no caption visible. Comfortable stays the default: this is a choice for the person, not a redesign.

### The tab says when a session is waiting (`ui.js`, `syncTitleState`)

A Screens session that stopped to ask something is a run that is not happening until somebody answers, and the
dashboard is usually in another tab. The toolbar already shows it as a ✋ beside the count, fed by
`/fragments/screens-count` every 30 seconds; the tab title now carries it too: `✋ 2 waiting · Videos · Vardot
Workspace`, and goes back to the page's own title when nothing waits. A `MutationObserver` on `.screens-count`
drives it rather than htmx's own event, which did not reach the handler (a first version listened for
`htmx:afterSwap` and never fired). Only "waiting" goes in the title: a count of detached sessions would be noise.

### Status chips say what they mean

Found by the `vardot-ai-ux-designer` agent reviewing the live pages. A project card's agent chip reads **"agent
working"** (brand blue) or **"waiting for you"** (amber, pulsing), in words: before, a stopped agent was
"agent running" with a hand added, so colour and an emoji carried the one state that needs a person. DDEV state is
**Running** (green) or **Stopped** (a quiet outline, never the agent's blue), each with a dot drawn by CSS rather
than an emoji, because each machine draws emoji its own way. On Screens a waiting session says **"Waiting for you
· yes or no"** (what it waits for, from `waiting.js`), an attached session is a neutral outline (amber is kept for
waiting), and the toolbar says "2 waiting" beside the hand. "Wipe dead" is **Remove ended sessions**.

### Page structure and event names

Home carries one `h1` ("Workspaces"), each workspace card title is an `h2`, a project list is an `h2` under the
workspace `h1`, and the Playwright browsers on Screens are an `h2` in their own one-column group (it had been an
`h4` inside the grid's wrong column). A filter's visible word is inside its accessible name: **State**, **Type**
and **Per page**, not three different "Show" labels. The Build button is 42px, the height of the fields beside it.

**htmx 4 fires only `htmx:after:swap` style names.** `htmx:afterSwap` is never dispatched, so five listeners
(field mics on swapped fields, row captions, the editor dialog's name, the tab title) did nothing and looked
fine because another path covered each by luck. `page-structure.test.js` fails on a camel-case name in
`ui.js` or `mic.js`. `modal-fit.css` also stopped defining its padding as `--modal-*` custom properties: the
themes test requires every theme to define every token a component uses, and these were set on one element.

### Default styling (`style:` in `settings.yml`)

The dashboard's appearance is configuration, not code:

```yaml
style:
  workspace_name: Workspace     # the word beside the wordmark
  mode: light                 # light | dark | system   — the DEFAULT, not an override
  editor_theme: auto          # auto | light | dark     — Ace, independently of the page
  logo_on_light: vardot-logo-on-light.svg
  logo_on_dark: vardot-logo-on-dark.svg
  favicon_svg: vardot-emblem.svg
  favicon_png: vardot-favicon.png
```

`styleSettings()` in `workspaces.js` fills in the shipped defaults and validates the enums, so a typo
falls back rather than rendering nothing. All seven keys appear in `/settings` with no extra work —
the line-by-line editor lists whatever scalars the file holds.

**`mode` is a default, never an override.** The pre-paint script applies it only when `localStorage` has
no `ws-theme`: someone who has used the toggle keeps their choice, which is the difference between a
default and a setting that fights the user. Verified with `mode: dark` — a first visit went dark, and a
visitor with `light` stored stayed light. `system` follows `prefers-color-scheme`.

**`editor_theme` is separate on purpose.** A code editor is somewhere people often want dark even on a
light page, so `auto` follows the mode while `light`/`dark` pin it. It reaches the client as
`data-editor-theme` on `<html>`, read by `aceTheme()`. Verified: `editor_theme: dark` on a light page
gives Ace `tomorrow_night`.

Two traps, both hit while building this. The inline pre-paint script lives **inside a template
literal**, so a backtick in one of its comments ends the literal and takes the whole app down with a
syntax error. And **do not restyle Ace's own chrome**: the gutter, the active line and the rest come as
a matched set per theme, and the overrides here were keyed on `html.dark` — so a dark editor forced onto
a light page (`editor_theme: dark`) drew a *light* gutter of line numbers beside dark code. Ace styles
`.ace_gutter` itself; letting it puts the gutter at `rgb(37,40,44)` against a `rgb(29,31,33)` code area.

### Settings editor (`/settings`)

`core/config/settings.yml` and every `workspace.<name>.settings.yml`, editable from the dashboard —
reachable from the rail's `Go` group on any page. Two constraints drive the whole design:

- **A secret's value never leaves the server.** `isSecretKey` matches `pass`/`password`/`token`/
  `api_key`/`secret`; those render as an empty `type="password"` field with "set — leave blank to keep
  it", and a blank submission keeps what is on disk. The value is not in the HTML, not in the response
  after saving (the confirmation names the keys, never the values), and not in `actions.log` — `audit()`
  logs a fixed allowlist of fields, which is why it must stay that way.
- **The file is rewritten line by line, not parsed and re-dumped.** `js-yaml` would drop the comments
  (the committed `settings.yml` documents `$ai_providers_<provider>_api_key` in one) and reflow
  everything, turning a one-key change into an unreviewable diff. `readSettingsRows` walks the lines
  tracking indentation to build dotted paths and remembers each key's line number;
  `writeSettingsValues` replaces the value on exactly those lines, keeping indentation, inline
  comments and quoting. Verified: changing one key produces a one-line diff.

**Lists are editable, not read-only.** `listEditorHtml(file, key)` renders any YAML list in a settings
file as rows you can drag (`public/sortable.js`, the same pointer-event sortable as the home cards, by a
handle or the row) or move with arrows and Alt+arrow keys, plus an Add field. Three lists reach it: `workspaces:`
(what exists and the card order), `profiles:` (the loop in `cmd-build-profiles.sh`, which `rm -rf`s each
entry before rebuilding it) and `site_templates:`. A nested list is found by its dotted path
(`auth.google.allowed_domains`), and each list editor gets its own id. `readListBlock`/`writeListBlock` replace
only the list's own lines and keep each kept item's raw line. **Adding a workspace is four things**, so
`addWorkspace` does all four — the list entry, `workspace.<name>.settings.yml`, the folder, and a
`*.<name>.workspace` DDEV hostname (which needs a `ddev restart` to resolve, and the response says so).
**Deleting one is offered only when it is not used** (`workspace-delete.js`): no project, file or backup in
it, no screen session running there, and not the last one. It asks three times (the confirm dialog, the
name typed, `YES` typed) and undoes the same four things.

Two guards, because this list is the workspace registry: a drag posts the order it was rendered from and
is refused with **409** when the file has changed since, and any new order must be a **permutation** of
the current one — an entry silently lost here would unregister a workspace. Both were written after I
scrambled the list myself, by letting a `python` edit and an API write race for the same file.

**Each list says what it is, from the code that reads it** (`LIST_META`): `modules:` is contrib worked on
in that workspace, cloned over SSH with `git clone git@git.drupal.org:project/<name>.git` by
`cmd-tool-git-clone-all-modules.sh` — which **deletes each folder first**, so it re-clones everything and
discards uncommitted work; `themes:`/`admin_themes:` feed the `cmd-all-*-themes.sh` build and install
loops; `profiles:` feeds `cmd-build-profiles.sh`, which also deletes first. Each carries its own
placeholder and validation pattern, so a Drupal machine name is checked as one. **A name that exists in
`products/` is refused from `modules:`** — that folder is ours, not third-party contrib, and cloning it
into `modules/` too gives two checkouts of one thing.

**A workspace's icon and description live in its own settings file.** `presentation: icon:`/`subtitle:` in
`workspace.<name>.settings.yml` overrides the hardcoded `PRESENTATION` row (`{...PRESENTATION[name],
...own}`), which is the only way a workspace added from the dashboard gets anything but the default folder
icon. The chooser shows **the icons themselves**, as radio tiles (a `<select>` can only render text), with a
name filter over all **162**. That list is **parsed out of the vendored `uikit-icons.min.js`**, not typed
out, so it cannot drift from what renders — and that drift was real: `commands` shipped with `terminal`,
which UIKit has no icon for, so its card and rail drew an empty box (now `nut`). Anything outside the
parsed set is refused. `writeWorkspacePresentation` appends the block when it is missing, since the
line-by-line writer only edits values already present.

**Workspace icons are Tabler, vendored as one sprite.** Chosen by measuring, not reputation:

| Library | Icons | Raw | Gzipped | Licence |
|---|---|---|---|---|
| Lucide | 2006 | 463 KB | 83 KB | ISC |
| **Tabler outline** | **4736** | 1476 KB | **192 KB** | MIT |
| Bootstrap Icons | 2064 | 1031 KB | 211 KB | MIT |

Tabler gives 2.4× the icons for 2.3× the gzip and shares Lucide's 24×24 stroke geometry, so it drops in
with no CSS change; Bootstrap Icons cost more gzipped for half the set. `public/vendor/tabler-sprite.svg`
holds every icon as a `<symbol>`, with the shared stroke attributes stated once on the root and Tabler's
no-op bounding `<path>` stripped from each. `brand-*`/`logo-*` are excluded: logos are not interface icons.

**UIKit is no longer offered for workspaces** — 122 icons in a different visual language made cards that
did not match each other. It still *renders*: `iconHtml(name, ratio)` treats a **bare name as UIKit**, which
is what the dashboard's own chrome uses and what keeps any previously stored value working, while
`tabler:<name>` resolves through the sprite. All 19 `PRESENTATION` defaults are `tabler:` names, each
verified against the sprite.

**The stroke and colour live in CSS, not in the sprite.** Presentation attributes on an external sprite's
root `<svg>` do **not** cross into the referencing document — a `<symbol>` pulled in by `<use>` inherits from
the *host* `<svg>`, which had none, so every icon drew at the default **1px** stroke and looked thin and
wrong. `.tabler-icon` states `fill`, `stroke`, `stroke-width` (1.75, 1.6 at card/heading size) and the round
caps once in `style.css`, which fixes every use and keeps the sprite free of 4736 repetitions. The card,
page-heading and preview icons are `--brand-primary`: the old `uk-icon` carried `uk-text-primary`, and
dropping that class in the move to `<svg>` is what turned them grey.

**Paged, and searchable.** 4736 tiles inline would be a multi-megabyte page, but making search the only
way in means you cannot browse — and you often do not know the name of the icon you want.
`/fragments/icons?q=&page=` serves 120 per page with a pager (`«‹ 121–240 of 4734 · page 2 of 40 ›»`), the
grid loads page 1 on `hx-trigger="load"`, every pager link carries the query through `hx-include` so paging
stays inside a search, and typing resets to page 1 of the matches on a 220ms debounce. The settings page
stays around 61KB.

`site_templates:` has **no reader**: every site-template builder declares its own `site_template_name`
inline, the way the distribution builders declare their five values. Editing that list is inventory
bookkeeping, not configuration — it changes nothing until a builder exists.

The form carries each row's line number and key, and a save refuses with **409** if the line no longer
holds that key — the file changed under the form, and blindly writing would put a value on the wrong
key. Lists (`workspaces:`) are not fields of that form: they have the list editors above, because their
order is the dashboard's card order and their membership registers a workspace, so they are not something to
retype into a text field by accident.

Editing the live file is immediate — `workspaces.js` re-reads config on a 2s memo, so no restart.

### The images workspace

`images/` holds images, screenshots and generated pictures, `kind: 'files'`, type `media`, listed right
before `videos`. It is not the generic file list: `itemRowsHtml` hands `images` to `images-page.js`, a gallery
of lazy-loaded thumbnails (folders first, search, sort including **Largest first**, a type filter, paging) with
a viewer in the editor modal (previous and next, also the arrow keys, fit or actual size, dimensions, size,
date and where it lives, Download, Open, Copy link, Copy Markdown, Rename and Delete).

- **Dimensions come from the header** (`images.js`: PNG, JPEG, GIF, WebP, AVIF, SVG), a few KB per file and
  cached, so a folder of hundreds lists without a process per file.
- **Thumbnails** are made once per file with ImageMagick in the dashboard container, three at a time, into
  `core/workspace-app/.cache/image-thumbs/` (gitignored); an SVG or a file under 60 KB is shown as itself.
- **All media images** lists, read-only, the images in images, docs, videos, audio, specs, designs and the
  dashboard's own `docs/screenshots` (served by `/fragments/images/app-file/`), depth 4, at most 3000,
  cached a minute. Never a site workspace. Rename and Delete exist only for `images/` itself.
- `/files/<ws>/<path>` serves webp and avif, and an SVG with `default-src 'none'; sandbox`, since an SVG
  can carry script.

**Making images** (`images-create.js`), all in the dashboard container, no paid call:

- **Upload images** posts each file as its own request to `/actions/image-upload`, its bytes as the body, on
  a route before the 1 MB form parser (same-origin check kept). The type is decided by the bytes (`sniff`),
  not the name, 25 MB a file, and a taken name gets a number.
- **Screenshot a page** drives the container's chromium through Playwright: a width of 1280, 1440, 1600
  (1600×1000, the docs standard) or 1920, light or dark, the window or the whole page.
- **Edit as a new file**, in the viewer: crop to a centred aspect, resize to a width, convert to PNG, JPEG or
  WebP with a quality. `editArgs` builds ImageMagick argv from fixed lists and checked numbers only, and the
  result is `<name>-v2…`; the original is never written.

**Generate with AI** (`images-ai.js`) calls OpenAI's Images API with `ai_providers.openai.api_key` from
`settings.yml`, sent only as the `Authorization` header and never printed, logged or put in a URL (an error
message has any `sk-…` masked). Models `gpt-image-2.5-flare` (default) and `gpt-image-2.5-sunburst`; square,
landscape or portrait; low, medium or high; one to four. It is paid, so the form answers with a **plan**
(model, size, count, OpenAI's published per-image figure) and the request goes out only with
`confirm=yes`, which only the confirm dialog's Yes sends. Each image lands in `images/generated/` with a
`<file>.json` sidecar (prompt, model, size, quality, time, cost from the response's `usage`), and the viewer
shows it as "How it was made". With no real key the form says what to set and its button is disabled. The
tests run against a local stand-in (`OPENAI_IMAGES_API`), so they never spend anything.

Right after each image is saved, `describeImage` makes ONE vision call (`gpt-5.4-nano`, chat completions, the
image as a base64 data URL at `detail: low`, never a public URL, JSON back) for a 1 to 2 sentence `summary`
and an `alt` of at most 125 characters, added to the sidecar with its cost and written to a readable
`<stem>.md` (marked with `<!-- images: how this image was made -->`, so a note of the same stem that is not
ours is never overwritten; then it is `<file>.md`). The plan includes it. A failed description keeps the
image, records `description: not written`, and the viewer offers **Describe it** (`/actions/image-describe`,
behind the confirm dialog, images in images/ only). Copy Markdown uses the alt text. `OPENAI_CHAT_API`
points the tests at the stand-in.

**Edit with AI** (`editPlan`, `editImage`) sends the source to OpenAI's image edit endpoint as multipart, the
key in the header only. PNG, JPEG and WebP go as they are; anything else is a temporary PNG made with
ImageMagick; an SVG goes to Claude Code instead. Paid, so a plan first (the new image, the source as image input, and the
description) and the request only with `confirm=yes`. The result is never the source: `<stem>-ai-v<n>.<ext>`
beside an image in images/, or images/edited/ for one from another workspace, with the same sidecar and
`.md` plus `source` and `edit_prompt`, and the viewer links back to the source. `OPENAI_EDITS_API` points
the tests at the stand-in.

**Providers are modules** (`images-providers/`, `index.js` holds `ORDER`). Each exports `id`, `label`, `keyName`,
`kinds` (`generate`, `edit`, `svg`), its models, sizes and qualities, `available()` (`{ok, why}`), estimates, and
the calls for its kinds; the forms, plans and actions read the registry, so a new provider is one file in
`ORDER`. `http.js` holds what they share: `keyFor` (a `CHANGE_ME`/`change-this` placeholder is no key), one POST
with the key in a header, and errors with `sk-`, `xai-`, `AIza` and `Bearer` tokens masked. OpenAI keeps its
behaviour; **Gemini** uses the Interactions API (`gemini-nano-banana-2.1`, the key in `x-goog-api-key`; Imagen
is shut down), **xAI** `grok-imagine-image-2.0`, **Stability** Stable Image Core (multipart, generate only),
**Anthropic** writes SVG only. Gemini and xAI publish no per-image figure on the pages they were built from,
so their plans say so rather than guess. `xai` and `stability` ship as `sk-change-this` placeholders. Each
endpoint has an env override (`GEMINI_INTERACTIONS_API`, `XAI_IMAGES_API`, `STABILITY_CORE_API`,
`ANTHROPIC_MESSAGES_API`, …) and `tests/unit/images-providers.test.js` checks every request shape against a
stand-in. A provider with no key is a disabled option that names the key.

**Claude Code CLI** (`claude-code.js`, `claude_code_cli`) is `async` and keyless: `startSession` writes the
prompt and a job file 0600 into `.screens/prompts/` and starts a host screen session through the runner,
`claude -p "$(cat '<file>')" … --allowedTools Write Read --disallowedTools Bash WebFetch WebSearch` (the prompt
comes first because `--allowedTools` is variadic), so no prompt text is ever on the line. Claude writes
`<name>.svg` and `<name>.claude.json` (summary, alt) and nothing else; `scripts/images-claude-finish.js` then
sanitises the SVG, renders the PNG with host Chrome (`images-render.js`, a virtual time budget so animations
finish first) and writes the records (`images-records.js`, no dependencies) with `provider: claude_code_cli`.
It needs the confirm dialog like a paid call, because it starts a session. It is the only provider that edits
an SVG, and it is not offered for a raster edit.

**Generate SVG** (`images-svg.js`, `images-svg-core.js`, `images-svg-sanitize.js`, `actions/images-svg.js`)
asks a text model (OpenAI `gpt-5.4-mini`/`nano`, Gemini, Anthropic, or Claude Code) for SVG code. Settings are
the `svg:` block of `workspace.images.settings.yml`, read live: `brief`, `palette: brand-tokens` (or five hexes),
`max_attempts`, `request_timeout`, `time_budget`, `motion` and `examples` (the picker; it fills the prompt and
the style, and both stay editable). Every answer goes through `core.finish`: the allow-list sanitiser (no
script, foreignObject, image, handlers, external `href`/`url()`, `@import`, or SMIL that sets `href`), which
counts what it removed; a drawing that lost shapes to it is retried with the reason; the root gets a viewBox
and loses width and height; a `transform` on an element a CSS animation moves goes onto a wrapping `<g>`; and
it must hold 4 drawable elements in 4 `<g class="part">` groups, or it is retried with the reason within the
attempts and the time budget. **Draw the strokes** writes its motion into the file (each part `--i:n`, strokes
`pathLength="1"`, `draw-rise` 1100 ms with a 110 ms stagger, all inside `prefers-reduced-motion:
no-preference`), so it plays anywhere. Claude Code retries through its finish step: exit 3 appends the reason
to the prompt file and the session's loop draws again. The viewer shows an SVG as an `<img>` (it animates and
runs nothing), starts it when a quarter is in view, and has **Replay** and **Copy SVG markup**; its PNG
preview stands in under reduced motion. Tested example drawings live in the live `images/svg/examples/` only,
never in the repository.

### The videos workspace

`videos/` holds recorded walkthroughs and their poster frames — `kind: 'files'`, like docs. They used
to sit in `docs/videos/`, which made a 10MB binary tree a subdirectory of the documents that reference
them; moving them out is a live-tree change (the files are never committed), but the **references had
to move with them**: two docs linked `videos/<name>.mp4` relatively and now link `../videos/<name>.mp4`.

**The final voiceover** (`videos/cmd-tools-elevenlabs.sh`, `fun-elevenlabs.sh`, `libs/elevenlabs.py`). A video is
drafted with the local Piper voice; once a person approves a draft, this makes the last voiceover with
ElevenLabs or levels a take a person recorded. The `elevenlabs:` block in `settings.yml` holds `api_key`
(masked like every secret), `voice_id`, `model_id` and `region`; without a real key the stage is not offered
(`-a status` exits 3). `voiceover` sends one request per section of a timed script (`## D01 Title (00:00.0 to
00:21.4)` with `> ` spoken lines), speeds a section up by at most 8% to fit its window, stops with exit 5 when
one cannot fit, and puts the result on the approved video with `-c:v copy`. Four rules hold throughout:
anything that spends credits prints a plan and exits 4 until `--confirm`; an overwrite is refused before any
request; the key reaches the client in one process's environment and never a command line; and the wrapper
evals nothing the user typed, because `argparse`'s own `eval` runs a `$(...)` value, so the engine rejects
quotes, `$`, backticks and backslashes with a type check first. Section audio is kept beside the output, so
a re-run sends only the sections whose text changed.

**The modal is styled for dark mode.** UIKit hardcodes `.uk-modal-dialog` to white and the dark rules
only ever covered `.uk-card-default`, so in dark mode the dialog stayed white behind a dark card with
near-white text on it — unreadable. It now uses the card surface (`#1c2136`), the bare `×` gets its own
colour since it sits on the dialog rather than on a card, and the nested `.editor-card` drops its own
border and shadow: two dark panels with two borders reads as a mistake. Measured: heading 14.01:1, meta
6.25:1, Ace's own code 9.8:1 — and light mode unchanged at 12.63:1.

**Editing a video makes a NEW version** (`videos/cmd-tools-video-edit.sh`, `fun-video-edit.sh`, `libs/video_edit.py`;
dashboard `video-edit.js`, `actions/video-edit.js`, the Edit button on every video row). A change is a timeline of
pieces, a stretch of the source or a card, built in one ffmpeg run, and `retime_script` rewrites the timed script
so each section still points at its words. The original is never changed and the name is the next free `-v<N>`.

- **A logo scene is a Chrome screenshot, not an ffmpeg filter.** This ffmpeg has no `drawtext`, and a screenshot of
  `vardot-logo-on-dark.svg` on the brand colour in Figtree is the real logo and the real font. Cards are drawn at the
  video's own size. An added section is a card spoken in full: the picture waits for the voice.
- **Free text never reaches a command line.** Titles and the new section's words travel in a JSON file
  (`--strings-file`) under `.screens/voice-text/`, which the command removes; the line holds only validated tokens.
- **Every tab can ask Claude Code** (`askBrief` in `video-edit.js`, `/actions/video-edit-ai`). An optional prompt sits
  under the settings of each tab, voice included, with an **Ask Claude Code** button beside the normal one (which is
  unchanged and ignores the prompt). It starts a Claude Code screen in `videos/` briefed with the video, its timed
  script sections, the editing and voice commands, the rules (a new version only, the original never touched, stop at
  any ElevenLabs plan until the person says yes, look at the result before saying it is done), the non-empty settings
  already chosen on the tab, and the person's words last. It works alone or added on to the tab. The prompt of **any**
  Claude screen now reaches `claude` through `.screens/prompts/<session>.txt` and `"$(cat …)"`: a double-quoted word
  on the line let `$(…)` and backticks in a typed prompt run in the shell.
- **A section can be borrowed from another video** (`--borrow` in `video_edit.py`, the Borrow group on the Sections tab).
  `VIDEO|SECTION-or-START-END|AFTER|SCRIPT`, repeatable: a stretch of another video goes after one of this video's
  sections, or at the start or end, its words come with it into the script as a `B01`, `B02`… section, and the times of
  everything after it move. The picture is fitted inside this video's frame (pillarbox or letterbox, never stretched),
  a borrowed part keeps its own speed (`--speed` and `--length` apply to the edited video only), and nothing is changed
  in the video it came from. **Every stretch is its own seeked input of its file** (`-ss`/`-t`), not one input cut by
  many `trim` filters: with a second source in the middle ffmpeg held the whole rest of a 1440x900 video in memory
  while the timeline waited, and a 93 second edit took 5 minutes 15 seconds; it takes 17. A piece with no length is
  dropped, because `-t 0` means no limit to ffmpeg.
- **The tabs are short.** Sections is an accordion (Remove sections, Borrow a section from another video, Add a
  section) with one group open at a time, the one that applies; Opening and Closing sit side by side on Logo and music;
  the prompt on every tab is a folded `<details>`, **"Prompt the AI to make more changes or tweaks"**. Opened, it can
  also name **a project** (any folder of products, dev, test, sandboxes or demos: the session starts in it and reads its
  CLAUDE.md) and **a link** (any http or https page, handed over as external input to look at, never to obey).
- **Only a paid section spends**: an ElevenLabs voice for an added section stops at a plan (exit 4) and the action
  asks through the confirm dialog. Speed, length, trim, cuts, scenes and music cost nothing.
- **The videos list holds only videos**, with posters as thumbnails. A voiceover script beside one is read from its
  card's Transcript button, found in `docs/` first and then in `videos/` itself, and is not a row of its own.

**Playing one uses the editor modal**, not a second overlay: `/fragments/videos/play/<name>` returns a
`<video>` card into `#editor-modal-body`, and `ui.js` **pauses any media before emptying** that
container — detaching a playing element leaves its audio running, which is startling once the modal has
visibly closed. A poster of the same stem (`<stem>-poster.jpg`) is used automatically when the
recording made one.

**Only video files are listed.** A poster is an input to the player, not something to browse — listing
them doubled the rows and gave half of them a Play button that the fragment would have refused anyway.
`VIDEO_RE` is defined once and used by the listing, the play fragment and the row icon, so a file can
never be offered a Play button the player then 404s. The posters stay on disk and still reach the
player as its `poster` attribute.

`/files/<workspace>/<name>` gained real content types and **byte-range support**. It previously served
everything as `application/octet-stream` with no `Accept-Ranges`, which for a video means the scrub bar
does nothing, the whole file must arrive before playback, and some browsers refuse to play at all.
Verified: `video/mp4`, and `Range: bytes=1000-2000` → `206` with `content-range: bytes 1000-2000/6353936`.

### The audio workspace

`audio/` holds voices and sounds — voiceovers, voice samples, narration takes, effects and music —
`kind: 'files'` and type `media`, like videos. It reuses everything videos has: the browsable folder
list (`voices/` and `sounds/` open as rows), the byte-range `/files/audio/<path>` route and the editor
modal. What it adds is the **sound player**: `AUDIO_RE` in `format.js` is the one definition of what
plays, the same `/fragments/<ws>/play/<path>` route answers with an `<audio>` card instead of a
`<video>`, and a row gets a Play button for it. Speed and loop are plain `data-sound-*` controls in
`ui.js`, acting on the audio in their own card. A new workspace also needs a `*.audio.workspace` DDEV
hostname, which takes a `ddev restart` of the dashboard to resolve.

**The player and the cards follow a streaming site's habits** (`public/media-player.js`, `media-info.js`). A card
shows the recording's length in a corner (read from the file: the container has no ffprobe, so mp4 header at
either end, webm, wav and constant-bit-rate mp3 are parsed, and anything else shows nothing), CC when a script
or transcript exists, and a short muted preview while the pointer rests on it. The player starts when opened,
remembers the speed in `localStorage` (`ws-media-speed`; 0.5x to 5x in quarter steps, in a dropdown), answers
the keyboard (space/K, J/L, arrows, M, F, `<` `>`, digits), draws the transcript's sections as a chapter bar
with the current one highlighted, and steps to the previous and next recording of the list it was opened from.

**Generate voice** is the rail's primary action there, and `audio/cmd-tools-voice.sh` (`fun-voice.sh` over
`libs/voice.py`, which imports the ElevenLabs engine) is what it runs, so the form and the CLI cannot
disagree. Two engines, and what the form offers follows the keys the machine holds: `-a engines --json`
reports each engine's availability, ElevenLabs' voices (only when the key may list them — otherwise a
voice-id field), the plan and the credits left. **Piper is a host tool**: the dashboard container has no
Piper, no voice models and no ffmpeg, so the form offers it from the voice-narration catalog
(`hostOnly`) and the run goes through the host screen runner like every long action; the text reaches it
through a private temp file, never a command line. Two modes: a text to a file in `voices/`, or a script
spoken over a video as a NEW video in `videos/` (the engine's `voiceover`, with Piper swapped in for the
synthesiser; a transcript with no timed headings becomes one section across the whole video). The video
mode shows its plan first, from a port of the script parser in `audio-voice.js`, because the container
cannot probe a video; the real fit check runs on the host. ElevenLabs needs `confirm=yes`, which only the
confirm dialog's button sends, and the command refuses without its own `--confirm`.

### Domains

Hierarchical by default, driven by `hub_domain:` in `settings.yml` (default `workspace.ddev.site`):
`workspace.ddev.site` (home) → `<workspace>.workspace.ddev.site` (workspace page) →
`<project>.<workspace>.workspace.ddev.site` (the project's real site, used by Launch). The canonical
`https://<project>.ddev.site` always keeps working. Wildcard hostnames + the nginx tier handle routing,
so projects need no per-project config. Setting `hub_domain` to a public domain runs the same system as a
remote workspace hub.

## A session finds its own context, at any depth

Claude Code loads every `CLAUDE.md` between the working directory and the filesystem root, so the
context is placed once per level and a session started anywhere inherits all of it:

```
~/workspace/CLAUDE.md                      how to work out which workspace you are in
~/workspace/<workspace>/CLAUDE.md          @AGENTS.md — the agent, the skills, that folder's commands
~/workspace/<ws>/<project>/CLAUDE.md       written by graphify when a graph exists
```

The workspace-level file **imports** `AGENTS.md` with `@AGENTS.md` rather than repeating it, so the
folder has one source of truth and the two cannot drift. Verified from
`test/v11canvasi18n/web/modules`, four directories down: all three files load, and `claude -p` there
correctly answers the workspace (`test`), the agent (`webship-workspace`), a hard rule (DDEV only) and
that the project has a 989-node graph — none of which it could infer from that directory.

The tree's own root `CLAUDE.md` is not this file: it ships as
`core/templates/workspace-root-CLAUDE.md` and `core/scripts/sync-tooling.sh` places it **only when
missing**, since it is a live-tree file a machine may have added to. `AGENTS.md` and `CLAUDE.md` are
now in the rsync include list alongside `cmd-*.sh` and `README.md`.

## AGENTS.md in every workspace

Each workspace folder carries an `AGENTS.md` naming the **`webship-workspace`** agent and only the
skills that actually apply to it — `webship-workspace-build` and `-backups` where projects are built,
`-graphify` where there is code to map, `-upsun` only in the three folders that deploy, `-authoring`
in `ai-agents`/`ai-skills`/`ai-prompts`, `webship-gitlab-ci-local-runner` where projects are git clones with a
pipeline. One generic list pasted nineteen times would be noise in eighteen of them.

Each also lists that folder's own `cmd-*.sh` and repeats the hard rules, because an agent reading
`AGENTS.md` in `~/workspace/modules` may never see this file. `README.md` is for a person; `AGENTS.md`
is the same folder explained to a coding agent.

## Naming

The tooling was renamed from "VDO" — no `vdo` in filenames, variables, or folder names (the VDO drop logo
is the dashboard logo). Env vars are `WORKSPACE_{ROOT,PATH,SCRIPTS,CONFIG}`. Only real project
directories are called "projects"; every other workspace names its items via `PRESENTATION` in
`workspaces.js`.

## Reference docs in this repo

- `README.md` — the short front page: what it is, three steps to run it, where everything is.
- `core/workspace-app/docs/REFERENCE.md` — the full reference that README used to be: setup, layout, dashboard, build/backup/remove usage, and how to add your own commands, scripts and row actions.
- `core/workspace-app/README.md` — dashboard internals, DDEV wiring, per-machine adjustments, security note.
- `docs/workspace-tips-and-rules.md` — the distilled hard rules + operational tips.
- `worklogs/` — dated session worklogs (what changed, what was learned, what was left unverified),
  and the **output directory for the `vardot-worklog-from-git-actions` agent**, which generates
  activity worklogs from GitHub, GitLab (including `git.drupalcode.org`) and Bitbucket. That agent
  reads its output directory from this file: worklogs go to `~/workspace/worklogs/`, named
  `session-worklog-<YYYY-MM-DD>-<topic>.md` by hand or with the agent's own dated convention when
  generated.

## Known gaps

- `themes/cmd-all-*-build-themes.sh`, `themes/cmd-build-drupal-template.sh` and the `cmd-tools-update-all.sh`
  scripts in dev/test/demos/sandboxes/profiles/themes still use raw host `composer`/`sudo chown` — flag
  before running; they have not been converted to DDEV.
- The dashboard job registry is in-memory; an app restart orphans running builds.
