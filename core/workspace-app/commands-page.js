/**
 * The Commands page, as HTML: the catalog, one command's page, the run form, a new command, and your commands as
 * YAML. The rules are in commands.js and the writes in actions/commands-center.js.
 */

const fs = require('fs');
const yaml = require('js-yaml');

const { esc } = require('./html');
const { loadWorkspaces, workspaceDir } = require('./workspaces');
const { paginate, listControlsHtml, listPagerHtml } = require('./lists');
const { tildePath } = require('./format');
const rl = require('./row-layout');
const cc = require('./commands');

const icon = (name, ratio = 0.7) => `<span uk-icon="icon: ${name}; ratio: ${ratio}"></span>`;
const vals = (o) => `hx-vals='${esc(JSON.stringify(o))}'`;
const MODAL = 'hx-target="#editor-modal-body" hx-swap="innerHTML"';
const OUT = 'hx-target="#webship-workspace-output" hx-swap="innerHTML"';

// Code shown on a page: Ace, read-only, and a read-only textarea still readable when Ace does not load.
const codeView = (mode, text, label) => `<textarea class="uk-textarea cc-yaml" rows="${Math.min(32, String(text).split('\n').length + 1)}" readonly spellcheck="false"
    data-ace="${mode}" data-ace-readonly="1" aria-label="${esc(label)}">${esc(text)}</textarea>`;

function tabsHtml(active) {
  const tab = (href, label, key, title) => `<a class="uk-button uk-button-${active === key ? 'primary' : 'default'} uk-button-small settings-tab"
       href="${href}"${active === key ? ' aria-current="page"' : ''} title="${esc(title)}">${esc(label)}</a>`;
  return `<p class="settings-tabs cc-tabs">
    ${tab('/commands', 'Commands', 'list', 'Every command: built in, yours, and the cmd-*.sh scripts')}
    ${tab('/commands/new', 'New', 'new', 'A command, a script, or an action on a button')}
    ${tab('/commands/definition', 'Definition', 'definition', 'Your commands as YAML')}
  </p>`;
}

function sourceBadge(e) {
  if (e.source === 'yours' && e.overrides) return '<span class="uk-label uk-label-warning" title="Your version of a built-in command">changed</span>';
  if (e.source === 'yours') return '<span class="uk-label uk-label-success">yours</span>';
  if (e.source === 'script') return '<span class="uk-label" title="A cmd-*.sh in a workspace folder">script</span>';
  return '<span class="uk-label" title="Shipped with the dashboard">built in</span>';
}

function describeTarget(e) {
  if (e.source === 'script') return `a script in ${e.workspace}/`;
  const when = e.when.length === 1 && e.when[0] === 'any' ? '' : ` · ${rl.describeWhen(e.when)}`;
  return `runs on ${cc.ON[e.on] || e.on}${when}`;
}

const scriptHref = (ws, file) => `/commands/s/${encodeURIComponent(ws)}/${encodeURIComponent(file)}`;

/** What a script can do, the same set the old Settings → Commands rows had, plus Run and Use in a command. */
function scriptButtons(ws, file) {
  const w = encodeURIComponent(ws);
  const f = encodeURIComponent(file);
  const withFile = `${vals({ file })} ${OUT}`;
  return [
    `<button class="uk-button uk-button-primary uk-button-small" hx-get="/fragments/cc/script-run/${w}/${f}" ${MODAL}>${icon('play')} Run</button>`,
    `<button class="uk-button uk-button-default uk-button-small" hx-get="/fragments/commands/edit/${w}/${f}" ${MODAL}>${icon('pencil')} Edit</button>`,
    `<a class="uk-button uk-button-default uk-button-small" href="/commands/new?script=${encodeURIComponent(`${ws}/${file}`)}" title="A command that runs this script, with its arguments and what it runs on">${icon('plus-circle')} Use in a command</a>`,
    `<button class="uk-button uk-button-default uk-button-small" hx-get="/fragments/commands/clone/${w}/${f}" ${OUT}>${icon('copy')} Clone</button>`,
    `<button class="uk-button uk-button-default uk-button-small" hx-post="/actions/command-diff" ${withFile}>${icon('git-fork')} Diff repo</button>`,
    `<button class="uk-button uk-button-default uk-button-small" hx-post="/actions/command-pull" ${withFile} title="Overwrite with the copy in webship/workspace; a differing local copy is kept under backups/">${icon('cloud-download')} Pull</button>`,
    `<button class="uk-button uk-button-secondary uk-button-small" hx-get="/fragments/commands/propose/${w}/${f}" ${OUT}>${icon('git-branch')} Propose PR</button>`,
  ].join('');
}

function commandRowHtml(e, mtime, badge) {
  const isScript = e.source === 'script';
  const href = isScript ? scriptHref(e.workspace, e.file) : `/commands/c/${encodeURIComponent(e.id)}`;
  const buttons = isScript ? scriptButtons(e.workspace, e.file) : [
    `<button class="uk-button uk-button-primary uk-button-small" hx-get="/fragments/cc/run/${encodeURIComponent(e.id)}" ${MODAL}>${icon('play')} Run</button>`,
    `<a class="uk-button uk-button-default uk-button-small" href="${href}#edit">${icon('pencil')} Edit</a>`,
    `<button class="uk-button uk-button-default uk-button-small" hx-post="/actions/cc-copy" ${vals({ id: e.id, mtime })} ${OUT}>${icon('copy')} Copy</button>`,
    e.source === 'yours'
      ? `<button class="uk-button uk-button-danger uk-button-small arm-step" hx-post="/actions/cc-remove" ${vals({ id: e.id, mtime })} ${OUT} hx-trigger="confirmed-remove">${icon('trash')} ${e.overrides ? 'Back to built in' : 'Delete'}</button>`
      : '',
  ].join('');
  return `
    <div class="uk-card uk-card-default uk-card-small uk-card-body uk-margin-small project-row cc-row">
      <div class="cmd-row-stack">
        <span class="cmd-id">
          <span class="cmd-title">${icon(isScript ? 'file-text' : 'play-circle', 0.8)} <a href="${href}">${esc(e.label)}</a> ${sourceBadge(e)} ${isScript && badge ? badge(e) : ''}</span>
          <code class="fname cmd-file">${esc(isScript ? e.file : cc.lineOf(e))}</code>
          <span class="cmd-desc">${e.description ? `${esc(e.description)} · ` : ''}${esc(describeTarget(e))}</span>
        </span>
        <div class="project-actions">${buttons}</div>
      </div>
    </div>`;
}

/** The whole catalog, searchable and filterable, grouped, and paged over the flat list so pages stay even. */
function catalogListHtml(state = {}, { scripts = [], badge = null } = {}) {
  const cat = cc.loadCatalog();
  const all = [...cat.commands, ...cc.scriptEntries(scripts)];
  const source = ['builtin', 'yours', 'script'].includes(state.source) ? state.source : 'all';
  const on = cc.ON[state.on] ? state.on : 'all';
  const rank = new Map();
  for (const e of all) if (!rank.has(e.group)) rank.set(e.group, rank.size);
  // Groups keep their order; inside a group the Sort choice applies (by name either way, since a command
  // carries no date of its own; Newest and Oldest keep the catalog's order, forwards or back).
  const sortBy = String(state.sort || '');
  const within = sortBy === 'name' ? (a, b) => a.e.label.localeCompare(b.e.label)
    : sortBy === 'nameDesc' ? (a, b) => b.e.label.localeCompare(a.e.label)
      : sortBy === 'oldest' ? (a, b) => b.i - a.i
        : (a, b) => a.i - b.i;
  const matched = cc.filterCommands(all, { q: state.q, source, on })
    .map((e, i) => ({ e, i }))
    .sort((a, b) => rank.get(a.e.group) - rank.get(b.e.group) || within(a, b))
    .map((x) => x.e);
  const inGroup = {};
  for (const e of matched) inGroup[e.group] = (inGroup[e.group] || 0) + 1;
  const pg = paginate(matched, state);
  const shown = [];
  for (const e of pg.slice) {
    if (!shown.length || shown[shown.length - 1].group !== e.group) shown.push({ group: e.group, items: [] });
    shown[shown.length - 1].items.push(e);
  }
  const body = shown.map(({ group, items }) => `
    <h4 class="uk-margin-small-top">${esc(group)} <span class="uk-badge">${items.length === inGroup[group] ? items.length : `${items.length} of ${inGroup[group]}`}</span></h4>
    ${items.map((e) => commandRowHtml(e, cat.mtime, badge)).join('')}`).join('');

  const bare = '/fragments/cc/list';
  const qs = new URLSearchParams();
  if (state.q) qs.set('q', state.q);
  if (source !== 'all') qs.set('source', source);
  if (on !== 'all') qs.set('on', on);
  const pager = listPagerHtml(`${bare}${qs.toString() ? `?${qs}` : ''}`, '#webship-workspace-projects', pg, state, 'commands');
  const count = (s) => all.filter((e) => e.source === s).length;
  const select = (name, label, current, options) => `<label class="uk-text-meta">${label}
      <select class="uk-select uk-form-small" name="${name}" aria-label="${esc(label)}"
              hx-get="${bare}" hx-target="#webship-workspace-projects" hx-swap="innerHTML"
              hx-trigger="change" hx-include="closest .list-controls" hx-vals='{"page":"1"}'>
        ${options.map(([v, t]) => `<option value="${v}"${v === current ? ' selected' : ''}>${esc(t)}</option>`).join('')}
      </select></label>`;
  // One group each, so the two wrap onto their own lines on a phone instead of pushing the page sideways.
  const filters = [
    select('source', 'Source', source, [['all', `Every source (${all.length})`], ['builtin', `Built in (${count('builtin')})`],
      ['yours', `Yours (${count('yours')})`], ['script', `Scripts (${count('script')})`]]),
    select('on', 'Runs on', on, [['all', 'Anything'], ...Object.entries(cc.ON)]),
  ];
  const problems = [
    ...(cat.error ? [`${tildePath(cc.userFile())} could not be read (${cat.error}), so only the built-in commands are listed. Saving a command replaces the file.`] : []),
    ...(cat.builtinError ? [`The built-in commands could not be read: ${cat.builtinError}.`] : []),
    ...cat.problems.map((p) => `Skipped ${p}.`),
  ];
  const narrowed = state.q || source !== 'all' || on !== 'all';
  return `<h3 class="uk-margin-small-bottom">Commands <span class="uk-badge">${all.length}</span></h3>
    <p class="uk-text-meta uk-margin-small-bottom">Every command the dashboard can run, and what each runs on: a workspace folder, a project,
      a folder or a file. The built-in ones ship with the dashboard, yours are kept in <code>${esc(tildePath(cc.userFile()))}</code>, and every
      <code>cmd-*.sh</code> in the tree is listed as a script.</p>
    ${problems.map((p) => `<div class="msg error">${esc(p)}</div>`).join('')}
    ${listControlsHtml(bare, '#webship-workspace-projects', state, 'commands', filters)}
    ${narrowed ? `<p class="uk-text-meta">${matched.length} of ${all.length} commands.</p>` : ''}
    ${matched.length ? '' : '<p class="uk-text-meta">No commands match.</p>'}
    ${pager}
    ${body}
    ${pager}`;
}

/** Where a run goes: a workspace, then a project, then a path — only as much as the command runs on. */
function targetFieldsHtml(e, preset = {}) {
  const workspaces = loadWorkspaces();
  const keys = Object.keys(workspaces);
  const ws = keys.includes(preset.ws) ? preset.ws : (keys.includes('dev') ? 'dev' : keys[0]);
  const refresh = 'hx-get="/fragments/cc/target" hx-target="closest .cc-target" hx-swap="outerHTML" hx-trigger="change" hx-include="closest form"';
  const parts = [`<label>Workspace <select class="uk-select uk-form-small" name="target_ws" ${refresh}>
      ${keys.map((k) => `<option value="${esc(k)}"${k === ws ? ' selected' : ''}>${esc(workspaces[k].label)}</option>`).join('')}
    </select></label>`];
  if (e.on !== 'workspace' && ws) {
    const names = cc.listFolders(workspaceDir(ws));
    const project = names.includes(preset.project) ? preset.project : '';
    parts.push(`<label>Project <select class="uk-select uk-form-small" name="target_project" ${refresh}>
        <option value="">${e.on === 'project' ? 'Pick a project…' : `None — inside the ${esc(ws)} folder`}</option>
        ${names.map((n) => `<option value="${esc(n)}"${n === project ? ' selected' : ''}>${esc(n)}</option>`).join('')}
      </select></label>`);
    if (e.on === 'folder' || e.on === 'file') {
      const listId = `cc-paths-${esc(e.id)}`;
      parts.push(`<label class="cc-wide">${e.on === 'file' ? 'File' : 'Folder'} <span class="uk-text-meta">${e.on === 'file'
        ? 'relative to the project, or to the workspace folder when no project is picked'
        : 'relative; empty is the project or workspace folder itself'}</span>
        <input class="uk-input uk-form-small cc-code" name="target_path" value="${esc(preset.path || '')}" list="${listId}" autocomplete="off" spellcheck="false"
               placeholder="${e.on === 'file' ? 'composer.json' : 'web/modules/custom'}"
               hx-get="/fragments/cc/paths" hx-target="#${listId}" hx-swap="outerHTML" hx-trigger="focus, keyup changed delay:300ms" hx-include="closest form"></label>
        <datalist id="${listId}"></datalist>`);
    }
  }
  return `<fieldset class="cc-target"><legend class="uk-text-meta">What it runs on: ${esc(cc.ON[e.on] || e.on)}</legend>${parts.join('')}</fieldset>`;
}

function pathsDatalistHtml(e, form) {
  return `<datalist id="cc-paths-${esc(e.id)}">${cc.pathSuggestions(e, form).map((p) => `<option value="${esc(p)}">`).join('')}</datalist>`;
}

function optionFieldsHtml(e) {
  if (!e.options.length) return '';
  return `<fieldset class="cc-options"><legend class="uk-text-meta">Options</legend>${e.options.map((o) => {
    const name = `opt_${esc(o.name)}`;
    const label = esc(o.label || o.name);
    if (o.values.length && o.enforced) {
      return `<label>${label} <select class="uk-select uk-form-small" name="${name}">${o.required ? '' : '<option value=""></option>'}
        ${o.values.map((v) => `<option value="${esc(v)}"${v === o.value ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select></label>`;
    }
    const listId = `cc-opt-${esc(e.id)}-${esc(o.name)}`;
    return `<label>${label} <input class="uk-input uk-form-small" name="${name}" value="${esc(o.value)}"${o.required ? ' required' : ''}${o.values.length ? ` list="${listId}"` : ''}>
      ${o.values.length ? `<datalist id="${listId}">${o.values.map((v) => `<option value="${esc(v)}">`).join('')}</datalist>` : ''}</label>`;
  }).join('')}</fieldset>`;
}

/** The run form: in the modal from the list, or inline on a command's own page. */
function runFormHtml(e, preset = {}, { inline = false } = {}) {
  const result = inline ? '#cc-run-result' : '#webship-workspace-output';
  const run = `<button type="button" class="uk-button ${e.confirm ? 'uk-button-danger arm-step' : 'uk-button-primary'}"${e.confirm ? ' hx-trigger="confirmed-remove"' : ''}
      hx-post="/actions/cc-run" hx-include="closest form" hx-target="${result}" hx-swap="innerHTML">${icon('play', 0.8)} Run</button>`;
  const form = `<form class="cc-run-form" onsubmit="return false">
      <input type="hidden" name="id" value="${esc(e.id)}">
      <input type="hidden" name="submitted" value="1">
      <p class="uk-text-meta"><code>${esc(cc.lineOf(e))}</code> — ${esc(describeTarget(e))}${e.confirm ? '. It asks first, in a dialog.' : ''}</p>
      ${targetFieldsHtml(e, preset)}
      ${optionFieldsHtml(e)}
      <div class="uk-margin-small-top">${run}</div>
    </form>
    ${inline ? '<div id="cc-run-result"></div>' : ''}`;
  return inline ? form : `<div class="editor-card"><h3 class="uk-margin-small-bottom">Run ${esc(e.label)}</h3>${form}</div>`;
}

/**
 * `suggest` is the project name a BUILDER would be given — the same one the Build form proposes.
 * A builder run from here takes its name as the first argument, so the box opens with it already
 * typed, and the flags are added after. Empty for anything that is not a builder: a tool takes a
 * project that exists, and proposing a new name for it would be wrong.
 */
function scriptRunFormHtml(ws, file, flags = [], suggest = '') {
  return `<div class="editor-card">
    <h3 class="uk-margin-small-bottom">Run ${esc(file)}</h3>
    <p class="uk-text-meta">Runs from <code>${esc(ws)}/</code> with the arguments you give, in a screen session.${flags.length
      ? ` Its flags: ${flags.map((f) => `<code>${esc(f.long)}</code>`).join(' ')}` : ''}${suggest
      ? ` The name is filled in past what <code>${esc(ws)}/</code> already holds — type over it freely.` : ''}</p>
    <form hx-post="/actions/command-run" ${OUT}>
      <input type="hidden" name="target" value="${esc(ws)}">
      <input type="hidden" name="script" value="${esc(file)}">
      <input class="uk-input uk-margin-small-bottom cc-code" name="args" value="${esc(suggest)}"
             placeholder="Arguments, e.g. myproject --install" spellcheck="false"
             pattern="[a-zA-Z0-9 ._@^~:\\/=,\\-]*">
      <button type="submit" class="uk-button uk-button-primary">${icon('play', 0.8)} Run</button>
    </form>
  </div>`;
}

function scriptPageBody({ ws, file, desc = '', flags = [], source = '', badge = '' }) {
  return `<div class="cc-command-head"><span class="uk-label">script</span> ${badge} <code>${esc(ws)}/${esc(file)}</code></div>
    ${desc ? `<p class="uk-margin-small">${esc(desc)}</p>` : ''}
    ${flags.length ? `<p class="uk-text-meta">Flags: ${flags.map((f) => `<code>${esc(f.long)}</code>`).join(' ')}</p>` : ''}
    <div class="project-actions cc-manage">${scriptButtons(ws, file)}</div>
    <h4 class="uk-margin-small-bottom">The script</h4>
    ${codeView('sh', source, `The script ${file}`)}`;
}

/** The add and edit form. `v` is the command as saved, or as it was just submitted when saving it was refused. */
function commandFormHtml(v, { cat, scripts = [], isNew = false }) {
  const kind = v.script ? 'script' : 'run';
  const groups = [...new Set(cat.commands.map((c) => c.group))];
  const refs = scripts.flatMap((g) => g.items.map((it) => `${g.key}/${it.file}`));
  if (v.script && !refs.includes(v.script)) refs.unshift(v.script);
  const idField = isNew
    ? `<label>Id <span class="uk-text-meta">made from the label when empty</span>
        <input class="uk-input uk-form-small cc-code" name="cc_id" value="${esc(v.id || '')}" maxlength="45" spellcheck="false" placeholder="rebuild-caches"></label>`
    : `<input type="hidden" name="id" value="${esc(v.id)}">`;
  return `<form class="cc-form" hx-post="/actions/cc-save" hx-target="#cc-command" hx-swap="outerHTML">
    <input type="hidden" name="mtime" value="${cat.mtime}">
    <div class="cc-form-grid">
      <label>Label <input class="uk-input uk-form-small" name="cc_label" value="${esc(v.label)}" maxlength="60" required></label>
      ${idField}
      <label>Group <input class="uk-input uk-form-small" name="cc_group" value="${esc(v.group)}" maxlength="40" list="cc-groups" placeholder="General"></label>
      <datalist id="cc-groups">${groups.map((g) => `<option value="${esc(g)}">`).join('')}</datalist>
      <label>Runs on <select class="uk-select uk-form-small" name="cc_on">${Object.entries(cc.ON)
        .map(([k, t]) => `<option value="${k}"${k === v.on ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
      <label>Shows on <input class="uk-input uk-form-small cc-code" name="cc_when" value="${esc(v.when.join(' '))}" placeholder="any"
             title="any, ddev, composer, node, git, workspace:name — each may start with !"></label>
      <label class="cc-wide">Description <input class="uk-input uk-form-small" name="cc_description" value="${esc(v.description)}" maxlength="200"></label>
      <fieldset class="cc-wide cc-kind"><legend class="uk-text-meta">What it runs</legend>
        <label class="cc-inline"><input class="uk-radio" type="radio" name="cc_kind" value="run"${kind === 'run' ? ' checked' : ''}> A command line</label>
        <label class="cc-inline"><input class="uk-radio" type="radio" name="cc_kind" value="script"${kind === 'script' ? ' checked' : ''}> A script of the tree</label>
        <label class="cc-wide">Command line <textarea class="uk-textarea uk-form-small cc-code" name="cc_run" rows="1" maxlength="400" spellcheck="false" placeholder="ddev drush cr" data-ace="sh" data-ace-single="1">${esc(v.run)}</textarea></label>
        <label>Script <select class="uk-select uk-form-small" name="cc_script"><option value="">Pick a script…</option>
          ${refs.map((r) => `<option value="${esc(r)}"${r === v.script ? ' selected' : ''}>${esc(r)}</option>`).join('')}</select></label>
        <label>Arguments <textarea class="uk-textarea uk-form-small cc-code" name="cc_args" rows="1" maxlength="400" spellcheck="false" placeholder="{{project}} --install" data-ace="sh" data-ace-single="1">${esc(v.args)}</textarea></label>
      </fieldset>
      <label>Tags <input class="uk-input uk-form-small" name="cc_tags" value="${esc(v.tags.join(' '))}" placeholder="drupal database"></label>
      <label>Opens <select class="uk-select uk-form-small" name="cc_open">
        <option value="toast"${v.open === 'toast' ? ' selected' : ''}>a toast linking to it</option>
        <option value="screen"${v.open === 'screen' ? ' selected' : ''}>its screen, right away</option></select></label>
      <label class="cc-inline"><input class="uk-checkbox" type="checkbox" name="cc_confirm" value="1"${v.confirm ? ' checked' : ''}> ask before running</label>
    </div>
    <p class="uk-text-meta">A line gets values only as <code>{{workspace}}</code> <code>{{project}}</code> <code>{{folder}}</code> <code>{{file}}</code>
      <code>{{path}}</code> and <code>{{opt.name}}</code>, each single-quoted for you. It cannot contain $ or a backtick.
      ${v.options.length ? 'Its options are kept as they are: change those in Definition.' : 'Options are added in Definition.'}</p>
    <button type="submit" class="uk-button uk-button-primary uk-button-small">${icon('check')} ${isNew ? 'Add the command' : 'Save the command'}</button>
  </form>`;
}

/** Where a command is used on the project rows, and a form to put it on another button. */
function onButtonsHtml(e) {
  const used = cc.usedBy(e.id);
  const list = used.length
    ? `<ul class="uk-list uk-list-collapse cc-used">${used.map((a) => `<li><strong>${esc(rl.buttonLabel(a.button))}</strong> → ${esc(a.group)} → ${esc(a.label)}${a.steps.length > 1
      ? ` <span class="uk-text-meta">(one of its ${a.steps.length} steps)</span>` : ''}</li>`).join('')}</ul>`
    : '<p class="uk-text-meta">Not on any button yet.</p>';
  if (e.on === 'file') {
    return `<h4 class="uk-margin-small-bottom">On buttons</h4>${list}
      <p class="uk-text-meta">It runs on a file, so it cannot go on a button: a project row gives no file to run it on.</p>`;
  }
  const layout = rl.loadRowLayout();
  const buttons = rl.knownButtonIds(layout).filter((b) => rl.hasMenu(b));
  return `<h4 class="uk-margin-small-bottom">On buttons</h4>
    ${list}
    <form class="cc-add-to-button" hx-post="/actions/cc-add-to-button" hx-target="#cc-command" hx-swap="outerHTML">
      <input type="hidden" name="id" value="${esc(e.id)}">
      <input type="hidden" name="mtime" value="${rl.layoutMtime()}">
      <div class="cc-form-grid">
        <label>Button <select class="uk-select uk-form-small" name="button">${buttons.map((b) => `<option value="${esc(b)}"${b === 'more' ? ' selected' : ''}>${esc(rl.buttonLabel(b))}</option>`).join('')}</select></label>
        <label>Group <input class="uk-input uk-form-small" name="group" value="${esc(e.group)}" maxlength="40"></label>
        <label>Label <input class="uk-input uk-form-small" name="label" value="${esc(e.label)}" maxlength="60"></label>
      </div>
      <p class="uk-text-meta">It shows on the rows its node filter matches (${esc(rl.describeWhen(e.when))}), and runs on that row's project.</p>
      <button type="submit" class="uk-button uk-button-default uk-button-small">${icon('plus')} Add to the button</button>
    </form>`;
}

function commandPageBody(e, { message = '', draft = null, scripts = [] } = {}) {
  const cat = cc.loadCatalog();
  const hasBuiltin = cat.builtin.some((c) => c.id === e.id);
  const row = (k, v) => (v ? `<dt>${esc(k)}</dt><dd>${v}</dd>` : '');
  const options = e.options.map((o) => `<code>${esc(o.name)}</code>${o.required ? ' (required)' : ''}${o.values.length ? `: ${esc(o.values.join(', '))}` : ''}`).join('; ');
  const manage = 'hx-target="#cc-command" hx-swap="outerHTML"';
  const script = e.script
    ? `<a href="${scriptHref(...e.script.split('/'))}"><code>${esc(e.script)}</code></a>${e.args ? ` <code>${esc(e.args)}</code>` : ''}`
    : '';
  return `<div id="cc-command">
    ${message}
    <div class="cc-command-head">${sourceBadge(e)} <span class="uk-text-meta">${esc(describeTarget(e))}</span></div>
    ${e.description ? `<p class="uk-margin-small">${esc(e.description)}</p>` : ''}
    <dl class="cc-dl">
      ${row('Id', `<code>${esc(e.id)}</code>`)}
      ${row('Group', esc(e.group))}
      ${row('Runs on', esc(cc.ON[e.on]))}
      ${row('Shows on', esc(rl.describeWhen(e.when)))}
      ${e.run ? row('Runs', `<code>${esc(e.run)}</code>`) : row('Script', script)}
      ${row('Options', options)}
      ${row('Asks first', e.confirm ? 'yes — it asks in a dialog before it runs' : '')}
      ${row('Opens', e.open === 'screen' ? 'its screen, right away' : 'a toast linking to its session')}
      ${row('Tags', esc(e.tags.join(', ')))}
    </dl>
    <h4 class="uk-margin-small-bottom">Run</h4>
    ${runFormHtml(e, {}, { inline: true })}
    ${onButtonsHtml(e)}
    <h4 id="edit" class="uk-margin-small-bottom">Edit</h4>
    ${e.source === 'builtin' ? '<p class="uk-text-meta">A built-in command. Saving keeps your version in your commands, in the same place in the list; deleting yours brings this one back.</p>' : ''}
    ${commandFormHtml(draft || e, { cat, scripts })}
    <div class="project-actions cc-manage">
      <button type="button" class="uk-button uk-button-default uk-button-small" hx-post="/actions/cc-copy" ${vals({ id: e.id, mtime: cat.mtime, from: 'page' })} ${manage}>${icon('copy')} Copy</button>
      ${e.source === 'yours' ? `<button type="button" class="uk-button uk-button-danger uk-button-small arm-step" hx-post="/actions/cc-remove"
        ${vals({ id: e.id, mtime: cat.mtime, from: 'page' })} ${manage} hx-trigger="confirmed-remove">${icon('trash')} ${hasBuiltin ? 'Delete yours, back to the built-in one' : 'Delete'}</button>` : ''}
    </div>
    <details class="row-definition-help"><summary>As YAML</summary>${codeView('yaml', yaml.dump({ commands: [cc.commandToDoc(e)] }, { lineWidth: 140, noRefs: true }), 'This command as YAML')}</details>
  </div>`;
}

function newPageBody({ scripts = [], draft = null, message = '', preset = {} } = {}) {
  const cat = cc.loadCatalog();
  const v = draft || cc.cleanCommand({ on: 'project', script: preset.script || '' }, 'yours');
  return `<div id="cc-command">
    ${message}
    <h3 class="uk-margin-small-bottom">A command</h3>
    <p class="uk-text-meta">A command line, or a script of the tree with its arguments, that runs on a workspace folder, a project, a folder or a
      file. It joins the list and runs from its own page.</p>
    ${commandFormHtml(v, { cat, scripts, isNew: true })}
    <div class="cc-new-other">
      <h3 class="uk-margin-small-bottom">A script</h3>
      <p class="uk-text-meta">A <code>cmd-*.sh</code> in a workspace folder, scaffolded with the bootstrap chain already correct. It is listed here as a script.</p>
      <div class="project-actions">
        <button class="uk-button uk-button-default uk-button-small" hx-get="/fragments/commands/new" ${MODAL}>${icon('plus-circle')} New script</button>
        <button class="uk-button uk-button-secondary uk-button-small" hx-get="/fragments/commands/new?ai=1" ${MODAL}>${icon('bolt')} Generate a script with AI</button>
      </div>
      <h3 class="uk-margin-small-bottom">An action on a button</h3>
      <p class="uk-text-meta">Steps in a project row's button menu (DDEV, GIT, More, or a button of your own), with options, a node filter and on_error steps.</p>
      <a class="uk-button uk-button-default uk-button-small" href="/settings/buttons">${icon('thumbnails')} Open Buttons</a>
    </div>
  </div>`;
}

const EXAMPLE = `commands:
  - id: update-database
    label: Update the database
    group: Drupal
    description: Switch branch, install, run the updates
    on: project                  # workspace | project | folder | file
    when: [ddev, composer, "!workspace:products"]
    confirm: true                # ask in a dialog before it runs
    open: screen                 # toast (the default) | screen
    tags: [drupal, database]
    options:
      - name: branch
        label: Branch
        value: main
        regex: '^[A-Za-z0-9._/-]+$'
        required: true
    run: git switch {{opt.branch}} && ddev composer install && ddev drush updb -y
  - id: backup-dev-project
    label: Back up the project
    on: project
    when: [workspace:dev]
    script: dev/cmd-tools-backup-dev.sh    # a script of the tree, instead of run
    args: '{{project}}'`;

function definitionBody({ message = '', draft = null } = {}) {
  const cat = cc.loadCatalog();
  let defaults = '';
  try { defaults = fs.readFileSync(cc.defaultsFile(), 'utf8'); } catch (_) { /* shown as empty */ }
  return `<div id="cc-definition">
    ${message}
    <form hx-post="/actions/cc-definition-save" hx-target="#cc-definition" hx-swap="outerHTML">
      <input type="hidden" name="mtime" value="${cat.mtime}">
      <p class="uk-text-meta">Your commands as YAML — the file the other tabs edit. Copy it to keep or share; paste one in to load it.
        <strong>Check</strong> says what would change and saves nothing. A command with a built-in id is your version of that command.</p>
      <textarea class="uk-textarea row-definition-text" name="definition" rows="22" spellcheck="false" data-ace="yaml">${esc(draft === null ? cc.definitionText() : draft)}</textarea>
      <div class="row-definition-buttons">
        <button type="button" class="uk-button uk-button-default uk-button-small" hx-post="/actions/cc-definition-check" hx-include="closest form"
                hx-target="#cc-definition-report" hx-swap="innerHTML">Check</button>
        <button type="submit" class="uk-button uk-button-primary uk-button-small">${icon('check')} Save</button>
      </div>
      <div id="cc-definition-report"></div>
    </form>
    <details class="row-definition-help"><summary>A command with every field</summary>${codeView('yaml', EXAMPLE, 'A command with every field')}
      <p class="uk-text-meta"><code>on</code> says what it runs on, and so which values its line can use: <code>{{workspace}}</code> always,
        <code>{{project}}</code> on a project, folder or file, <code>{{folder}}</code> on a folder or file, <code>{{file}}</code> on a file, and
        <code>{{path}}</code> for the full path of whatever it runs on. <code>when</code>: every clause must match. Each value is single-quoted.</p>
    </details>
    <details class="row-definition-help"><summary>The built-in commands (${cat.builtin.length})</summary>${codeView('yaml', defaults, 'The built-in commands')}</details>
    <h4>Start again</h4>
    <p class="uk-text-meta">Deletes <code>${esc(tildePath(cc.userFile()))}</code>: every command of yours goes, and every built-in one is as shipped.</p>
    <button type="button" class="uk-button uk-button-danger uk-button-small arm-step" hx-post="/actions/cc-reset" ${vals({ mtime: cat.mtime })}
            hx-target="#cc-definition" hx-swap="outerHTML" hx-trigger="confirmed-remove">Remove all of yours</button>
  </div>`;
}

module.exports = {
  tabsHtml,
  sourceBadge,
  describeTarget,
  catalogListHtml,
  commandRowHtml,
  targetFieldsHtml,
  pathsDatalistHtml,
  runFormHtml,
  scriptRunFormHtml,
  scriptPageBody,
  commandFormHtml,
  commandPageBody,
  newPageBody,
  definitionBody,
};
