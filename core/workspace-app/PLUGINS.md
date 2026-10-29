# Dashboard plugins

Optional features a workspace can turn on from settings, without touching `server.js`. A plugin is
a folder under `core/workspace-app/plugins/<name>/` with an `index.js` exporting `register(api)` —
or any npm module (add it to this app's `package.json`, name it with a `module:` key), so plugins
travel the same way any node dependency does.

Everything stays HTMX + UIKit: a plugin serves server-rendered fragments and wires them with
`hx-get`/`hx-post`; no client frameworks.

## A plugin is a node module

A plugin can be a folder under `plugins/<name>/` or any npm package. A package is the way to share one: name
it with `module:` and the loader requires it by name, **before** looking for a folder (the folder is the fallback
when the package is not installed yet). To ship one inside this repo, keep it in `plugins/<name>/` with its own
`package.json` and link it from the dashboard's:

```json
"dependencies": { "@vardot/workspace-google-drive": "file:plugins/google-drive-sync" }
```

```yaml
plugins:
  google-drive-sync:
    enabled: true
    module: "@vardot/workspace-google-drive"
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
    module: "@vardot/my-npm-plugin"
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

## The reference plugin

`plugins/workspace-notes/` is the working example: a Notes rail button per enabled workspace,
editing `NOTES.md` in the workspace folder through the modal, saved by a namespaced action.
