# Developer guide

For changing the tooling itself: adding a command, a builder, a workspace, or a dashboard feature.
If you only want to *use* the workspace, [USER-GUIDE.md](USER-GUIDE.md) is the one you want.

Everything here is enforced somewhere — by `cmd-smoke-test.sh`, by a unit test, or by a failure that
has actually happened on a real machine. Where a rule exists because something broke, it says so.

---

## The shape of it

```
~/workspace/
├── core/
│   ├── scripts/            the whole build chain, shared by every command
│   │   ├── bootstrap.sh              locates the workspace from its own path
│   │   ├── bootstrap-libraries.sh    argparse, YAML, progress bar
│   │   ├── bootstrap-functions.sh    an explicit source list — NOT a glob
│   │   ├── args/arg-*.sh             one argument surface per command family
│   │   ├── functions/fun-*.sh        where the work actually happens
│   │   └── tests/cmd-smoke-test.sh   the test suite for the commands
│   ├── config/
│   │   ├── settings.yml              the registry: workspaces, secrets, style
│   │   └── workspace.<name>.settings.yml   one per workspace
│   └── workspace-app/      the dashboard (node:http + HTMX, no framework)
└── <workspace>/            dev, test, products, … each with its own cmd-*.sh
```

**A fresh clone works with no setup.** Every `cmd-*.sh` resolves `WORKSPACE_SCRIPTS` from its own
`${BASH_SOURCE[0]}` before sourcing `bootstrap.sh`, which derives `WORKSPACE_PATH`, `_ROOT` and
`_CONFIG` from itself. There is no installer step for this and no `.bashrc` edit; exported
`WORKSPACE_*` values still win, which is how the dashboard container points at its bind-mounted tree.

---

## Hard rules

These are not style preferences. Each one has cost somebody a rebuild or an outage.

| | |
| --- | --- |
| **Containers only (DDEV by default)** | `ddev composer`, `ddev drush`, `ddev delete -y -O`, `ddev export-db`. Never host composer, drush or mysql |
| **Never write a `$databases` block into `settings.php`** | DDEV's `settings.ddev.php` owns it. `set_default_settings` only ensures the config sync directory |
| **`ddev start` takes `-y`; `ddev stop` does not** | |
| **Every `cmd-*-project.sh` carries `# workspace-name: <Human Name>`** | the smoke test enforces it and the Build dropdown shows it |
| **Spawned commands must close stdin** | `stdio: ['ignore','pipe','pipe']` — `ddev`'s `docker exec -i` hangs for ever on an open stdin pipe |
| **`--help` is only safe on argparse scripts** | never "test" a non-argparse `cmd-*.sh` by running it |
| **Never hardcode a person** | `contributor.name`/`.email` in `settings.yml`. A shared tool that names one author makes everyone else's commits claim someone else's work |

**A DDEV project does not come back by itself.** Its containers carry `restart: no`, so after a reboot
every workspace URL answers 404 from a router with nothing behind it. `core/scripts/autostart.sh
--enable` installs the systemd user service that fixes it. Do **not** reach for a Docker
`restart: unless-stopped` policy instead: DDEV re-pushes router config on `ddev start`, so a container
resurrected behind its back comes up with no route and answers nothing — the same 404, harder to find.

**Every router-mutating verb serialises.** `start`, `stop`, `restart`, `poweroff` and `delete` each
tear down and recreate the one shared `ddev-router`; two at once can leave it destroyed, which takes
every `*.ddev.site` address down — the dashboard included — while the web containers sit there
healthy. `core/scripts/ddev-shim/ddev` holds an `flock` for every caller, and `DDEV_ROUTER_LOCK_HELD`
stops a lock being taken twice by nested callers.

---

## Adding a command

A `cmd-*.sh` is a thin declaration; the work lives in `core/`.

```bash
#!/usr/bin/env bash
# workspace-name: My Thing

WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.dev.settings.yml);

ARGPARSE_DESCRIPTION="What it does, in one line"
source ${WORKSPACE_SCRIPTS}/args/arg-my-thing.sh || exit 1 ;

shift $#;
cd ${WORKSPACE_ROOT}/${doc_name};
my_thing_command ;
```

Then `args/arg-my-thing.sh` (an `argparse` heredoc) and `functions/fun-my-thing.sh`.

**Add the function file to `bootstrap-functions.sh`.** It is an explicit `source` list, not a glob, so
a new `fun-*.sh` stays invisible until it is listed there — and the failure is a "command not found"
a long way from the cause.

Three argparse traps, each found by hitting it:

- **`store_true` yields the string `yes`**, so test `[ "${FLAG}" == 'yes' ]`.
- **The dest becomes a shell variable**, so avoid names bash already owns. `--hostname` would clobber
  `$HOSTNAME`; the clone command uses `--extra-hostname` for exactly that reason.
- **Several `store_const` aliases sharing one dest overwrite each other.** Use one option with a value
  (`-a start|stop|status`) instead.

Read a flag that a caller may not set as `${FLAG:-}`: `remove_project` is called from the dashboard
and from other scripts that know nothing about `--force`.

---

## Adding a builder

A builder declares five distribution facts **inline** and lets `build_distribution` do the rest:

```bash
site_version="~11.0.0"
distribution_name="webship"
distribution_title="Webship 11"
distribution_webroot="docroot"
distribution_profile_repo="..."
distribution_project_template="drupal/webship_project"
```

There is no `core/config/distributions/` — a builder is readable on its own, and changing what one
builds touches only that file.

**Version strings follow the file name.** `cmd-<distro><major>-<minor>-0-project.sh` pins
`site_version="~<major>.<minor>.0"` — the three-segment form, so it means "that minor, latest patch".
A `-x-` builder tracks the branch (`11.0.x-dev`); latest-per-major builders use a caret (`^11`, `^2`).

A whole new distribution is one `args/arg-<name>.sh`, one `functions/fun-distribution-<name>.sh`
(with `install_<name>_with_drush`, `enable_<name>_extra_components`, `set_<name>_users`) and the
`cmd-*-project.sh` files that pick versions.

---

## Adding a workspace

Two entries and a directory:

1. the name in the `workspaces:` list in `core/config/settings.yml` — that list is also the home
   page's card order;
2. `core/config/workspace.<name>.settings.yml`, holding `doc_name` and optionally
   `presentation: icon:`/`subtitle:`.

The dashboard re-reads config on a 2-second memo, so there is no restart and no code change. Settings
→ the `workspaces:` list does all of it from the browser, including the folder and the DDEV hostname
(which needs a `ddev restart` to resolve — the response says so).

**Deleting one** goes through the same list, and only for a workspace nothing uses (`workspace-delete.js`):
no item in its folder but its own tooling, no backups, no screen session running there, and not the last
workspace. It asks three times (the confirm dialog, the name typed, `YES` typed), checks again on the
server, and removes the list entry, the settings file, the tooling and the folder, and the DDEV hostname.
Test it on a throwaway `zz-*` workspace, never on one you use.

**Icons are Tabler**, referenced as `tabler:<name>` and parsed out of the vendored sprite, so a name
that does not exist is refused rather than rendering an empty box.

---

## The dashboard

`server.js` (single file, no framework) + `workspaces.js` (the config bridge) + `public/`.
Server-rendered HTML fragments, swapped by HTMX.

- **`workspaces.js` reads the config live.** The only hardcoded table is `PRESENTATION`; script
  discovery is by filename regex, not a hand-maintained map.
- **Jobs are an in-memory `Map`**, so **do not restart the app while jobs are running** — running
  builds get orphaned. Build jobs get a 60-minute timeout: a cold-cache `composer create-project` can
  exceed fifteen.
- **Every action shells out to the real `cmd-*.sh`.** The button and the command line cannot drift,
  and the collision checks, refusals and guards live in one place — the script.
- **The stylesheet is assembled** from `public/css/base.css` + `public/css/components/*.css` + a theme.
  `public/style.css` is not the source; editing it changes nothing. `cssVersion()` stamps the URL from
  the parts' mtimes, so a cached browser picks changes up.

Four things that have taken the app down or hidden a feature:

| | |
| --- | --- |
| **a backtick inside a template literal** | ends the literal and takes the whole app down with a `SyntaxError` hundreds of lines away. There is a test asserting no HTML comment in these files contains one |
| **a variable defined in the wrong IIFE** | renders as *nothing at all* — page rendering swallows errors, so a whole action group silently disappeared |
| **HTMX only swaps 2xx by default** | every 4xx this app returns used to be discarded silently, so a refused save looked like a broken button. `htmx:beforeSwap` in `ui.js` sets `shouldSwap` for 4xx/5xx |
| **UIkit closes a dropdown on an outside click only** | opening a modal is not one, so the menu stayed open on top of the dialog it had just opened |

---

## Testing

```bash
bash core/scripts/tests/cmd-smoke-test.sh    # every cmd-*.sh: syntax, bootstrap chain, header
cd core/workspace-app && npm run test:unit   # node --test
cd core/workspace-app && npm test            # unit + the cucumber browser suite
```

The smoke test's exit code is the number of failures, and it needs no environment setup.

**A test that needs machine state skips with the reason**, at run time, rather than failing or being
excluded — see `tests/step-definitions/preconditions.steps.js`. A suite with permanent red in it stops
being read, which is how this one drifted for weeks without anyone noticing it could not even launch a
browser. (In cucumber that is `return 'skipped'`; `this.skip()` is Mocha's and does nothing here.)

---

## Shipping a change

1. **An issue first**, then a PR referencing it. Both end with the Checkpoints checklist; never tick
   the human-review box.
2. Work in the git clone at `~/workspace/products/workspace` (branch `1.0.x`), not in the live tree.
3. After a merge, bring it back with `bash ~/workspace/core/scripts/sync-tooling.sh --pull` — it
   mirrors the scripts, the dashboard and each workspace's commands, prunes what the clone dropped,
   re-applies this machine's docker GID, and runs the smoke test.
4. A release is an annotated tag on `1.0.x` plus a GitHub release titled with the tag. There is no
   version-bump commit; the installed version is a per-machine stamp, not a committed file.

**Never commit** real credentials, API keys, machine paths or project names. The published files are
team-installable templates: `CHANGE_ME` and `sk-change-this` are what ship.

---

## Where the rest is

| | |
| --- | --- |
| the dashboard screen by screen, with pictures | [README.md](README.md) |
| using it | [USER-GUIDE.md](USER-GUIDE.md) |
| every command and flag, and how to install | `README.md` at the top of the repository |
| the distilled rules and traps | `docs/workspace-tips-and-rules.md` |
| the dashboard's internals and DDEV wiring | `core/workspace-app/README.md` |
| what changed and what was learned, dated | `worklogs/` |
