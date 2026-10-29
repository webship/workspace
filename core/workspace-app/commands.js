/**
 * The command catalog: every command the dashboard can run, kept as data rather than code.
 *
 * Three sources, one list:
 *
 *   built in  commands/defaults.yml, shipped with the dashboard — an update brings new ones
 *   yours     core/config/commands.yml, written by the Commands page; one with a built-in's id is your version of it
 *   scripts   every cmd-*.sh in the tree, listed as it is (read, never copied)
 *
 * A command is a Rundeck job cut down to one machine:
 *
 *   id, label, group, description, tags
 *   on:       workspace | project | folder | file      what it runs on (Rundeck's node)
 *   when:     [ddev, composer, "!workspace:products"]  the node filter, the same as a row action's
 *   run:      a shell line                             or
 *   script:   <workspace>/cmd-….sh, with args          a script of the tree, run from its own folder
 *   options:  asked for before it runs, the same as a row action's
 *   confirm:  asks in a dialog;   open: toast | screen
 *
 * A line receives values only as {{workspace}} {{project}} {{folder}} {{file}} {{path}} and {{opt.name}}, each
 * put in single quotes. No line and no value can hold $ or a backtick: the screen runner hands the whole line to
 * an outer shell, which would expand them before it runs.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const { CONFIG_DIR, ROOT, loadWorkspaces, isValidWorkspace, workspaceDir, builderLabel, commandTitle, commandDescription } = require('./workspaces');
const { NAME_RE, SCRIPT_RE } = require('./validate');
const rl = require('./row-layout');

const ON = {
  workspace: 'a workspace folder',
  project: 'a project',
  folder: 'a folder',
  file: 'a file',
};
const ID_RE = /^[a-z0-9][a-z0-9-]{0,44}$/;
const TAG_RE = /^[a-z0-9][a-z0-9-]{0,20}$/;
const SCRIPT_REF_RE = /^([a-z0-9_-]{1,40})\/(cmd-[a-zA-Z0-9_.-]+\.sh)$/;
const PLACEHOLDER_ANY_RE = /\{\{([^}]*)\}\}/g;
const OPT_PLACEHOLDER_RE = /^opt\.[a-z][a-z0-9_]{0,30}$/;
const VARS = ['workspace', 'project', 'folder', 'file', 'path'];
// Which targets give a value: a workspace folder has no project, and only a file has a file.
const VAR_NEEDS = { project: ['project', 'folder', 'file'], folder: ['folder', 'file'], file: ['file'] };
// A path inside a target: plain names joined by /, never . or .. — spaces are fine, the value is quoted.
const REL_PATH_RE = /^[A-Za-z0-9_.@+~ ,()-]{1,120}(?:\/[A-Za-z0-9_.@+~ ,()-]{1,120}){0,20}$/;
const SAFE_DIR_RE = /^[\w/.@+~-]+$/;
const MAX_COMMANDS = 500;

function defaultsFile() { return process.env.COMMANDS_DEFAULTS_FILE || path.join(__dirname, 'commands', 'defaults.yml'); }
function userFile() { return process.env.COMMANDS_FILE || path.join(CONFIG_DIR, 'commands.yml'); }

const str = (v) => (v === undefined || v === null || typeof v === 'object' ? '' : String(v)).trim();

/** A command from whatever a file or a form held. An unknown `on` is kept, so it is refused rather than changed. */
function cleanCommand(c, source = 'yours') {
  if (!c || typeof c !== 'object' || Array.isArray(c)) return null;
  const on = str(c.on);
  return {
    id: str(c.id),
    label: str(c.label),
    group: str(c.group) || 'General',
    description: str(c.description),
    on: on || 'project',
    when: rl.whenList(c.when),
    run: str(c.run),
    script: str(c.script),
    args: str(c.args),
    options: rl.cleanCustom({ options: c.options }).options,
    confirm: c.confirm === true,
    open: c.open === 'screen' ? 'screen' : 'toast',
    tags: (Array.isArray(c.tags) ? c.tags : []).map(str).filter(Boolean),
    source,
  };
}

/** What a command runs, as one line: its run line, or the script with its arguments. */
function lineOf(e) {
  return e.run || `bash ${e.script}${e.args ? ` ${e.args}` : ''}`;
}

/** Why this command must not be saved or run, or '' when it may. */
function commandRefusal(e) {
  if (!e) return 'it is not a command (a mapping with id, label, and run or script)';
  if (!ID_RE.test(e.id)) return 'the id is lower-case letters, digits and dashes (up to 45)';
  if (!ON[e.on]) return `"on" is ${Object.keys(ON).join(', ')}`;
  if (!!e.run === !!e.script) return 'a command has either run (a shell line) or script (a cmd-*.sh), and not both';
  if (e.script && !SCRIPT_REF_RE.test(e.script)) return 'script is <workspace>/cmd-<name>.sh, like dev/cmd-tools-backup-dev.sh';
  if (e.run && e.args) return 'args go with a script — put them in the run line instead';
  if (e.tags.length > 10 || e.tags.some((t) => !TAG_RE.test(t))) return 'tags are up to 10 short lower-case names';
  // Label, group, description, when, the line itself and the options are what a row action must be: the same code checks them.
  const why = rl.customRefusal({ ...e, button: 'more', keepgoing: false, steps: [{ command: lineOf(e), onError: '' }] });
  if (why) return why;
  for (const m of lineOf(e).matchAll(PLACEHOLDER_ANY_RE)) {
    const name = m[1];
    if (name.startsWith('opt.')) {
      if (!OPT_PLACEHOLDER_RE.test(name)) return `{{${name}}} is not an option name`;
      continue;
    }
    if (!VARS.includes(name)) return `{{${name}}} is not a value a command can use: ${VARS.map((v) => `{{${v}}}`).join(' ')} or {{opt.name}}`;
    if (VAR_NEEDS[name] && !VAR_NEEDS[name].includes(e.on)) return `{{${name}}} needs "on" to be ${VAR_NEEDS[name].join(' or ')}`;
  }
  return '';
}

/** The YAML shape of a command: only what differs from the defaults. */
function commandToDoc(e) {
  const doc = { id: e.id, label: e.label };
  if (e.group && e.group !== 'General') doc.group = e.group;
  if (e.description) doc.description = e.description;
  doc.on = e.on;
  if (!(e.when.length === 1 && e.when[0] === 'any')) doc.when = e.when;
  if (e.run) {
    doc.run = e.run;
  } else {
    doc.script = e.script;
    if (e.args) doc.args = e.args;
  }
  if (e.options.length) {
    doc.options = e.options.map((o) => {
      const d = { name: o.name };
      if (o.label) d.label = o.label;
      if (o.value) d.value = o.value;
      if (o.values.length) d.values = o.values;
      if (o.enforced) d.enforced = true;
      if (o.required) d.required = true;
      if (o.regex) d.regex = o.regex;
      return d;
    });
  }
  if (e.confirm) doc.confirm = true;
  if (e.open === 'screen') doc.open = 'screen';
  if (e.tags.length) doc.tags = e.tags;
  return doc;
}

function mtimeOf(file) {
  try { return Math.floor(fs.statSync(file).mtimeMs); } catch (_) { return 0; }
}

/** The commands a file holds, what was skipped and why, and whether the file could be read at all. */
function readList(file, source) {
  const empty = { entries: [], problems: [], error: '' };
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (_) { return empty; }
  let doc;
  try { doc = yaml.load(text); } catch (err) { return { ...empty, error: `it is not valid YAML (${String(err.reason || err.message).slice(0, 120)})` }; }
  if (!rl.withinBudget(doc)) return { ...empty, error: 'it is too large or too deeply nested to be a list of commands' };
  if (doc === null || doc === undefined) return empty;
  if (typeof doc !== 'object' || Array.isArray(doc)) return { ...empty, error: 'it is not a mapping with a commands: list' };
  if (doc.commands === undefined || doc.commands === null) return empty;
  if (!Array.isArray(doc.commands)) return { ...empty, error: '"commands" is not a list' };
  const entries = [];
  const problems = [];
  const seen = new Set();
  for (const raw of doc.commands.slice(0, MAX_COMMANDS)) {
    const e = cleanCommand(raw, source);
    const why = commandRefusal(e) || (seen.has(e.id) ? 'the id is used twice' : '');
    if (why) { problems.push(`${(e && e.id) || '(no id)'}: ${why}`); continue; }
    seen.add(e.id);
    entries.push(e);
  }
  if (doc.commands.length > MAX_COMMANDS) problems.push(`only the first ${MAX_COMMANDS} commands are read`);
  return { entries, problems, error: '' };
}

let cache = { key: '', value: null };

/** Built in and yours, merged by id: yours replaces a built-in one in its place, and a new one of yours comes after. */
function loadCatalog() {
  const key = `${defaultsFile()}:${mtimeOf(defaultsFile())}|${userFile()}:${mtimeOf(userFile())}`;
  if (cache.key === key && cache.value) return cache.value;
  const builtin = readList(defaultsFile(), 'builtin');
  const yours = readList(userFile(), 'yours');
  const byId = new Map(builtin.entries.map((e) => [e.id, e]));
  for (const e of yours.entries) byId.set(e.id, byId.has(e.id) ? { ...e, overrides: true } : e);
  const value = {
    commands: [...byId.values()],
    builtin: builtin.entries,
    yours: yours.entries,
    problems: [...builtin.problems.map((p) => `built in — ${p}`), ...yours.problems],
    error: yours.error,
    builtinError: builtin.error,
    mtime: mtimeOf(userFile()),
  };
  cache = { key, value };
  return value;
}

function invalidateCatalog() { cache = { key: '', value: null }; }

function findCommand(id) {
  return loadCatalog().commands.find((c) => c.id === String(id || '')) || null;
}

const HEADER = '# Your commands for the Webship Workspace dashboard (see core/workspace-app/commands.js).\n'
  + '# Written by the Commands page; a hand edit works too. A command with a built-in id is your version of it.\n'
  + '# Delete this file to go back to the built-in commands only.\n';

function yourDocText(list) {
  return `${HEADER}${yaml.dump({ commands: list.map(commandToDoc) }, { lineWidth: 140, noRefs: true })}`;
}

/** Write your commands, unless the file changed since the page that asks was drawn. No commands removes the file. */
function saveYourCommands(list, expectedMtime) {
  const file = userFile();
  if (expectedMtime !== undefined && expectedMtime !== null && String(expectedMtime) !== ''
    && String(mtimeOf(file)) !== String(expectedMtime)) {
    const err = new Error('Your commands changed since this page was loaded.');
    err.code = 'CHANGED';
    throw err;
  }
  if (!list.length) {
    try { fs.unlinkSync(file); } catch (_) { /* already gone */ }
    invalidateCatalog();
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, yourDocText(list));
  fs.renameSync(tmp, file);
  invalidateCatalog();
}

function definitionText() {
  try {
    const text = fs.readFileSync(userFile(), 'utf8');
    if (text.trim()) return text;
  } catch (_) { /* no file yet */ }
  return `${HEADER}commands: []\n`;
}

/** What loading this YAML as your commands would do, and the commands it would leave — or why not. */
function checkDefinition(text) {
  const report = { errors: [], notes: [], next: null };
  const raw = String(text === undefined || text === null ? '' : text);
  if (!raw.trim()) {
    report.errors.push('The definition is empty. To remove every command of yours, use Remove all of yours below.');
    return report;
  }
  let doc;
  try { doc = yaml.load(raw); } catch (err) {
    report.errors.push(`It is not valid YAML: ${String(err.reason || err.message).slice(0, 200)}`);
    return report;
  }
  if (!rl.withinBudget(doc)) {
    report.errors.push('The definition is too large or too deeply nested to be a list of commands (YAML aliases can make a few lines stand for billions of values).');
    return report;
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc) || !Array.isArray(doc.commands)) {
    report.errors.push('It needs a "commands:" list.');
    return report;
  }
  if (doc.commands.length > MAX_COMMANDS) {
    report.errors.push(`Up to ${MAX_COMMANDS} commands.`);
    return report;
  }
  const next = [];
  const ids = new Set();
  doc.commands.forEach((item, i) => {
    const e = cleanCommand(item, 'yours');
    const why = commandRefusal(e) || (ids.has(e.id) ? 'the id is used twice' : '');
    if (why) report.errors.push(`Command ${i + 1}${e && e.id ? ` (${e.id})` : ''}: ${why}.`);
    else { ids.add(e.id); next.push(e); }
  });
  if (report.errors.length) return report;

  const current = loadCatalog();
  const before = new Map(current.yours.map((e) => [e.id, JSON.stringify(commandToDoc(e))]));
  const builtinIds = new Set(current.builtin.map((e) => e.id));
  const added = next.filter((e) => !before.has(e.id)).map((e) => e.id);
  const changed = next.filter((e) => before.has(e.id) && before.get(e.id) !== JSON.stringify(commandToDoc(e))).map((e) => e.id);
  const removed = [...before.keys()].filter((id) => !ids.has(id));
  const overrides = next.filter((e) => builtinIds.has(e.id)).map((e) => e.id);
  // A command of yours that a button's action uses cannot go: the action would be left with a step that runs nothing.
  for (const id of removed.filter((x) => !builtinIds.has(x))) {
    const by = usedBy(id);
    if (by.length) report.errors.push(`It removes ${id}, which is used by ${describeUses(by)} — take it off the button first.`);
  }
  if (report.errors.length) return report;
  report.notes.push(`${next.length} command${next.length === 1 ? '' : 's'} of yours.`);
  if (added.length) report.notes.push(`Adds ${added.join(', ')}.`);
  if (changed.length) report.notes.push(`Changes ${changed.join(', ')}.`);
  if (removed.length) report.notes.push(`Removes ${removed.join(', ')}.`);
  if (overrides.length) report.notes.push(`Your version of the built-in ${overrides.join(', ')}.`);
  if (!added.length && !changed.length && !removed.length) report.notes.push('Nothing changes.');
  report.next = next;
  return report;
}

// ---------------------------------------------------------------- scripts

/**
 * Every cmd-*.sh in the tree, grouped by the workspace folder it lives in. commands/ is not a registered workspace
 * — its cmd-tools-commands.sh still belongs in the list. What each one says about itself is read from the script,
 * so it cannot fall out of step with an edit made by someone who did not know a list existed.
 */
function listScripts() {
  const all = loadWorkspaces();
  const groups = [];
  for (const key of [...Object.keys(all), 'commands']) {
    const dir = all[key] ? all[key].dir : path.join(ROOT, key);
    const label = all[key] ? all[key].label : key.charAt(0).toUpperCase() + key.slice(1);
    let files = [];
    try {
      // Builders first in their order, then the tools in theirs — Settings → Command order, over the
      // shipped default. Alphabetical used to drop `cmd-tools-backup-dev.sh` between two Webship
      // builders, which reads as a mistake before it reads as an order. Lazy require: build-order.js
      // reads CONFIG_DIR from workspaces.js, and this module is already in that neighbourhood.
      files = require('./build-order').sortCommands(
        fs.readdirSync(dir).filter((f) => SCRIPT_RE.test(f)), key);
    } catch (_) { continue; }
    if (!files.length) continue;
    groups.push({
      key,
      label,
      dir,
      items: files.map((f) => ({
        file: f,
        label: builderLabel(dir, f),
        title: commandTitle(dir, f),
        desc: commandDescription(dir, f),
      })),
    });
  }
  return groups;
}

/** The scripts as catalog entries, so one list can show, search and filter all of them. */
function scriptEntries(groups) {
  return groups.flatMap((g) => g.items.map((it) => ({
    id: `${g.key}/${it.file}`,
    source: 'script',
    label: it.title || it.file,
    file: it.file,
    workspace: g.key,
    group: `Scripts · ${g.label}`,
    description: it.desc && it.desc !== it.title ? it.desc : '',
    on: 'workspace',
    when: ['any'],
    run: '',
    script: `${g.key}/${it.file}`,
    args: '',
    options: [],
    confirm: false,
    open: 'toast',
    tags: [],
  })));
}

function filterCommands(list, { q = '', source = 'all', on = 'all' } = {}) {
  const needle = String(q || '').trim().toLowerCase();
  return list.filter((e) => {
    if (source !== 'all' && e.source !== source) return false;
    if (on !== 'all' && e.on !== on) return false;
    if (!needle) return true;
    return [e.id, e.label, e.group, e.description, e.run, e.script, e.args, ...(e.tags || [])].join(' ').toLowerCase().includes(needle);
  });
}

// ---------------------------------------------------------------- on buttons

/** The row actions whose steps use this command. */
function usedBy(id) {
  return rl.loadRowLayout().custom.filter((c) => c.steps.some((s) => s.use === id));
}

function describeUses(actions) {
  return actions.map((a) => `${rl.buttonLabel(a.button)} → ${a.group} → ${a.label}`).join(', ');
}

/**
 * The line a `use:` step runs from a project row. A command that runs on a project or a folder runs in the project
 * (its folder is the project itself); one that runs on a workspace folder, and a script, runs from its own folder.
 * Its {{opt.name}} placeholders are left for the action, which asks for the options and fills them.
 */
function stepLine(cmd, { workspace, project, projectDir }, env = { workspaceDir, exists: fs.existsSync }) {
  if (cmd.on === 'file') return { error: `${cmd.label} runs on a file, and a project row gives no file to run it on` };
  const wsDir = env.workspaceDir(workspace);
  const vars = {
    workspace,
    project: cmd.on === 'workspace' ? '' : project,
    folder: cmd.on === 'folder' ? '.' : '',
    file: '',
    path: cmd.on === 'workspace' ? wsDir : projectDir,
  };
  const fillVars = (t) => t.replace(PLACEHOLDER_ANY_RE, (whole, name) => (VARS.includes(name) ? shq(vars[name]) : whole));
  let body;
  let dir = '';
  if (cmd.run) {
    body = fillVars(cmd.run);
    if (cmd.on === 'workspace') dir = wsDir;
  } else {
    const file = scriptPath(cmd, env);
    if (!file || !env.exists(file)) return { error: `${cmd.label} runs ${cmd.script}, which does not exist` };
    body = `bash ${shq(file)}${cmd.args ? ` ${fillVars(cmd.args)}` : ''}`;
    dir = path.dirname(file);
  }
  if (dir && !SAFE_DIR_RE.test(dir)) return { error: `${cmd.label} runs from a folder whose path a shell line cannot carry safely` };
  return { command: dir ? `( cd ${shq(dir)} && ${body} )` : body };
}

/** An action with each use: step replaced by that command's line, for the project it runs on — or why not. */
function expandSteps(entry, ctx, env) {
  const steps = [];
  for (const [i, s] of entry.steps.entries()) {
    if (!s.use) { steps.push(s); continue; }
    const cmd = findCommand(s.use);
    if (!cmd) return { error: `step ${i + 1} uses ${s.use}, which is not a command any more` };
    const line = stepLine(cmd, ctx, env);
    if (line.error) return { error: `step ${i + 1}: ${line.error}` };
    steps.push({ command: line.command, onError: s.onError, use: '' });
  }
  return { entry: { ...entry, steps } };
}

// ---------------------------------------------------------------- running

const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch (_) { return false; } };

/** The folders a target's project can be picked from. */
function listFolders(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.') && NAME_RE.test(d.name))
      .map((d) => d.name).sort().slice(0, 500);
  } catch (_) { return []; }
}

/**
 * Where a command runs and the values it gets, from what a run form picked — or why not.
 *
 *   workspace  the workspace folder
 *   project    a project folder in it
 *   folder     a folder inside the workspace, or inside a project when one is picked (empty: that folder itself)
 *   file       a file there; the command runs from the workspace or project folder, and {{file}} is relative to it
 *
 * The path is resolved and must still be inside the workspace or project, so a link cannot lead out of it.
 */
function resolveTarget(e, form = {}, env = { isValidWorkspace, workspaceDir }) {
  const ws = str(form.target_ws);
  if (!env.isValidWorkspace(ws)) return { error: 'Pick a workspace.' };
  const wsDir = env.workspaceDir(ws);
  const project = e.on === 'workspace' ? '' : str(form.target_project);
  let base = wsDir;
  if (project) {
    if (!NAME_RE.test(project)) return { error: 'That is not a project name.' };
    base = path.join(wsDir, project);
    if (!isDir(base)) return { error: `There is no ${project} folder in ${ws}.` };
  } else if (e.on === 'project') {
    return { error: 'Pick a project.' };
  }
  const rel = (e.on === 'folder' || e.on === 'file') ? str(form.target_path).replace(/^(\.\/)+/, '').replace(/\/+$/, '') : '';
  let target = base;
  if (e.on === 'file' && !rel) return { error: 'Name the file.' };
  if (rel) {
    if (!REL_PATH_RE.test(rel) || rel.split('/').some((s) => s === '.' || s === '..')) {
      return { error: 'The path is a relative path inside the target: names with letters, digits, spaces and . _ - @ + ~ , ( ), joined by /.' };
    }
    let real;
    let realBase;
    try {
      real = fs.realpathSync(path.join(base, rel));
      realBase = fs.realpathSync(base);
    } catch (_) { return { error: `There is nothing at ${rel}.` }; }
    if (real !== realBase && !real.startsWith(realBase + path.sep)) return { error: `${rel} leads outside ${project || ws}.` };
    target = path.join(base, rel);
  }
  let st;
  try { st = fs.statSync(target); } catch (_) { return { error: `There is nothing at ${rel || project || ws}.` }; }
  if (e.on === 'folder' && !st.isDirectory()) return { error: `${rel} is not a folder.` };
  if (e.on === 'file' && !st.isFile()) return { error: `${rel} is not a file.` };

  const cwd = e.on === 'folder' ? target : base;
  if (!SAFE_DIR_RE.test(cwd)) return { error: 'The folder path has characters a shell line cannot carry safely.' };
  const vars = {
    workspace: ws,
    project,
    folder: e.on === 'folder' ? (rel || '.') : (e.on === 'file' ? path.dirname(rel) : ''),
    file: e.on === 'file' ? rel : '',
    path: target,
  };
  if (Object.values(vars).some((v) => /[$`\r\n\0]/.test(v))) return { error: 'The target has a $, a backtick or a line break in its path.' };
  const where = [project, rel].filter(Boolean).join('/');
  return { ws, project, rel, base, cwd, target, vars, where, name: [ws, where].filter(Boolean).join('/') };
}

/** Names to offer while a path is typed: what is in the folder the typed part ends in (folders only, for a folder). */
function pathSuggestions(e, form = {}, env = { isValidWorkspace, workspaceDir }) {
  const ws = str(form.target_ws);
  if (!env.isValidWorkspace(ws)) return [];
  const project = str(form.target_project);
  let base = env.workspaceDir(ws);
  if (project) {
    if (!NAME_RE.test(project)) return [];
    base = path.join(base, project);
  }
  const typed = str(form.target_path);
  const dirPart = typed.includes('/') ? typed.slice(0, typed.lastIndexOf('/')) : '';
  if (dirPart && (!REL_PATH_RE.test(dirPart) || dirPart.split('/').some((s) => s === '.' || s === '..'))) return [];
  const dir = path.join(base, dirPart);
  try {
    const realBase = fs.realpathSync(base);
    const real = fs.realpathSync(dir);
    if (real !== realBase && !real.startsWith(realBase + path.sep)) return [];
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((d) => !d.name.startsWith('.') && REL_PATH_RE.test(d.name) && (e.on !== 'folder' || d.isDirectory()))
      .map((d) => `${dirPart ? `${dirPart}/` : ''}${d.name}${d.isDirectory() ? '/' : ''}`)
      .sort().slice(0, 200);
  } catch (_) { return []; }
}

const shq = (v) => `'${String(v).replace(/'/g, "'\\''")}'`;

function fill(text, vars, values) {
  return text.replace(PLACEHOLDER_ANY_RE, (whole, name) => {
    if (name.startsWith('opt.')) return shq(values[name.slice(4)] === undefined ? '' : values[name.slice(4)]);
    return VARS.includes(name) ? shq(vars[name] === undefined ? '' : vars[name]) : whole;
  });
}

function scriptPath(e, env = { workspaceDir }) {
  const m = SCRIPT_REF_RE.exec(e.script || '');
  if (!m) return null;
  return path.join(m[1] === 'commands' ? path.join(ROOT, 'commands') : env.workspaceDir(m[1]), m[2]);
}

/** The line a run hands to its screen session, with the markers the Activity tab reads its result from. */
function commandLine(e, vars = {}, values = {}, env = { workspaceDir }) {
  const body = e.run
    ? fill(e.run, vars, values)
    : `bash ${shq(scriptPath(e, env))}${e.args ? ` ${fill(e.args, vars, values)}` : ''}`;
  return `{ ${body} ; } && echo "ROW-ACTION succeeded" || echo "ROW-ACTION failed"`;
}

module.exports = {
  ON,
  VARS,
  ID_RE,
  SCRIPT_REF_RE,
  MAX_COMMANDS,
  defaultsFile,
  userFile,
  cleanCommand,
  commandRefusal,
  commandToDoc,
  lineOf,
  loadCatalog,
  invalidateCatalog,
  findCommand,
  saveYourCommands,
  definitionText,
  checkDefinition,
  listScripts,
  scriptEntries,
  filterCommands,
  listFolders,
  resolveTarget,
  pathSuggestions,
  scriptPath,
  commandLine,
  usedBy,
  describeUses,
  stepLine,
  expandSteps,
};
