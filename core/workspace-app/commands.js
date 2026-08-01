/**
 * Every `cmd-*.sh` in the workspace, and what the tooling repository has to say about it.
 *
 * The scripts live in the workspace folder they run from — a builder for `dev` sits in `dev/`,
 * because that is where you run it — so this is a VIEW over the tree rather than a place that
 * holds anything. What it adds is the operations that are awkward when the commands are scattered
 * across twenty folders: what exists, what differs from the repository, and bringing one down.
 *
 * Every action shells out to `commands/cmd-tools-commands.sh` rather than reimplementing it, so
 * the buttons and the CLI cannot drift apart.
 */

const fs = require('fs');
const path = require('path');

const { ROOT, loadWorkspaces, loadYaml, CONFIG_DIR } = require('./workspaces');
const { esc } = require('./html');
const { searchSortPage, listControlsHtml, listPagerHtml, emptyListHtml, defaultSort } = require('./lists');

const SCRIPT_RE = /^cmd-[a-zA-Z0-9_.-]+\.sh$/;

// The repository this tooling comes from, and the branch. Read from settings rather than assumed:
// a fork is a legitimate place to work from, and the shell tooling reads the same keys.
function toolingRepo() {
  const s = loadYaml(path.join(CONFIG_DIR, 'settings.yml')).sources || {};
  const t = s.tooling || {};
  return { repo: t.repo || 'webship/workspace', ref: t.ref || '1.0.x' };
}

// The `# workspace-name:` header a builder carries, which is what the Build dropdown shows. Worth
// surfacing here too: it is the difference between a list of filenames and a list of what they do.
function commandLabel(file) {
  try {
    const head = fs.readFileSync(file, 'utf8').slice(0, 600);
    const m = head.match(/^# workspace-name:\s*(.+)$/m);
    if (m) return m[1].trim();
  } catch (_) { /* unreadable is not fatal — the name still tells you something */ }
  return '';
}

/**
 * Every command, as a flat list carrying the workspace it belongs to.
 *
 * Flat rather than grouped: the list is searched, sorted and paged like every other list in the
 * dashboard, and a grouped structure would have to be flattened for each of those anyway. The
 * workspace travels on the row, which is what a reader needs to see.
 */
function listAllCommands() {
  const rows = [];
  const order = Object.keys(loadWorkspaces());
  for (const key of order) {
    const dir = loadWorkspaces()[key].dir;
    let files = [];
    try {
      files = fs.readdirSync(dir).filter((f) => SCRIPT_RE.test(f));
    } catch (_) { continue; }
    for (const f of files) {
      const full = path.join(dir, f);
      let mtime = 0;
      try { mtime = fs.statSync(full).mtimeMs; } catch (_) { /* vanished */ }
      rows.push({ name: f, workspace: key, label: commandLabel(full), mtime, groupRank: order.indexOf(key) });
    }
  }
  return rows;
}

// A command is identified by its workspace AND its name: `cmd-tools-remove.sh` exists in five
// workspaces, and they are not the same file.
function commandFile(workspace, name) {
  const ws = loadWorkspaces()[workspace];
  if (!ws || !SCRIPT_RE.test(name)) return null;
  const full = path.join(ws.dir, name);
  return fs.existsSync(full) ? full : null;
}

function commandRowsHtml(state) {
  const all = listAllCommands();
  const url = '/fragments/commands/list';
  const target = '#webship-workspace-projects';
  const { repo } = toolingRepo();
  // Searched by name, workspace AND label, because "what builds Drupal 11" is a search for the
  // label and "everything in dev" is a search for the workspace.
  const grouped = { ...state, sort: state.sort === defaultSort() ? 'group' : state.sort };
  const page = searchSortPage(all, grouped, (r) => `${r.name} ${r.workspace} ${r.label}`);

  const rowHtml = (c) => {
    const vals = `hx-vals='{"workspace":"${esc(c.workspace)}","file":"${esc(c.name)}"}' hx-target="#webship-workspace-output" hx-swap="innerHTML"`;
    return `
    <div class="uk-card uk-card-default uk-card-small uk-card-body uk-margin-small project-row">
      <div class="uk-flex uk-flex-between uk-flex-middle uk-flex-wrap">
        <span><span uk-icon="icon: file-text; ratio: .8"></span>
          <span class="uk-text-bold">${esc(c.name)}</span>
          <span class="uk-label">${esc(c.workspace)}</span>
          ${c.label ? `<span class="uk-text-meta">${esc(c.label)}</span>` : ''}</span>
        <div class="project-actions">
          <button class="uk-button uk-button-default uk-button-small"
                  hx-get="/fragments/commands/edit/${esc(c.workspace)}/${encodeURIComponent(c.name)}"
                  hx-target="#editor-modal-body" hx-swap="innerHTML"><span uk-icon="icon: pencil; ratio: .7"></span> Edit</button>
          <div class="uk-inline act-menu">
            <button class="uk-button uk-button-default uk-button-small" type="button" title="Compare with ${esc(repo)}, or bring its copy down"><span uk-icon="icon: cloud-download; ratio: .7"></span> Repo <span uk-icon="icon: chevron-down; ratio: .6"></span></button>
            <div uk-dropdown="mode: click; pos: bottom-right"><ul class="uk-nav uk-dropdown-nav">
              <li class="uk-nav-header">${esc(repo)}</li>
              <li><a href hx-post="/actions/command-diff" ${vals}><span uk-icon="icon: git-branch; ratio: .7"></span> Diff against the repository</a></li>
              <li><a href hx-post="/actions/command-pull" ${vals}><span uk-icon="icon: download; ratio: .7"></span> Pull its copy over mine</a></li>
              <li class="uk-nav-divider"></li>
              <li><a href hx-get="/fragments/commands/propose/${esc(c.workspace)}/${encodeURIComponent(c.name)}" hx-target="#editor-modal-body" hx-swap="innerHTML"><span uk-icon="icon: git-pull-request; ratio: .7"></span> Propose mine…</a></li>
            </ul></div>
          </div>
        </div>
      </div>
    </div>`;
  };

  // Regroup whatever landed on this page, in the order the workspaces are configured in, so the
  // grouping matches the card order on the home page rather than the alphabet.
  const order = Object.keys(loadWorkspaces());
  const seen = new Map();
  for (const c of page.slice) {
    if (!seen.has(c.workspace)) seen.set(c.workspace, []);
    seen.get(c.workspace).push(c);
  }
  const totals = all.reduce((m, c) => m.set(c.workspace, (m.get(c.workspace) || 0) + 1), new Map());
  const rows = [...seen.keys()]
    .sort((a, b) => (order.indexOf(a) === -1 ? 99 : order.indexOf(a)) - (order.indexOf(b) === -1 ? 99 : order.indexOf(b)))
    .map((ws) => {
      const here = seen.get(ws);
      const total = totals.get(ws) || here.length;
      // "3 of 22 here" rather than a bare count: a partial group on a page must not read as the
      // whole of that workspace.
      const count = here.length === total ? `${total}` : `${here.length} of ${total}`;
      return `<h4 class="cmd-group-head">${esc(ws)} <span class="uk-text-meta">${count}</span></h4>
        ${here.map(rowHtml).join('')}`;
    }).join('');

  const pager = listPagerHtml(url, target, page, grouped, 'commands');
  return `
    <h3 class="uk-margin-small-bottom">Commands <span class="uk-badge">${all.length}</span></h3>
    <p class="uk-text-meta uk-margin-small-bottom">Every <code>cmd-*.sh</code> in the workspace, in the folder it runs from.
      Compared against <a href="https://github.com/${esc(repo)}" target="_blank">${esc(repo)}</a>.</p>
    <div class="uk-margin-small-bottom cmd-toolbar">
      <button class="uk-button uk-button-primary uk-button-small" hx-get="/fragments/commands/new"
              hx-target="#editor-modal-body" hx-swap="innerHTML"><span uk-icon="icon: plus; ratio: .7"></span> New command</button>
      <button class="uk-button uk-button-default uk-button-small" hx-post="/actions/command-list-remote"
              hx-target="#webship-workspace-output" hx-swap="innerHTML"><span uk-icon="icon: cloud-download; ratio: .7"></span> Compare every command</button>
      <div class="uk-inline act-menu">
        <button class="uk-button uk-button-secondary uk-button-small" type="button" title="Bring the repository's commands down"><span uk-icon="icon: download; ratio: .7"></span> Sync from ${esc(repo)} <span uk-icon="icon: chevron-down; ratio: .6"></span></button>
        <div uk-dropdown="mode: click; pos: bottom-left"><ul class="uk-nav uk-dropdown-nav">
          <li class="uk-nav-header">${esc(repo)}</li>
          <li><a href hx-post="/actions/command-sync" hx-target="#webship-workspace-output" hx-swap="innerHTML"><span uk-icon="icon: search; ratio: .7"></span> Show me what would change</a></li>
          <li><a href hx-post="/actions/command-sync" hx-vals='{"confirm":"yes"}' hx-target="#webship-workspace-output" hx-swap="innerHTML"><span uk-icon="icon: download; ratio: .7"></span> Take the ones I am missing</a></li>
          <li class="uk-nav-divider"></li>
          <li><a href class="uk-text-danger arm-step" data-armed="0" hx-post="/actions/command-sync" hx-vals='{"confirm":"yes","overwrite":"yes"}' hx-trigger="confirmed-remove" hx-target="#webship-workspace-output" hx-swap="innerHTML" title="Each file it replaces is kept under backups/ first"><span uk-icon="icon: refresh; ratio: .7"></span> Replace the ones that differ too</a></li>
        </ul></div>
      </div>
    </div>
    ${all.length ? listControlsHtml(url, target, grouped, 'commands') : ''}
    ${pager}
    ${rows || emptyListHtml(state, 'commands', 'No cmd-*.sh found anywhere in the workspace.')}
    ${page.pages > 1 ? pager : ''}`;
}

module.exports = { listAllCommands, commandFile, commandRowsHtml, toolingRepo, SCRIPT_RE };
