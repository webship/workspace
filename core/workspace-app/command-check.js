/**
 * The commands the workspace needs on this machine: found, with the version, or missing, with how to
 * install it. It reports; it never installs anything and never uses sudo.
 *
 * Who needs a command says so in the shape a plugin's manifest uses:
 *
 *   "needs":    { "plugins": [["dev", "test"]], "commands": ["upsun", "container:twg", ["curl", "wget"]] },
 *   "suggests": { "commands": [{ "command": "pandoc", "hint": "https://pandoc.org/installing.html" }] }
 *
 * An entry is a command's name, a list of names when any one will do, or `{ command | anyOf, where,
 * hint, for }`. `where` (or a `where:` prefix) says which machine: `host` (the default: where the
 * cmd-*.sh run), `container` (the dashboard's container) or `project` (the project's own container,
 * which exists only once a project is built, so it is listed and not checked). `needs.commands` are
 * what the owner cannot work without; `suggests.commands` are what a part of it uses. The core's own
 * list is core/scripts/needs.json; a plugin's is in its manifest.
 *
 *   node command-check.js [core|plugins|all|<plugin>] [--json]     exit 1 when a needed command is missing
 *
 * Plain Node, no dependencies for the core's list: `webship-workspace init` runs it before npm install.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const CORE_NEEDS = path.join(__dirname, '..', 'scripts', 'needs.json');
const WHERE = ['host', 'container', 'project'];
const CMD_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/;
// This workspace: the dashboard's folder and the tree it belongs to.
const APP_DIR = __dirname;
const WORKSPACE_ROOT = path.resolve(__dirname, '..', '..');

/** Packages whose name is not the command's, per package manager; everything else installs under its own name. */
const PACKAGES = {
  awk: { apt: 'gawk', dnf: 'gawk', brew: 'gawk' },
  node: { apt: 'nodejs', dnf: 'nodejs', brew: 'node' },
  npm: { apt: 'npm', dnf: 'nodejs-npm', brew: 'node' },
  python3: { apt: 'python3', dnf: 'python3', brew: 'python' },
  docker: { apt: 'docker.io', dnf: 'docker', brew: '--cask docker' },
  script: { apt: 'bsdutils', dnf: 'util-linux', brew: 'util-linux' },
  ssh: { apt: 'openssh-client', dnf: 'openssh-clients', brew: 'openssh' },
  // The database clients a pull uses: there is no package called mysqldump or pg_dump (#437).
  mysqldump: { apt: 'default-mysql-client', dnf: 'community-mysql', brew: 'mysql-client' },
  pg_dump: { apt: 'postgresql-client', dnf: 'postgresql', brew: 'libpq' },
};

/** How to install a command, in plain words: the owner's hint, or the package on the common systems. */
function hintFor(name, given = '') {
  if (given) return /^https?:\/\//.test(given) ? `see ${given}` : given;
  const p = PACKAGES[name] || {};
  return `Debian/Ubuntu: apt install ${p.apt || name} · Fedora: dnf install ${p.dnf || name} · macOS (Homebrew): brew install ${p.brew || name}`;
}

/** A manifest's needs or suggests: a list is the plugins; an object holds `plugins` and `commands`. */
function split(value) {
  if (value == null) return { plugins: undefined, commands: undefined, problems: [] };
  if (Array.isArray(value)) return { plugins: value, commands: undefined, problems: [] };
  if (typeof value !== 'object') return { plugins: value, commands: undefined, problems: [] };
  const extra = Object.keys(value).filter((k) => k !== 'plugins' && k !== 'commands');
  return { plugins: value.plugins, commands: value.commands, problems: extra.map((k) => `"${k}" is not a kind of need (plugins, commands)`) };
}

/** The commands of one list as `{ anyOf, where, hint, for }`, and what is wrong with it. */
function commandEntries(list) {
  const entries = [];
  const problems = [];
  if (list == null) return { entries, problems };
  if (!Array.isArray(list)) return { entries, problems: ['commands must be a list'] };
  for (const raw of list) {
    const obj = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : { anyOf: Array.isArray(raw) ? raw : [raw] };
    let names = obj.anyOf || (obj.command !== undefined ? [obj.command] : []);
    if (!Array.isArray(names)) names = [names];
    let where = obj.where || '';
    // "container:twg": the place rides on the name.
    names = names.map((n) => {
      const m = typeof n === 'string' && n.match(/^(host|container|project):(.+)$/);
      if (m) { where = where || m[1]; return m[2]; }
      return n;
    });
    where = where || 'host';
    if (!names.length || names.some((n) => typeof n !== 'string' || !CMD_RE.test(n)) || !WHERE.includes(where)) {
      problems.push(`${JSON.stringify(raw)} is not a command, a list of commands or { command, where, hint }`);
      continue;
    }
    entries.push({ anyOf: [...new Set(names)], where, hint: typeof obj.hint === 'string' ? obj.hint : '', for: typeof obj.for === 'string' ? obj.for : '' });
  }
  return { entries, problems };
}

/** Whether this process is inside a container (the dashboard's, when the dashboard asks). */
function inContainer() {
  return !!process.env.IS_DDEV_PROJECT || fs.existsSync('/.dockerenv');
}

/** The full path of a command on PATH, or ''. No shell: the name is looked for, never run. */
function findOnPath(name, envPath = process.env.PATH || '') {
  if (!CMD_RE.test(name)) return '';
  for (const dir of envPath.split(path.delimiter).filter(Boolean)) {
    const file = path.join(dir, name);
    try {
      if (fs.statSync(file).isFile()) { fs.accessSync(file, fs.constants.X_OK); return file; }
    } catch (_) { /* not here */ }
  }
  return '';
}

/** The version a command reports, or '' — asked the ways commands answer, each with a short time limit. */
function versionOf(file) {
  for (const arg of ['--version', '-v', '-V', 'version']) {
    let r;
    try { r = spawnSync(file, [arg], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, LC_ALL: 'C' } }); } catch (_) { continue; }
    if (!r || r.error) continue;
    const m = `${r.stdout || ''}\n${r.stderr || ''}`.match(/\d+\.\d+(?:\.\d+)*(?:[-+~][0-9A-Za-z.]+)?/);
    if (m && (r.status === 0 || arg !== '--version')) return m[0];
    if (m) return m[0];
  }
  return '';
}

// The dashboard only looks where it runs: it never reaches into another machine to draw a page.
let localOnly = false;

const cache = new Map();   // "where:name" -> { at, found, path, version, why }
const CACHE_MS = 5 * 60 * 1000;   // a page that lists them must not start forty processes on every load

const NOT_RUNNING = 'in the dashboard\'s container, which is not running';

/** The DDEV project of this workspace's dashboard: `name:` in its .ddev/config.yaml, else `workspace`. */
function dashboardProject() {
  try {
    const m = fs.readFileSync(path.join(APP_DIR, '.ddev', 'config.yaml'), 'utf8').match(/^name:[ \t]*["']?([A-Za-z0-9][A-Za-z0-9._-]*)/m);
    if (m) return m[1];
  } catch (_) { /* no config: DDEV's default for this folder */ }
  return 'workspace';
}

let chosen = null;   // { at, name } or { at, why }
/**
 * The container to ask about `where: container`, or why there is none. WORKSPACE_DASHBOARD_CONTAINER
 * names it outright (an empty value: there is none to ask). Otherwise it is this workspace's own,
 * ddev-<project>-web, and only when it has this workspace mounted: on a machine with two workspaces,
 * or for a throwaway tree, the one that is up may serve another tree, and its answers are not this
 * one's (#628).
 */
function dashboardContainer(docker) {
  if (chosen && Date.now() - chosen.at < CACHE_MS) return chosen;
  let out;
  if (process.env.WORKSPACE_DASHBOARD_CONTAINER !== undefined) {
    const named = process.env.WORKSPACE_DASHBOARD_CONTAINER;
    out = named ? { name: named } : { why: 'in the dashboard\'s container, and there is none to ask from here' };
  } else {
    const name = `ddev-${dashboardProject()}-web`;
    let r = null;
    try { r = spawnSync(docker, ['inspect', name, '--format', '{{range .Mounts}}{{println .Source}}{{end}}'], { encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (_) { r = null; }
    const real = (p) => { try { return fs.realpathSync(p); } catch (_) { return p; } };
    const mounts = r && !r.error && r.status === 0 ? (r.stdout || '').split('\n').map((l) => l.trim()).filter(Boolean).map(real) : null;
    if (!mounts) out = { why: NOT_RUNNING };
    else if (!mounts.includes(real(WORKSPACE_ROOT))) out = { why: 'in the dashboard\'s container: the one that is running serves another workspace' };
    else out = { name };
  }
  out.at = Date.now();
  chosen = out;
  return out;
}

/** One command in one place: `{ state: found|missing|unchecked, path, version, why }`. */
function look(name, where) {
  const key = `${where}:${name}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit;
  let out;
  const here = inContainer() ? 'container' : 'host';
  if (where === 'project') {
    out = { state: 'unchecked', why: 'in the project\'s own container: there once a project is built' };
  } else if (where === here) {
    const file = findOnPath(name);
    out = file ? { state: 'found', path: file, version: versionOf(file) } : { state: 'missing' };
  } else if (where === 'host') {
    out = { state: 'unchecked', why: 'on the host: run `webship-workspace doctor` in a terminal there' };
  } else if (localOnly) {
    out = { state: 'unchecked', why: 'in the dashboard\'s container: this dashboard runs outside one' };
  } else {
    // From the host, this workspace's dashboard container is asked through docker, when it is running.
    const docker = findOnPath('docker');
    const target = docker ? dashboardContainer(docker) : { why: NOT_RUNNING };
    let r = null;
    if (target.name) {
      try { r = spawnSync(docker, ['exec', target.name, 'sh', '-c', `command -v ${name}`], { encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (_) { r = null; }
    }
    if (!target.name) {
      out = { state: 'unchecked', why: target.why };
    } else if (!r || r.error || (r.status !== 0 && /No such container|is not running|Cannot connect|permission denied/i.test(r.stderr || ''))) {
      out = { state: 'unchecked', why: NOT_RUNNING };
    } else if (r.status === 0 && (r.stdout || '').trim()) {
      out = { state: 'found', path: (r.stdout || '').trim().split('\n')[0], version: '' };
    } else {
      out = { state: 'missing' };
    }
  }
  out.at = Date.now();
  cache.set(key, out);
  return out;
}

/** One entry checked: the first alternative that is found, else missing (or unchecked when it cannot be looked for from here). */
function checkEntry(entry, kind, owner) {
  const looks = entry.anyOf.map((n) => ({ name: n, ...look(n, entry.where) }));
  const found = looks.find((l) => l.state === 'found');
  const state = found ? 'found' : (looks.every((l) => l.state === 'unchecked') ? 'unchecked' : 'missing');
  return { owner, kind, anyOf: entry.anyOf, where: entry.where, for: entry.for, state,
    name: found ? found.name : entry.anyOf[0], path: found ? found.path : '', version: found ? found.version : '',
    why: state === 'unchecked' ? looks[0].why : '', hint: state === 'missing' ? hintFor(entry.anyOf[0], entry.hint) : '' };
}

/** Every command one owner declares, checked: `{ owner, rows, problems }`. `source` is `{ needs, suggests }`. */
function checkOwner(owner, source = {}) {
  const rows = [];
  const problems = [];
  for (const kind of ['needs', 'suggests']) {
    const { commands } = split(source[kind]);
    const { entries, problems: bad } = commandEntries(commands);
    for (const b of bad) problems.push(`${kind}: ${b}`);
    for (const e of entries) rows.push(checkEntry(e, kind, owner));
  }
  return { owner, rows, problems };
}

/** The core's own list. */
function checkCore(file = CORE_NEEDS) {
  let source = {};
  try { source = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return { owner: 'core', rows: [], problems: [`${file} cannot be read`] }; }
  return checkOwner('core', source);
}

/** One plugin's list, from its manifest, or null when no such plugin package is here. */
function checkPlugin(name) {
  const { pluginByName } = require('./plugin-manifest');
  const p = pluginByName(name);
  return p ? checkOwner(name, p.manifest) : null;
}

/** Every plugin package's list (only the ones that declare commands). */
function checkPlugins() {
  const { installedPlugins } = require('./plugin-manifest');
  return installedPlugins().map((p) => checkOwner(p.name, p.manifest)).filter((r) => r.rows.length || r.problems.length);
}

const missingNeeded = (reports) => reports.flatMap((r) => r.rows).filter((r) => r.kind === 'needs' && r.state === 'missing');
const missingSuggested = (reports) => reports.flatMap((r) => r.rows).filter((r) => r.kind === 'suggests' && r.state === 'missing');

/** One row as a line of text. */
function rowText(r) {
  const what = r.anyOf.length > 1 ? `one of ${r.anyOf.join(', ')}` : r.anyOf[0];
  const place = r.where === 'host' ? '' : ` (${r.where})`;
  const label = `${what}${place}`.padEnd(26);
  if (r.state === 'found') return `  ✓ ${label} ${(r.version || 'found').padEnd(14)} ${r.path}`;
  if (r.state === 'unchecked') return `  · ${label} not checked: ${r.why}`;
  return `  ✗ ${label} missing — ${r.kind === 'needs' ? 'needed' : 'suggested'}${r.for ? ` for ${r.for}` : ''}\n      install: ${r.hint}`;
}

/** A whole report as text: one block per owner, then what it comes to. */
function reportText(reports) {
  const lines = [];
  for (const rep of reports) {
    if (!rep.rows.length && !rep.problems.length) continue;
    lines.push(rep.owner === 'core' ? 'The core of Webship Workspace:' : `The plugin ${rep.owner}:`);
    for (const p of rep.problems) lines.push(`  ! ${p}`);
    for (const kind of ['needs', 'suggests']) {
      const rows = rep.rows.filter((r) => r.kind === kind);
      if (!rows.length) continue;
      lines.push(kind === 'needs' ? ' needs' : ' a part of it uses');
      for (const r of rows) lines.push(rowText(r));
    }
  }
  const need = missingNeeded(reports);
  const soft = missingSuggested(reports);
  const names = (rows) => [...new Set(rows.map((r) => `${r.anyOf[0]}${r.where === 'host' ? '' : ` (${r.where})`}`))].join(', ');
  lines.push('');
  if (!need.length && !soft.length) lines.push('Every command that could be checked from here is found.');
  if (need.length) lines.push(`Missing and needed: ${names(need)}. Install ${need.length > 1 ? 'them' : 'it'} yourself; nothing is installed for you.`);
  if (soft.length) lines.push(`Missing, used by a part only: ${names(soft)}. That part does not work until ${soft.length > 1 ? 'they are' : 'it is'} installed.`);
  return lines.join('\n');
}

/** The short form a step prints before it starts: only what is missing, or '' when nothing is. */
function missingText(reports) {
  const lines = [];
  for (const r of [...missingNeeded(reports), ...missingSuggested(reports)]) lines.push(rowText(r).replace(/^ {2}✗/, `  ✗ ${r.owner}:`));
  return lines.join('\n');
}

module.exports = { split, commandEntries, findOnPath, versionOf, hintFor, inContainer, checkOwner, checkCore, checkPlugin, checkPlugins,
  missingNeeded, missingSuggested, reportText, missingText, rowText, CORE_NEEDS, clearCache: () => { cache.clear(); chosen = null; }, setLocalOnly: (on = true) => { localOnly = !!on; cache.clear(); chosen = null; } };

if (require.main === module) {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const short = args.includes('--missing');
  const scope = args.find((a) => !a.startsWith('--')) || 'all';
  let reports;
  if (scope === 'core') reports = [checkCore()];
  else if (scope === 'plugins') reports = checkPlugins();
  else if (scope === 'all') { reports = [checkCore()]; try { reports.push(...checkPlugins()); } catch (_) { /* the dashboard is not installed yet: the core alone */ } }
  else {
    const one = checkPlugin(scope);
    if (!one) { process.stderr.write(`No plugin named '${scope}' is installed in the dashboard.\n`); process.exit(2); }
    reports = [one];
  }
  if (json) process.stdout.write(`${JSON.stringify(reports, null, 2)}\n`);
  else if (short) { const t = missingText(reports); if (t) process.stdout.write(`${t}\n`); }
  else {
    const text = reportText(reports);
    process.stdout.write(`${scope !== 'core' && scope !== 'all' && scope !== 'plugins' && !reports[0].rows.length ? `The plugin ${scope} declares no commands.\n` : ''}${text}\n`);
  }
  process.exit(missingNeeded(reports).length || reports.some((r) => r.problems.length) ? 1 : 0);
}
