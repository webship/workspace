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

The same four steps are buttons on **Settings → Plugins**. `--install` is idempotent, records what
it placed in `core/config/plugins.installed.yml`, keeps a managed block in `.gitignore` so a dev
clone never commits what an install placed, and says when the dashboard container needs
`ddev restart` (a compose file or host mount the plugin brought). `--uninstall` removes exactly
what `--install` placed.

A plugin is a node package with a `workspacePlugin` manifest in its `package.json` and an
`index.js` exporting `register(api)` — or a folder under `core/workspace-app/plugins/<name>/` with
the same shape, which is how one is developed before it gets a repository.

## The manifest

```json
"workspacePlugin": {
  "name": "upsun",                                   // its settings key and route namespace
  "label": "Upsun",
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
  "css": ["public/upsun.css"]
}
```

Where each piece lands: functions, args and machine scripts in `core/scripts/plugins/<name>/`
(bootstrap sources every `functions/*.sh` there, so a `cmd-*.sh` can call them; an args file is
sourced as `${WORKSPACE_SCRIPTS}/plugins/<name>/args/<file>`); commands in every workspace the
manifest names (or every one of its types), with `__WORKSPACE__` replaced by the folder's name;
compose files as `core/workspace-app/.ddev/docker-compose.plugin-<name>-<file>`; host mounts in a
`host-mounts.txt` that `host-mounts.sh` reads; themes in `core/config/`. `hostInstall` runs with
`--check` after an install and in full from `install.sh`.

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
| `api.addRowMenu(slot, { label, row }, fn)` | A named menu on every project row, in a slot the Buttons settings arrange like a built-in one. `fn({ key, project, dir, meta, allowed, vals })` returns the menu's HTML, or null for a row it has nothing for. |
| `api.addPage(re, handler)` | A whole page: GET requests whose path matches `re`. `handler({ req, res, match, send })` writes the response itself. |
| `api.addProjectChip(fn)` | A chip in the project card's meta line. `fn({ key, project, dir, meta })` returns HTML or null. |
| `api.addFolderSetup({ html, steps, prompt, problem })` | A section of the New-folder form (`html(ws, { allowed })`), the shell steps it adds (`steps(ws, name, form, ctx)` → array), the lines it adds to the Claude Code prompt (`prompt(…)` → array) and its validation (`problem(ws, form, ctx)` → '' or why). |
| `api.addTypeAction(action, types)` | What the manifest's `typeActions` does, from code. |
| `api.addCss(file)` | A stylesheet appended after the components (what the manifest's `css` does). |
| `api.addLabels(map)` | Labels for its settings keys (what the manifest's `labels` does). |
| `api.addProjectBadge(fn)` | A badge in the project card's corner, sent with every screens poll so it clears itself. `fn({ key, project, dir, sessions })` returns HTML or null; `sessions` is the project's live screens. |
| `api.addSettingsOptions(file, dotted, fn)` | Live options for a field of a settings file (what a CLI can see rather than a hand-typed key). `fn()` is async and returns `[value, label][]`, or null for a plain input. |
| `api.addScreenStartHook(fn)` | Called after a screen session started for a work item (the New screen form's `work` key): `fn({ session, workKey, workspace, project, dir, form })` notes the run, posts if asked, returns HTML or ''. |
| `api.addWorkKeyLink(fn)` | Where a work-item key found in a project's name links to: `fn(key)` returns a URL or null (the chip is plain text without one). |
| `api.addWorkPrompt(fn)` | The prompt a screen started for a work item begins with: `fn({ key, workspace, project })` returns it, or null for the dashboard's own. |
| `api.addSessionLog(fn)` | Where a session's log lives when the dashboard does not know: `fn(session, dirs)` returns a file in one of `dirs`, or ''. |
| `api.addAssistantContext(fn)` | A paragraph of the assistant's system context: what this plugin lets it reach, and the rules. |

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

## Useful targets

- `#webship-workspace-output` — the page's output area (results, job toasts land near it).
- `#editor-modal-body` — the editor modal; anything swapped in opens it automatically.
- `api.lib.startJob(title, cmd, args, cwd, opts)` + `jobFragment(id).html` — run a command as a
  live job toast, the way every built-in long action does.

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

## Hooks a feature plugin reaches for

Besides the row menus, pages, fragments and actions, the loader offers: `addForge(host, …)` (the
credential the dashboard uses for a git host: `github-auth.js` asks it first), `addOpenWith(fn)` (the
Open-with menu for a folder: project rows, the files pages, the images gallery) and `addFolderLink(fn)`
(a link that opens a folder elsewhere, inside the COMPOSER menu). `api.lib` also hands a plugin what
git says about a folder (`hasOwnGit`, `gitWorktreeInfo`, `projectHasGit`, `gitBranchOf`), the
lingering-session tail (`lingerTail`, `LINGER_MARK`), `tildePath` and `hostRunnerRequest`.

## Families

Plugins that do the same job for different services share a base package, so a provider is thin and
the surface is one. A base is an ordinary private npm package the provider depends on; it is not a
plugin itself (no manifest) and the dashboard never sees it.

| Family | Base | What the base draws | A provider supplies |
| --- | --- | --- | --- |
| Hosting (`upsun`, `acquia`, `digitalocean`, `cpanel`, `aws`, `azure`, `godaddy`) | `@webship.co/workspace-hosting` — `registerHosting(api, provider)` | the per-provider row menu (linked / unlinked), the live-site chip, the environments modal and list, the get-database-and-files flow, the branch-and-data block, the tool verbs as screen sessions, the `/<id>-site/<ws>/<project>` jump, the New-folder section, the family stylesheet | a `HostingProvider`: how a project is detected as linked, the CLI and its token, the environments and their URLs, the verbs its `cmd-tools-<id>.sh` carries (status, activities, logs, deploy…), the pull flags, the console URL |

| Forges (`github`, `gitlab`, `bitbucket`) | `@webship.co/workspace-forge` — `registerForge(api, forge)` | the credential the dashboard uses for the host (`api.addForge`, which `github-auth.js` asks before the legacy `git.github` block), the row menu on every project whose git remote is at the host (repository, open issues and pull or merge requests, open one from the branch in a terminal, clone URL), the repository chip, the New-folder clone option | a `ForgeProvider`: the host, the CLI, how a remote URL reads, the pages, the issue and request lists, the clone URL |
| Container runtimes (`docker`, `lando`, `docksal`, `podman`, `kubernetes`) | `@webship.co/workspace-container` — `registerContainer(api, runtime)` | the row menu on every project the runtime recognises (its verbs as terminal sessions in the project, grouped, with the site link), the up/down caption answered after the row is drawn, the New-folder init option | a `ContainerRuntime`: how a folder is detected as a project, the CLI, how to tell whether it is up, the verbs and their commands |

`@webship.co/workspace-upsun` 2.0.0 is the reference provider: `register(api)` is one line, the facts are
in `src/lib/provider.ts`, and the bash tool, compose file, host install, settings template and theme
are what the installer places.

## The reference plugin

`plugins/workspace-notes/` is the working example: a Notes rail button per enabled workspace,
editing `NOTES.md` in the workspace folder through the modal, saved by a namespaced action.
