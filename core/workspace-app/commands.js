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
const { searchSortPage, listControlsHtml, listPagerHtml, emptyListHtml } = require('./lists');

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
  for (const key of Object.keys(loadWorkspaces())) {
    const dir = loadWorkspaces()[key].dir;
    let files = [];
    try {
      files = fs.readdirSync(dir).filter((f) => SCRIPT_RE.test(f));
    } catch (_) { continue; }
    for (const f of files) {
      const full = path.join(dir, f);
      let mtime = 0;
      try { mtime = fs.statSync(full).mtimeMs; } catch (_) { /* vanished */ }
      rows.push({ name: f, workspace: key, label: commandLabel(full), mtime });
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
  const page = searchSortPage(all, state, (r) => `${r.name} ${r.workspace} ${r.label}`);

  const rows = page.slice.map((c) => {
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
              <li><a href hx-post="/actions/command-propose" ${vals}><span uk-icon="icon: git-pull-request; ratio: .7"></span> Propose mine…</a></li>
            </ul></div>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');

  const pager = listPagerHtml(url, target, page, state, 'commands');
  return `
    <h3 class="uk-margin-small-bottom">Commands <span class="uk-badge">${all.length}</span></h3>
    <p class="uk-text-meta uk-margin-small-bottom">Every <code>cmd-*.sh</code> in the workspace, in the folder it runs from.
      Compared against <a href="https://github.com/${esc(repo)}" target="_blank">${esc(repo)}</a>.</p>
    <p class="uk-margin-small-bottom">
      <button class="uk-button uk-button-primary uk-button-small" hx-post="/actions/command-list-remote"
              hx-target="#webship-workspace-output" hx-swap="innerHTML"><span uk-icon="icon: cloud-download; ratio: .7"></span> Compare every command</button>
    </p>
    ${all.length ? listControlsHtml(url, target, state, 'commands') : ''}
    ${pager}
    ${rows || emptyListHtml(state, 'commands', 'No cmd-*.sh found anywhere in the workspace.')}
    ${page.pages > 1 ? pager : ''}`;
}

module.exports = { listAllCommands, commandFile, commandRowsHtml, toolingRepo, SCRIPT_RE };
