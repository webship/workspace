/**
 * The dashboard side of ai-anycli.js: one panel per kind — the sources (a row each, with its state),
 * the AI CLIs of the settings, and the folder's items against every CLI that is on.
 *
 * It draws from the same engine the terminal uses and changes nothing itself: every button posts to
 * /actions/any-cli (actions/ai-anycli.js), which runs the terminal's own command and draws the panel
 * again with what it printed. A CLI, a source or a state is never named in this file.
 */

const fs = require('fs');
const path = require('path');

const { esc } = require('./html.mts');
const A = require('./ai-anycli');

const KIND_LABEL = { 'ai-agents': 'AI Agents', 'ai-skills': 'AI Skills', 'ai-commands': 'AI Commands', 'ai-prompts': 'AI Prompts', cmd: 'cmd-* commands' };
const PANEL_RE = /^\/fragments\/(ai-agents|ai-skills|ai-commands|ai-prompts|cmd)\/any-cli$/;

/** The dashboard runs in a container: it sees a CLI only when its command and its folder are in there. */
const inContainer = () => !!process.env.IS_DDEV_PROJECT;

/** Whether what is written at a CLI's place for every session is the person's own: under the workspace, or a folder that is there. */
function sharedWithHost(dir) {
  if (!inContainer()) return true;
  const root = process.env.WORKSPACE_ROOT || path.resolve(__dirname, '..', '..');
  if (dir === root || dir.startsWith(`${root}${path.sep}`)) return true;
  const home = process.env.HOME || '';
  const rel = home && dir.startsWith(`${home}${path.sep}`) ? dir.slice(home.length + 1).split(path.sep)[0] : '';
  return !!rel && fs.existsSync(path.join(home, rel));
}

const STATE_CLASS = [
  [/^(current|installed|reachable|signed in|on)$/, 'uk-label-success'],
  [/^(unreachable|missing here|missing)/, 'uk-label-danger'],
  [/(behind|changed locally|differs|removed upstream|signed out)/, 'uk-label-warning'],
];
function badge(state, title = '') {
  const cls = (STATE_CLASS.find(([re]) => re.test(state)) || [null, ''])[1];
  return `<span class="uk-label ${cls} any-cli-state" data-state="${esc(state)}"${title ? ` title="${esc(title)}"` : ''}>${esc(state)}</span>`;
}

function age(iso) {
  if (!iso) return '';
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 90) return 'just now';
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 129600) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

const post = (vals) => `hx-post="/actions/any-cli" hx-vals='${esc(JSON.stringify(vals))}' hx-target="#any-cli-panel" hx-swap="outerHTML"`;
const button = (label, vals, title, style = 'default', confirm = '') =>
  `<button type="button" class="uk-button uk-button-${style} uk-button-small" ${post(vals)}${confirm ? ` hx-confirm="${esc(confirm)}"` : ''} title="${esc(title)}">${esc(label)}</button>`;

/** The workspace a form names for the action's own check: the folder itself, or for cmd the folder the commands go in. */
function sourcesHtml(kind, workspaces) {
  const list = A.sourcesStatus(kind);
  const rows = list.map((s) => {
    const ws = kind === 'cmd' ? s.to : kind;
    const tally = [...new Set(s.items.map((i) => i.state))].map((st) => `${s.items.filter((i) => i.state === st).length} ${st}`).join(', ');
    const items = s.items.map((i) => `<li><code>${esc(i.to)}</code> ${badge(i.state)}</li>`).join('');
    return `<tr class="any-cli-source" data-source="${esc(s.id)}">
        <td><strong>${esc(s.id)}</strong><br><span class="uk-text-meta">${esc(s.forge)}${s.via ? ` · from ${esc(s.via)}` : ''}</span></td>
        <td><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.url.replace(/^https:\/\//, ''))}</a>${s.ref ? ` <span class="uk-text-meta">@${esc(s.ref)}</span>` : ''}${
          s.path ? `<br><span class="uk-text-meta">in ${esc(s.path)}</span>` : ''}${s.to ? `<br><span class="uk-text-meta">into ${esc(s.to)}/</span>` : ''}</td>
        <td>${badge(s.state, s.checkedAt ? `Asked ${s.checkedAt}` : 'Not asked yet: press Check')}${s.checkedAt ? ` <span class="uk-text-meta">${esc(age(s.checkedAt))}</span>` : ''}</td>
        <td><details><summary>${s.items.length} item${s.items.length === 1 ? '' : 's'}${tally ? `: ${esc(tally)}` : ''}</summary><ul class="uk-list uk-list-collapse uk-margin-small-top">${items}</ul></details></td>
        <td class="any-cli-actions">
          ${button('Check', { workspace: ws, kind, verb: 'source-check', id: s.id }, `Ask ${s.url} where it is, changing no item`)}
          ${button('Update', { workspace: ws, kind, verb: 'source-update', id: s.id }, 'Take what moved upstream; an item changed here is left')}
          ${button('Remove', { workspace: ws, kind, verb: 'source-remove', id: s.id }, 'Forget this source and remove the items it placed; one changed here is kept', 'danger')}
        </td>
      </tr>`;
  }).join('');
  const to = kind === 'cmd'
    ? `<div class="uk-width-1-6@s"><select class="uk-select uk-form-small" name="workspace" aria-label="The folder the commands go in" required>${
        workspaces.map((w) => `<option value="${esc(w)}">${esc(w)}/</option>`).join('')}</select></div>`
    : `<input type="hidden" name="workspace" value="${esc(kind)}">`;
  return `
    <h4 class="uk-margin-small-bottom">Sources</h4>
    ${list.length ? `<div class="uk-overflow-auto"><table class="uk-table uk-table-small uk-table-divider any-cli-sources">
      <thead><tr><th>Source</th><th>Repository</th><th>State</th><th>Items</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
      : `<p class="uk-text-meta any-cli-none">No source yet. Add a repository below.</p>`}
    <form class="uk-grid uk-grid-small any-cli-add" uk-grid hx-post="/actions/any-cli" hx-target="#any-cli-panel" hx-swap="outerHTML">
      <input type="hidden" name="kind" value="${esc(kind)}"><input type="hidden" name="verb" value="source-add">
      ${to}
      <div class="uk-width-1-3@s"><input class="uk-input uk-form-small" name="source" required aria-label="Source"
        placeholder="owner/repo, an https:// address${kind === 'ai-skills' ? ', or skills.sh/owner/repo/skill' : ''}"></div>
      <div class="uk-width-1-6@s"><input class="uk-input uk-form-small" name="item" aria-label="One item only" placeholder="one item (optional)"></div>
      <div class="uk-width-1-6@s"><input class="uk-input uk-form-small" name="ref" aria-label="Branch or tag" placeholder="branch (optional)"></div>
      <div class="uk-width-1-6@s"><input class="uk-input uk-form-small" name="id" aria-label="Id to list it under" placeholder="id (optional)"></div>
      <div class="uk-width-auto@s"><button type="submit" class="uk-button uk-button-primary uk-button-small">Add source</button></div>
    </form>
    <p class="uk-text-meta">GitHub, GitLab (git.drupalcode.org, gitlab.com, your own) and Bitbucket, over https. A tree address picks a branch and a folder.
      Files only: each one is listed below when it is fetched, and nothing fetched is ever run.${kind === 'cmd' ? ' A command is placed in the folder, not run, and never over one that is already there.' : ''}</p>`;
}

function clisHtml() {
  const chips = A.listClis().map((c) => {
    const words = A.cliStateWords(c).map((w) => (w === 'missing' && inContainer() ? "not in the dashboard's container" : w));
    return `<span class="any-cli-chip${c.enabled ? '' : ' is-off'}" data-cli="${esc(c.id)}" title="${esc(`${c.vendor ? `${c.vendor} · ` : ''}${c.command}${c.docs ? ` · ${c.docs}` : ''}`)}">
      <strong>${esc(c.label)}</strong> ${words.map((w) => badge(w)).join(' ')}</span>`;
  }).join('');
  return `
    <h4 class="uk-margin-small-bottom">AI CLIs</h4>
    <div class="any-cli-chips">${chips}</div>
    <p class="uk-text-meta">From <code>core/config/ai.settings.yml</code> over <code>core/config/ai.defaults.yml</code>: switch one off, change the default or add your own there.${
      inContainer() ? ' The dashboard runs in a container, so it sees a CLI whose command and folder are in there; for the others use the terminal.' : ''}</p>`;
}

/** "plugin <name>" under an item a plugin placed, or nothing. */
function pluginOf(kind, name, record) {
  const by = require('./plugin-install').placedBy(kind === 'ai-skills' ? `${kind}/${name}/SKILL.md` : `${kind}/${name}.md`, record);
  return by ? `<br><span class="uk-text-meta any-cli-plugin" title="${esc(by.module || by.name)}${by.version ? ` ${esc(by.version)}` : ''}">plugin ${esc(by.name)}</span>` : '';
}

function itemsHtml(kind) {
  if (kind === 'ai-prompts') {
    return '<p class="uk-text-meta any-cli-none">A prompt is the launch command of a new session: it is run, not installed into a CLI.</p>';
  }
  const { clis, rows } = A.matrix(kind);
  const record = require('./plugin-install').readRecord();
  if (!rows.length) return `<p class="uk-text-meta any-cli-none">No ${esc(A.KIND_NOUN[kind])} in ${esc(kind)}/ yet.</p>`;
  const usable = new Map(clis.map((c) => {
    let place = null;
    try { place = A.cliPlace(c, kind); } catch (_) { place = null; }
    return [c.id, !!place && sharedWithHost(place.dir)];
  }));
  const head = clis.map((c) => `<th>${esc(c.label)}${c.isDefault ? ' <span class="uk-text-meta">(default)</span>' : ''}</th>`).join('');
  const body = rows.map((r) => `<tr class="any-cli-item" data-item="${esc(r.name)}">
      <td><code>${esc(r.name)}</code>${r.source ? `<br><span class="uk-text-meta">from ${esc(r.source)}</span> ${badge(r.sourceState)}` : ''}${pluginOf(kind, r.name, record)}</td>
      ${r.cells.map((cell) => {
        const vals = { workspace: kind, kind, name: r.name, cli: cell.cli };
        const can = usable.get(cell.cli);
        const act = cell.state === 'no such thing' ? ''
          : !can ? '<span class="uk-text-meta">use the terminal</span>'
          : cell.state === 'not installed' ? button('Install', { ...vals, verb: 'install' }, `Install ${r.name} into this CLI`, 'primary')
          : `${cell.state === 'installed, differs' ? button('Update', { ...vals, verb: 'install' }, `Install ${r.name} again, as it is in the folder now`, 'primary') : ''}
             ${cell.state === 'installed, differs'
    // What is there is not what the folder installs: removing it is asked first, and said to the engine.
    ? button('Remove', { ...vals, verb: 'uninstall', force: '1' }, `Take ${r.name} out of this CLI, though what is there differs from the item`, 'default', `What ${r.name} is in this CLI differs from the item in the folder (edited there, or something else of that name). Remove it?`)
    : button('Remove', { ...vals, verb: 'uninstall' }, `Take ${r.name} out of this CLI`)}`;
        return `<td class="any-cli-cell" data-cli="${esc(cell.cli)}">${badge(cell.state)} ${act}</td>`;
      }).join('')}
    </tr>`).join('');
  return `<h4 class="uk-margin-small-bottom">Items in each CLI</h4>
    <div class="uk-overflow-auto"><table class="uk-table uk-table-small uk-table-divider any-cli-items"><thead><tr><th>${esc(KIND_LABEL[kind])}</th>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

/**
 * The whole panel. `said` is what the last action printed; `failed` marks it as an error.
 * `workspaces` is the list of folders a cmd-* source may go in.
 */
function panelHtml(kind, { said = '', failed = false, workspaces = [] } = {}) {
  let body;
  try {
    body = `${sourcesHtml(kind, workspaces)}${kind === 'cmd' ? '' : `${clisHtml()}${itemsHtml(kind)}`}`;
  } catch (e) {
    if (!(e instanceof A.AnyCliError)) throw e;
    body = `<p class="any-cli-none">${esc(e.message)}</p>`;
  }
  return `<div id="any-cli-panel" class="any-cli" data-kind="${esc(kind)}">
    <h3 class="uk-margin-small-bottom">${kind === 'cmd' ? 'Commands from repositories' : `Sources and AI CLIs — ${esc(KIND_LABEL[kind])}`}</h3>
    ${said ? `<pre class="any-cli-said${failed ? ' is-error' : ''}" role="status">${esc(said)}</pre>` : ''}
    ${body}
  </div>`;
}

/** The panel for a fragment address, or null when the address is not this module's. */
function fragment(pathname, workspaces = []) {
  const m = String(pathname).match(PANEL_RE);
  return m ? panelHtml(m[1], { workspaces }) : null;
}

module.exports = { panelHtml, fragment, badge, sharedWithHost, PANEL_RE, KIND_LABEL };
