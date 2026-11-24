# Dashboard plugins

Optional features, each a package of its own, turned on in four steps. The lean core is the
workspaces, the builders, the settings and the assistant shell; everything else — Upsun, Jira, the
Web IDE, git, tests, graphs, RAG, media, avatars, designs — is a plugin in its own repository
(`github.com/webship/workspace-<name>`), required with npm when a machine needs it.

```bash
bash core/scripts/plugins.sh --require github:webship/workspace-upsun   # 1. require: npm install into the dashboard
bash core/scripts/plugins.sh --activate upsun                            # 2. activate: plugins.upsun in settings.yml
bash core/scripts/plugins.sh --install upsun                             # 3. install: place what the manifest names
bash core/scripts/plugins.sh --configure upsun                           # 4. configure: its own settings file
bash core/scripts/plugins.sh --list                                      # where each plugin is
```

The same four steps are buttons in **Settings**: a plugin not added yet is required from **Settings → Add a plugin**, and the other
steps are on the plugin's own tab. `--install` is idempotent, records what
it placed in `core/config/plugins.installed.yml`, keeps a managed block in `.gitignore` so a dev
clone never commits what an install placed, and says when the dashboard container needs
`ddev restart` (a compose file or host mount the plugin brought). `--uninstall` removes exactly
what `--install` placed, while it still is what was placed: the record keeps the hash of every file,
so a file a person changed since (a command, a function) is kept, and so is the plugin's settings
file once it holds anything but the template (a token, an account). After it, `--remove` takes the
package out of the dashboard (`npm uninstall`) and `plugins.<name>` out of `settings.yml`, so Settings
lists only the plugins the workspace has; its settings file stays. The uninstall names each file it
kept. A second `--install` writes the plugin's own files again: one a person changed is first kept
beside it as `<file>.yours`, and the install names both; a file the new version no longer ships is
kept when it was changed here, and said. Records written by 1.0.15 and earlier hold no hash for a
plugin's own files, so `--require` (before npm replaces a package) and `webship-workspace update`
note how the installed version shipped each of them first (`node plugin-install.js remember`).

A plugin is a node package with a `workspacePlugin` manifest in its `package.json` and an
`index.js` exporting `register(api)` — or a folder under `core/workspace-app/plugins/<name>/` with
the same shape, which is how one is developed before it gets a repository.

## The manifest

```json
"workspacePlugin": {
  "name": "upsun",                                   // its settings key and route namespace
  "label": "Upsun",                                  // its name as people write it; also the casing of its name in its AI items' titles
  "settingsFile": "plugin.upsun.settings.yml",       // core/config/<file>, created from…
  "settingsTemplate": "config/plugin.upsun.settings.yml",
  "legacySettingsKey": "upsun",                      // the settings.yml block it replaces: its values carry over
  "labels": "config/settings.labels.yml",            // labels for its settings keys, merged into the Settings page
  "typeActions": { "upsun": ["sites"] },             // actions workspace types may allow
  "commands": { "types": ["sites"], "workspaces": ["dev", "test"], "files": ["commands/cmd-tools-upsun.sh"] },
  "scripts": { "functions": ["scripts/functions/fun-upsun.sh"], "args": ["scripts/args/arg-upsun.sh"],
               "machine": ["scripts/upsun-ai.sh"], "hostInstall": "scripts/host-install.sh" },
  "ddev": { "compose": ["ddev/docker-compose.upsun-cli.yaml"], "hostMounts": ["~/.upsun-cli"] },
  "themes": ["config/theme.upsun.yml"],
  "css": ["public/upsun.css"],
  "js": ["public/upsun.js"],                          // browser scripts, loaded on every page after the dashboard's own
  "features": ["features/upsun.feature"],             // webship-js scenarios, run by the dashboard's own suite
  "featuresSite": "cmd-<name>-project.sh ci-site --install --runtime docker",   // a platform plugin: the one site its CI builds for its features
  "ai": { "agents": ["agents/upsun-deployer.md"] },   // AI items: agents, skills, commands, prompts
  "needs": [["dev", "test", "demos", "sandboxes", "projects"], "ai-agents"],   // other plugins it cannot work without
  "suggests": ["github"],                             // other plugins that go well with it: said, never added
  "family": "hosting",                                // where Settings lists it (see "Where Settings lists a plugin")
  "summary": "Link a project to Upsun: environments, data, deploys"   // the one line under its name in Settings
}
```

Where each piece lands: functions, args and machine scripts in `core/scripts/plugins/<name>/`
(bootstrap sources every `functions/*.sh` there, so a `cmd-*.sh` can call them; an args file is
sourced as `${WORKSPACE_SCRIPTS}/plugins/<name>/args/<file>`); commands in every workspace the
manifest names (or every one of its types), with `__WORKSPACE__` replaced by the folder's name;
compose files as `core/workspace-app/.ddev/docker-compose.plugin-<name>-<file>`; host mounts in a
`host-mounts.txt` that `host-mounts.sh` reads; themes in `core/config/`. `hostInstall` runs with
`--check` after an install and in full from `install.sh`.

AI items land in the workspace folder of their kind, where the dashboard lists them like any other
item and installs them into `~/.claude` from there (a plugin that ships agents says `"needs": ["ai-agents"]`,
so the folder is there): `ai.agents` (one `.md` each) in `ai-agents/`,
`ai.skills` (one folder each, with its `SKILL.md`) in `ai-skills/`, `ai.commands` in `ai-commands/`,
`ai.prompts` in `ai-prompts/`. A kind whose folder is not a workspace here (not on `workspaces:`) is
skipped, and the install says so; the items are placed when that folder is installed or activated, with
no second step for the plugin. They are files a person edits in place, so the record keeps the hash of what was placed: a
file that still is the plugin's copy is updated by the next `--install` and removed by `--uninstall`;
one that was edited here, or that was already there under that name, is kept by both.

From the folder an item installs into any AI CLI the settings list (Claude Code by default, Gemini CLI,
Codex, …), converted to what that CLI reads: `bash cmd-tools-ai-items.sh <name> --install --cli <id>`,
or the folder's **Sources and AI CLIs** panel. A plugin ships its items once, in the Claude Code shape;
the CLIs are data in `core/config/ai.defaults.yml` (see `core/docs/ai-items-any-cli.md`).

Features land in `core/workspace-app/tests/features/plugins/<name>/`, so `ddev test-dashboard browser`
runs them with the core's. A scenario that only holds when one of the plugin's settings is set says
so in a tag: `@needs-setting-<plugin>-<key>` skips it, with the reason, while
`core/config/plugin.<plugin>.settings.yml` has no value for `<key>` (the Jira feature tags its menu
scenario `@needs-setting-jira-default_project`). A plugin ships no step definitions: webship-js's
own steps and the core's are what a feature can use.

A plugin that builds sites (a platform plugin) also proves a site on a container runtime. A scenario
tagged `@needs-runtime-docker` (or `-podman`, `-kubernetes`) drives the first running site of that
runtime in the workspace, and is skipped with the reason where there is none. `@needs-platform-<name>`
beside it narrows that to a site of the plugin's own platform (its project type or its claim). The core's steps for it
are in `tests/step-definitions/runtimes.steps.js`: the row, its state, its link, its menu, and
`When I open "/a-path" on the "docker" site` for a page of the site itself. In the plugin's CI the
site comes from `featuresSite` in the manifest: one builder of the plugin and plain arguments, which
the reusable workflow (`plugin-browser-suite.yml`) runs on Docker Compose before the features. What
a platform plugin changes to build on the runtimes is in `core/docs/plugins-on-runtimes.md`.

## What a plugin needs from another plugin

The core ships empty, so a plugin cannot count on anything but the core. When it needs another
plugin to do its job — a builder needs a sites folder to be placed in, agents need the AI Agents
folder — its manifest says so, and the workspace adds it or says what is missing:

```json
"needs":    [["dev", "test", "sandboxes", "demos"], "ai-agents"],
"suggests": ["graph"]
```

Both keys have one shape: a list whose entries are a plugin's name (its manifest `name`, which is also
its package: `@webship.co/workspace-<name>`), or a list of names when any one of them will do. In a
list of alternatives the order matters only when none is here: the first is the one added.

- **A need is about the workspace, not about `node_modules`.** It is met when that plugin is activated
  and installed here. For a plugin that is a workspace folder it is also met when a folder of that key
  is already on `workspaces:` (a workspace made before folders were plugins). A package's own
  dependencies (a provider's family base) stay npm's business.
- **`--require`** says what the package needs and whether the workspace has it. With `--with-needs` the
  packages it needs are fetched too; nothing is activated by a require.
- **`--activate` and `--install`** stop while a need is not met: in a terminal they ask
  (`Add dev, ai-agents now? [y/N]`); anywhere else, or on a no, they change nothing and print the exact
  commands. With `--with-needs` each missing plugin is required (from the same source as the plugin
  that needs it: the npm scope, the `github:owner/…` repository beside it, or the folder beside a
  path), activated and installed first — its own needs before it — and then the step goes on. A need
  that cannot be added stops the run before the plugin itself is touched; what was added before the
  stop is a whole plugin, never half of one.
- **`--deactivate` and `--uninstall`** refuse, with the list of who needs it, while a plugin in use
  (activated or installed) needs this one and no alternative is here. There is no force: take the
  plugin that needs it off first.
- **`suggests`** is only said: it never stops a step and never adds anything.
- **`--list`**, a plugin's tab in Settings and the catalogue rows of the packages that are
  required show `needs: …` with `met by <name>` or `not here`, and `needed by: …`. On the page, Activate
  and Install ask first when a need is not met ("add them too?") and run the script with
  `--with-needs`; Cancel changes nothing.
- A cycle (`a` needs `b` needs `a`), a name that is not a plugin name and a need no package answers
  to are reported and nothing is changed.
- The install records what was needed and what met it (`needs`, `metBy` in
  `core/config/plugins.installed.yml`), so a plugin whose package was removed still keeps what it needs.

### Commands on the machine

A plugin may also need commands: a provider needs its CLI, a tool needs `curl`. The same two keys take
them, as an object — a list alone stays the plugins:

```json
"needs":    { "plugins": [["dev", "test", "demos", "sandboxes", "projects"]], "commands": [{ "command": "upsun", "hint": "https://docs.upsun.com/administration/cli.html" }] },
"suggests": { "commands": ["container:pandoc", ["curl", "wget"]] }
```

An entry is a command's name, a list of names when any one will do, or `{ command | anyOf, where, hint,
for }`. `where` — or a `where:` prefix on the name — says which machine: `host` (the default: where the
`cmd-*.sh` run), `container` (the dashboard's container) or `project` (the project's own container,
listed and not checked: it exists once a project is built). `needs.commands` is what the plugin cannot
work without; `suggests.commands` is what a part of it uses. `hint` is how to install it, a sentence
or a link; without one the package of that name on Debian/Ubuntu, Fedora and macOS is said. List only
what the plugin's own scripts and code really call.

The core says its own the same way, in `core/scripts/needs.json`, each with the file that calls it.

```bash
webship-workspace doctor                       # the core and every plugin package: found (version, path) or missing (how to install)
bash core/scripts/plugins.sh --check upsun     # one plugin; exit 1 when a needed command is missing
```

The check reports and nothing more: it never installs, never uses sudo. `init` says what the core is
missing before it starts, `--require` and `--install` say what the plugin is missing before they go
on, the dashboard says it in its log when it starts, and Settings shows a plugin's commands on its tab
and the core's on Add a plugin, each under "Commands on this machine". A missing command never stops a step — it
is installed outside the workspace, and the plugin's settings file is often where its CLI is
configured — it is said, each time, until it is there. From the host the dashboard's container is
asked through `docker exec`; from inside the container the host cannot be looked at, and the row says
to run `webship-workspace doctor` there.

What a plugin places into workspace folders — its `cmd-*.sh` and its AI items — goes only into folders
that are active here (on `workspaces:`), and follows that list: installing or activating a folder
places, into it, what the plugins already installed put there, so the order plugins were added in
does not matter; deactivating or uninstalling a folder takes those files out of it (the folder and
its own content stay). `--uninstall` of the plugin removes them all and its record in
`core/config/plugins.installed.yml`; an AI item a person edited stays. Declare only what is
true: a need is something the plugin cannot do its job without.

Everything stays HTMX + UIKit: a plugin serves server-rendered fragments and wires them with
`hx-get`/`hx-post`; no client frameworks.

## A plugin is a node module

A plugin can be a folder under `plugins/<name>/` or any npm package. A package is the way to share one: name
it with `module:` and the loader requires it by name, **before** looking for a folder (the folder is the fallback
when the package is not installed yet). To ship one inside this repo, keep it in `plugins/<name>/` with its own
`package.json` and link it from the dashboard's:

```json
"dependencies": { "@webship.co/workspace-google-drive": "file:plugins/google-drive-sync" }
```

```yaml
plugins:
  google-drive-sync:
    enabled: true
    module: "@webship.co/workspace-google-drive"
```

`npm install` links it into `node_modules`. `plugins/google-drive-sync` is the worked example: `index.js`
(`register(api)`), `lib/`, its own `tests/` (picked up by `npm run test:unit`), and a rule its tests enforce:
**require nothing outside the package**. Anything the command line or an MCP server of yours also runs must work
without the dashboard, so reach the dashboard only through `api`.

## A plugin's own settings file

Each plugin keeps its settings in `core/config/plugin.<name>.settings.yml`, not in `settings.yml`: edited,
backed up and protected separately (the file is created mode 600, and `client_secret`, `token` and similar keys
are masked on the Settings page like any secret), and gone when the plugin is. `sync-tooling` never copies it.
A plugin reads and writes it through `api.settings` and keeps a shipped template of it in `core/config/`.

## Turn one on

```yaml
# core/config/settings.yml
plugins:
  workspace-notes:
    enabled: true
    workspaces: "dev,test"   # empty or absent = every workspace
  my-npm-plugin:
    enabled: true
    module: "@webship/my-npm-plugin"
```

Restart the app (`docker exec ddev-workspace-web supervisorctl restart webextradaemons:workspace-app`) to load
changes — plugins are read once at startup. A plugin that fails to load is reported on the
console and skipped; it cannot take the dashboard down.

## Write one

```js
// core/workspace-app/plugins/hello/index.js
module.exports.register = (api) => {
  const { esc, workspaceDir, isValidWorkspace } = api.lib;

  // A rail button on every workspace page this plugin applies to.
  api.addPageActions(({ view, key, meta }) => {
    if (view !== 'workspace' || !key || !api.appliesTo(key)) return null;
    return { label: 'Hello', items: [
      `<button class="uk-button uk-button-default action-btn"
        hx-get="/fragments/p/${api.name}/greet?workspace=${esc(key)}"
        hx-target="#webship-workspace-output" hx-swap="innerHTML">
        <span uk-icon="icon: happy; ratio: .8"></span><span class="action-label">Hello</span></button>`,
    ] };
  });

  // GET /fragments/p/hello/<rest>
  api.addFragment(({ send, rest, searchParams }) => {
    send(`<div class="msg assistant">Hello from ${esc(searchParams.get('workspace') || '?')}.</div>`);
  });

  // POST /actions/p/hello/<action> — context is the same one built-in actions get.
  api.addAction('save', ({ form, send, workspace }) => {
    send('<div class="msg assistant">Saved.</div>');
  });
};
```

## The api

| Member | What it is |
| --- | --- |
| `api.name` | The plugin's settings key. Also its route namespace. |
| `api.config` | Its `plugins.<name>` block from settings.yml, verbatim. |
| `api.appliesTo(key)` | Whether `config.workspaces` includes that workspace (empty list = all). |
| `api.addAction(name, handler)` | POST handler at `/actions/p/<plugin>/<name>`. Context: `{ form, res, send, workspace, pathname }` — identical to built-in actions. |
| `api.addFragment(handler)` | GET handler for `/fragments/p/<plugin>/<rest>`. Context: `{ req, res, send, rest, searchParams }`. |
| `api.addPageActions(fn)` | `fn({ view, key, meta })` returns a rail group `{ label, items: [html] }` or null. Runs on every page render. |
| `api.addProjectActions(fn)` | `fn({ key, project, dir, meta })` returns HTML appended to that project row's actions (or null). Runs per row on `projects`-kind pages. |
| `api.addRowMenu(slot, { label, row }, fn)` | A named menu on every project row, in a slot the Buttons settings arrange like a built-in one. `fn({ key, project, dir, meta, allowed, vals })` returns the menu's HTML, or null for a row it has nothing for — or `{ html, body }`, a menu whose body loads when it opens (below). |
| `api.capabilities` | What this dashboard can do that an older one could not, as a `Set` of names; a package that serves several dashboards checks it before using a newer form of an answer. So far: `row-menu-body`, `runner`, `screens-panel`. |
| `api.addPage(re, handler)` | A whole page: GET requests whose path matches `re`. `handler({ req, res, match, send })` writes the response itself. |
| `api.addProjectChip(fn)` | A chip in the project card's meta line. `fn({ key, project, dir, meta })` returns HTML or null. |
| `api.addFolderSetup({ html, steps, prompt, problem })` | A section of the New-folder form (`html(ws, { allowed })`), the shell steps it adds (`steps(ws, name, form, ctx)` → array), the lines it adds to the Claude Code prompt (`prompt(…)` → array) and its validation (`problem(ws, form, ctx)` → '' or why). |
| `api.addTypeAction(action, types)` | What the manifest's `typeActions` does, from code. |
| `api.addCss(file)` | A stylesheet appended after the components (what the manifest's `css` does). |
| `api.addScript(file)` | A browser script of the plugin's own (what the manifest's `js` does): served at `/plugin-js/<plugin>/<file name>` and loaded with `defer` after `ui.js`, in the order declared. Needs `capabilities.has('scripts')`. |
| `api.addUpload(name, handler, { maxBytes })` | POST handler at `/actions/p/<plugin>/<name>` for a binary body (an utterance, a picture). Context: `{ req, res, body, searchParams, json }`; `body` is a Buffer, `json(object, status)` answers. Refused from another site and over `maxBytes` (2 MB unless said). Needs `capabilities.has('uploads')`. |
| `api.addLabels(map)` | Labels for its settings keys (what the manifest's `labels` does). |
| `api.addProjectBadge(fn)` | A badge in the project card's corner, sent with every screens poll so it clears itself. `fn({ key, project, dir, sessions })` returns HTML or null; `sessions` is the project's live screens. |
| `api.addSettingsOptions(file, dotted, fn)` | Live options for a field of a settings file (what a CLI can see rather than a hand-typed key). `fn()` is async and returns `[value, label][]`, or null for a plain input. |
| `api.addScreenStartHook(fn)` | Called after a screen session started for a work item (the New screen form's `work` key): `fn({ session, workKey, workspace, project, dir, form })` notes the run, posts if asked, returns HTML or ''. |
| `api.addWorkKeyLink(fn)` | Where a work-item key found in a project's name links to: `fn(key)` returns a URL or null (the chip is plain text without one). |
| `api.addWorkPrompt(fn)` | The prompt a screen started for a work item begins with: `fn({ key, workspace, project })` returns it, or null for the dashboard's own. |
| `api.addSessionLog(fn)` | Where a session's log lives when the dashboard does not know: `fn(session, dirs)` returns a file in one of `dirs`, or ''. |
| `api.addAssistantContext(fn)` | A paragraph of the assistant's system context: what this plugin lets it reach, and the rules. |
| `api.addAssistantTurn(fn)` | A paragraph for one turn only: `fn({ body, message })` is given what the page posted and answers a paragraph or `''`; it may be async. For something the person hands over with a turn (a picture, a selection), named in the body by the plugin's own script through `wsAssistantHooks.beforeSend`. Needs `capabilities.has('assistant-turn')`. |
| `api.addRunner(fn)` | The runner of the commands the dashboard starts (a build, a row menu's verb, a tool). `fn({ session, workspace, project, projectDir, ownerDir, verb, cmdLine, label })` starts the command its own way and returns `{ ok, session, already, why, html }` (`html` is the answer shown), or null to leave it to the dashboard. Needs `capabilities.has('runner')`. |
| `api.addScreensPanel(fn)` | A panel at the top of the Screens page: `fn()` returns its HTML, or '' for none. Needs `capabilities.has('screens-panel')`. |

### A row menu whose body loads when it opens

A page of fifty rows must not carry fifty copies of every menu. Instead of the whole menu, a row-menu
function may return an object:

```js
api.addRowMenu('cloud', { label: 'CLOUD', row: 0 }, ({ key, project, dir, allowed }) => {
  if (!allowed.has('cloud')) return null;
  return {
    html: `<button class="uk-button uk-button-default uk-button-small" type="button">CLOUD <span uk-icon="icon: chevron-down; ratio: .6"></span></button>`,
    body: `/fragments/p/${api.name}/menu/${encodeURIComponent(key)}/${encodeURIComponent(project)}`,
    caption: 'linked',            // optional: the small text beside the button
    classes: 'act-menu-hosting',  // optional: extra classes on the menu's wrapper
  };
});
// The body: what used to be inside the dropdown, as a fragment.
api.addFragment(({ send, rest }) => {
  const m = rest.match(/^menu\/([a-z0-9_-]+)\/([a-zA-Z0-9_-]+)$/);
  if (m) return send(`<ul class="uk-nav uk-dropdown-nav"><li><a href …>…</a></li></ul>`);
});
```

| Key | What it is |
| --- | --- |
| `html` | The button that opens the menu. Required. |
| `body` | The URL of a fragment this plugin serves (under `/fragments/p/<plugin>/`) whose response is the dropdown's inner HTML, normally one `<ul class="uk-nav uk-dropdown-nav">`. Required. |
| `caption` | The text beside the button (`not linked`, `3 running`), or none. |
| `classes` | Extra classes on the `.uk-inline.act-menu` wrapper, after the `act-menu-<slot>` the core adds. |

The core draws `<span class="act-with-status"><div class="uk-inline act-menu act-menu-<slot> …">` + the
button + an empty `uk-dropdown` shell + the caption. The shell carries `hx-get` to
`/fragments/row-menu/<slot>/<ws>/<project>?body=<url>` with `hx-trigger="menu-opened"`: UIkit's
`beforeshow` on the dropdown is relayed as `menu-opened` by `public/ui.js`, so the body is fetched each
time the menu opens and never before. The core asks the plugin's `body` URL itself and arranges the
items the way it arranges an inline menu's (the Buttons settings hide, order and add your own actions to
it alike), so a lazy menu behaves like an inline one once open. A string return is unchanged: the whole
menu, inline. A plugin that must also run on a dashboard older than this form checks
`api.capabilities && api.capabilities.has('row-menu-body')` and falls back to the string.

`rag` is a slot the core can draw itself, for a folder with a `cmd-tools-ragify.sh`. Once a plugin
registers it (the RAG plugin, `@webship.co/workspace-rag`), the row draws that plugin's menu there and
the core draws none of its own, nor asks the Milvus servers for the page. In the default order RAG
stays last in its row, after the buttons plugins add there (Graph).

The core's own menus take the same road: DDEV, COMPOSER, Tests, SCREENS, NODE and More are drawn as this shell and
answer at `/fragments/row-menu/<slot>/<ws>/<project>` with no `body` parameter, their items computed for
that one project when the menu opens (a page of fifty rows is a third of what it was). A plugin's
`body` must still name one of its own fragments; the core slots are not open to one.

`api.lib` also lends `tabModalHtml`, `hubDomain()`, `listScreens()`, `agentSessions()`, `screenLogFor()`, `claudeSessionsFor()` and
`screensCached()` (the last `screen -ls`, for a renderer that cannot wait). The types of all of it are
`@webship.co/workspace-plugin-api`; a plugin written in TypeScript is checked against them.

## TypeScript

A plugin package is TypeScript: `src/` compiled to `dist/` by `tsc` on install (`prepare`), so the dashboard
requires `dist/src/index.js` and a clone of the repository builds itself. Its tests are TypeScript too
and run compiled (`npm test`); `@webship.co/workspace-upsun` is the shape to copy.
| `api.settings` | This plugin's own settings file: `file`, `read()`, `set(dotted, value)` and `setList(dotted, items)`, which change one key or list in place, comments kept, creating the file when it is missing. |
| `api.lib` | Shared helpers: `esc`, `humanSize`, `humanTime`, `ROOT`, `loadWorkspaces`, `workspaceDir`, `isValidWorkspace`, `startJob`, `jobFragment`, `listProjects`, `NAME_RE`, `wsUrl` — `screenAction` (start a command as a Screen session, the way every long action does), `auth` (`sessionOf(req)`, `googleButton`, `BUTTON_CSS` from the dashboard's Google sign-in), plus the type layer: `TYPES`, `workspaceType(key)`, `typeAllows(key, action)`. |

Namespacing is the safety model: a plugin's routes all live under its own name, so it can never
shadow a built-in, and disabling it removes its whole surface at once.

## Who runs a command

Every command the dashboard starts (a build, a row menu's verb, a tool, a step of Settings →
Plugins, a plugin's `screenAction`) runs in a screen session, and is read on the Screens page. It
is offered to three runners, in this order, and the first that takes it answers the request:

1. **A plugin's runner** (`api.addRunner`). It starts the command its own way and returns the
   result, or returns null to decline. A runner that throws is skipped.
2. **The host runner** (`core/workspace-app/scripts/screen-host.sh --start`): the dashboard's own
   screen sessions on the machine.
3. **Screen where the dashboard runs**: its container (`screen` is in the image), or the machine
   when the dashboard is run there with node. A fresh workspace needs nothing more.

There is no run in the page: no terminal is drawn at the bottom of it, by the dashboard or by a
plugin (`api.capabilities.has('screens-only')`). After a start the page shows a short notice —
what started, on what, and **Open in Screens**, a link to `/screens?session=<name>`. A link to
`/screens` opens Screens in the modal over the page one is on (the modal of the top bar's Screens
button: `/fragments/screens` into `#editor-modal-body`), with that session first and the end of its
log, also after it has ended. A plugin's own notice needs nothing more than that link; the address
itself, typed or opened in a new tab, is the Screens page. When no runner can start a
session the command is not started, and the answer says what is missing, the step that fixes it,
and the command line to copy into a terminal of your own.

```js
api.addRunner(async ({ session, workspace, project, projectDir, cmdLine, label }) => {
  if (!mine(workspace)) return null;                        // leave it to the dashboard
  await start(session, cmdLine, projectDir);                // the plugin's own way
  return { ok: true, session, html: `<div class="msg assistant flash-now">${label} runs as ${session}</div>` };
});
```

A runner's `html` is the answer shown: keep it a short notice with a link to the session
(`<div class="msg assistant flash-now">…</div>`), not output.

## Useful targets

- `#webship-workspace-output` — the page's output area (short results; they surface as notices at the top).
- `#editor-modal-body` — the editor modal; anything swapped in opens it automatically.
- `api.lib.screenAction(send, { workspace, project, projectDir, verb, cmdLine, label })` — start a
  command the way every built-in action does: a screen session, and the notice with its link. End
  a short command with `api.lib.lingerTail(label)` so its session stays open to be read.
- `api.lib.startJob(title, cmd, args, cwd, opts)` + `jobFragment(id).html` — a view that follows a
  process where you swap it in (a modal, a panel of your own): a progress bar from `phases`, the
  output, a Stop button. It stays where it was put — it is never moved to the bottom of the page —
  and it ends with the dashboard, so it is not how a command is run.

## Types and plugins

Workspace folders have a **type** (`sites`, `code`, `files`, `media`, `ai-items` — see
`WORKSPACES.md`) that decides which built-in actions their project rows carry. A plugin can read
the same layer to offer itself only where it makes sense:

```js
api.addProjectActions(({ key, project, meta }) => {
  if (!api.appliesTo(key) || api.lib.workspaceType(key) !== 'sites') return null;
  return `<button class="uk-button uk-button-default uk-button-small"
    hx-post="/actions/p/${api.name}/ping" hx-vals='{"workspace":"${api.lib.esc(key)}","projectName":"${api.lib.esc(project)}"}'
    hx-target="#webship-workspace-output" hx-swap="innerHTML">
    <span uk-icon="icon: bolt; ratio: .7"></span> Ping</button>`;
});
```

## A workspace as a plugin

A workspace folder (modules, themes, recipes, dev, …) can itself be a plugin: the package carries
the folder's `workspace.<key>.settings.yml` template, its `cmd-*.sh` commands and its docs, and the
manifest names the folder:

```json
"workspacePlugin": {
  "name": "drupal-themes",
  "workspace": { "key": "themes", "settingsTemplate": "config/workspace.themes.settings.yml",
                 "files": ["commands/cmd-build-theme.sh"], "docs": ["docs/AGENTS.md"] }
}
```

`--install` makes the folder, places the settings file once (never overwritten: it holds this
machine's lists) and the commands (`__WORKSPACE__` filled with the key), and writes the docs once.
`--activate` puts the key on settings.yml's `workspaces:` list, at the end (the dashboard's order;
move it in Settings → Workspaces); `--deactivate` takes it off, and the folder, its content and its
settings stay. `--uninstall` removes the commands and keeps the settings file and the docs. The bash
functions the commands call still live in `core/scripts/functions` (and in `scripts.functions` of
the plugin, placed under `core/scripts/plugins/<name>/functions/`).

## A platform as a plugin

A plugin for one platform (WordPress, Odoo, …) is a feature plugin whose pieces are all in the
manifest: its builder and tools in `commands` (placed into the `sites` folders), their functions and
argparse in `scripts`, its agents in `ai.agents`. Three names in its functions file are what the
core's own tools look for, so the row menus of a project of that platform work like any other's:

| Function | Called by | What it does |
| --- | --- | --- |
| `set_<name>_users` | `cmd-tools-add-users.sh <project> <name>` | Declares the default accounts (`users`, `user_<key>_name`, `_mail`, `_password`, `_role`). |
| `add_<name>_users`, `cancel_<name>_users` | the same tools | Create and remove those accounts with the platform's own CLI; without them the Drupal way (drush) is used. |
| `testing_configure_<name>` | `cmd-tools-testing.sh <project>` | Runs in the project once the testing stack is scaffolded: adds the platform's step pack to `package.json` and `cucumber.js`. Returns 0 and changes nothing for a project that is not its own. |

A step pack that belongs to no platform plugin (Diffy, a second platform) is added with
`cmd-tools-testing.sh <project> --add-steps <pack>` (`core/scripts/libs/step_packs.js`, [Testing](../docs/testing.md)).
It leaves what a hook added alone: `--remove-steps` only takes out what `--add-steps` put in.

`<name>` is the DDEV project type (`wordpress`, `typo3`, `magento2`, …): the Users menu of a project
row reads it from the project's `.ddev/config.yaml`. A Drupal project is named by what it holds: the
install profile under `profiles/contrib` when there is one, else `drupal_cms` when its
`composer.json` carries the Drupal CMS packages, else `drupal`. A platform plugin says what it needs
to land somewhere — `"needs": [["dev", "test", "sandboxes", "demos"], "ai-agents"]`: one sites folder for
its builder (the folder also carries `cmd-tools-testing.sh` and the Users tools its hooks answer to)
and the AI Agents folder for its agents — so it works on a workspace that had nothing. A builder that carries the name of an example a
workspace folder ships replaces it while the plugin is installed; `--uninstall` puts the folder's
copy back. `@webship.co/workspace-wordpress` is the shape to copy.

## Hooks a feature plugin reaches for

Besides the row menus, pages, fragments and actions, the loader offers: `addForge(host, …)` (the
credential the dashboard uses for a git host: `github-auth.js` asks it first), `addOpenWith(fn)` (the
Open-with menu for a folder: project rows, the files pages, the images gallery) and `addFolderLink(fn)`
(a link that opens a folder elsewhere, inside the COMPOSER menu). `api.lib` also hands a plugin what
git says about a folder (`hasOwnGit`, `gitWorktreeInfo`, `projectHasGit`, `gitBranchOf`), the
lingering-session tail (`lingerTail`, `LINGER_MARK`), `tildePath` and `hostRunnerRequest`. For sites,
`api.lib.localSite(urlOrHost)` answers the project of this workspace a host name belongs to
(`{ workspace, project, dir, host }`, or null), and `api.lib.readerAllowed(url)` answers `''` when the
reading window may open a URL and the reason when it may not.

## A plugin's script and the assistant

A script a plugin loads (`js`, `api.addScript`) is plain browser JavaScript on every page; it reads what
it needs from one of the plugin's fragments. For the assistant's panel it has three things, all present
when `capabilities.has('assistant-answer')`:

- `window.wsAssistantSend(text)` sends a turn as if it were typed. It returns false when there is no panel.
- `window.wsAssistantHooks.beforeSend.push((body) => ({ ...body, voice: true }))` adds to what a turn carries.
- `document.addEventListener('ws-assistant-answer', (e) => { … })` hears every answer before the summary
  voice speaks it: `e.detail` is `{ html, spoken, directive }`. A listener that speaks the answer itself
  calls `e.preventDefault()`, and the summary voice stays silent for that answer.

A plugin that listens its own way (a local model, voice activity) sets `window.wsAssistantEar =
{ hold(on), keep(on), keeping() }`: the dock's Hold to talk button, the Space bar and the Keep listening
button then call it in place of the browser's recogniser (`capabilities.has('assistant-ear')`). It sends
the turn itself, and shows the two buttons when the browser has no recogniser of its own.
With voice input switched off (`assistant.voice_input: false`) the dock calls no ear: the two buttons are
not there and the Space bar is the page's own. The setting is the person's microphone, whichever engine
listens. An ear that also listens on its own (voice activity) reads `window.WS_SPEECH.voiceInput` and stays
quiet when it is `false`.

The events the page already sends are there too: `ws-assistant-working` (`{ on, failed }`),
`ws-assistant-reply` and `ws-assistant-speech` (`{ type: 'start' | 'word' | 'end', word }`, which the
avatar's mouth follows: a plugin that speaks dispatches it).

## A plugin's script and the avatar's windows

The avatar's windows (the board, the reading window, a video) are the dashboard's. A plugin's script
reaches them through `window.wsAvatarWindows`, present when `capabilities.has('avatar-windows')` and the
assistant has an avatar:

| Call | What it does |
| --- | --- |
| `open(kind, title)` | A window of the plugin's own, by a kind of its own (`camera`): the `<section>`, whose content goes in `.avatar-window-body`. It is dragged, filled and closed like the others. `close(kind)`, `isOpen(kind)` |
| `board()` | Opens the board and answers `{ svg, area, lines, window, keep(node), clear() }`: the drawing (an SVG, 100 by 60), the notes' area, the list of lines. `keep(node)` puts what the plugin added under the board's Undo and Clear |
| `write(lines)`, `draw(commands)`, `note(text)` | What the assistant's `BOARD:` and `DRAW:` lines do |
| `browse(url)`, `readerDocument()` | The reading window: open an https page in it, and its document (no scripts run in it) |
| `speak(text)` | Says it in the avatar's voice, when the voice is on |

`document.addEventListener('ws-avatar-window', (e) => …)` hears a window being made: `e.detail` is
`{ kind, window }`.

## Where Settings lists a plugin

Settings groups plugins by family and shows, for each, one state and the one action that comes next
(`settings-model.mts`). A plugin may say where it belongs and what it is in a line:

| Manifest key | What it is |
| --- | --- |
| `family` | One of `platforms`, `folders`, `ai`, `hosting`, `forges`, `containers`, `databases`, `features`. Another value is ignored. |
| `summary` | One line, up to 160 characters, shown under the plugin's name. |

Both are optional and read only by a dashboard with `capabilities.has('settings-family')`; an older
one ignores them. Without `family` the base decides: an `ai-*` folder is AI, a plugin the catalogue
lists takes the catalogue's family, a plugin with `workspace.key` is a workspace folder, a plugin that
ships a builder (`cmd-*-project.sh`) is a platform, anything else is a feature. Without `summary` the
line is the catalogue's, else the first sentence of the package description.

The states, in the order a plugin moves through them: Not active (Activate), Not installed (Install),
Needs settings (Configure: a value in its settings file is still `CHANGE_ME`, or the file is not
there; the note names those keys), Needs <command> (How to install: a command its `needs.commands`
names was checked on this machine and is missing; one that cannot be checked from where the dashboard
runs changes nothing), Ready. Beside them: Needs <plugin> (something it needs is not here; the action
adds it in the same run, `--with-needs`), Files missing (Reinstall), Needs cannot be met (a cycle).

A plugin whose package is on npm also says when a newer version is there (`plugin-updates.mts`): the
registry is asked for the `latest` tag of each package in a fragment of its own, a few at a time, and
the answer is kept for six hours. A package that is not on the registry (a path, a GitHub repository,
a folder under `plugins/`) gets no answer, and no answer is never shown as up to date.

## Families

Plugins that do the same job for different services share a base package, so a provider is thin and
the surface is one. A base is an ordinary private npm package the provider depends on; it is not a
plugin itself (no manifest) and the dashboard never sees it.

| Family | Base | What the base draws | A provider supplies |
| --- | --- | --- | --- |
| Hosting (`upsun`, `acquia`, `digitalocean`, `cpanel`, `aws`, `azure`, `godaddy`) | `@webship.co/workspace-hosting` — `registerHosting(api, provider)` | the per-provider row menu (linked / unlinked), the live-site chip, the environments modal and list, the get-database-and-files flow, the branch-and-data block, the tool verbs as screen sessions, the `/<id>-site/<ws>/<project>` jump, the New-folder section, the family stylesheet | a `HostingProvider`: how a project is detected as linked, the CLI and its token, the environments and their URLs, the verbs its `cmd-tools-<id>.sh` carries (status, activities, logs, deploy…), the pull flags, the console URL |

| Forges (`github`, `gitlab`, `bitbucket`) | `@webship.co/workspace-forge` — `registerForge(api, forge)` | the credential the dashboard uses for the host (`api.addForge`, which `github-auth.js` asks before the legacy `git.github` block), the row menu on every project whose git remote is at the host (repository, open issues and pull or merge requests, open one from the branch in a terminal, clone URL), the repository chip, the New-folder clone option | a `ForgeProvider`: the host, the CLI, how a remote URL reads, the pages, the issue and request lists, the clone URL |
| Container runtimes (`docker`, `lando`, `docksal`, `podman`, `kubernetes`) | `@webship.co/workspace-container` — `registerContainer(api, runtime)` | the row menu on every project the runtime recognises (its verbs as terminal sessions in the project, grouped, with the site link), the up/down caption answered after the row is drawn, the New-folder init option | a `ContainerRuntime`: how a folder is detected as a project, the CLI, how to tell whether it is up, the verbs and their commands |
| Databases (`mariadb`, `mysql`, `postgresql`, `sqlite`) | `@webship.co/workspace-database` — `registerDatabase(api, engine)` | one DATABASE row menu for every engine, with a section per database the project has (the server of DDEV, of the runtime layer or of a compose file of the project's own, or a SQLite file), the caption answered after the row is drawn, the tables-and-sizes modal, the import form of the backups folder's dumps, the tool verbs as screen sessions, the web admins (DDEV's official add-ons) and the `/<engine>-admin/<tool>/<ws>/<project>` jump, the assistant's context | a `DatabaseEngine`: how the project's databases of that engine are found, its `cmd-tools-<engine>.sh` and client, its web admins, the entries it offers and what does not fit where, the dump's extension |

`@webship.co/workspace-upsun` is the reference provider: `register(api)` is one line, the facts are
in `src/lib/provider.ts`, and the bash tool, compose file, host install, settings template and theme
are what the installer places.

## The reference plugin

`plugins/workspace-notes/` is the working example: a Notes rail button per enabled workspace,
editing `NOTES.md` in the workspace folder through the modal, saved by a namespaced action.
