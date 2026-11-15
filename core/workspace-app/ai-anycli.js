/**
 * AI items and cmd-* commands from several repositories, into any AI CLI.
 *
 * Two stages, so every source feeds every CLI:
 *
 *   SOURCES (GitHub, GitLab, Bitbucket, skills.sh)  ->  the workspace folder  ->  the AI CLIs
 *
 * The folder (ai-agents/, ai-skills/, ai-commands/, ai-prompts/) holds an item once, in one shape (the
 * Claude Code one). A source places items there and records them in a lock file, one entry per source,
 * so check, update and remove work per source. An install converts the item to what one CLI reads and
 * writes it where that CLI's documentation says. The `cmd` kind does the first stage for cmd-*.sh.
 *
 * Nothing about a CLI is in this file: the CLIs are data (core/config/ai.defaults.yml, with this
 * machine's core/config/ai.settings.yml merged over it). What is here is the small set of converters
 * those entries name, and the rules.
 *
 * What is fetched is untrusted. It is cloned with hooks off into a temporary folder, only regular
 * files are copied, without their execute bit, each one is named in the output, and nothing fetched
 * is ever run, sourced or handed to an interpreter. No token is written anywhere.
 *
 * Used by ai-anycli-cli.js (the terminal) and ai-anycli-page.js (the dashboard), so the two cannot
 * disagree about a state.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const yaml = require('js-yaml');

/* ------------------------------------------------------------------ where things are */

const APP_ROOT = path.resolve(__dirname, '..', '..');
const root = () => process.env.WORKSPACE_ROOT || APP_ROOT;
const configDir = () => process.env.WORKSPACE_CONFIG || path.join(root(), 'core', 'config');
const home = () => process.env.HOME || os.homedir();

const AI_KINDS = ['ai-agents', 'ai-skills', 'ai-commands', 'ai-prompts'];
const KINDS = [...AI_KINDS, 'cmd'];
const KIND_NOUN = { 'ai-agents': 'agent', 'ai-skills': 'skill', 'ai-commands': 'command', 'ai-prompts': 'prompt', cmd: 'cmd-* command' };

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const ID_RE = /^[a-z0-9][a-z0-9_-]*$/;
const FOLDER_RE = /^[a-z0-9][a-z0-9_-]*$/;
const CMD_RE = /^cmd-[A-Za-z0-9_.-]+\.sh$/;
const NOT_ITEMS = new Set(['README.md', 'AGENTS.md', 'CLAUDE.md', 'RULES.md', 'GEMINI.md', 'QWEN.md']);

// What one fetched item may hold. A skill is a few text files; anything near these is not a skill.
const LIMITS = { files: 200, fileBytes: 2 * 1024 * 1024, totalBytes: 10 * 1024 * 1024 };

class AnyCliError extends Error {}
const fail = (message) => { throw new AnyCliError(message); };

function expandHome(p) {
  const s = String(p || '');
  if (s === '~') return home();
  if (s.startsWith('~/')) return path.join(home(), s.slice(2));
  return s;
}

/* ------------------------------------------------------------------ settings */

const isMap = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** Maps merge key by key; a scalar or a list in `over` replaces the one under it. */
function deepMerge(base, over) {
  if (!isMap(base) || !isMap(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = isMap(v) && isMap(base[k]) ? deepMerge(base[k], v) : v;
  return out;
}

function readYaml(file) {
  try { return yaml.load(fs.readFileSync(file, 'utf8')) || {}; } catch (_) { return {}; }
}

const defaultsFile = () => {
  const mine = path.join(configDir(), 'ai.defaults.yml');
  return fs.existsSync(mine) ? mine : path.join(__dirname, '..', 'config', 'ai.defaults.yml');
};
const settingsFile = () => path.join(configDir(), 'ai.settings.yml');

/** The shipped CLIs with this machine's file over them. Read on every call: a settings change needs no restart. */
function loadConfig() {
  const cfg = deepMerge(readYaml(defaultsFile()), readYaml(settingsFile()));
  cfg.clis = isMap(cfg.clis) ? cfg.clis : {};
  cfg.sources = isMap(cfg.sources) ? cfg.sources : {};
  cfg.roles = isMap(cfg.roles) ? cfg.roles : {};
  cfg.default_cli = String(cfg.default_cli || 'claude');
  return cfg;
}

const SETTINGS_HEADER = `# This machine's AI CLIs and sources. Merged over core/config/ai.defaults.yml key by key, and never
# replaced by an update. Written by the tooling (--source-add, --source-remove) and by hand: a CLI
# switched off, another default, a CLI of your own, a source. Comments in here are not kept when the
# tooling writes it. No token belongs in this file.
`;

/** Change this machine's file (never the shipped one). `change` gets the parsed file and edits it. */
function updateSettings(change) {
  const data = readYaml(settingsFile());
  change(data);
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), `${SETTINGS_HEADER}\n${yaml.dump(data, { lineWidth: 120, noRefs: true })}`);
}

/* ------------------------------------------------------------------ the AI CLIs and their states */

function onPath(command) {
  if (!command || !/^[A-Za-z0-9_.-]+$/.test(String(command))) return '';
  for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    const file = path.join(dir, String(command));
    try { fs.accessSync(file, fs.constants.X_OK); if (fs.statSync(file).isFile()) return file; } catch (_) { /* next */ }
  }
  return '';
}

/** signed in / signed out / unknown, from presence alone: no file is opened, no variable printed. */
function signInState(cli) {
  const files = Array.isArray(cli.signed_in) ? cli.signed_in : [];
  const vars = Array.isArray(cli.signed_in_env) ? cli.signed_in_env : [];
  if (!files.length && !vars.length) return 'unknown';
  if (files.some((f) => fs.existsSync(expandHome(f)))) return 'signed in';
  if (vars.some((v) => !!process.env[String(v)])) return 'signed in';
  return 'signed out';
}

/** Every CLI of the settings, in their order, with its states. `onlyEnabled` leaves the ones switched off out. */
function listClis(cfg = loadConfig(), { onlyEnabled = false } = {}) {
  const out = [];
  for (const [id, raw] of Object.entries(cfg.clis)) {
    if (!ID_RE.test(id) || !isMap(raw)) continue;
    const enabled = raw.enabled !== false;
    if (onlyEnabled && !enabled) continue;
    const command = String(raw.command || id);
    const where = onPath(command);
    out.push({
      id,
      label: String(raw.label || id),
      vendor: String(raw.vendor || ''),
      command,
      docs: String(raw.docs || ''),
      enabled,
      isDefault: id === cfg.default_cli,
      installed: !!where,
      commandPath: where,
      signIn: where ? signInState(raw) : 'unknown',
      kinds: isMap(raw.kinds) ? raw.kinds : {},
      run: Array.isArray(raw.run) ? raw.run.map(String) : null,
      agentArg: Array.isArray(raw.agent_arg) ? raw.agent_arg.map(String) : null,
      instructions: String(raw.instructions || ''),
    });
  }
  return out;
}

function cliById(id, cfg = loadConfig()) {
  const wanted = id === 'default' || !id ? cfg.default_cli : id;
  return listClis(cfg).find((c) => c.id === wanted) || null;
}

/** What a CLI's row says, in words: "on, default, installed, signed in". */
function cliStateWords(cli) {
  return [cli.enabled ? 'on' : 'off', ...(cli.isDefault ? ['default'] : []), cli.installed ? 'installed' : 'missing',
    ...(cli.installed ? [cli.signIn === 'unknown' ? 'sign-in unknown' : cli.signIn] : [])];
}

/* ------------------------------------------------------------------ sources: what a person may type */

function forgeOf(host) {
  if (host === 'github.com') return 'github';
  if (host === 'bitbucket.org') return 'bitbucket';
  return 'gitlab';
}

function cleanSubpath(p) {
  const s = String(p || '').replace(/^\/+|\/+$/g, '');
  if (!s) return '';
  if (s.split('/').some((part) => part === '..' || part === '.' || part === '')) fail(`Not a folder I will read: '${p}'.`);
  if (!/^[A-Za-z0-9_./-]+$/.test(s)) fail(`Not a folder I will read: '${p}'.`);
  return s;
}

function cleanRef(r) {
  const s = String(r || '');
  if (!s) return '';
  if (!/^[A-Za-z0-9_./-]+$/.test(s) || s.includes('..') || s.startsWith('-')) fail(`Not a branch or tag I will read: '${r}'.`);
  return s;
}

/**
 * A source, from what was typed, as { url, ref, path, forge, host, item, via }.
 *
 *   owner/repo, owner/repo@ref                         GitHub
 *   https://github.com/owner/repo[/tree/<ref>[/<folder>]]
 *   https://<gitlab host>/group[/sub]/project[/-/tree/<ref>[/<folder>]]      git.drupalcode.org, gitlab.com, your own
 *   https://bitbucket.org/workspace/repo[/src/<ref>[/<folder>]]
 *   skills.sh/owner/repo[/skill], https://skills.sh/owner/repo/skill         resolved to the GitHub repository, no call to skills.sh
 *
 * https only, no account in the address. `item` is the one item a skills.sh address names.
 */
function parseSource(input, { allowFile = process.env.AI_ITEMS_ALLOW_FILE === '1' } = {}) {
  const raw = String(input || '').trim();
  const no = () => fail(`Not a source I can read: '${raw}'. Use owner/repo, owner/repo@ref, an https:// address of a GitHub, GitLab or Bitbucket repository, or skills.sh/owner/repo/skill.`);
  if (!raw || /\s/.test(raw)) no();

  // A local repository, for the tests only (AI_ITEMS_ALLOW_FILE=1): never reachable from the dashboard.
  if (raw.startsWith('file://')) {
    if (!allowFile) no();
    return { url: raw, ref: '', path: '', forge: 'local', host: 'local', item: '', via: '' };
  }

  const skills = raw.match(/^(?:https:\/\/)?(?:www\.)?skills\.sh\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:\/([A-Za-z0-9_.-]+))?\/?$/);
  if (skills) {
    return { url: `https://github.com/${skills[1]}/${skills[2]}`, ref: '', path: '', forge: 'github', host: 'github.com', item: skills[3] || '', via: 'skills.sh' };
  }

  const short = raw.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:@([A-Za-z0-9_./-]+))?$/);
  if (short && !raw.includes('://')) {
    return { url: `https://github.com/${short[1]}/${short[2]}`, ref: cleanRef(short[3]), path: '', forge: 'github', host: 'github.com', item: '', via: '' };
  }

  let u;
  try { u = new URL(raw); } catch (_) { no(); }
  if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash || !/^[a-z0-9.-]+$/.test(u.hostname) || (u.port && !/^\d+$/.test(u.port))) no();
  const host = u.host;
  const forge = forgeOf(u.hostname);
  let parts = u.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
  if (parts.some((p) => p === '..' || p === '.' || !/^[A-Za-z0-9_.~-]+$/.test(p))) no();
  let ref = ''; let sub = '';
  const cut = (marker, drop) => {
    const i = parts.indexOf(marker);
    if (i < 0) return;
    const rest = parts.slice(i + 1);
    parts = parts.slice(0, i - drop);
    ref = rest[0] || ''; sub = rest.slice(1).join('/');
  };
  if (forge === 'github') cut('tree', 0);
  else if (forge === 'bitbucket') cut('src', 0);
  else if (parts.includes('-')) cut('tree', 1);            // GitLab: /group/project/-/tree/<ref>/<folder>
  if (parts.length < 2) no();
  if (forge !== 'gitlab' && parts.length !== 2) no();
  parts[parts.length - 1] = parts[parts.length - 1].replace(/\.git$/, '');
  return { url: `https://${host}/${parts.join('/')}`, ref: cleanRef(ref), path: cleanSubpath(sub), forge, host, item: '', via: '' };
}

/** A short id for a source nobody named: the repository's name, and the folder's when there is one. */
function defaultSourceId(src, taken = []) {
  const repo = src.url.replace(/\/+$/, '').split('/').slice(-2).join('-');
  let id = `${repo}${src.item ? `-${src.item}` : src.path ? `-${src.path.split('/').pop()}` : ''}`
    .toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'source';
  if (!/^[a-z0-9]/.test(id)) id = `s-${id}`;
  let n = 2; let candidate = id;
  while (taken.includes(candidate)) { candidate = `${id}-${n}`; n += 1; }
  return candidate;
}

/* ------------------------------------------------------------------ git, read only */

/**
 * The environment of one git call. Never prompts. For github.com the `gh` login is borrowed, the way
 * the rest of the tooling does; for another forge a token named in WORKSPACE_GIT_TOKEN (set by the
 * caller from the forge plugin's settings, for that one process) is answered by a helper that reads it
 * from the environment. No token is in an address, an argument, a file or the output.
 */
function gitEnv(src) {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'true', GCM_INTERACTIVE: 'never' };
  delete env.WORKSPACE_GIT_TOKEN;
  const pairs = [];
  if (src.forge === 'github' && onPath('gh')) pairs.push(['credential.https://github.com.helper', '!gh auth git-credential']);
  const token = forgeToken(src);
  if (token && src.forge !== 'github' && src.forge !== 'local') {
    env.WORKSPACE_GIT_TOKEN = token;
    const user = src.forge === 'bitbucket' ? 'x-token-auth' : 'oauth2';
    pairs.push([`credential.https://${src.host}.helper`, `!f() { echo username=${user}; echo "password=\${WORKSPACE_GIT_TOKEN}"; }; f`]);
  }
  env.GIT_CONFIG_COUNT = String(pairs.length);
  pairs.forEach(([k, v], i) => { env[`GIT_CONFIG_KEY_${i}`] = k; env[`GIT_CONFIG_VALUE_${i}`] = v; });
  return env;
}

/** The token the forge plugin (or settings.yml's git: block) holds for this host, or ''. Never logged. */
function forgeToken(src) {
  const real = (v) => (v && String(v) !== 'CHANGE_ME' ? String(v) : '');
  const plugin = (name) => readYaml(path.join(configDir(), `plugin.${name}.settings.yml`));
  const git = readYaml(path.join(configDir(), 'settings.yml')).git || {};
  if (src.forge === 'gitlab') {
    const p = plugin('gitlab');
    if (!p.host || String(p.host) === src.host) { const t = real(p.token); if (t) return t; }
    for (const block of Object.values(git)) if (isMap(block) && String(block.host) === src.host) return real(block.token);
  }
  if (src.forge === 'bitbucket') return real(plugin('bitbucket').token) || real((git.bitbucket || {}).token);
  return '';
}

function git(args, src, cwd) {
  return spawnSync('git', args, { cwd, env: gitEnv(src), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 });
}

/** The commit a source's branch (or its default one) is at, or '' when it cannot be reached. */
function remoteHead(src) {
  const r = git(['ls-remote', src.url, src.ref || 'HEAD'], src);
  if (r.status !== 0) return '';
  const lines = String(r.stdout || '').split('\n').filter(Boolean);
  const pick = lines.find((l) => /\trefs\/heads\//.test(l)) || lines[0] || '';
  return pick.split('\t')[0] || '';
}

/** A shallow copy in a temporary folder: hooks off, no submodules, no links followed. Returns { dir, commit, clean }. */
function cloneSource(src) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-source-'));
  const dir = path.join(tmp, 'repo');
  const clean = () => fs.rmSync(tmp, { recursive: true, force: true });
  const args = ['-c', 'core.hooksPath=/dev/null', '-c', 'advice.detachedHead=false',
    'clone', '--quiet', '--depth', '1', '--no-tags', '--single-branch', '--no-recurse-submodules',
    ...(src.ref ? ['--branch', src.ref] : []), '--', src.url, dir];
  const r = git(args, src);
  if (r.status !== 0) { clean(); return null; }
  const commit = String(git(['rev-parse', 'HEAD'], src, dir).stdout || '').trim();
  return { dir, commit, clean };
}

/** git's own id of a file or a folder at the fetched commit: what "did it move upstream" compares. */
function upstreamId(dir, rel, src) {
  const r = git(['rev-parse', `HEAD:${rel}`], src, dir);
  return r.status === 0 ? String(r.stdout || '').trim() : '';
}

/* ------------------------------------------------------------------ finding items in a repository */

const CONTAINERS = {
  'ai-agents': ['.claude/agents', 'agents', 'ai/agents', 'ai-agents'],
  'ai-skills': ['skills', '.claude/skills', '.agents/skills', 'ai/skills', 'ai-skills'],
  'ai-commands': ['.claude/commands', 'commands', 'ai/commands', 'ai-commands'],
  'ai-prompts': ['prompts', 'ai/prompts', 'ai-prompts'],
  cmd: ['commands'],
};

const isDir = (p) => { try { return fs.lstatSync(p).isDirectory(); } catch (_) { return false; } };
const isFile = (p) => { try { return fs.lstatSync(p).isFile(); } catch (_) { return false; } };

/**
 * The items of one kind in a checkout, as [{ name, rel }], `rel` being the path inside the repository.
 * Looked for in the folder asked for (or the root) and in the folders the kinds are kept in by
 * convention; a folder asked for that IS one skill is that skill.
 */
function discover(kind, dir, subpath = '') {
  const base = subpath ? path.join(dir, subpath) : dir;
  // A link in the repository may point anywhere: nothing is read through one, at any depth.
  const top = fs.realpathSync(dir);
  const inside = (p) => { try { const r = fs.realpathSync(p); return r === top || r.startsWith(`${top}${path.sep}`); } catch (_) { return false; } };
  if (!isDir(base) || !inside(base)) return [];
  const found = new Map();
  const add = (name, rel) => { if (NAME_RE.test(name) && !found.has(name)) found.set(name, rel.split(path.sep).join('/')); };
  const relOf = (p) => path.relative(dir, p);

  if (kind === 'ai-skills' && subpath && isFile(path.join(base, 'SKILL.md'))) {
    add(path.basename(base), relOf(base));
    return [...found].map(([name, rel]) => ({ name, rel }));
  }
  for (const container of ['', ...CONTAINERS[kind]]) {
    const where = container ? path.join(base, container) : base;
    if (!isDir(where) || !inside(where)) continue;
    for (const e of fs.readdirSync(where).sort()) {
      const full = path.join(where, e);
      if (!inside(full)) continue;
      if (kind === 'ai-skills') {
        if (isDir(full) && isFile(path.join(full, 'SKILL.md'))) add(e, relOf(full));
      } else if (kind === 'cmd') {
        if (CMD_RE.test(e) && isFile(full)) add(e, relOf(full));
      } else if (e.endsWith('.md') && !NOT_ITEMS.has(e) && isFile(full)) {
        // In the root of a repository a .md file is its documentation, not an item.
        if (!container && !subpath) continue;
        add(e.slice(0, -3), relOf(full));
      }
    }
  }
  return [...found].map(([name, rel]) => ({ name, rel }));
}

/* ------------------------------------------------------------------ files: hashing and placing */

/** Every regular file under a path, as [relative path, absolute path]; a link or anything else is in `skipped`. */
function regularFiles(p) {
  const files = []; const skipped = [];
  const st = fs.lstatSync(p);
  if (st.isFile()) return { files: [['', p]], skipped };
  if (!st.isDirectory()) return { files, skipped: [path.basename(p)] };
  const walk = (d, rel) => {
    for (const e of fs.readdirSync(d).sort()) {
      if (e === '.git') continue;
      const full = path.join(d, e);
      const r = rel ? `${rel}/${e}` : e;
      const s = fs.lstatSync(full);
      if (s.isDirectory()) walk(full, r);
      else if (s.isFile()) files.push([r, full]);
      else skipped.push(r);
    }
  };
  walk(p, '');
  return { files, skipped };
}

/** One hash for a file or a folder: of the names and the contents, in order. '' when it is not there. */
function contentHash(p) {
  if (!fs.existsSync(p)) return '';
  const h = crypto.createHash('sha256');
  for (const [rel, full] of regularFiles(p).files) { h.update(`${rel}\0`); h.update(fs.readFileSync(full)); h.update('\0'); }
  return h.digest('hex');
}

/** Copy one fetched item to its place: regular files only, within the limits, written 0644. Returns what was written. */
function placeItem(from, to) {
  const { files, skipped } = regularFiles(from);
  if (files.length > LIMITS.files) fail(`${path.basename(to)} holds ${files.length} files (the limit is ${LIMITS.files}).`);
  let total = 0;
  for (const [, full] of files) {
    const size = fs.statSync(full).size;
    if (size > LIMITS.fileBytes) fail(`${path.basename(to)}: ${path.basename(full)} is ${size} bytes (the limit for one file is ${LIMITS.fileBytes}).`);
    total += size;
  }
  if (total > LIMITS.totalBytes) fail(`${path.basename(to)} is ${total} bytes (the limit is ${LIMITS.totalBytes}).`);
  fs.rmSync(to, { recursive: true, force: true });
  const written = [];
  for (const [rel, full] of files) {
    const dest = rel ? path.join(to, rel) : to;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, fs.readFileSync(full), { mode: 0o644 });
    fs.chmodSync(dest, 0o644);
    written.push({ file: rel || path.basename(to), bytes: fs.statSync(dest).size });
  }
  return { written, skipped };
}

/* ------------------------------------------------------------------ the lock */

function kindFolder(kind) {
  if (!AI_KINDS.includes(kind)) fail(`Unknown kind '${kind}'. One of: ${KINDS.join(', ')}.`);
  const dir = path.join(root(), kind);
  if (!isDir(dir)) fail(`There is no ${kind}/ workspace here. Add it first: webship-workspace plugin require ${kind}, then activate and install.`);
  return dir;
}

function lockFile(kind) {
  if (kind === 'cmd') return path.join(configDir(), 'cmd-sources.lock.json');
  return path.join(root(), kind, '.ai-sources.lock.json');
}

function readLock(kind) {
  try {
    const data = JSON.parse(fs.readFileSync(lockFile(kind), 'utf8'));
    if (isMap(data) && isMap(data.sources)) return data;
  } catch (_) { /* a first run */ }
  return { version: 1, sources: {} };
}

function writeLock(kind, lock) {
  fs.mkdirSync(path.dirname(lockFile(kind)), { recursive: true });
  fs.writeFileSync(lockFile(kind), `${JSON.stringify(lock, null, 2)}\n`);
}

/** Where a source's item sits, relative to the workspace root. */
function itemPlace(kind, name, src) {
  if (kind === 'cmd') return `${src.to}/${name}`;
  return kind === 'ai-skills' ? `${kind}/${name}` : `${kind}/${name}.md`;
}

/* ------------------------------------------------------------------ states */

/** One locked item's state, from the lock and the files here. No network. */
function itemState(entry) {
  const here = path.join(root(), entry.to);
  if (!fs.existsSync(here)) return 'missing here';
  const changed = contentHash(here) !== entry.placed;
  if (entry.gone) return changed ? 'changed locally, removed upstream' : 'removed upstream';
  const behind = !!entry.latest && entry.latest !== entry.upstream;
  if (changed) return behind ? 'changed locally, behind' : 'changed locally';
  return behind ? 'behind' : 'current';
}

function sourcesOf(kind, cfg = loadConfig()) {
  const map = isMap(cfg.sources[kind]) ? cfg.sources[kind] : {};
  const out = [];
  for (const [id, raw] of Object.entries(map)) {
    if (!ID_RE.test(id) || !isMap(raw) || !raw.url) continue;
    if (raw.enabled === false) continue;
    let parsed;
    try { parsed = parseSource(String(raw.url)); } catch (_) { continue; }
    out.push({ id, ...parsed, ref: raw.ref ? cleanRef(raw.ref) : parsed.ref, path: raw.path ? cleanSubpath(raw.path) : parsed.path,
      item: raw.item ? String(raw.item) : '', to: raw.to ? String(raw.to) : '', via: raw.via ? String(raw.via) : parsed.via });
  }
  return out;
}

/** Everything the listing and the page show for one kind: each source, its state, its items and theirs. */
function sourcesStatus(kind, cfg = loadConfig()) {
  if (!KINDS.includes(kind)) fail(`Unknown kind '${kind}'. One of: ${KINDS.join(', ')}.`);
  const lock = readLock(kind);
  return sourcesOf(kind, cfg).map((src) => {
    const rec = lock.sources[src.id] || {};
    const items = Object.entries(rec.items || {}).map(([name, entry]) => ({ name, to: entry.to, state: itemState(entry), files: entry.files || 0 }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { ...src, state: rec.state || 'not checked', checkedAt: rec.checkedAt || '', commit: rec.commit || '', items };
  });
}

/* ------------------------------------------------------------------ source verbs */

const now = () => new Date().toISOString();

function targetFolderOfCmd(to) {
  if (!to || !FOLDER_RE.test(to) || to === 'core') fail('A cmd-* source needs the workspace folder its commands go in: --to dev.');
  if (!isDir(path.join(root(), to))) fail(`There is no ${to}/ folder in this workspace.`);
  return to;
}

/** Names a source may not take: what is already in the folder and did not come from it. */
function ownedBy(lock, place, exceptId) {
  for (const [id, rec] of Object.entries(lock.sources)) {
    if (id === exceptId) continue;
    for (const entry of Object.values(rec.items || {})) if (entry.to === place) return id;
  }
  return '';
}

/**
 * Fetch a source and place its items; `only` is the set of names to take (empty = all of the kind).
 * Used by add and by update. Returns counts; says each file through `say`.
 */
function syncSource(kind, src, lock, { say, force = false, adding = false }) {
  const clone = cloneSource(src);
  const rec = lock.sources[src.id] || { items: {} };
  rec.items = rec.items || {};
  Object.assign(rec, { url: src.url, ref: src.ref, path: src.path, forge: src.forge, checkedAt: now() });
  lock.sources[src.id] = rec;
  if (!clone) {
    rec.state = 'unreachable';
    say(`  ${src.id}: unreachable (${src.url}${src.ref ? ` @${src.ref}` : ''}). Nothing was changed.`);
    return { ok: false, placed: 0, updated: 0, left: 0 };
  }
  const counts = { ok: true, placed: 0, updated: 0, left: 0 };
  try {
    rec.state = 'reachable';
    rec.commit = clone.commit;
    const found = discover(kind, clone.dir, src.path).filter((it) => !src.item || it.name === src.item);
    const names = new Set(found.map((it) => it.name));
    for (const it of found) {
      const place = itemPlace(kind, it.name, src);
      const dest = path.join(root(), place);
      const id = upstreamId(clone.dir, it.rel, src);
      const had = rec.items[it.name];
      if (!had) {
        const owner = ownedBy(lock, place, src.id);
        if (owner || fs.existsSync(dest)) {
          say(`  left ${place}: the name is taken (${owner ? `it came from ${owner}` : 'it is already here and did not come from a source'}).`);
          counts.left += 1;
          continue;
        }
      } else {
        const changedHere = fs.existsSync(dest) && contentHash(dest) !== had.placed;
        if (had.upstream === id && fs.existsSync(dest) && !(force && changedHere)) { had.latest = id; had.gone = false; continue; }
        if (changedHere && !force) {
          had.latest = id; had.gone = false;
          say(`  left ${place}: changed locally (--force replaces it with the source's).`);
          counts.left += 1;
          continue;
        }
      }
      const { written, skipped } = placeItem(path.join(clone.dir, it.rel), dest);
      rec.items[it.name] = { path: it.rel, upstream: id, latest: id, gone: false, placed: contentHash(dest), to: place, files: written.length, placedAt: now() };
      say(`  ${had ? 'updated' : 'placed'} ${place}`);
      for (const w of written) say(`      ${w.file}  ${w.bytes} bytes`);
      for (const s of skipped) say(`      skipped ${s}: not a regular file`);
      counts[had ? 'updated' : 'placed'] += 1;
    }
    for (const [name, entry] of Object.entries(rec.items)) {
      if (names.has(name)) continue;
      entry.gone = true;
      if (!adding) say(`  ${entry.to}: removed upstream, left as is.`);
    }
  } finally {
    clone.clean();
  }
  return counts;
}

function sourceAdd(kind, input, { id = '', ref = '', subpath = '', item = '', to = '', say = () => {} } = {}) {
  if (!KINDS.includes(kind)) fail(`Unknown kind '${kind}'. One of: ${KINDS.join(', ')}.`);
  if (kind === 'cmd') targetFolderOfCmd(to); else kindFolder(kind);
  const parsed = parseSource(input);
  if (parsed.via === 'skills.sh' && kind !== 'ai-skills') fail('skills.sh lists skills: use it in ai-skills.');
  const cfg = loadConfig();
  const taken = Object.keys(isMap(cfg.sources[kind]) ? cfg.sources[kind] : {});
  const src = { ...parsed, ref: ref ? cleanRef(ref) : parsed.ref, path: subpath ? cleanSubpath(subpath) : parsed.path,
    item: item && item !== '_all_' ? item : parsed.item, to };
  if (src.item && !NAME_RE.test(src.item)) fail(`Not an item name: '${src.item}'.`);
  src.id = id || defaultSourceId(src, taken);
  if (!ID_RE.test(src.id)) fail(`A source's id is lowercase letters, digits, hyphens and underscores: '${src.id}'.`);
  if (taken.includes(src.id)) fail(`There is already a source called ${src.id}. Update it (--source-update ${src.id}), or add this one under another id (--as).`);

  say(`${src.id}: ${src.url}${src.ref ? ` @${src.ref}` : ''}${src.path ? ` in ${src.path}` : ''}${src.via ? ` (from ${src.via})` : ''}`);
  const lock = readLock(kind);
  const counts = syncSource(kind, src, lock, { say, adding: true });
  if (!counts.ok) fail(`Could not read ${src.url}. Check the address, the branch and that you may read it.`);
  if (!counts.placed) {
    delete lock.sources[src.id];
    fail(`No ${KIND_NOUN[kind]} ${src.item ? `called ${src.item} ` : ''}found in ${src.url}${src.path ? ` under ${src.path}` : ''}${counts.left ? ' that is not already here' : ''}. The source was not added.`);
  }
  writeLock(kind, lock);
  updateSettings((data) => {
    data.sources = isMap(data.sources) ? data.sources : {};
    data.sources[kind] = isMap(data.sources[kind]) ? data.sources[kind] : {};
    const entry = { url: src.url };
    for (const k of ['ref', 'path', 'item', 'to', 'via']) if (src[k]) entry[k] = src[k];
    data.sources[kind][src.id] = entry;
  });
  say(`Added ${src.id}: ${counts.placed} placed${counts.left ? `, ${counts.left} left` : ''}.`);
  say(kind === 'cmd'
    ? 'These commands were placed, not run. Read each one before you run it: it runs with your own permissions.'
    : 'Review what was fetched before use: an AI session runs it with its full permissions. Nothing was run.');
  return { id: src.id, ...counts };
}

function pickSources(kind, id) {
  const all = sourcesOf(kind);
  if (!id || id === '_all_') return all;
  const one = all.find((s) => s.id === id);
  if (!one) fail(`No source called ${id} for ${kind}. See them with --sources.`);
  return [one];
}

/** Ask upstream where each source is, without changing an item. */
function sourceCheck(kind, id, { say = () => {} } = {}) {
  const lock = readLock(kind);
  const list = pickSources(kind, id);
  if (!list.length) say(`No source for ${kind} yet. Add one with --source-add.`);
  for (const src of list) {
    const rec = lock.sources[src.id] || (lock.sources[src.id] = { items: {} });
    rec.checkedAt = now();
    const head = remoteHead(src);
    if (!head) { rec.state = 'unreachable'; say(`  ${src.id}: unreachable`); continue; }
    rec.state = 'reachable';
    if (head !== rec.commit) {
      const clone = cloneSource(src);
      if (!clone) { rec.state = 'unreachable'; say(`  ${src.id}: unreachable`); continue; }
      try {
        const found = new Map(discover(kind, clone.dir, src.path).map((it) => [it.name, it.rel]));
        for (const [name, entry] of Object.entries(rec.items || {})) {
          const rel = found.get(name);
          entry.gone = !rel;
          if (rel) entry.latest = upstreamId(clone.dir, rel, src);
        }
      } finally { clone.clean(); }
    }
    const states = Object.values(rec.items || {}).map(itemState);
    const tally = [...new Set(states)].map((s) => `${states.filter((x) => x === s).length} ${s}`).join(', ');
    say(`  ${src.id}: reachable${tally ? `, ${tally}` : ''}`);
  }
  writeLock(kind, lock);
  return sourcesStatus(kind);
}

function sourceUpdate(kind, id, { say = () => {}, force = false } = {}) {
  const lock = readLock(kind);
  const list = pickSources(kind, id);
  if (!list.length) say(`No source for ${kind} yet. Add one with --source-add.`);
  const total = { placed: 0, updated: 0, left: 0, unreachable: 0 };
  for (const src of list) {
    say(`${src.id}: ${src.url}${src.ref ? ` @${src.ref}` : ''}`);
    const c = syncSource(kind, src, lock, { say, force });
    if (!c.ok) { total.unreachable += 1; continue; }
    total.placed += c.placed; total.updated += c.updated; total.left += c.left;
    if (!c.placed && !c.updated && !c.left) say('  up to date');
  }
  writeLock(kind, lock);
  say(`Updated ${total.updated}, new ${total.placed}, left ${total.left}${total.unreachable ? `, ${total.unreachable} source${total.unreachable === 1 ? '' : 's'} unreachable` : ''}. Nothing was run.`);
  return total;
}

/** Forget a source and take away what it placed. An item changed here is kept unless forced; `keepItems` keeps all. */
function sourceRemove(kind, id, { say = () => {}, keepItems = false, force = false } = {}) {
  const cfg = loadConfig();
  const known = isMap(cfg.sources[kind]) && cfg.sources[kind][id];
  const lock = readLock(kind);
  if (!known && !lock.sources[id]) fail(`No source called ${id} for ${kind}. See them with --sources.`);
  let removed = 0; let kept = 0;
  for (const entry of Object.values((lock.sources[id] || {}).items || {})) {
    const here = path.join(root(), entry.to);
    if (!fs.existsSync(here)) continue;
    if (keepItems || (!force && contentHash(here) !== entry.placed)) {
      say(`  kept ${entry.to}${keepItems ? '' : ': changed locally'}`); kept += 1; continue;
    }
    fs.rmSync(here, { recursive: true, force: true });
    say(`  removed ${entry.to}`); removed += 1;
  }
  delete lock.sources[id];
  writeLock(kind, lock);
  updateSettings((data) => {
    if (isMap(data.sources) && isMap(data.sources[kind])) {
      delete data.sources[kind][id];
      if (!Object.keys(data.sources[kind]).length) delete data.sources[kind];
      if (!Object.keys(data.sources).length) delete data.sources;
    }
  });
  say(`Removed the source ${id}: ${removed} item${removed === 1 ? '' : 's'} removed, ${kept} kept.`);
  return { removed, kept };
}

/* ------------------------------------------------------------------ converters */

/** A Markdown item as { front, body }: the YAML block between the first two `---` lines, and the rest. */
function splitFrontmatter(text) {
  const m = String(text).match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?([\s\S]*)$/);
  if (!m) return { front: {}, body: String(text), had: false };
  let front = {};
  try { front = yaml.load(m[1]) || {}; } catch (_) { front = {}; }
  return { front: isMap(front) ? front : {}, body: m[2], had: true };
}

function withFrontmatter(front, body) {
  const keys = Object.keys(front);
  if (!keys.length) return body;
  return `---\n${yaml.dump(front, { lineWidth: -1, noRefs: true })}---\n${body.startsWith('\n') ? '' : '\n'}${body}`;
}

const tomlString = (s) => JSON.stringify(String(s));
/** A TOML multi-line basic string: backslashes and any run of three quotes escaped. */
const tomlText = (s) => `"""\n${String(s).replace(/\\/g, '\\\\').replace(/"""/g, '""\\"')}${String(s).endsWith('\n') ? '' : '\n'}"""`;

/** The keys of the frontmatter a converter did not carry over, to say so. */
const dropped = (front, kept) => Object.keys(front).filter((k) => !kept.includes(k));

const ARGS_RE = /\$ARGUMENTS\b/g;
const POSITIONAL_RE = /\$(?:ARGUMENTS\[\d+\]|\d)\b/;
const SHELL_RE = /!`[^`\n]+`|^```!/m;
/** What a command's body holds that another CLI writes differently, and that is left as written. */
function bodyNotes(body) {
  const notes = [];
  if (POSITIONAL_RE.test(body)) notes.push('$1-style arguments have no equivalent there and were left as written');
  if (SHELL_RE.test(body)) notes.push('shell output lines (!`…`) are written another way there and were left as written');
  return notes;
}

/**
 * Each converter takes the item's text and name and returns { text, notes }. They are named by the
 * `convert:` of a CLI's kind in the settings; a CLI nobody listed uses whichever fits its format.
 * (A skill is a folder and has one converter, `skill-folder`, handled where folders are.)
 */
const CONVERTERS = {
  /** As it is. */
  copy: (text) => ({ text, notes: [] }),

  /** An agent for a CLI that reads Markdown with frontmatter: name, description, the body. */
  'agent-markdown': (text, name) => {
    const { front, body } = splitFrontmatter(text);
    const gone = dropped(front, ['name', 'description']);
    return { text: withFrontmatter({ name: String(front.name || name), description: String(front.description || '') }, body),
      notes: gone.length ? [`left out ${gone.join(', ')}: Claude Code's own keys, so the agent has this CLI's defaults there`] : [] };
  },

  /** An agent as TOML: name, description, developer_instructions. */
  'agent-toml': (text, name) => {
    const { front, body } = splitFrontmatter(text);
    const gone = dropped(front, ['name', 'description']);
    return { text: `name = ${tomlString(front.name || name)}\ndescription = ${tomlString(front.description || '')}\ndeveloper_instructions = ${tomlText(body.replace(/^\n+/, ''))}\n`,
      notes: gone.length ? [`left out ${gone.join(', ')}: Claude Code's own keys`] : [] };
  },

  /** An agent as TOML for a CLI whose keys are agent_type, display_name, description, instructions. */
  'agent-toml-vibe': (text, name) => {
    const { front, body } = splitFrontmatter(text);
    const gone = dropped(front, ['name', 'description']);
    return { text: `agent_type = "subagent"\ndisplay_name = ${tomlString(front.name || name)}\ndescription = ${tomlString(front.description || '')}\ninstructions = ${tomlText(body.replace(/^\n+/, ''))}\n`,
      notes: gone.length ? [`left out ${gone.join(', ')}: Claude Code's own keys`] : [] };
  },

  /** A command for a CLI that reads Markdown and $ARGUMENTS: description and argument-hint kept. */
  'command-markdown': (text) => {
    const { front, body } = splitFrontmatter(text);
    const keep = {};
    for (const k of ['description', 'argument-hint']) if (front[k] !== undefined) keep[k] = String(front[k]);
    const gone = dropped(front, ['description', 'argument-hint']);
    return { text: withFrontmatter(keep, body), notes: gone.length ? [`left out ${gone.join(', ')}`] : [] };
  },

  /** A command for a CLI that reads Markdown and {{args}}: description kept, $ARGUMENTS rewritten. */
  'command-markdown-args': (text) => {
    const { front, body } = splitFrontmatter(text);
    const gone = dropped(front, ['description']);
    const notes = [...(gone.length ? [`left out ${gone.join(', ')}`] : []), ...bodyNotes(body)];
    return { text: withFrontmatter(front.description !== undefined ? { description: String(front.description) } : {}, body.replace(ARGS_RE, '{{args}}')), notes };
  },

  /** A command as TOML: description, prompt, with $ARGUMENTS rewritten to {{args}}. */
  'command-toml': (text) => {
    const { front, body } = splitFrontmatter(text);
    const gone = dropped(front, ['description']);
    const notes = [...(gone.length ? [`left out ${gone.join(', ')}`] : []), ...bodyNotes(body)];
    const lines = [];
    if (front.description !== undefined) lines.push(`description = ${tomlString(front.description)}`);
    lines.push(`prompt = ${tomlText(body.replace(/^\n+/, '').replace(ARGS_RE, '{{args}}'))}`);
    return { text: `${lines.join('\n')}\n`, notes };
  },
};

/* ------------------------------------------------------------------ install into a CLI */

/** The items of a kind's folder, by name. */
function folderItems(kind) {
  const dir = kindFolder(kind);
  const names = [];
  for (const e of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, e);
    if (kind === 'ai-skills') { if (NAME_RE.test(e) && isDir(full) && isFile(path.join(full, 'SKILL.md'))) names.push(e); }
    else if (e.endsWith('.md') && !NOT_ITEMS.has(e) && isFile(full) && NAME_RE.test(e.slice(0, -3))) names.push(e.slice(0, -3));
  }
  return names;
}

const itemSource = (kind, name) => path.join(root(), kind, kind === 'ai-skills' ? name : `${name}.md`);

/** Where a CLI keeps a kind: for every session, or inside one project (`to` = <folder>/<project>). null = no such thing there. */
function cliPlace(cli, kind, to = '') {
  const k = cli.kinds[kind];
  if (!isMap(k) || !k.convert) return null;
  if (k.convert !== 'skill-folder' && !CONVERTERS[k.convert]) return null;
  if (kind === 'ai-skills' && k.convert !== 'skill-folder') return null;
  if (kind !== 'ai-skills' && k.convert === 'skill-folder') return null;
  let dir;
  if (!to || to === '_none_') {
    if (!k.user) return null;
    dir = expandHome(k.user);
  } else {
    const m = String(to).match(/^([a-z0-9][a-z0-9_-]*)\/([A-Za-z0-9][A-Za-z0-9_.-]*)$/);
    if (!m) fail(`'--to ${to}' needs a workspace folder and a project: --to dev/myproject.`);
    if (!isDir(path.join(root(), m[1], m[2]))) fail(`There is no ${to} in this workspace.`);
    if (!k.project) return null;
    dir = path.join(root(), m[1], m[2], cleanSubpath(k.project));
  }
  return { dir, convert: k.convert, extension: String(k.extension || '.md') };
}

/** The files an install writes, as Map<path under the CLI's folder, Buffer>, and what the converter said. */
function converted(kind, name, place) {
  const src = itemSource(kind, name);
  const out = new Map(); let notes = [];
  if (kind === 'ai-skills') {
    for (const [rel, full] of regularFiles(src).files) out.set(`${name}/${rel}`, fs.readFileSync(full));
  } else {
    const r = CONVERTERS[place.convert](fs.readFileSync(src, 'utf8'), name);
    out.set(`${name}${place.extension}`, Buffer.from(r.text));
    notes = r.notes;
  }
  return { files: out, notes };
}

/** installed / installed, differs / not installed / no such thing — by converting again and comparing. */
function itemCliState(kind, name, cli, to = '') {
  let place;
  try { place = cliPlace(cli, kind, to); } catch (_) { place = null; }
  if (!place) return 'no such thing';
  const top = path.join(place.dir, kind === 'ai-skills' ? name : `${name}${place.extension}`);
  if (!fs.existsSync(top)) return 'not installed';
  const { files } = converted(kind, name, place);
  for (const [rel, buf] of files) {
    const f = path.join(place.dir, rel);
    if (!isFile(f) || !fs.readFileSync(f).equals(buf)) return 'installed, differs';
  }
  if (kind === 'ai-skills' && regularFiles(top).files.length !== files.size) return 'installed, differs';
  return 'installed';
}

function wantedClis(cliId, cfg) {
  if (cliId === 'all') return listClis(cfg, { onlyEnabled: true });
  const cli = cliById(cliId, cfg);
  if (!cli) fail(`No AI CLI called ${cliId} in the settings. See them with --clis.`);
  if (!cli.enabled) fail(`${cli.label} is switched off (clis.${cli.id}.enabled in core/config/ai.settings.yml).`);
  return [cli];
}

function wantedItems(kind, name) {
  const all = folderItems(kind);
  if (!name || name === '_all_') return all;
  if (!all.includes(name)) fail(`No ${KIND_NOUN[kind]} called ${name} in ${kind}/.`);
  return [name];
}

/** Install one item, or all, of a folder into one CLI, or all that are on. */
function install(kind, name, cliId, { to = '', say = () => {} } = {}) {
  if (!AI_KINDS.includes(kind)) fail(`Only AI items install into an AI CLI (${AI_KINDS.join(', ')}).`);
  if (kind === 'ai-prompts') fail('A prompt is the launch command of a new session: it is run, not installed into a CLI.');
  const cfg = loadConfig();
  const items = wantedItems(kind, name);
  let done = 0;
  for (const cli of wantedClis(cliId, cfg)) {
    const place = cliPlace(cli, kind, to);
    if (!place) { say(`${cli.label}: no place for a ${KIND_NOUN[kind]}${to ? ' in a project' : ''} there. Nothing installed.`); continue; }
    for (const item of items) {
      const { files, notes } = converted(kind, item, place);
      if (kind === 'ai-skills') fs.rmSync(path.join(place.dir, item), { recursive: true, force: true });
      for (const [rel, buf] of files) {
        const f = path.join(place.dir, rel);
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, buf, { mode: 0o644 });
      }
      const first = [...files.keys()][0];
      say(`${cli.label}: installed ${item} -> ${path.join(place.dir, kind === 'ai-skills' ? item : first)}${place.convert === 'copy' || place.convert === 'skill-folder' ? '' : ` (${place.convert})`}`);
      for (const n of notes) say(`    ${n}`);
      done += 1;
    }
    if (!cli.installed) say(`    ${cli.command} is not on the PATH here: the files are where the documentation of ${cli.label} says, and it was not run.`);
  }
  if (done) say('Start a new session of the CLI to pick it up.');
  return done;
}

function uninstall(kind, name, cliId, { to = '', say = () => {} } = {}) {
  if (!AI_KINDS.includes(kind) || kind === 'ai-prompts') fail('Nothing of this kind is installed into a CLI.');
  if (!name || name === '_all_') fail('Name the item to take out of the CLI.');
  if (!NAME_RE.test(name)) fail(`Not an item name: '${name}'.`);
  const cfg = loadConfig();
  let done = 0;
  for (const cli of wantedClis(cliId, cfg)) {
    const place = cliPlace(cli, kind, to);
    if (!place) continue;
    const top = path.join(place.dir, kind === 'ai-skills' ? name : `${name}${place.extension}`);
    if (!fs.existsSync(top)) { say(`${cli.label}: ${name} is not installed.`); continue; }
    fs.rmSync(top, { recursive: true, force: true });
    say(`${cli.label}: removed ${top}`);
    done += 1;
  }
  return done;
}

/** The folder's items against the CLIs that are on: [{ name, source, cells: [{ cli, state }] }]. */
function matrix(kind, { to = '' } = {}) {
  const cfg = loadConfig();
  const clis = listClis(cfg, { onlyEnabled: true });
  const from = new Map();
  for (const s of sourcesStatus(kind, cfg)) for (const it of s.items) from.set(it.name, { source: s.id, state: it.state });
  const rows = folderItems(kind).map((name) => ({
    name,
    source: (from.get(name) || {}).source || '',
    sourceState: (from.get(name) || {}).state || '',
    cells: clis.map((cli) => ({ cli: cli.id, state: kind === 'ai-prompts' ? 'no such thing' : itemCliState(kind, name, cli, to) })),
  }));
  return { clis, rows };
}

module.exports = {
  AnyCliError, AI_KINDS, KINDS, KIND_NOUN, CONVERTERS, LIMITS,
  loadConfig, updateSettings, settingsFile, defaultsFile, deepMerge, expandHome,
  listClis, cliById, cliStateWords, signInState, onPath,
  parseSource, defaultSourceId, discover, contentHash, placeItem, gitEnv, forgeToken,
  lockFile, readLock, itemState, sourcesOf, sourcesStatus,
  sourceAdd, sourceCheck, sourceUpdate, sourceRemove,
  splitFrontmatter, folderItems, cliPlace, converted, itemCliState, install, uninstall, matrix,
};
