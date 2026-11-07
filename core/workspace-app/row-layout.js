/**
 * Rows management: how a project row is built — its rows of buttons, top to bottom, what is inside each
 * button's menu, and the actions someone adds — set in Commands → Buttons.
 *
 * Global, one file for the machine: core/config/row-actions.yml. It holds only what someone changed;
 * the defaults live here, so a button added to the dashboard later appears in its default row until
 * someone moves it, and deleting the file is a full reset. sync-tooling.sh copies only
 * workspace.*.settings.yml into core/config, so a --pull never touches it.
 *
 *   rows:    [[ids…], [ids…], …]    the rows of buttons, top to bottom (the first sits beside the badges)
 *   hidden:  [ids…]                 buttons not shown at all
 *   show:    { <id>: icon | text }  a button drawn as its icon alone, or as its label alone — absent
 *                                   means both, which is what every button is until someone says
 *   menus:   { <id>: { groups, columns: [[groups…], …], order: { <group>: [entries] }, hidden_groups, hidden_entries } }
 *   custom:  [action…]              actions someone added (below)
 *
 * An action borrows Rundeck's job model, cut down to one user on one machine:
 *
 *   id, label, button, group, description
 *   when:      [ddev, composer, "!workspace:products"]   every clause must match; ! negates (a node filter)
 *   options:   [{ name, label, value, values, enforced, required, regex }]   asked for before it runs
 *   steps:     ["cmd", { command, on_error }, { use }]     or a single `command`; `use: <id>` runs a command of the
 *              catalog (commands.js) on the row's project
 *   keepgoing: false → stop at the first failed step; true → run them all and say which failed
 *   confirm:   true → asks in a dialog first, like every destructive entry in the dashboard
 *   open:      toast (the default: a line at the top links to the session) | screen (its terminal opens at once)
 *
 * A value reaches a step only through {{opt.name}}, checked against the option and put in single quotes.
 * No step can contain $ or a backtick: the screen runner hands the whole line to an outer shell, which
 * would expand them before the step runs. Every run is recorded (row-actions.history.jsonl) and its result
 * read back from the markers its line prints.
 *
 * Every menu is rearranged the same way, without each menu knowing: its <ul class="uk-dropdown-nav">
 * is split into top-level <li>, a group starts at a header or after a divider, and a group is named by
 * its header's data-group, else the header text before " · ". An entry is named by its data-entry, else
 * its text. Markup this cannot split cleanly is returned untouched, so a menu is never broken by it.
 * Hiding is presentation only: a hidden entry's route still answers, exactly as it did before. The dashboard's
 * own commands can be moved and hidden, never deleted; only actions someone added can be edited or deleted.
 *
 * What the page can offer to reorder or hide is what has been SEEN on project rows: every menu this
 * rearranges is recorded in core/config/row-actions.seen.json.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const { esc } = require('./html');
const { CONFIG_DIR, ROOT } = require('./workspaces');

const BUILTIN_BUTTONS = [
  { id: 'ddev', label: 'DDEV', row: 0 },
  { id: 'tests', label: 'Tests', row: 0 },
  // These three lay out their own menus (SCREENS is filled in by a request), so they take no column setting.
  { id: 'screens', label: 'SCREENS', row: 1, columns: false },
  { id: 'composer', label: 'COMPOSER', row: 1, columns: false },
  { id: 'node', label: 'NODE', row: 1, columns: false },
  // Single buttons, with no menu inside to arrange or to add actions to.
  { id: 'backup', label: 'Backup', row: 1, menu: false },
  { id: 'clone', label: 'Clone', row: 1, menu: false },
  { id: 'graph', label: 'Graph', row: 1 },
  { id: 'rag', label: 'RAG', row: 1 },
  { id: 'more', label: 'More', row: 1 },
];
const BUILTIN_IDS = new Set(BUILTIN_BUTTONS.map((b) => b.id));
const DEFAULT_ROWS = [0, 1].map((row) => BUILTIN_BUTTONS.filter((b) => b.row === row).map((b) => b.id));

/** A button a plugin adds (plugin-loader's addRowMenu): known to the layout like a built-in one. */
function registerButton(spec) {
  if (BUILTIN_IDS.has(spec.id)) return;
  const row = spec.row === 1 ? 1 : 0;
  const entry = { id: spec.id, label: spec.label || spec.id, row };
  if (spec.columns === false) entry.columns = false;
  if (spec.menu === false) entry.menu = false;
  BUILTIN_BUTTONS.push(entry);
  BUILTIN_IDS.add(spec.id);
  DEFAULT_ROWS[row].push(spec.id);
}
const MAX_ROWS = 6;
const MAX_COLUMNS = 4;

// The base clauses of `when`. Each can take a ! in front, and workspace:<name> matches one workspace.
const WHENS = {
  any: 'every folder',
  ddev: 'DDEV projects',
  composer: 'folders with a composer.json',
  node: 'folders with a package.json',
  git: 'folders with their own .git',
};

const ID_RE = /^[a-z][a-z0-9-]{0,30}$/;
const CUSTOM_ID_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;
// A label goes into the session's closing echo "…" as well as the page: no quote, $, backtick or backslash.
const LABEL_RE = /^[A-Za-z0-9 _.()+:/@#,&-]{1,60}$/;
const GROUP_RE = /^[A-Za-z0-9 _.()+:/-]{1,40}$/;
const KEY_RE = /^[^\r\n<>]{1,120}$/;
const WHEN_RE = /^!?(any|ddev|composer|node|git|workspace:[a-z0-9_-]{1,40})$/;
const OPTION_NAME_RE = /^[a-z][a-z0-9_]{0,30}$/;
const PLACEHOLDER_RE = /\{\{opt\.([a-z][a-z0-9_]{0,30})\}\}/g;
// A step that uses a command of the catalog names it by its id (commands.js).
const USE_RE = /^[a-z0-9][a-z0-9-]{0,44}$/;

const lc = (s) => String(s).toLowerCase();

// YAML aliases let a few lines stand for billions of values (each level pointing at the one below nine times).
// Anything walking such a document — or turning one of its lists into text — never finishes, and this
// dashboard serves every page from one thread. A definition is walked here first, visit by visit, and refused
// once it passes a size no real layout comes near.
const MAX_DEFINITION_NODES = 50000;
function withinBudget(value, budget = MAX_DEFINITION_NODES) {
  const stack = [value];
  let visits = 0;
  while (stack.length) {
    const v = stack.pop();
    visits += 1;
    if (visits > budget) return false;
    if (Array.isArray(v)) { for (let i = 0; i < v.length; i += 1) stack.push(v[i]); } else if (v && typeof v === 'object') { for (const k of Object.keys(v)) stack.push(v[k]); }
  }
  return true;
}
const hasMenu = (id) => (BUILTIN_BUTTONS.find((b) => b.id === id) || {}).menu !== false;
const takesColumns = (id) => hasMenu(id) && (BUILTIN_BUTTONS.find((b) => b.id === id) || {}).columns !== false;

function layoutFile() { return process.env.ROW_ACTIONS_FILE || path.join(CONFIG_DIR, 'row-actions.yml'); }
function seenFile() { return process.env.ROW_ACTIONS_SEEN_FILE || path.join(CONFIG_DIR, 'row-actions.seen.json'); }
function historyFile() { return process.env.ROW_ACTIONS_HISTORY_FILE || path.join(CONFIG_DIR, 'row-actions.history.jsonl'); }

// ---------------------------------------------------------------- actions

function whenList(w) {
  const list = Array.isArray(w) ? w : [w];
  const out = list.map((x) => (x === undefined || x === null ? '' : String(x).trim())).filter(Boolean);
  return out.length ? out : ['any'];
}

function describeWhen(list) {
  return whenList(list).map((c) => {
    const neg = c.startsWith('!');
    const k = neg ? c.slice(1) : c;
    const text = k.startsWith('workspace:') ? `the ${k.slice(10)} workspace` : (WHENS[k] || k);
    return neg ? `not ${text}` : text;
  }).join(' and ');
}

function whenMatches(when, ctx = {}) {
  return whenList(when).every((c) => {
    const neg = c.startsWith('!');
    const k = neg ? c.slice(1) : c;
    let v;
    if (k === 'any') v = true;
    else if (k.startsWith('workspace:')) v = ctx.key === k.slice(10);
    else v = !!({ ddev: ctx.isDdev, composer: ctx.hasComposer, node: ctx.hasNode, git: ctx.hasGit })[k];
    return neg ? !v : v;
  });
}

function cleanCustom(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) return null;
  const str = (v) => (v === undefined || v === null ? '' : String(v)).trim();
  const rawSteps = Array.isArray(c.steps) ? c.steps : (c.command !== undefined ? [c.command] : []);
  const steps = rawSteps.map((s) => ((s && typeof s === 'object')
    ? { command: str(s.command), onError: str(s.on_error !== undefined ? s.on_error : s.onError), use: str(s.use) }
    : { command: str(s), onError: '', use: '' }));
  const options = (Array.isArray(c.options) ? c.options : []).map((o) => ((o && typeof o === 'object') ? {
    name: str(o.name),
    label: str(o.label),
    value: str(o.value),
    values: Array.isArray(o.values) ? o.values.map(str) : [],
    enforced: o.enforced === true,
    required: o.required === true,
    regex: str(o.regex),
  } : null));
  return {
    id: str(c.id),
    label: str(c.label),
    button: lc(str(c.button)),
    group: str(c.group) || 'Custom',
    description: str(c.description),
    when: whenList(c.when),
    confirm: c.confirm === true,
    keepgoing: c.keepgoing === true,
    open: c.open === 'screen' ? 'screen' : 'toast',
    steps,
    options,
  };
}

function commandRefusal(cmd, what) {
  if (!cmd || cmd.length > 400) return `${what} is one line of up to 400 characters`;
  if (/[\r\n\0]/.test(cmd)) return `${what} must be one line`;
  if (/[$`]/.test(cmd)) {
    return `${what} cannot contain $ or a backtick: the screen runner hands the line to an outer shell, which would expand them before it runs (for a value, use an option and {{opt.name}})`;
  }
  return '';
}

function valueRefusal(v, what) {
  if (String(v).length > 200) return `${what} is up to 200 characters`;
  if (/[\r\n\0$`]/.test(v)) return `${what} cannot contain $, a backtick or a line break`;
  return '';
}

/** Why this action must not be saved or run, or '' when it may. */
function customRefusal(e) {
  if (!e) return 'it is not an action (a mapping with id, label, button, steps…)';
  if (!CUSTOM_ID_RE.test(e.id)) return 'the id is lower-case letters, digits and dashes';
  if (!LABEL_RE.test(e.label)) return 'the label is letters, digits, spaces and . ( ) + : / @ # , & - (up to 60)';
  if (!ID_RE.test(e.button)) return 'the button is a lower-case name, like ddev, composer or tools';
  if (!hasMenu(e.button)) return `${buttonLabel(e.button)} is a single button with no menu — put the action in More, or in a button of your own`;
  if (!GROUP_RE.test(e.group)) return 'the group is letters, digits and spaces (up to 40)';
  if (e.description.length > 200 || /[\r\n]/.test(e.description)) return 'the description is one line of up to 200 characters';
  if (e.when.some((w) => !WHEN_RE.test(w))) return '"when" is any, ddev, composer, node, git or workspace:<name>, each optionally with ! in front';
  if (!e.steps.length || e.steps.length > 20) return 'an action has 1 to 20 steps';
  for (const [i, s] of e.steps.entries()) {
    const what = e.steps.length === 1 ? 'the command' : `step ${i + 1}`;
    if (s.use && s.command) return `${what} has both use and a command line — a step is one or the other`;
    if (s.use && !USE_RE.test(s.use)) return `${what} uses "${s.use}", which is not a command id`;
    const r = (s.use ? '' : commandRefusal(s.command, what)) || (s.onError ? commandRefusal(s.onError, `${what}'s on_error`) : '');
    if (r) return r;
  }
  if (e.options.length > 10) return 'an action asks for up to 10 options';
  const names = new Set();
  for (const o of e.options) {
    if (!o) return 'an option is a mapping: name, and optionally label, value, values, enforced, required, regex';
    if (!OPTION_NAME_RE.test(o.name) || names.has(o.name)) return `option names are unique lower-case names (${o.name || 'empty'})`;
    names.add(o.name);
    if (o.label && !LABEL_RE.test(o.label)) return `option ${o.name}: the label is letters, digits and spaces (up to 60)`;
    if (o.values.length > 50) return `option ${o.name}: up to 50 values`;
    for (const v of [o.value, ...o.values]) { const r = valueRefusal(v, `option ${o.name}`); if (r) return r; }
    if (o.enforced && !o.values.length) return `option ${o.name} is enforced but lists no values`;
    if (o.regex) {
      if (o.regex.length > 200) return `option ${o.name}: the regex is up to 200 characters`;
      try { new RegExp(o.regex); } catch (_) { return `option ${o.name}: the regex does not compile`; }
    }
  }
  for (const s of e.steps) {
    for (const t of [s.command, s.onError]) {
      for (const m of t.matchAll(PLACEHOLDER_RE)) if (!names.has(m[1])) return `{{opt.${m[1]}}} is used but there is no option called ${m[1]}`;
    }
  }
  return '';
}

/** Why this value must not be used for this option, or '' when it may. */
function optionValueRefusal(o, raw) {
  const v = raw === undefined || raw === null ? '' : String(raw);
  const name = o.label || o.name;
  if (!v) return o.required ? `${name} is required` : '';
  const r = valueRefusal(v, name);
  if (r) return r;
  if (o.enforced && !o.values.includes(v)) return `${name} must be one of: ${o.values.join(', ')}`;
  if (o.regex && !new RegExp(o.regex).test(v)) return `${name} does not match ${o.regex}`;
  return '';
}

/** The values a run uses: what was submitted, else each option's default — or the first thing wrong. */
function resolveOptions(entry, form = {}) {
  const values = {};
  for (const o of entry.options) {
    const given = form[`opt_${o.name}`];
    const v = (given === undefined || given === null || String(given) === '') ? o.value : String(given);
    const why = optionValueRefusal(o, v);
    if (why) return { error: why };
    values[o.name] = v;
  }
  return { values };
}

const shq = (v) => `'${String(v).replace(/'/g, "'\\''")}'`;

/**
 * The line an action runs. Steps are joined with && (stop at the first failure) or run one after another
 * (keepgoing); a step's on_error runs when it fails and its result becomes the step's, as in Rundeck.
 * The markers it prints are how the Activity tab knows what happened, without reading an exit code — `$?`
 * is not available to a line that may not contain `$`.
 */
function actionCommandLine(entry, values = {}) {
  const fill = (cmd) => cmd.replace(PLACEHOLDER_RE, (_, n) => shq(values[n] === undefined ? '' : values[n]));
  const parts = entry.steps.map((s, i) => {
    const run = `{ ${fill(s.command)} ; }`;
    const handled = s.onError
      ? `{ ${run} || { echo "ROW-ACTION step ${i + 1} failed: running its on_error" ; ${fill(s.onError)} ; } ; }`
      : run;
    return entry.keepgoing ? `{ ${handled} || echo "ROW-ACTION step ${i + 1} failed" ; }` : handled;
  });
  return `{ ${parts.join(entry.keepgoing ? ' ; ' : ' && ')} ; } && echo "ROW-ACTION succeeded" || echo "ROW-ACTION failed"`;
}

/** What a run's output says happened. */
function runStatus(text, live) {
  const t = String(text || '');
  const failedSteps = [...t.matchAll(/ROW-ACTION step (\d+) failed(?!:)/g)].map((m) => m[1]);
  if (/ROW-ACTION failed/.test(t)) return { state: 'failed', note: '' };
  if (/ROW-ACTION succeeded/.test(t)) {
    return failedSteps.length ? { state: 'partly', note: `step ${failedSteps.join(', ')} failed` } : { state: 'succeeded', note: '' };
  }
  return live ? { state: 'running', note: '' } : { state: 'unknown', note: 'no result in its output' };
}

function slug(label) {
  return lc(label).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'action';
}

// ---------------------------------------------------------------- steps that use a command

// commands.js requires this file, so the catalog is required when it is first needed rather than at the top.
const catalog = () => require('./commands');

/** A step as a person writes it in the steps box: its command line, or use: <command id>. */
function stepText(s) {
  return s.use ? `use: ${s.use}` : s.command;
}

/** The commands an action's steps use, in order; `cmd` is null for one that is not in the catalog. */
function usedCommands(entry) {
  return entry.steps.filter((s) => s.use).map((s) => ({ id: s.use, cmd: catalog().findCommand(s.use) }));
}

/** Why an action's use: steps cannot run from a project row, or '' when they can. */
function useRefusal(entry) {
  for (const [i, s] of entry.steps.entries()) {
    if (!s.use) continue;
    const cmd = catalog().findCommand(s.use);
    if (!cmd) return `step ${i + 1} uses ${s.use}, which is not a command (it may have been deleted)`;
    if (cmd.on === 'file') return `step ${i + 1} uses ${cmd.label}, which runs on a file, and a project row gives no file to run it on`;
  }
  return '';
}

/** The options a run asks for: the action's own, then those of the commands it uses (the action's own win a shared name). */
function effectiveOptions(entry) {
  const out = entry.options.filter(Boolean);
  const names = new Set(out.map((o) => o.name));
  for (const { cmd } of usedCommands(entry)) {
    for (const o of (cmd ? cmd.options : [])) {
      if (o && !names.has(o.name)) { names.add(o.name); out.push(o); }
    }
  }
  return out;
}

/** The command picker of an "Add an action" box: every command a project row can run. */
function commandPickerHtml(name) {
  const usable = catalog().loadCatalog().commands.filter((c) => c.on !== 'file');
  const groups = [...new Set(usable.map((c) => c.group))];
  return `<label>Use a command <select class="uk-select uk-form-small" name="${name}">
        <option value="">None — type the commands below</option>
        ${groups.map((g) => `<optgroup label="${esc(g)}">${usable.filter((c) => c.group === g)
          .map((c) => `<option value="${esc(c.id)}">${esc(c.label)}</option>`).join('')}</optgroup>`).join('')}
      </select></label>`;
}

// ---------------------------------------------------------------- the layout

/** A layout from whatever the file held: unknown ids dropped, every button placed exactly once. */
function normalizeLayout(raw) {
  const r = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
  const strList = (v, re) => (Array.isArray(v) ? v : [])
    .filter((x) => typeof x === 'string' || typeof x === 'number').map((x) => String(x).trim()).filter((x) => re.test(x));

  const custom = [];
  const customIds = new Set();
  for (const c of Array.isArray(r.custom) ? r.custom : []) {
    const e = cleanCustom(c);
    if (!e || customRefusal(e) || customIds.has(e.id)) continue;
    customIds.add(e.id);
    custom.push(e);
  }
  const customButtons = [...new Set(custom.map((c) => c.button).filter((b) => !BUILTIN_IDS.has(b)))];
  const known = new Set([...BUILTIN_IDS, ...customButtons]);

  const placed = new Set();
  const hidden = strList(r.hidden, ID_RE).filter((id) => known.has(id) && !placed.has(id) && placed.add(id));
  // `lines` is what the first version of this file called rows.
  const rawRows = (Array.isArray(r.rows) ? r.rows : (Array.isArray(r.lines) ? r.lines : [])).slice(0, MAX_ROWS);
  const rows = rawRows.map((row) => strList(Array.isArray(row) ? row : [], ID_RE).filter((id) => known.has(id) && !placed.has(id) && placed.add(id)));
  if (!rows.length) rows.push([]);
  // A button the file does not mention — new since it was saved, or never moved — keeps its default row.
  for (const b of BUILTIN_BUTTONS) {
    if (placed.has(b.id)) continue;
    while (rows.length <= b.row) rows.push([]);
    rows[b.row].push(b.id);
    placed.add(b.id);
  }
  for (const id of customButtons) {
    if (placed.has(id)) continue;
    rows[Math.min(1, rows.length - 1)].push(id);
    placed.add(id);
  }

  const menus = {};
  const rawMenus = (r.menus && typeof r.menus === 'object') ? r.menus : {};
  for (const [id, m] of Object.entries(rawMenus)) {
    if (!ID_RE.test(id) || !m || typeof m !== 'object') continue;
    menus[id] = {
      groups: strList(m.groups, KEY_RE).map(lc),
      hiddenGroups: strList(m.hidden_groups, KEY_RE).map(lc),
      hiddenEntries: strList(m.hidden_entries, KEY_RE).map(lc),
      columns: (Array.isArray(m.columns) ? m.columns : []).slice(0, MAX_COLUMNS).map((col) => strList(Array.isArray(col) ? col : [], KEY_RE).map(lc)),
      order: Object.fromEntries(Object.entries((m.order && typeof m.order === 'object' && !Array.isArray(m.order)) ? m.order : {})
        .filter(([g]) => KEY_RE.test(g)).map(([g, keys]) => [lc(g), strList(keys, KEY_RE).map(lc)]).filter(([, keys]) => keys.length)),
    };
  }
  // How much of a button is drawn. The same three answers the navigation gives, and deliberately the
  // same word for them: a row of buttons and a rail of entries are the same question about room.
  const show = Object.fromEntries(Object.entries((r.show && typeof r.show === 'object' && !Array.isArray(r.show)) ? r.show : {})
    .filter(([id, how]) => ID_RE.test(id) && known.has(id) && (how === 'icon' || how === 'text')));

  return { rows, hidden, show, menus, custom };
}

function customToDoc(c) {
  const doc = { id: c.id, label: c.label, button: c.button, group: c.group };
  if (c.description) doc.description = c.description;
  doc.when = c.when.length === 1 ? c.when[0] : [...c.when];
  if (c.confirm) doc.confirm = true;
  if (c.keepgoing) doc.keepgoing = true;
  if (c.open === 'screen') doc.open = 'screen';
  if (c.options.length) {
    doc.options = c.options.map((o) => {
      const od = { name: o.name };
      if (o.label) od.label = o.label;
      if (o.value) od.value = o.value;
      if (o.values.length) od.values = [...o.values];
      if (o.enforced) od.enforced = true;
      if (o.required) od.required = true;
      if (o.regex) od.regex = o.regex;
      return od;
    });
  }
  const stepDoc = (s) => {
    if (s.use) return s.onError ? { use: s.use, on_error: s.onError } : { use: s.use };
    return s.onError ? { command: s.command, on_error: s.onError } : s.command;
  };
  if (c.steps.length === 1 && !c.steps[0].onError && !c.steps[0].use) doc.command = c.steps[0].command;
  else doc.steps = c.steps.map(stepDoc);
  return doc;
}

/** The layout as the file stores it. */
function toDoc(layout) {
  return {
    rows: layout.rows.map((l) => [...l]),
    hidden: [...layout.hidden],
    ...(Object.keys(layout.show || {}).length ? { show: { ...layout.show } } : {}),
    menus: Object.fromEntries(Object.entries(layout.menus)
      .filter(([, m]) => m.groups.length || m.hiddenGroups.length || m.hiddenEntries.length
        || Object.keys(m.order || {}).length || (m.columns && m.columns.length > 1))
      .map(([id, m]) => [id,
      { groups: [...m.groups], hidden_groups: [...m.hiddenGroups], hidden_entries: [...m.hiddenEntries],
        ...(m.columns && m.columns.length > 1 ? { columns: m.columns.map((c) => [...c]) } : {}),
        ...(Object.keys(m.order || {}).length ? { order: Object.fromEntries(Object.entries(m.order).map(([g, k]) => [g, [...k]])) } : {}) }])),
    custom: layout.custom.map(customToDoc),
  };
}

function knownButtonIds(layout) {
  return [...BUILTIN_IDS, ...new Set(layout.custom.map((c) => c.button).filter((b) => !BUILTIN_IDS.has(b)))];
}

function buttonLabel(id) {
  return (BUILTIN_BUTTONS.find((b) => b.id === id) || { label: String(id).toUpperCase() }).label;
}

let cache = { at: 0, mtime: -1, file: '', layout: null };

function layoutMtime() {
  try { return fs.statSync(layoutFile()).mtimeMs; } catch (_) { return 0; }
}

/** The current layout, re-read at most every 2s (like workspaces.js) and whenever the file changes. */
function loadRowLayout() {
  const file = layoutFile();
  const now = Date.now();
  if (cache.layout && cache.file === file && now - cache.at < 2000) return cache.layout;
  const mtime = layoutMtime();
  if (cache.layout && cache.file === file && cache.mtime === mtime) { cache.at = now; return cache.layout; }
  let raw = {};
  let error = '';
  if (mtime) {
    try { raw = yaml.load(fs.readFileSync(file, 'utf8')) || {}; } catch (err) { raw = {}; error = String(err.message || err).split('\n')[0]; }
    if (!error && !withinBudget(raw)) { raw = {}; error = 'it is too large or too deeply nested to be a layout'; }
  }
  const layout = normalizeLayout(raw);
  layout.error = error;
  cache = { at: now, mtime, file, layout };
  return layout;
}

function invalidateRowLayout() { cache = { at: 0, mtime: -1, file: '', layout: null }; }

function loadRowLayoutFresh() { invalidateRowLayout(); return loadRowLayout(); }

function refuseIfChanged(expectedMtime) {
  if (expectedMtime === undefined || expectedMtime === null || String(expectedMtime) === '') return;
  if (Number(expectedMtime) !== layoutMtime()) {
    const err = new Error('row-actions.yml changed since this page was loaded');
    err.code = 'CHANGED';
    throw err;
  }
}

const HEADER = '# Rows management for project rows (see core/workspace-app/row-layout.js).\n'
  + '# Written by Commands → Buttons; a hand edit works too. Delete this file to go back to the defaults.\n';

/** Write the layout. Refuses when the file changed since `expectedMtime` (the mtime the form was drawn with). */
function saveRowLayout(layout, expectedMtime) {
  refuseIfChanged(expectedMtime);
  const file = layoutFile();
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, HEADER + yaml.dump(toDoc(layout), { lineWidth: 120 }));
  fs.renameSync(tmp, file);
  invalidateRowLayout();
  return layoutMtime();
}

function resetRowLayout(expectedMtime) {
  refuseIfChanged(expectedMtime);
  try { fs.unlinkSync(layoutFile()); } catch (_) { /* already the defaults */ }
  invalidateRowLayout();
}

/** The file as text, or what it would be with the defaults. */
function definitionText() {
  try { return fs.readFileSync(layoutFile(), 'utf8'); } catch (_) {
    return HEADER + yaml.dump(toDoc(normalizeLayout({})), { lineWidth: 120 });
  }
}

/**
 * What loading a pasted definition would do, like `rd jobs load`: `replace` takes the whole file; `skip` and
 * `update` take only its actions, and do that to an id that already exists (Rundeck's duplicate option —
 * skip is the default here, so loading the same file twice never doubles an action). Nothing is written.
 */
function checkDefinition(text, mode, current) {
  const report = { errors: [], notes: [], next: null };
  if (!String(text || '').trim()) {
    report.errors.push('The definition is empty. To go back to the defaults, use Reset to the defaults below.');
    return report;
  }
  let raw;
  try { raw = yaml.load(String(text || '')); } catch (err) {
    report.errors.push(`The YAML does not parse: ${String(err.message || err).split('\n')[0]}`);
    return report;
  }
  if (raw === undefined || raw === null) raw = {};
  if (!withinBudget(raw)) {
    report.errors.push('The definition is too large or too deeply nested to be a layout (YAML aliases can make a few lines stand for billions of values).');
    return report;
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    report.errors.push('The top level is a mapping with rows, hidden, menus and custom.');
    return report;
  }
  if (raw.custom !== undefined && !Array.isArray(raw.custom)) {
    report.errors.push('custom is a list of actions.');
    return report;
  }
  const incoming = (raw.custom || []).map((c, i) => ({ i, e: cleanCustom(c) }));
  const seenIds = new Set();
  for (const { i, e } of incoming) {
    const why = customRefusal(e);
    if (why) report.errors.push(`Action ${i + 1}${e && e.id ? ` (${e.id})` : ''}: ${why}.`);
    else if (seenIds.has(e.id)) report.errors.push(`Action ${i + 1}: the id ${e.id} is used twice.`);
    else seenIds.add(e.id);
  }
  for (const { i, e } of incoming) {
    const why = report.errors.length ? '' : useRefusal(e);
    if (why) report.errors.push(`Action ${i + 1} (${e.id}): ${why}.`);
  }
  if (report.errors.length) return report;

  const actions = incoming.map((x) => x.e);
  if (mode === 'skip' || mode === 'update') {
    const doc = toDoc(current);
    let added = 0; let updated = 0; let skipped = 0;
    for (const e of actions) {
      const at = doc.custom.findIndex((c) => c.id === e.id);
      if (at < 0) { doc.custom.push(customToDoc(e)); added += 1; } else if (mode === 'update') { doc.custom[at] = customToDoc(e); updated += 1; } else skipped += 1;
    }
    report.notes.push(`${added} action(s) added, ${updated} updated, ${skipped} skipped because the id already exists.`);
    if (raw.rows || raw.lines || raw.hidden || raw.menus) report.notes.push('Its rows, hidden buttons and menus are not loaded in this mode — choose "replace" for those.');
    report.next = normalizeLayout(doc);
  } else {
    const next = normalizeLayout(raw);
    const known = new Set(knownButtonIds(next));
    const named = [...(Array.isArray(raw.rows) ? raw.rows : (Array.isArray(raw.lines) ? raw.lines : [])).flat(), ...(Array.isArray(raw.hidden) ? raw.hidden : [])]
      .filter((x) => typeof x === 'string' || typeof x === 'number').map(String);
    const unknown = [...new Set(named.filter((id) => !known.has(id)))];
    if (unknown.length) report.notes.push(`Not a button, so ignored: ${unknown.join(', ')}.`);
    if ((Array.isArray(raw.rows) ? raw.rows : []).length > MAX_ROWS) report.notes.push(`Only the first ${MAX_ROWS} rows are kept.`);
    report.notes.push(`${next.rows.length} row(s), ${next.hidden.length} hidden button(s), ${next.custom.length} action(s).`);
    report.next = next;
  }
  return report;
}

// ---------------------------------------------------------------- what has been seen

const seen = { data: null, timer: null };

function loadSeen() {
  if (!seen.data) {
    try { seen.data = JSON.parse(fs.readFileSync(seenFile(), 'utf8')) || {}; } catch (_) { seen.data = {}; }
  }
  return seen.data;
}

function flushSeenSoon() {
  if (seen.timer) return;
  seen.timer = setTimeout(() => {
    seen.timer = null;
    try { fs.writeFileSync(seenFile(), JSON.stringify(seen.data, null, 1)); } catch (_) { /* the page lists less, nothing breaks */ }
  }, 1500);
  if (seen.timer.unref) seen.timer.unref();
}

// Bounded: a SCREENS menu names every session it has ever listed, and that must not grow for ever.
const MAX_GROUPS = 60;
const MAX_ENTRIES = 80;

function recordSeen(menuId, groups) {
  const all = loadSeen();
  const menu = all[menuId] || (all[menuId] = { groups: {} });
  let dirty = false;
  for (const g of groups) {
    if (!g.key) continue;
    let rec = menu.groups[g.key];
    // After the first page load almost every entry is already on record: its text is only read when it is new.
    // Reading it for every entry of every menu of every row was most of what arranging a page cost.
    if (!rec) {
      if (Object.keys(menu.groups).length >= MAX_GROUPS) continue;
      // A group named by data-group has a header that changes from row to row (a project name, a server);
      // it is listed by that name, not by whichever project happened to show it first.
      const named = g.header && /\bdata-group="/.test(g.header) && lc(plainText(g.header)) !== g.key;
      rec = { label: named ? g.key.replace(/^./, (c) => c.toUpperCase()) : plainText(g.header || g.entries[0] || ''), entries: {} };
      menu.groups[g.key] = rec;
      dirty = true;
    }
    let count = Object.keys(rec.entries).length;
    g.entries.forEach((li, i) => {
      const k = g.keys ? g.keys[i] : entryKey(li);
      if (!k || rec.entries[k] || count >= MAX_ENTRIES) return;
      const t = plainText(li).slice(0, 120);
      if (!t) return;
      rec.entries[k] = t;
      count += 1;
      dirty = true;
    });
  }
  if (dirty) flushSeenSoon();
}

function seenMenu(menuId) {
  const m = loadSeen()[menuId];
  return { groups: (m && m.groups) || {} };
}

// ---------------------------------------------------------------- run history

function recordRun(run) {
  const file = historyFile();
  try {
    fs.appendFileSync(file, `${JSON.stringify(run)}\n`);
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    if (lines.length > 400) fs.writeFileSync(file, `${lines.slice(-300).join('\n')}\n`);
  } catch (_) { /* the Activity tab shows less, nothing breaks */ }
}

function readRuns() {
  try {
    return fs.readFileSync(historyFile(), 'utf8').split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean);
  } catch (_) { return []; }
}

function sessionLog(session) {
  try {
    const file = path.join(ROOT, '.screens', `${session}.log`);
    const size = fs.statSync(file).size;
    const len = Math.min(size, 512 * 1024);
    const fd = fs.openSync(file, 'r');
    try { const buf = Buffer.alloc(len); fs.readSync(fd, buf, 0, len, size - len); return buf.toString('utf8'); } finally { fs.closeSync(fd); }
  } catch (_) { return ''; }
}

function liveSessions() {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(ROOT, '.screens', 'host-sessions.json'), 'utf8'));
    return new Set((j.sessions || []).map((s) => s.session));
  } catch (_) { return new Set(); }
}

/**
 * Before a session's log is truncated by the next run of the same action, write down how the last run
 * ended — otherwise its line in Activity would start describing the new run.
 */
function settleRun(session) {
  const runs = readRuns();
  let i = runs.length - 1;
  while (i >= 0 && runs[i].session !== session) i -= 1;
  if (i < 0 || runs[i].status) return;
  // Only a run whose output already says how it ended. A request that is refused because the last run is still
  // going comes through here too, and used to write that run down as "unknown" for good, mid-run.
  const text = sessionLog(session);
  if (!/ROW-ACTION (succeeded|failed)/.test(text)) return;
  runs[i].status = runStatus(text, false);
  try { fs.writeFileSync(historyFile(), `${runs.map((r) => JSON.stringify(r)).join('\n')}\n`); } catch (_) { /* best effort */ }
}

// ---------------------------------------------------------------- rearranging a menu

function plainText(html) {
  return String(html)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

const keyText = (s) => lc(s).replace(/[<>]/g, '').replace(/\s*\(running(…|\.\.\.)\)\s*$/, '').trim().slice(0, 120);

function entryKey(liHtml) {
  const m = /\bdata-entry="([^"]+)"/.exec(liHtml);
  return m ? keyText(m[1]) : keyText(plainText(liHtml));
}

function groupKeyOf(headerHtml) {
  const m = /\bdata-group="([^"]+)"/.exec(headerHtml);
  return m ? keyText(m[1]) : keyText(plainText(headerHtml).split(' · ')[0]);
}

/** The top-level <li> of a menu, or null when the markup has anything else in it that could be lost. */
function splitTopLevelLi(inner) {
  const src = String(inner).replace(/<!--[\s\S]*?-->/g, '');
  const out = [];
  const re = /<li\b[^>]*>|<\/li>/gi;
  let depth = 0;
  let start = -1;
  let last = 0;
  let stray = '';
  let m;
  while ((m = re.exec(src))) {
    if (m[0][1] !== '/') {
      if (depth === 0) { stray += src.slice(last, m.index); start = m.index; }
      depth += 1;
    } else if (depth > 0) {
      depth -= 1;
      if (depth === 0) { out.push(src.slice(start, re.lastIndex)); last = re.lastIndex; }
    }
  }
  stray += depth === 0 ? src.slice(last) : 'unclosed';
  return stray.trim() ? null : out;
}

const isDivider = (li) => /^<li\b[^>]*\bclass="[^"]*\buk-nav-divider\b/i.test(li);
const isHeader = (li) => /^<li\b[^>]*\bclass="[^"]*\buk-nav-header\b/i.test(li);

function customEntryHtml(c, ctx) {
  const vals = `hx-vals='{"workspace":"${esc(ctx.key || '')}","projectName":"${esc(ctx.project || '')}","id":"${esc(c.id)}"}'`;
  const title = esc(c.description || c.steps.map(stepText).join(' → '));
  const icon = '<span uk-icon="icon: play-circle; ratio: .7"></span>';
  if (effectiveOptions(c).length) {
    // Rundeck asks for a job's options before it runs; so does this, in the dashboard's one modal.
    return `<li><a href hx-post="/actions/row-custom-options" ${vals} hx-target="#editor-modal-body" hx-swap="innerHTML"
      hx-on::after:request="UIkit.modal('#editor-modal').show()" data-entry="custom-${esc(c.id)}" title="${title}">${icon} ${esc(c.label)}…</a></li>`;
  }
  const arm = c.confirm ? ' class="arm-step" hx-trigger="confirmed-remove"' : '';
  return `<li><a href hx-post="/actions/row-custom-run" ${vals} hx-target="#webship-workspace-output" hx-swap="innerHTML"${arm} data-entry="custom-${esc(c.id)}" title="${title}">${icon} ${esc(c.label)}</a></li>`;
}

/**
 * One menu's list, rearranged: groups in the saved order (the rest after, as they were), hidden groups
 * and entries left out, and this button's actions added to their group.
 */
function arrangeNavInner(menuId, inner, ctx = {}) {
  const layout = ctx.layout || loadRowLayout();
  const lis = splitTopLevelLi(inner);
  if (!lis) return inner;

  const groups = [];
  let cur = null;
  for (const li of lis) {
    if (isDivider(li)) { cur = null; continue; }
    if (isHeader(li)) { cur = { header: li, entries: [] }; groups.push(cur); continue; }
    if (!cur) { cur = { header: null, entries: [] }; groups.push(cur); }
    cur.entries.push(li);
  }
  for (const g of groups) {
    g.keys = g.entries.map(entryKey);
    g.key = g.header ? groupKeyOf(g.header) : (g.keys[0] || '');
    g.hadEntries = g.entries.length > 0;
  }
  recordSeen(menuId, groups);

  // Nothing saved for this menu and no action of yours in it: it is shown exactly as it was rendered.
  if (!layout.menus[menuId] && (ctx.withCustom === false || !layout.custom.some((c) => c.button === menuId))) return inner;

  const m = layout.menus[menuId] || { groups: [], hiddenGroups: [], hiddenEntries: [], order: {}, columns: [] };
  const hideGroups = new Set(m.hiddenGroups);
  const hideEntries = new Set(m.hiddenEntries);
  let kept = groups
    .filter((g) => !hideGroups.has(g.key))
    .map((g) => {
      const keep = g.entries.map((li, i) => !hideEntries.has(g.keys[i]));
      return { ...g, entries: g.entries.filter((_, i) => keep[i]), keys: g.keys.filter((_, i) => keep[i]) };
    })
    // A group whose every entry is hidden goes with them; a header that never had entries (a note) stays.
    .filter((g) => g.entries.length || (g.header && !g.hadEntries));

  if (ctx.withCustom !== false) {
    for (const c of layout.custom) {
      if (c.button !== menuId || !whenMatches(c.when, ctx)) continue;
      const gk = keyText(c.group);
      if (hideGroups.has(gk) || hideEntries.has(`custom-${c.id}`)) continue;
      let g = kept.find((x) => x.key === gk);
      if (!g) {
        g = { key: gk, header: `<li class="uk-nav-header" data-group="${esc(gk)}">${esc(c.group)}</li>`, entries: [], keys: [], hadEntries: true };
        kept.push(g);
      }
      g.entries.push(customEntryHtml(c, ctx));
      g.keys.push(`custom-${c.id}`);
    }
  }

  // The saved order of the entries inside each group — the dashboard's commands and your actions alike.
  for (const g of kept) {
    const o = (m.order || {})[g.key];
    if (!o || !o.length) continue;
    const pos = (k) => { const i = o.indexOf(k); return i < 0 ? o.length : i; };
    const sorted = g.entries.map((li, i) => ({ li, k: g.keys[i], i })).sort((a, b) => pos(a.k) - pos(b.k) || a.i - b.i);
    g.entries = sorted.map((x) => x.li);
    g.keys = sorted.map((x) => x.k);
  }
  const rank = (g) => { const i = m.groups.indexOf(g.key); return i < 0 ? m.groups.length : i; };
  kept = kept.map((g, i) => ({ g, i })).sort((a, b) => rank(a.g) - rank(b.g) || a.i - b.i).map((x) => x.g);
  return kept.map((g) => `${g.header || ''}${g.entries.join('')}`).join('<li class="uk-nav-divider"></li>');
}

function matchingClose(html, from, tag) {
  const re = new RegExp(`<${tag}\\b[^>]*>|</${tag}>`, 'gi');
  re.lastIndex = from;
  let depth = 1;
  let m;
  while ((m = re.exec(html))) {
    if (m[0][1] === '/') { depth -= 1; if (!depth) return m.index; } else depth += 1;
  }
  return -1;
}

/** Every menu list inside one button, rearranged. Actions go into the first list with something to click. */
function arrangeButtonHtml(menuId, html, ctx = {}) {
  if (!html) return html;
  const openRe = /<ul\b[^>]*\bclass="[^"]*\buk-dropdown-nav\b[^"]*"[^>]*>/gi;
  const navs = [];
  let m;
  while ((m = openRe.exec(html))) {
    const start = openRe.lastIndex;
    const close = matchingClose(html, start, 'ul');
    if (close < 0) return html;
    navs.push([start, close]);
    openRe.lastIndex = close;
  }
  if (!navs.length) return html;
  const withLinks = navs.findIndex(([s, e]) => /<a\b/.test(html.slice(s, e)));
  const target = withLinks < 0 ? 0 : withLinks;
  let out = '';
  let pos = 0;
  navs.forEach(([s, e], i) => {
    out += html.slice(pos, s) + arrangeNavInner(menuId, html.slice(s, e), { ...ctx, withCustom: i === target });
    pos = e;
  });
  return out + html.slice(pos);
}

/**
 * A menu set to more than one column becomes that many lists side by side, each group in the column it was
 * put in (a group not placed yet goes to the last). Only a button with a single menu list that no request
 * fills in later is split; anything else is returned as it was.
 */
function columnizeButtonHtml(menuId, html, layout) {
  const m = layout.menus[menuId];
  if (!html || !m || !m.columns || m.columns.length < 2 || !takesColumns(menuId)) return html;
  const found = [...html.matchAll(/<ul\b[^>]*\bclass="[^"]*\buk-dropdown-nav\b[^"]*"[^>]*>/gi)];
  if (found.length !== 1 || /\bhx-(get|post)=/.test(found[0][0])) return html;
  const openTag = found[0][0];
  const start = found[0].index + openTag.length;
  const close = matchingClose(html, start, 'ul');
  const lis = close < 0 ? null : splitTopLevelLi(html.slice(start, close));
  if (!lis) return html;
  const cols = m.columns.map(() => []);
  let cur = null;
  for (const li of lis) {
    if (isDivider(li)) { cur = null; continue; }
    if (isHeader(li) || !cur) {
      cur = { header: isHeader(li) ? li : null, entries: [] };
      const key = cur.header ? groupKeyOf(li) : entryKey(li);
      const at = m.columns.findIndex((c) => c.includes(key));
      cols[at < 0 ? cols.length - 1 : at].push(cur);
      if (cur.header) continue;
    }
    cur.entries.push(li);
  }
  // One list per column; DDEV's own CSS columns would split each of them again, so that class goes.
  const tag = openTag.replace(/\s*\bddev-nav-columns\b/, '');
  const lists = cols.filter((c) => c.length)
    .map((c) => `${tag}${c.map((g) => `${g.header || ''}${g.entries.join('')}`).join('<li class="uk-nav-divider"></li>')}</ul>`);
  if (lists.length < 2) return html;
  return `${html.slice(0, found[0].index)}<div class="menu-columns menu-columns-${lists.length}">${lists.join('')}</div>${html.slice(close + 5)}`;
}

/** A button someone made by naming it on an action. Empty on a row where none of its actions apply. */
function customButtonHtml(id, ctx = {}) {
  const layout = ctx.layout || loadRowLayout();
  const n = layout.custom.filter((c) => c.button === id && whenMatches(c.when, ctx)).length;
  if (!n) return '';
  return `<span class="act-with-status"><div class="uk-inline act-menu act-menu-custom act-menu-${esc(id)}">
    <button class="uk-button uk-button-default uk-button-small" type="button" title="Your own actions — Commands → Buttons"><span uk-icon="icon: bolt; ratio: .7"></span> ${esc(buttonLabel(id))} <span uk-icon="icon: chevron-down; ratio: .6"></span></button>
    <div uk-dropdown="mode: click; pos: bottom-right"><ul class="uk-nav uk-dropdown-nav"></ul></div>
  </div><span class="act-status uk-text-meta">${n} action${n === 1 ? '' : 's'}</span></span>`;
}

/**
 * The row's rows of buttons. `buttons` maps each built-in id to its rendered HTML ('' when it does not
 * apply to this row). `preArranged` names buttons whose menu was already rearranged, because they count
 * what is in it for their caption.
 */
function rowLinesHtml(buttons, ctx = {}, { preArranged = new Set() } = {}) {
  const layout = ctx.layout || loadRowLayout();
  const full = { ...ctx, layout };
  const hidden = new Set(layout.hidden);
  const render = (id) => {
    if (hidden.has(id)) return '';
    const html = Object.prototype.hasOwnProperty.call(buttons, id) ? (buttons[id] || '')
      : (BUILTIN_IDS.has(id) ? '' : customButtonHtml(id, full));
    if (!html) return '';
    const placed = columnizeButtonHtml(id, preArranged.has(id) ? html : arrangeButtonHtml(id, html, full), layout);
    // Icon alone or label alone: the button is WRAPPED, never rewritten. Its markup is built by whoever
    // added it — a built-in in server.js, a custom one here — and reaching into that string to delete a
    // span is the documented way this breaks. Both halves stay, so a screen reader still reads the name.
    const how = (layout.show || {})[id];
    return (how === 'icon' || how === 'text') ? `<span class="row-show-${how}">${placed}</span>` : placed;
  };
  const rows = layout.rows.map((ids) => ids.map(render).join(''));
  return { rows, first: rows[0] || '', second: rows[1] || '', extra: rows.slice(2) };
}

/** The form a run with options starts from: every option, its default, and what it may be. */
function actionOptionsFormHtml(entry, { workspace, project }) {
  const hidden = `<input type="hidden" name="workspace" value="${esc(workspace)}"><input type="hidden" name="projectName" value="${esc(project)}">`
    + `<input type="hidden" name="id" value="${esc(entry.id)}"><input type="hidden" name="submitted" value="1">`;
  const fields = effectiveOptions(entry).map((o) => {
    const name = `opt_${o.name}`;
    const label = `${esc(o.label || o.name)}${o.required ? ' <span class="uk-text-danger">*</span>' : ''}`;
    const hint = [o.regex ? `matches <code>${esc(o.regex)}</code>` : '', o.values.length && !o.enforced ? 'or type your own' : ''].filter(Boolean).join(' · ');
    let input;
    if (o.values.length && o.enforced) {
      input = `<select class="uk-select" name="${name}">${o.values.map((v) => `<option${v === o.value ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select>`;
    } else {
      const list = o.values.length ? ` list="row-opt-${esc(entry.id)}-${esc(o.name)}"` : '';
      input = `<input class="uk-input" name="${name}" value="${esc(o.value)}"${list} autocomplete="off" spellcheck="false">`
        + (o.values.length ? `<datalist id="row-opt-${esc(entry.id)}-${esc(o.name)}">${o.values.map((v) => `<option value="${esc(v)}">`).join('')}</datalist>` : '');
    }
    return `<label class="row-option">${label}${input}${hint ? `<span class="uk-text-meta">${hint}</span>` : ''}</label>`;
  }).join('');
  const done = `hx-target="#webship-workspace-output" hx-swap="innerHTML" hx-on::after:request="if (event.detail.successful) UIkit.modal('#editor-modal').hide()"`;
  const run = entry.confirm
    ? `<button type="button" class="uk-button uk-button-danger arm-step" hx-post="/actions/row-custom-run" hx-include="closest form" hx-trigger="confirmed-remove" ${done}>Run ${esc(entry.label)}</button>`
    : `<button type="submit" class="uk-button uk-button-primary">Run ${esc(entry.label)}</button>`;
  return `<div class="uk-card uk-card-default uk-card-body editor-card row-options">
    <h3 class="uk-margin-small-bottom">${esc(entry.label)}</h3>
    <p class="uk-text-meta">On <strong>${esc(project)}</strong>${entry.description ? ` — ${esc(entry.description)}` : ''}</p>
    <form ${entry.confirm ? 'hx-on:submit="event.preventDefault()"' : `hx-post="/actions/row-custom-run" ${done}`}>
      ${hidden}${fields}
      <p class="uk-text-meta">Runs ${entry.steps.length} step${entry.steps.length === 1 ? '' : 's'}: ${entry.steps.map((s) => `<code>${esc(stepText(s))}</code>`).join(' → ')}</p>
      ${run}
    </form>
  </div>`;
}

// ---------------------------------------------------------------- Commands → Buttons

function moveArrows(what) {
  return `<span class="ws-move">
      <button type="button" class="uk-button uk-button-default uk-button-small" title="Move ${esc(what)} up"
        hx-on:click="const li = this.closest('li'); if (li.previousElementSibling) li.parentNode.insertBefore(li, li.previousElementSibling)"><span uk-icon="icon: chevron-up; ratio: .7"></span></button>
      <button type="button" class="uk-button uk-button-default uk-button-small" title="Move ${esc(what)} down"
        hx-on:click="const li = this.closest('li'); if (li.nextElementSibling) li.parentNode.insertBefore(li.nextElementSibling, li)"><span uk-icon="icon: chevron-down; ratio: .7"></span></button>
    </span>`;
}

const EXAMPLE = `custom:
  - id: update-db
    label: Update the database
    button: ddev
    group: drupal
    description: Switch branch, install, run the updates
    when: [ddev, composer, "!workspace:products"]
    confirm: true
    keepgoing: false
    options:
      - name: branch
        label: Branch
        value: main
        regex: '^[A-Za-z0-9._/-]+$'
        required: true
    steps:
      - git fetch origin {{opt.branch}}
      - git switch {{opt.branch}}
      - ddev composer install
      - command: ddev drush updb -y
        on_error: ddev drush watchdog:show --count=20`;

function addActionFields(key, groupsList, { withButton = false } = {}) {
  const f = (n) => `add_${n}_${esc(key)}`;
  return `<div class="row-add-grid">
      ${commandPickerHtml(f('use'))}
      ${withButton ? `<label>Button name <input class="uk-input uk-form-small" name="${f('button')}" maxlength="30" placeholder="tools"></label>` : ''}
      <label>Label <input class="uk-input uk-form-small" name="${f('label')}" maxlength="60" placeholder="Rebuild caches"></label>
      <label>Group <input class="uk-input uk-form-small" name="${f('group')}" maxlength="40" placeholder="Custom"${groupsList ? ` list="row-groups-${esc(key)}"` : ''}></label>
      ${groupsList ? `<datalist id="row-groups-${esc(key)}">${groupsList}</datalist>` : ''}
      <label>Shows on <select class="uk-select uk-form-small" name="${f('when')}">${Object.entries(WHENS).map(([k, t]) => `<option value="${k}">${esc(t)}</option>`).join('')}</select></label>
      <label class="row-add-steps">Commands, one per line <span class="uk-text-meta">— or use: &lt;command id&gt;</span> <textarea class="uk-textarea uk-form-small" name="${f('steps')}" rows="2" placeholder="ddev drush cr" spellcheck="false" data-ace="sh"></textarea></label>
      <label class="row-add-check"><input class="uk-checkbox" type="checkbox" name="${f('keepgoing')}" value="1"> keep going when a step fails</label>
      <label class="row-add-check"><input class="uk-checkbox" type="checkbox" name="${f('confirm')}" value="1"> ask before running</label>
      <label>Opens <select class="uk-select uk-form-small" name="${f('open')}"><option value="toast">a toast linking to it</option><option value="screen">its screen, right away</option></select></label>
    </div>`;
}

/**
 * Add a row, and add a button: the dashboard's one modal rather than controls at the bottom of a long form.
 *
 * Both post the rows form with them (`#row-arrange-form`), because a drag that has not been saved yet is part of
 * what the layout should become — the inline versions got that for free by sitting inside the form, and a modal
 * sits outside it. Both close the modal when the write succeeds; the editor behind it is replaced by the answer.
 */
function addRowFormHtml() {
  const layout = loadRowLayoutFresh();
  const full = layout.rows.length >= MAX_ROWS;
  return `<div class="editor-card">
    <h3 class="uk-margin-small-bottom">Add a row</h3>
    <p class="uk-text-meta">A project row is built from rows of buttons, top to bottom. A new one is added at the
      bottom, empty — drag buttons into it, or pick it from a button's row selector. There ${layout.rows.length === 1
        ? 'is 1 row' : `are ${layout.rows.length} rows`} now, and up to ${MAX_ROWS} are allowed.</p>
    ${full ? `<p class="msg error">All ${MAX_ROWS} rows are in use. Remove one first.</p>` : `
    <button type="button" class="uk-button uk-button-primary" hx-post="/actions/row-rows"
      hx-vals='{"op":"add","pane":"0","mtime":"${layoutMtime()}"}' hx-include="#row-arrange-form"
      hx-target="#row-actions-editor" hx-swap="outerHTML"><span uk-icon="icon: plus; ratio: .8"></span> Add the row</button>`}
  </div>`;
}

function addButtonFormHtml() {
  const mtime = layoutMtime();
  return `<div class="editor-card">
    <h3 class="uk-margin-small-bottom">Add a button</h3>
    <p class="uk-text-meta">A button of your own on every project row, made by its first action: name the button, then
      say what the action does. More actions go in the button itself, once it is there.</p>
    <div class="row-add-action">
      ${addActionFields('new', '', { withButton: true })}
      <button type="button" class="uk-button uk-button-primary" hx-post="/actions/row-custom-add"
        hx-include="#row-arrange-form, closest .row-add-action"
        hx-vals='{"for_button":"__new__","mtime":"${mtime}","pane":"0"}'
        hx-target="#row-actions-editor" hx-swap="outerHTML"><span uk-icon="icon: plus; ratio: .8"></span> Add the button</button>
    </div>
  </div>`;
}

function rowActionsEditorHtml(message = '', pane = 0, { openButton = '' } = {}) {
  const layout = loadRowLayoutFresh();
  const mtime = layoutMtime();
  const mt = `<input type="hidden" name="mtime" value="${mtime}">`;
  const target = 'hx-target="#row-actions-editor" hx-swap="outerHTML"';
  const whereOptions = (where) => [...layout.rows.map((_, i) => [String(i), `Row ${i + 1}`]), ['hidden', 'Hidden']]
    .map(([v, t]) => `<option value="${v}"${String(where) === v ? ' selected' : ''}>${t}</option>`).join('');

  const buttonCard = (id, where) => {
    const label = buttonLabel(id);
    const shownAs = (layout.show || {})[id] || '';
    const cat = seenMenu(id).groups;
    const keys = Object.keys(cat);
    const m = layout.menus[id] || { groups: [], hiddenGroups: [], hiddenEntries: [], order: {}, columns: [] };
    const hg = new Set(m.hiddenGroups);
    const he = new Set(m.hiddenEntries);
    const mine = layout.custom.filter((c) => c.button === id);
    const nHidden = keys.filter((k) => hg.has(k)).length
      + keys.reduce((n, k) => n + Object.keys(cat[k].entries).filter((e) => he.has(e)).length, 0);
    const bits = [
      hasMenu(id) ? (keys.length ? `${keys.length} group${keys.length === 1 ? '' : 's'}` : 'not seen yet') : 'a single button',
      nHidden ? `${nHidden} hidden` : '',
      mine.length ? `${mine.length} of yours` : '',
    ].filter(Boolean).join(' · ');
    // What the menu holds: the groups and entries seen on project rows, plus this button's own actions,
    // placed in their group even before a row has shown them. A removed action's old entry is dropped.
    const display = {};
    for (const k of keys) display[k] = { label: cat[k].label || k, entries: Object.entries(cat[k].entries).map(([ek, et]) => ({ key: ek, text: et })) };
    for (const c of mine) {
      const gk = keyText(c.group);
      const g = display[gk] || (display[gk] = { label: c.group, entries: [] });
      const item = { key: `custom-${c.id}`, text: c.label, custom: c };
      const at = g.entries.findIndex((x) => x.key === item.key);
      if (at < 0) g.entries.push(item); else g.entries[at] = item;
    }
    for (const g of Object.values(display)) g.entries = g.entries.filter((x) => !x.key.startsWith('custom-') || x.custom);
    const gkeys = Object.keys(display);
    const rank = (k) => { const i = m.groups.indexOf(k); return i < 0 ? m.groups.length : i; };
    const ordered = gkeys.map((k, i) => ({ k, i })).sort((a, b) => rank(a.k) - rank(b.k) || a.i - b.i).map((x) => x.k);
    // Columns: how many lists the menu shows side by side, and which column each group is in.
    const nCols = takesColumns(id) ? Math.max(1, (m.columns || []).length) : 1;
    const colOf = (k) => { if (nCols === 1) return 0; const i = m.columns.findIndex((c) => c.includes(k)); return i < 0 ? nCols - 1 : i; };
    const entriesOf = (k) => {
      const o = (m.order || {})[k] || [];
      const pos = (x) => { const i = o.indexOf(x.key); return i < 0 ? o.length : i; };
      return display[k].entries.map((x, i) => ({ x, i })).sort((a, b) => pos(a.x) - pos(b.x) || a.i - b.i).map((y) => y.x);
    };
    const editAction = (c) => {
      const f = (n) => `edit_${n}_${esc(c.id)}`;
      return `<details class="row-edit"><summary class="uk-text-meta">edit</summary>
        <div class="row-edit-action">
          <div class="row-add-grid">
            <label>Label <input class="uk-input uk-form-small" name="${f('label')}" value="${esc(c.label)}" maxlength="60"></label>
            <label>Group <input class="uk-input uk-form-small" name="${f('group')}" value="${esc(c.group)}" maxlength="40"></label>
            <label>Shows on <input class="uk-input uk-form-small" name="${f('when')}" value="${esc(c.when.join(' '))}" placeholder="any" title="any, ddev, composer, node, git, workspace:name — each may start with !"></label>
            <label>Opens <select class="uk-select uk-form-small" name="${f('open')}"><option value="toast"${c.open === 'toast' ? ' selected' : ''}>a toast linking to it</option><option value="screen"${c.open === 'screen' ? ' selected' : ''}>its screen, right away</option></select></label>
            <label class="row-add-steps">Commands, one per line <span class="uk-text-meta">— or use: &lt;command id&gt;</span> <textarea class="uk-textarea uk-form-small" name="${f('steps')}" rows="${Math.min(6, c.steps.length + 1)}" spellcheck="false" data-ace="sh">${esc(c.steps.map(stepText).join('\n'))}</textarea></label>
            <label class="row-add-check"><input class="uk-checkbox" type="checkbox" name="${f('keepgoing')}" value="1"${c.keepgoing ? ' checked' : ''}> keep going when a step fails</label>
            <label class="row-add-check"><input class="uk-checkbox" type="checkbox" name="${f('confirm')}" value="1"${c.confirm ? ' checked' : ''}> ask before running</label>
          </div>
          ${c.options.length || c.steps.some((st) => st.onError) ? '<p class="uk-text-meta">Its options and on_error steps are kept as they are — change those in Definition.</p>' : ''}
          <button type="button" class="uk-button uk-button-primary uk-button-small" hx-post="/actions/row-custom-save" hx-vals='{"id":"${esc(c.id)}","open_button":"${esc(c.button)}","mtime":"${mtime}","pane":"0"}' ${target}>Save the action</button>
          <button type="button" class="uk-button uk-button-danger uk-button-small arm-step" hx-post="/actions/row-custom-remove" hx-vals='{"id":"${esc(c.id)}","open_button":"${esc(c.button)}","mtime":"${mtime}","pane":"0"}' ${target} hx-trigger="confirmed-remove">Delete</button>
        </div>
      </details>`;
    };
    const groups = !hasMenu(id) ? '<p class="uk-text-meta">A single button: nothing inside it to arrange, and nowhere to add an action.</p>'
      : !gkeys.length ? '<p class="uk-text-meta">Not seen on a project row yet — open a workspace page where this button shows, then come back to arrange what is inside it.</p>'
      : `<input type="hidden" name="menu_present_${esc(id)}" value="1">
        ${takesColumns(id) ? `<label class="row-columns-pick">Columns in the menu <select class="uk-select uk-form-small" name="columns_${esc(id)}"
          hx-post="/actions/row-arrange-save" hx-trigger="change" hx-vals='{"pane":"0","open_button":"${esc(id)}"}' ${target}>${[1, 2, 3, 4].map((n) => `<option${n === nCols ? ' selected' : ''}>${n}</option>`).join('')}</select></label>` : `<p class="uk-text-meta">${esc(label)} lays out its own columns.</p>`}
        <div class="row-columns row-columns-${nCols}">
          ${Array.from({ length: nCols }, (_, col) => `<ol class="row-list row-groups" data-col="${col}" uk-sortable="group: cols-${esc(id)}; handle: .row-handle-group">
          ${ordered.filter((k) => colOf(k) === col).map((k) => `<li class="row-item row-group">
            <span class="row-handle row-handle-group" uk-icon="icon: table; ratio: .7" title="Drag to reorder the group"></span>
            <input type="hidden" name="group_${esc(id)}" value="${esc(k)}">
            <input type="hidden" class="gcol-of" name="gcol_${esc(id)}" data-key="${esc(k)}" value="${esc(k)}&#9;${col}">
            <div class="row-group-body">
              <label class="row-group-name"><input class="uk-checkbox" type="checkbox" name="hide_group_${esc(id)}" value="${esc(k)}"${hg.has(k) ? ' checked' : ''}>
                <strong>${esc(display[k].label)}</strong> <span class="uk-text-meta">hide the group</span></label>
              <ol class="row-entry-list" uk-sortable="handle: .row-handle-entry">
                ${entriesOf(k).map((x) => `<li class="row-entry-item">
                  <span class="row-handle row-handle-entry" uk-icon="icon: table; ratio: .6" title="Drag to reorder"></span>
                  ${moveArrows(x.text)}
                  <input type="hidden" name="entry_${esc(id)}" value="${esc(k)}&#9;${esc(x.key)}">
                  <label class="row-entry"><input class="uk-checkbox" type="checkbox" name="hide_entry_${esc(id)}" value="${esc(x.key)}"${he.has(x.key) ? ' checked' : ''}> ${esc(x.text)}</label>
                  ${x.custom
                    ? `<span class="uk-label row-entry-yours">yours · ${x.custom.open === 'screen' ? 'opens its screen' : 'toast'}${x.custom.steps.some((s) => s.use) ? ` · uses ${esc(x.custom.steps.filter((s) => s.use).map((s) => s.use).join(', '))}` : ''}</span>${editAction(x.custom)}`
                    : '<span class="uk-text-meta row-entry-builtin" title="A dashboard command: it can be moved or hidden, not deleted">built in</span>'}
                </li>`).join('')}
              </ol>
            </div>
            ${moveArrows('this group')}
          </li>`).join('')}
          </ol>`).join('')}
        </div>
        <p class="uk-text-meta">Drag a group, or a command inside it, to reorder — a group can also go to another column. A ticked group or command is hidden. Built-in commands can
          be moved and hidden; your own actions can also be edited and deleted.</p>`;
    const mineHtml = '';
    const add = !hasMenu(id) ? '' : `<div class="row-add-action">
      <span class="uk-text-meta">Add an action to ${esc(label)}</span>
      ${addActionFields(id, keys.map((k) => `<option value="${esc(cat[k].label || k)}">`).join(''))}
      <button type="button" class="uk-button uk-button-primary uk-button-small" hx-post="/actions/row-custom-add" hx-include="closest .row-add-action"
        hx-vals='{"for_button":"${esc(id)}","open_button":"${esc(id)}","mtime":"${mtime}","pane":"0"}' ${target}><span uk-icon="icon: plus; ratio: .7"></span> Add the action</button>
    </div>`;
    return `<li class="row-item row-button" data-button="${esc(id)}">
      <span class="row-handle row-handle-button" uk-icon="icon: table; ratio: .7" title="Drag to another place or row"></span>
      <input type="hidden" name="button" value="${esc(id)}">
      <input type="hidden" class="row-of" name="row_${esc(id)}" value="${where}">
      <details class="row-button-body"${id === openButton ? ' open' : ''}>
        <summary><strong>${esc(label)}</strong>${BUILTIN_IDS.has(id) ? '' : ' <span class="uk-label">yours</span>'} <span class="uk-text-meta">· ${bits}</span></summary>
        ${groups}${mineHtml}${add}
      </details>
      <select class="uk-select uk-form-small row-move" aria-label="Row for ${esc(label)}">${whereOptions(where)}</select>
      <!-- How much of the button is drawn. The same three answers the navigation entries give, and the
           same word for them: a row of buttons and a rail of entries are the same question about room.
           Both halves stay in the markup whichever is picked, so a screen reader still reads the name. -->
      <select class="uk-select uk-form-small row-show" name="show" aria-label="How much of ${esc(label)} is shown"
              title="How much of ${esc(label)} is shown on a project row">
        <option value="${esc(id)}:both"${shownAs ? '' : ' selected'}>icon + text</option>
        <option value="${esc(id)}:icon"${shownAs === 'icon' ? ' selected' : ''}>icon only</option>
        <option value="${esc(id)}:text"${shownAs === 'text' ? ' selected' : ''}>text only</option>
      </select>
      ${moveArrows(label)}
    </li>`;
  };

  const rowTool = (op, i, icon, title, disabled) => `<button type="button" class="uk-button uk-button-default uk-button-small" hx-post="/actions/row-rows"
      hx-vals='{"op":"${op}","index":"${i}","pane":"0"}' ${target}${disabled ? ' disabled' : ''} title="${esc(title)}"><span uk-icon="icon: ${icon}; ratio: .7"></span></button>`;

  const rowsPane = `<form id="row-arrange-form" hx-post="/actions/row-arrange-save" ${target}>
    ${mt}<input type="hidden" name="pane" value="0">
    <p class="uk-text-meta">Every project row is built from these rows of buttons, top to bottom. Drag a button to another row, or
      pick its row; open a button to order its groups, hide what you do not use, and add actions to it. Changes to rows and buttons
      apply when you save; adding or removing an action, or a row, saves the rest with it.</p>
    ${layout.rows.map((ids, i) => `<section class="row-block" data-row="${i}">
      <header class="row-block-head"><strong>Row ${i + 1}</strong>${i === 0 ? ' <span class="uk-text-meta">· beside the running and test badges</span>' : ''}
        <span class="row-block-tools">${rowTool('up', i, 'chevron-up', 'Move this row up', i === 0)}${rowTool('down', i, 'chevron-down', 'Move this row down', i === layout.rows.length - 1)}${rowTool('remove', i, 'trash', 'Remove this row — its buttons move to the row above', layout.rows.length === 1)}</span>
      </header>
      <ol class="row-list row-buttons" data-row="${i}" uk-sortable="group: row-buttons; handle: .row-handle-button">${ids.map((id) => buttonCard(id, i)).join('')}</ol>
    </section>`).join('')}
    <p><button type="button" class="uk-button uk-button-default uk-button-small" hx-get="/fragments/row/add-row"
      hx-target="#editor-modal-body" hx-swap="innerHTML"${layout.rows.length >= MAX_ROWS ? ' disabled' : ''}><span uk-icon="icon: plus; ratio: .7"></span> Add a row</button></p>
    <section class="row-block row-block-hidden" data-row="hidden">
      <header class="row-block-head"><strong>Hidden</strong> <span class="uk-text-meta">· not shown on any project row</span></header>
      <ol class="row-list row-buttons" data-row="hidden" uk-sortable="group: row-buttons; handle: .row-handle-button">${layout.hidden.map((id) => buttonCard(id, 'hidden')).join('')}</ol>
    </section>
    <section class="row-block row-add-button">
      <header class="row-block-head"><strong>Add a button</strong> <span class="uk-text-meta">· a menu of your own, made by its first action</span></header>
      <p><button type="button" class="uk-button uk-button-default uk-button-small" hx-get="/fragments/row/add-button"
        hx-target="#editor-modal-body" hx-swap="innerHTML"><span uk-icon="icon: plus; ratio: .7"></span> Add a button</button></p>
    </section>
    <!-- Stays at the bottom of the screen while the form is in view: the form is long, and Save used to be
         two screens away from whatever was just changed. ui.js marks the form as changed. -->
    <div class="row-save-bar">
      <span class="row-unsaved-note" role="status">Unsaved changes</span>
      <button type="submit" class="uk-button uk-button-primary"><span uk-icon="icon: check; ratio: .8"></span> Save the rows</button>
    </div>
  </form>`;

  const live = liveSessions();
  const runs = readRuns().slice(-40).reverse();
  const stateLabel = { succeeded: 'uk-label-success', failed: 'uk-label-danger', partly: 'uk-label-warning', running: 'uk-label-warning', unknown: '' };
  const activityPane = runs.length ? `<p class="uk-text-meta">The last runs of your own actions, newest first. One still going links to its session.</p>
    <div class="uk-overflow-auto"><table class="uk-table uk-table-small uk-table-divider row-activity">
      <thead><tr><th>Started</th><th>Action</th><th>Project</th><th>Result</th><th></th></tr></thead>
      <tbody>${runs.map((r) => {
        const isLive = live.has(r.session);
        const st = r.status || runStatus(sessionLog(r.session), isLive);
        const tail = r.status ? '' : sessionLog(r.session).split('\n').filter((l) => l.trim()).slice(-12).join('\n');
        return `<tr><td>${esc(new Date(r.at).toLocaleString())}</td><td>${esc(r.label)}</td><td>${esc(r.workspace)}/${esc(r.project)}</td>
          <td><span class="uk-label ${stateLabel[st.state] || ''}">${esc(st.state)}</span>${st.note ? ` <span class="uk-text-meta">${esc(st.note)}</span>` : ''}</td>
          <td>${isLive ? `<a href="/terminal/${encodeURIComponent(r.session)}" target="_blank" rel="noopener">open</a>`
            : (tail ? `<details><summary>output</summary><pre class="row-activity-log">${esc(tail)}</pre></details>` : '')}</td></tr>`;
      }).join('')}</tbody></table></div>`
    : '<p class="uk-text-meta">No action has run yet. Runs of your own actions are listed here, with how each one ended.</p>';

  const definitionPane = `<form id="row-definition-form" hx-post="/actions/row-definition-save" ${target}>
    ${mt}<input type="hidden" name="pane" value="2">
    <p class="uk-text-meta">The whole file as YAML — the same thing the Rows tab edits. Copy it to keep or share; paste one in to load
      it. <strong>Check</strong> says what would change and saves nothing.</p>
    <textarea class="uk-textarea row-definition-text" name="definition" rows="22" spellcheck="false" data-ace="yaml">${esc(definitionText())}</textarea>
    <div class="row-definition-buttons">
      <select class="uk-select uk-form-small" name="mode" aria-label="What to load">
        <option value="replace">Replace the whole file</option>
        <option value="skip">Load only its actions — skip an id that already exists</option>
        <option value="update">Load only its actions — update an id that already exists</option>
      </select>
      <button type="button" class="uk-button uk-button-default uk-button-small" hx-post="/actions/row-definition-check" hx-target="#row-definition-report" hx-swap="innerHTML">Check</button>
      <button type="submit" class="uk-button uk-button-primary uk-button-small"><span uk-icon="icon: check; ratio: .7"></span> Save</button>
    </div>
    <div id="row-definition-report"></div>
    <details class="row-definition-help"><summary>An action with every field</summary><textarea class="uk-textarea" rows="${EXAMPLE.split('\n').length + 1}" readonly spellcheck="false"
      data-ace="yaml" data-ace-readonly="1" aria-label="An action with every field">${esc(EXAMPLE)}</textarea>
      <p class="uk-text-meta"><code>when</code>: every clause must match — any, ddev, composer, node, git, workspace:&lt;name&gt;, each with an optional !.
        <code>{{opt.name}}</code> puts an option's value into a step, checked and single-quoted. <code>keepgoing</code> runs every step and says
        which failed; without it the first failure stops the rest. <code>on_error</code> runs when its step fails, and its result becomes the step's.</p>
    </details>
    <h4>Start again</h4>
    <p class="uk-text-meta">Deletes <code>${esc(layoutFile())}</code>: every button goes back to its default row, every group and command
      shows, and your own actions are removed.</p>
    <button type="button" class="uk-button uk-button-danger uk-button-small arm-step"
      hx-post="/actions/row-layout-reset" hx-vals='{"mtime":"${mtime}","pane":"2"}' ${target} hx-trigger="confirmed-remove">Reset to the defaults</button>
  </form>`;

  const active = [0, 1, 2].includes(Number(pane)) ? Number(pane) : 0;
  return `<div id="row-actions-editor">
    ${message}
    ${layout.error ? `<div class="msg error">${esc(layoutFile())} could not be read (${esc(layout.error)}), so the defaults are in use. Saving here replaces it.</div>` : ''}
    <ul class="uk-subnav uk-subnav-pill row-actions-tabs" uk-switcher="connect: #row-actions-panes; active: ${active}">
      <li><a href="#">Rows</a></li><li><a href="#">Activity</a></li><li><a href="#">Definition</a></li>
    </ul>
    <ul id="row-actions-panes" class="uk-switcher">
      <li>${rowsPane}</li>
      <li>${activityPane}</li>
      <li>${definitionPane}</li>
    </ul>
  </div>`;
}

/** The layout a submitted Rows form describes: which row each button is in, and each opened menu's groups. */
function arrangementFromForm(layout, form) {
  const list = (v) => (Array.isArray(v) ? v : (v === undefined || v === null ? [] : [v])).map((x) => String(x));
  const known = new Set(knownButtonIds(layout));
  const rows = layout.rows.map(() => []);
  const hidden = [];
  const placed = new Set();
  for (const id of list(form.button)) {
    if (!known.has(id) || placed.has(id)) continue;
    const where = String(form[`row_${id}`] === undefined ? '' : form[`row_${id}`]);
    if (where === 'hidden') { hidden.push(id); placed.add(id); continue; }
    const i = Number(where);
    if (Number.isInteger(i) && i >= 0 && i < rows.length) { rows[i].push(id); placed.add(id); }
  }
  // A button the form did not carry keeps the place it had, rather than falling back to its default.
  layout.rows.forEach((ids, i) => ids.forEach((id) => { if (!placed.has(id)) { rows[i].push(id); placed.add(id); } }));
  layout.hidden.forEach((id) => { if (!placed.has(id)) { hidden.push(id); placed.add(id); } });

  const doc = toDoc(layout);
  doc.rows = rows;
  doc.hidden = hidden;
  // How much of each button is drawn: `<id>:icon`, `<id>:text` or `<id>:both`. Both is what a button is
  // until somebody says otherwise, so it is not written down — and posting it explicitly is what makes
  // going back to both work. A button the form did not carry keeps the answer it had.
  const show = { ...(layout.show || {}) };
  for (const v of list(form.show)) {
    const at = v.lastIndexOf(':');
    if (at < 0) continue;
    const id = v.slice(0, at);
    const how = v.slice(at + 1);
    if (!known.has(id)) continue;
    if (how === 'icon' || how === 'text') show[id] = how; else delete show[id];
  }
  if (Object.keys(show).length) doc.show = show; else delete doc.show;
  for (const id of known) {
    if (!form[`menu_present_${id}`]) continue;
    // Only what the form could have shown is taken from it; anything this machine has not seen stays as it was.
    const cat = seenMenu(id).groups;
    const groupKeys = new Set(Object.keys(cat));
    for (const c of layout.custom.filter((x) => x.button === id)) groupKeys.add(keyText(c.group));
    const entryKeys = new Set([...Object.values(cat).flatMap((g) => Object.keys(g.entries)), ...layout.custom.filter((x) => x.button === id).map((x) => `custom-${x.id}`)]);
    const old = layout.menus[id] || { groups: [], hiddenGroups: [], hiddenEntries: [], order: {}, columns: [] };
    const order = {};
    for (const v of list(form[`entry_${id}`])) {
      const [g, e] = v.split('\t');
      if (!groupKeys.has(g) || !entryKeys.has(e)) continue;
      (order[g] || (order[g] = [])).push(e);
    }
    for (const [g, keys] of Object.entries(old.order || {})) if (!order[g] && !groupKeys.has(g)) order[g] = keys;
    const nCols = takesColumns(id) ? Math.min(MAX_COLUMNS, Math.max(1, Number(form[`columns_${id}`]) || 1)) : 1;
    const columns = nCols > 1 ? Array.from({ length: nCols }, () => []) : [];
    if (nCols > 1) {
      for (const v of list(form[`gcol_${id}`])) {
        const [g, c] = v.split('\t');
        if (!groupKeys.has(g)) continue;
        const ci = Number(c);
        // A column that no longer exists hands its groups to the last one.
        columns[Number.isInteger(ci) && ci >= 0 && ci < nCols ? ci : nCols - 1].push(g);
      }
    }
    // Only what differs from what the menu shows by default is kept. Every card posts its whole order on every
    // save, so a single change used to write the order of all twelve menus — freezing today's order for menus
    // nobody touched, and pinning it even after the dashboard changes a menu of its own.
    const naturalGroups = [...Object.keys(cat), ...[...groupKeys].filter((g) => !(g in cat))];
    const naturalEntries = (g) => [...Object.keys((cat[g] || {}).entries || {}),
      ...layout.custom.filter((x) => x.button === id && keyText(x.group) === g).map((x) => `custom-${x.id}`)];
    for (const g of Object.keys(order)) {
      if (!groupKeys.has(g)) continue;
      const natural = naturalEntries(g).filter((e) => order[g].includes(e));
      if (order[g].join('\n') === natural.join('\n')) delete order[g];
    }
    doc.menus[id] = {
      columns,
      order,
      groups: (() => {
        const sent = list(form[`group_${id}`]).filter((k) => groupKeys.has(k));
        const natural = naturalGroups.filter((g) => sent.includes(g));
        return [...(sent.join('\n') === natural.join('\n') ? [] : sent), ...old.groups.filter((k) => !groupKeys.has(k))];
      })(),
      hidden_groups: [...list(form[`hide_group_${id}`]).filter((k) => groupKeys.has(k)), ...old.hiddenGroups.filter((k) => !groupKeys.has(k))],
      hidden_entries: [...list(form[`hide_entry_${id}`]).filter((k) => entryKeys.has(k)), ...old.hiddenEntries.filter((k) => !entryKeys.has(k))],
    };
  }
  return doc;
}

module.exports = {
  registerButton,
  BUILTIN_BUTTONS,
  BUILTIN_IDS,
  DEFAULT_ROWS,
  // The first version called rows lines; the tests of the menus still ask for it by that name.
  DEFAULT_LINES: DEFAULT_ROWS,
  MAX_ROWS,
  WHENS,
  layoutFile,
  seenFile,
  historyFile,
  normalizeLayout,
  toDoc,
  customToDoc,
  knownButtonIds,
  buttonLabel,
  hasMenu,
  takesColumns,
  MAX_COLUMNS,
  columnizeButtonHtml,
  whenList,
  describeWhen,
  whenMatches,
  stepText,
  usedCommands,
  useRefusal,
  effectiveOptions,
  cleanCustom,
  customRefusal,
  optionValueRefusal,
  resolveOptions,
  actionCommandLine,
  runStatus,
  slug,
  loadRowLayout,
  loadRowLayoutFresh,
  invalidateRowLayout,
  layoutMtime,
  saveRowLayout,
  resetRowLayout,
  definitionText,
  checkDefinition,
  seenMenu,
  loadSeen,
  recordRun,
  readRuns,
  settleRun,
  liveSessions,
  sessionLog,
  plainText,
  entryKey,
  groupKeyOf,
  splitTopLevelLi,
  arrangeNavInner,
  arrangeButtonHtml,
  customButtonHtml,
  rowLinesHtml,
  actionOptionsFormHtml,
  addRowFormHtml,
  addButtonFormHtml,
  rowActionsEditorHtml,
  arrangementFromForm,
  withinBudget,
};
