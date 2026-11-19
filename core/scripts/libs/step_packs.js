/**
 * The webship-js extra-steps packs (`@webship-js/<name>-steps`): which there are, which a project has,
 * and adding, removing and copying the examples of one.
 *
 * A pack adds the steps of one platform (WordPress, Drupal, Jira …) or of a service any site can use
 * (Diffy) to a webship-js project: a dev dependency in package.json and its step-definition glob in
 * cucumber.js, after webship-js's own. The platform plugins' `testing_configure_<x>` hooks add their
 * own pack; this adds any of them, to any project with the testing stack.
 *
 * One module, two callers, like checks_plan.js beside it: `cmd-tools-testing.sh` shells out to it
 * (`node step_packs.js <verb> …`) and the dashboard requires it for the Extra steps panel, so the
 * panel and the command can never disagree about what a project has. No dependencies: Node's own
 * fs, path, https and dns, so it runs wherever the workspace runs (Node.js 20 or later).
 *
 * The rules it keeps:
 *   - a name is only ever one of `@webship-js/<name>-steps`, and only one the list holds is added;
 *   - idempotent: a second run adds what the first missed and never resets anything;
 *   - `remove` takes out exactly what `add` put in (written down in tests/step-packs.json), nothing else;
 *   - examples are copied, never over a file;
 *   - platform packs share their phrases on purpose (the webship-js FAQ, "Can I load several step packs
 *     in one project?"), so two of them never land in one profile: a second platform gets a profile of
 *     its own. Packs for any site (Diffy) and an extension with its base (Drupal CMS with Drupal core)
 *     go in one profile;
 *   - settings a pack reads (`worldParameters`) are named for the person to fill in, never invented;
 *   - a suggestion is printed, never installed.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const dns = require('dns');

const SCOPE = '@webship-js/';
const PACK_RE = /^@webship-js\/[a-z0-9][a-z0-9-]*-steps$/;
const REGISTRY = 'https://registry.npmjs.org';
// The search the scope is listed by. npm's search has stopped honouring the `scope:` qualifier (on
// 2026-11-19 it answered with 250 unrelated packages and none of the scope), so every answer is
// filtered by name, and the keyword search every pack carries (`webship-js`) is asked next.
const SEARCH_URLS = [
  `${REGISTRY}/-/v1/search?text=scope:webship-js&size=250`,
  `${REGISTRY}/-/v1/search?text=keywords:webship-js&size=250`,
];
// The organisation's own list names every package of the scope: one the search missed is asked for by name.
const ORG_URL = `${REGISTRY}/-/org/webship-js/package`;
const DAY = 24 * 60 * 60 * 1000;
// After a failed fetch, the next one waits this long: a panel opened offline should not wait on the network every time.
const RETRY_AFTER = 10 * 60 * 1000;
const CORE_GLOB = 'node_modules/webship-js/tests/step-definitions/**/*.js';
// The settings webship-js itself reads, each with a default of its own (its docs/global-settings.md): a pack's
// README showing one is showing the whole block, not asking for it.
const CORE_SETTINGS = new Set(['launchUrl', 'assetsFolder', 'minWaitTime', 'selectors', 'screenshot', 'video', 'javascript']);
const DEFAULT_FEATURES = 'tests/features/**/*.feature';
// The comment on every require line this adds, so a reader of cucumber.js knows where it came from.
const MARK = '// step pack: cmd-tools-testing.sh --add-steps';
const RECORD = path.join('tests', 'step-packs.json');
const RECORD_ABOUT = 'What cmd-tools-testing.sh --add-steps and --examples changed in this project, so --remove-steps takes out exactly that. Written by the Webship Workspace.';
const SHIPPED_FILE = path.join(__dirname, '..', '..', 'config', 'step-packs.json');
const DEFAULT_ROOT = path.resolve(__dirname, '..', '..', '..');

const BLOCK_START = (name) => `// >>> webship-workspace profile: ${name}`;
const BLOCK_END = (name) => `// <<< webship-workspace profile: ${name}`;
const PATHS_START = '// >>> webship-workspace default paths';
const PATHS_END = '// <<< webship-workspace default paths';

/* ------------------------------------------------------------------ names */

/** `diffy`, `diffy-steps` or `@webship-js/diffy-steps` → `@webship-js/diffy-steps`; null for anything else. */
function packName(input) {
  let s = String(input || '').trim().toLowerCase();
  if (!s) return null;
  if (s.startsWith(SCOPE)) s = s.slice(SCOPE.length);
  if (!s.endsWith('-steps')) s += '-steps';
  const name = SCOPE + s;
  return PACK_RE.test(name) ? name : null;
}
const dirName = (name) => name.slice(SCOPE.length);                       // diffy-steps
const shortName = (name) => dirName(name).replace(/-steps$/, '');         // diffy
const docsUrl = (name) => `https://webship.co/docs/webship-js/2.0.x/${shortName(name)}-step-definitions`;
const titleOf = (name) => shortName(name).split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

/* ------------------------------------------------------------------ small file helpers */

function readText(file) { try { return fs.readFileSync(file, 'utf8'); } catch (_) { return null; } }
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; } }
function writeJson(file, value, indent = 2) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, indent)}\n`);
  fs.renameSync(tmp, file);
}
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch (_) { return false; } };

/* ------------------------------------------------------------------ the list */

/** The list shipped with the core: what is used when npm cannot be reached, and what each pack is (kind, base, logo). */
function shippedList() {
  const doc = readJson(SHIPPED_FILE) || {};
  return { packs: Array.isArray(doc.packs) ? doc.packs : [], upcoming: Array.isArray(doc.upcoming) ? doc.upcoming : [] };
}

/** name → what the core knows about a pack, published or not yet. */
function knownPacks() {
  const { packs, upcoming } = shippedList();
  const map = new Map();
  for (const p of [...upcoming, ...packs]) if (p && PACK_RE.test(p.name || '')) map.set(p.name, p);
  return map;
}

/** One pack as everything here shows it: the registry's version and description over what the core knows. */
function describePack(entry, known = knownPacks()) {
  const meta = known.get(entry.name) || {};
  const kind = ['platform', 'extension', 'any-site'].includes(meta.kind) ? meta.kind : 'platform';
  return {
    name: entry.name,
    dir: dirName(entry.name),
    short: shortName(entry.name),
    title: meta.title || titleOf(entry.name),
    summary: meta.summary || entry.description || meta.description || '',
    description: entry.description || meta.description || '',
    version: entry.version || meta.version || '',
    date: entry.date || '',
    kind,
    base: kind === 'extension' && PACK_RE.test(meta.base || '') ? meta.base : '',
    logo: meta.logo || '',
    docs: docsUrl(entry.name),
    detect: Array.isArray(meta.detect) ? meta.detect : [],
    note: meta.note || '',
  };
}

function cacheFile(root) {
  return path.join(root || process.env.WORKSPACE_ROOT || DEFAULT_ROOT, 'core', 'workspace-app', '.cache', 'step-packs.json');
}

async function getJson(url, { fetchImpl = globalThis.fetch, timeoutMs = 10000 } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('this Node.js has no fetch');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: ctl.signal, headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`${url} answered ${res.status}`);
    return await res.json();
  } catch (e) {
    throw new Error(e && e.name === 'AbortError' ? `${url} did not answer in ${Math.round(timeoutMs / 1000)}s` : String((e && e.message) || e));
  } finally {
    clearTimeout(timer);
  }
}

/** Every `@webship-js/*-steps` package on npm: [{ name, version, description, date }]. Throws when none could be read. */
async function fetchRegistry(opts = {}) {
  const found = new Map();
  let last = null;
  const keep = (p) => {
    if (p && PACK_RE.test(String(p.name || ''))) {
      found.set(p.name, { name: p.name, version: String(p.version || ''), description: String(p.description || '').trim(), date: String(p.date || '') });
    }
  };
  for (const url of SEARCH_URLS) {
    try {
      const body = await getJson(url, opts);
      for (const o of (body && body.objects) || []) keep(o && o.package);
    } catch (e) { last = e; }
    if (found.size) break;
  }
  try {
    const org = await getJson(ORG_URL, opts);
    const missing = Object.keys(org || {}).filter((n) => PACK_RE.test(n) && !found.has(n)).slice(0, 25);
    for (const n of missing) {
      try { keep(await getJson(`${REGISTRY}/${n.replace('/', '%2F')}/latest`, opts)); } catch (e) { last = e; }
    }
  } catch (e) { last = last || e; }
  if (!found.size) throw last || new Error('the npm registry listed no @webship-js step pack');
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The packs, newest answer first: the day-old cache, then npm, then a stale cache, then the list shipped
 * with the core. `{ source: 'cache'|'npm'|'stale-cache'|'shipped', at, error, packs: [describePack] }`.
 * WORKSPACE_STEPS_OFFLINE=1 never asks npm (a machine with no network, a test).
 */
async function listPacks({ root, refresh = false, offline = process.env.WORKSPACE_STEPS_OFFLINE === '1', now = Date.now(), fetchImpl } = {}) {
  const file = cacheFile(root);
  const cached = readJson(file);
  const usable = cached && Array.isArray(cached.packs) && cached.packs.length > 0;
  const known = knownPacks();
  const answer = (source, at, entries, error = '') => ({
    source, at, error,
    packs: entries.filter((e) => e && PACK_RE.test(e.name || '')).map((e) => describePack(e, known))
      .sort((a, b) => a.title.localeCompare(b.title)),
  });
  if (usable && !refresh && now - Number(cached.at || 0) < DAY) return answer('cache', cached.at, cached.packs);
  let error = '';
  const triedRecently = cached && cached.triedAt && now - Number(cached.triedAt) < RETRY_AFTER;
  if (!offline && (refresh || !triedRecently)) {
    try {
      const packs = await fetchRegistry({ fetchImpl });
      try { writeJson(file, { at: now, source: 'npm', packs }); } catch (_) { /* a read-only tree still lists */ }
      return answer('npm', now, packs);
    } catch (e) {
      error = String((e && e.message) || e);
      try { writeJson(file, { ...(cached || {}), triedAt: now, error }); } catch (_) { /* best effort */ }
    }
  } else if (cached && cached.error) {
    error = cached.error;
  }
  if (usable) return answer('stale-cache', cached.at, cached.packs, error);
  return answer('shipped', 0, shippedList().packs, error || 'npm was not asked');
}

/* ------------------------------------------------------------------ reading cucumber.js */

/** Past a string literal that starts at `i`; the index after its closing quote. */
function skipString(s, i) {
  const q = s[i];
  let j = i + 1;
  while (j < s.length) {
    if (s[j] === '\\') { j += 2; continue; }
    if (s[j] === q) return j + 1;
    if (q === '`' && s[j] === '$' && s[j + 1] === '{') {   // a template's expression
      let depth = 1; j += 2;
      while (j < s.length && depth) {
        if (s[j] === '\'' || s[j] === '"' || s[j] === '`') { j = skipString(s, j); continue; }
        if (s[j] === '{') depth += 1; else if (s[j] === '}') depth -= 1;
        j += 1;
      }
      continue;
    }
    j += 1;
  }
  return s.length;
}

/** Past a comment that starts at `i`, or `i` when there is none. */
function skipComment(s, i) {
  if (s[i] === '/' && s[i + 1] === '/') { const e = s.indexOf('\n', i); return e < 0 ? s.length : e; }
  if (s[i] === '/' && s[i + 1] === '*') { const e = s.indexOf('*/', i + 2); return e < 0 ? s.length : e + 2; }
  return i;
}

/** The index just past the bracket that closes the one at `open` ({, [ or (), strings and comments skipped. */
function matchingClose(s, open) {
  let depth = 0;
  let i = open;
  while (i < s.length) {
    const c = s[i];
    const k = skipComment(s, i);
    if (k !== i) { i = k; continue; }
    if (c === '\'' || c === '"' || c === '`') { i = skipString(s, i); continue; }
    if (c === '{' || c === '[' || c === '(') depth += 1;
    else if (c === '}' || c === ']' || c === ')') { depth -= 1; if (depth === 0) return i + 1; }
    i += 1;
  }
  return -1;
}

/**
 * The keys of the object literal whose `{` is at `open`: [{ key, value }] where value is the text of its
 * value. Spreads and shorthand are passed over. Read as text, never run: a project's cucumber.js and a
 * pack's README are not code this process executes.
 */
function objectKeys(s, open) {
  const end = matchingClose(s, open);
  if (end < 0) return [];
  const out = [];
  let i = open + 1;
  let expectKey = true;
  while (i < end - 1) {
    const k = skipComment(s, i);
    if (k !== i) { i = k; continue; }
    const c = s[i];
    if (/\s/.test(c)) { i += 1; continue; }
    if (c === ',') { expectKey = true; i += 1; continue; }
    let key = null;
    let after = i;
    if (expectKey && (c === '\'' || c === '"')) {
      const e = skipString(s, i);
      const m = /^\s*:/.exec(s.slice(e, e + 64));
      if (m) { key = s.slice(i + 1, e - 1); after = e + m[0].length; }
    } else if (expectKey && /[A-Za-z_$]/.test(c)) {
      const m = /^([A-Za-z_$][\w$]*)\s*:/.exec(s.slice(i, i + 200));
      if (m) { key = m[1]; after = i + m[0].length; }
    }
    if (key !== null) {
      // The value runs to the next comma at this depth.
      let j = after;
      while (j < end - 1) {
        const jk = skipComment(s, j);
        if (jk !== j) { j = jk; continue; }
        const d = s[j];
        if (d === '\'' || d === '"' || d === '`') { j = skipString(s, j); continue; }
        if (d === '{' || d === '[' || d === '(') { const m2 = matchingClose(s, j); j = m2 < 0 ? end : m2; continue; }
        if (d === ',') break;
        j += 1;
      }
      out.push({ key, value: s.slice(after, j).trim(), valueAt: after });
      i = j;
      expectKey = false;
      continue;
    }
    // Anything else at this level (a spread, a shorthand, an expression): skip it as a unit.
    expectKey = false;
    if (c === '\'' || c === '"' || c === '`') { i = skipString(s, i); continue; }
    if (c === '{' || c === '[' || c === '(') { const m2 = matchingClose(s, i); i = m2 < 0 ? end : m2; continue; }
    i += 1;
  }
  return out;
}

/** The managed parts of a cucumber.js: the profile blocks this wrote, and its default-paths block. */
function managedBlocks(src) {
  const blocks = [];
  const re = /^\/\/ >>> webship-workspace profile: ([A-Za-z0-9_-]+)[ \t]*$/gm;
  let m;
  while ((m = re.exec(src))) {
    const name = m[1];
    const endMark = BLOCK_END(name);
    const e = src.indexOf(endMark, m.index);
    if (e < 0) continue;
    let end = e + endMark.length;
    if (src[end] === '\n') end += 1;
    blocks.push({ name, start: m.index, end, text: src.slice(m.index, end) });
  }
  let paths = null;
  const ps = src.indexOf(PATHS_START);
  const pe = ps < 0 ? -1 : src.indexOf(PATHS_END, ps);
  if (ps >= 0 && pe >= 0) {
    let end = pe + PATHS_END.length;
    if (src[end] === '\n') end += 1;
    paths = { start: ps, end };
  }
  return { blocks, paths };
}

/** Where the default profile's `require` list is: { open, close } around the brackets, or null. */
function defaultRequireRange(src, limit = src.length) {
  const head = src.slice(0, limit);
  const def = /\bdefault\s*:\s*\{/.exec(head);
  const from = def ? def.index : 0;
  const re = /\brequire\s*:\s*\[/g;
  re.lastIndex = from;
  const m = re.exec(head);
  if (!m) return null;
  const open = m.index + m[0].length - 1;
  const close = matchingClose(head, open);
  return close < 0 ? null : { open, close };
}

/**
 * What a cucumber.js says about the packs: [{ name, glob, profile, ours }] — `profile` is `default` for a
 * glob outside the blocks this wrote — and the profiles it wrote: [{ name, packs, features }].
 */
function readCucumber(src) {
  const { blocks, paths } = managedBlocks(src);
  const packs = [];
  const re = /(['"`])(node_modules\/(@webship-js\/[a-z0-9][a-z0-9-]*-steps)\/[^'"`]*)\1/g;
  let m;
  while ((m = re.exec(src))) {
    const block = blocks.find((b) => m.index >= b.start && m.index < b.end);
    const eol = src.indexOf('\n', m.index);
    const line = src.slice(src.lastIndexOf('\n', m.index) + 1, eol < 0 ? src.length : eol);
    // A line that is itself a comment loads nothing.
    if (/^\s*\/\//.test(line)) continue;
    if (!PACK_RE.test(m[3])) continue;
    packs.push({ name: m[3], glob: m[2], profile: block ? block.name : 'default', ours: line.includes(MARK) });
  }
  const profiles = blocks.map((b) => ({
    name: b.name,
    packs: packs.filter((p) => p.profile === b.name).map((p) => p.name),
    features: [...b.text.matchAll(/'tests\/features\/([A-Za-z0-9._-]+)\/\*\*\/\*\.feature'/g)].map((x) => x[1]),
  }));
  const firstBlock = Math.min(...blocks.map((b) => b.start), paths ? paths.start : src.length, src.length);
  return { packs, profiles, firstBlock, pathsBlock: paths };
}

/** The top-level keys of the default profile's worldParameters, and the handles of its users registry. */
function projectSettings(src, limit = src.length) {
  const head = src.slice(0, limit);
  const def = /\bdefault\s*:\s*\{/.exec(head);
  const re = /\bworldParameters\s*:\s*\{/g;
  re.lastIndex = def ? def.index : 0;
  const m = re.exec(head);
  if (!m) return { keys: new Set(), users: new Set(), found: false };
  const entries = objectKeys(head, m.index + m[0].length - 1);
  const users = new Set();
  const u = entries.find((e) => e.key === 'users');
  if (u && u.value.startsWith('{')) {
    const at = head.indexOf('{', u.valueAt);
    for (const e of objectKeys(head, at)) users.add(e.key);
  }
  return { keys: new Set(entries.map((e) => e.key)), users, found: true };
}

/* ------------------------------------------------------------------ what a pack's README says */

/** The glob a pack's README tells a project to add to cucumber.js, or the usual one. */
function globFor(name, readme) {
  const esc = name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const m = readme && new RegExp(`['"](node_modules/${esc}/[^'"\\s]+\\.(?:c|m)?js)['"]`).exec(readme);
  return m ? m[1] : `node_modules/${name}/tests/step-definitions/**/*.js`;
}

/**
 * The settings a pack's README shows under `worldParameters` (every block it shows, together):
 * Map key → { nested: [the keys of an object value] }.
 */
function readmeSettings(readme) {
  const out = new Map();
  if (!readme) return out;
  const re = /\bworldParameters\s*:\s*\{/g;
  let m;
  while ((m = re.exec(readme))) {
    for (const e of objectKeys(readme, m.index + m[0].length - 1)) {
      const nested = [];
      if (e.value.startsWith('{')) {
        const at = readme.indexOf('{', e.valueAt);
        for (const n of objectKeys(readme, at)) nested.push(n.key);
      }
      const had = out.get(e.key);
      out.set(e.key, { nested: [...new Set([...(had ? had.nested : []), ...nested])] });
    }
  }
  return out;
}

/** What a pack reads that the project does not set yet: [{ key, nested, missingUsers }]. */
function settingsToFill(src, readme, profile = 'default') {
  const want = readmeSettings(readme);
  if (!want.size) return [];
  const limit = readCucumber(src).firstBlock;
  const have = projectSettings(src, limit);
  // A profile this wrote spreads the default's settings and sets its own address and an empty registry.
  const keys = new Set(have.keys);
  const users = profile === 'default' ? have.users : new Set();
  if (profile !== 'default') { keys.add('launchUrl'); }
  const out = [];
  for (const [key, { nested }] of want) {
    if (CORE_SETTINGS.has(key)) continue;
    if (key === 'users') {
      const missingUsers = nested.filter((h) => !users.has(h));
      if (missingUsers.length || (!nested.length && !keys.has('users'))) out.push({ key, nested, missingUsers });
      continue;
    }
    if (!keys.has(key)) out.push({ key, nested, missingUsers: [] });
  }
  return out;
}

/** The cucumber.js an installed pack ships, if it ships one: its worldParameters are settings it reads too. */
function packConfigOf(projectDir, name) {
  return readText(path.join(projectDir, 'node_modules', ...name.split('/'), 'cucumber.js')) || '';
}

/** The README of a pack: the installed one, else the registry's. '' when neither can be read. */
async function readmeOf(projectDir, name, opts = {}) {
  const local = readText(path.join(projectDir, 'node_modules', ...name.split('/'), 'README.md'));
  if (local) return local;
  if (opts.offline) return '';
  try {
    const doc = await getJson(`${REGISTRY}/${name.replace('/', '%2F')}`, { ...opts, timeoutMs: opts.timeoutMs || 15000 });
    return String((doc && doc.readme) || '');
  } catch (_) { return ''; }
}

/* ------------------------------------------------------------------ a project */

function readRecord(projectDir) {
  const r = readJson(path.join(projectDir, RECORD));
  return r && r.packs && typeof r.packs === 'object' ? r : { about: RECORD_ABOUT, packs: {} };
}

function writeRecord(projectDir, record) {
  const file = path.join(projectDir, RECORD);
  for (const [name, r] of Object.entries(record.packs)) {
    if (!r || !Object.keys(r).length) delete record.packs[name];
  }
  if (!Object.keys(record.packs).length) { try { fs.unlinkSync(file); } catch (_) { /* never written */ } return; }
  writeJson(file, { about: RECORD_ABOUT, ...(record.createdDevDependencies ? { createdDevDependencies: true } : {}), packs: record.packs });
}

function installedVersion(projectDir, name) {
  const p = readJson(path.join(projectDir, 'node_modules', ...name.split('/'), 'package.json'));
  return p && p.version ? String(p.version) : '';
}

/** Every .feature under a folder, as paths relative to it. Symbolic links are not followed out of it. */
function featureFiles(dir, max = 2000) {
  const out = [];
  const walk = (d, rel) => {
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (out.length >= max) return;
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(d, e.name), r);
      else if (e.isFile() && e.name.endsWith('.feature')) out.push(r);
    }
  };
  walk(dir, '');
  return out;
}

/**
 * What a project has: { stack, hasPackageJson, hasCucumber, packs: { name: { range, installed, profile,
 * ours, examples } }, profiles }.
 */
function projectState(projectDir) {
  const pkg = readJson(path.join(projectDir, 'package.json'));
  const src = readText(path.join(projectDir, 'cucumber.js'));
  const record = readRecord(projectDir);
  const deps = { ...((pkg && pkg.dependencies) || {}), ...((pkg && pkg.devDependencies) || {}) };
  const layout = src ? readCucumber(src) : { packs: [], profiles: [] };
  const names = new Set([
    ...Object.keys(deps).filter((n) => PACK_RE.test(n)),
    ...layout.packs.map((p) => p.name),
    ...Object.keys(record.packs).filter((n) => PACK_RE.test(n)),
  ]);
  const packs = {};
  for (const name of [...names].sort()) {
    const inCucumber = layout.packs.find((p) => p.name === name);
    const rec = record.packs[name] || {};
    packs[name] = {
      name,
      range: deps[name] || '',
      installed: installedVersion(projectDir, name),
      profile: inCucumber ? inCucumber.profile : '',
      ours: Boolean(rec.devDependency || rec.require),
      examples: featureFiles(path.join(projectDir, 'tests', 'features', dirName(name))).length,
    };
  }
  const stack = fs.existsSync(path.join(projectDir, '.ddev', 'commands', 'web', 'init-full-automated-testing'))
    ? 'in-project' : (src !== null || isDir(path.join(projectDir, 'tests', 'step-definitions')) ? 'webship-js' : 'none');
  return { stack, hasPackageJson: Boolean(pkg), hasCucumber: src !== null, packs, profiles: layout.profiles };
}

/** Packs listed in package.json that node_modules does not hold yet. */
function notInstalled(projectDir) {
  const pkg = readJson(path.join(projectDir, 'package.json')) || {};
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  return Object.keys(deps).filter((n) => PACK_RE.test(n) && !installedVersion(projectDir, n));
}

/** The profile a feature file runs in: the one whose folder holds it, else `default`. */
function profileFor(projectDir, featurePath) {
  const src = readText(path.join(projectDir, 'cucumber.js')) || '';
  const rel = String(featurePath || '').replace(/^\.\//, '');
  const m = /^tests\/features\/([^/]+)\//.exec(rel);
  if (!m) return 'default';
  const hit = readCucumber(src).profiles.find((p) => p.features.includes(m[1]));
  return hit ? hit.name : 'default';
}

/* ------------------------------------------------------------------ editing cucumber.js */

const groupOf = (meta) => (meta.kind === 'extension' && meta.base ? meta.base : meta.name);

/**
 * Where a pack goes: { profile, create }. Packs for any site go in the default profile; a platform (and
 * its extensions) go there too when it holds no other platform, else into the profile of their own.
 */
function placeFor(name, layout, metaOf) {
  const meta = metaOf(name);
  if (meta.kind === 'any-site') return { profile: 'default' };
  const group = groupOf(meta);
  const defaultGroups = new Set(layout.packs.filter((p) => p.profile === 'default')
    .map((p) => metaOf(p.name)).filter((m) => m.kind !== 'any-site').map(groupOf));
  if (!defaultGroups.size || defaultGroups.has(group)) return { profile: 'default' };
  const existing = layout.profiles.find((pr) => pr.packs.some((p) => groupOf(metaOf(p)) === group));
  if (existing) return { profile: existing.name };
  let profile = shortName(group);
  const taken = new Set(layout.profiles.map((p) => p.name));
  while (taken.has(profile) || profile === 'default') profile = `${profile}-steps`;
  return { profile, create: true, others: [...defaultGroups] };
}

/** Insert `line` after the last pack line of the array whose brackets are at range, or after its opening. */
function insertIntoArray(src, range, line) {
  const inner = src.slice(range.open + 1, range.close - 1);
  if (!inner.includes('\n')) return null;   // all on one line: not edited by hand-off guessing
  const lines = inner.split('\n');
  let at = -1;
  lines.forEach((l, i) => { if (/node_modules\/(@webship-js\/|webship-js\/)/.test(l) && !/^\s*\/\//.test(l)) at = i; });
  let indent;
  if (at >= 0) {
    indent = /^[ \t]*/.exec(lines[at])[0];
    // A last element with no comma gets one, or the new line would not be an element of its own.
    const code = lines[at].replace(/\s*\/\/.*$/, '');
    if (!/,\s*$/.test(code)) lines[at] = lines[at].replace(code, `${code},`);
  } else {
    const first = lines.find((l, i) => i > 0 && l.trim());
    const openLine = src.slice(src.lastIndexOf('\n', range.open) + 1, range.open);
    indent = first ? /^[ \t]*/.exec(first)[0] : `${/^[ \t]*/.exec(openLine)[0]}  `;
    at = 0;
  }
  lines.splice(at + 1, 0, `${indent}${line}`);
  return src.slice(0, range.open + 1) + lines.join('\n') + src.slice(range.close - 1);
}

function profileBlock(profile, packs, envName) {
  const folders = packs.map((p) => `tests/features/${dirName(p.name)}/`).join(' and ');
  return [
    BLOCK_START(profile),
    `// A profile of its own for ${packs.map((p) => p.name).join(' and ')}: platform packs share phrases on purpose`,
    '// (the webship-js FAQ, "Can I load several step packs in one project?"), so two of them never share one.',
    `// Its features live in ${folders}, which the default profile leaves to it. Run it with`,
    `// npx cucumber-js -p ${profile}, or cmd-tools-testing.sh <project> --run --profile ${profile}.`,
    '// Give it the address of that site and its accounts: nothing here is filled in for you.',
    `module.exports['${profile}'] = {`,
    '  ...module.exports.default,',
    '  require: [',
    `    '${CORE_GLOB}',`,
    ...packs.map((p) => `    '${p.glob}', ${MARK}`),
    '  ],',
    "  paths: process.env.FEATURES ? process.env.FEATURES.split(',') : [",
    ...packs.map((p) => `    'tests/features/${dirName(p.name)}/**/*.feature',`),
    '  ],',
    '  worldParameters: {',
    '    ...module.exports.default.worldParameters,',
    `    launchUrl: process.env.${envName} || 'https://${profile}.example',`,
    '    users: {},',
    '  },',
    '};',
    BLOCK_END(profile),
    '',
  ].join('\n');
}

function pathsBlock(folders) {
  return [
    PATHS_START,
    '// The default profile leaves the folders of the profiles above to them (cmd-tools-testing.sh --add-steps).',
    `if (JSON.stringify(module.exports.default && module.exports.default.paths) === '${JSON.stringify([DEFAULT_FEATURES])}') {`,
    `  module.exports.default.paths = ['tests/features/*.feature', 'tests/features/!(${folders.join('|')})/**/*.feature'];`,
    '}',
    PATHS_END,
    '',
  ].join('\n');
}

/** Rewrite the default-paths block from the profile blocks there are now (none: no block). */
function refreshPathsBlock(src) {
  const layout = readCucumber(src);
  let out = src;
  if (layout.pathsBlock) out = out.slice(0, layout.pathsBlock.start) + out.slice(layout.pathsBlock.end);
  const folders = [...new Set(readCucumber(out).profiles.flatMap((p) => p.features))];
  if (!folders.length) return out;
  return `${out.replace(/\n*$/, '\n')}\n${pathsBlock(folders)}`;
}

const hasDefaultProfile = (src) => /module\.exports\s*=\s*\{[\s\S]*?\bdefault\s*:\s*\{/.test(src) || /module\.exports\.default\s*=/.test(src);

/* ------------------------------------------------------------------ add, remove, examples */

function rangeFor(version) {
  const m = /^(\d+)\.(\d+)\./.exec(String(version || ''));
  return m ? `^${m[1]}.${m[2]}.0` : '^2.0.0';
}

function indentOf(text) {
  const m = /^([ \t]+)"/m.exec(text || '');
  return m ? (m[1].includes('\t') ? '\t' : m[1].length) : 2;
}

/**
 * Add one pack: package.json, cucumber.js, the record. Never installs anything (the caller runs npm
 * install, in the project's container). `{ ok, code, changed: [], notes: [], fill: [], profile }`;
 * code 3 is "it needs a profile of its own and this cucumber.js has no default profile to build one on".
 */
function addPack(projectDir, pack, { readme = '', packConfig = packConfigOf(projectDir, pack.name), metaOf } = {}) {
  const name = pack.name;
  const out = { ok: true, code: 0, name, changed: [], notes: [], fill: [], profile: '' };
  const pkgFile = path.join(projectDir, 'package.json');
  const cucFile = path.join(projectDir, 'cucumber.js');
  const pkgText = readText(pkgFile);
  let src = readText(cucFile);
  if (pkgText === null || src === null) {
    return { ...out, ok: false, code: 1, error: 'This project has no webship-js stack yet (package.json and cucumber.js): set testing up first.' };
  }
  let pkg;
  try { pkg = JSON.parse(pkgText); } catch (e) { return { ...out, ok: false, code: 1, error: `package.json is not valid JSON: ${e.message}` }; }
  const known = knownPacks();
  const meta = metaOf || ((n) => (n === name ? pack : describePack({ name: n }, known)));
  const record = readRecord(projectDir);
  const rec = { ...(record.packs[name] || {}) };
  const layout = readCucumber(src);
  const glob = globFor(name, readme);

  // cucumber.js first: when it cannot take the pack, nothing else is changed either.
  const already = layout.packs.find((p) => p.name === name);
  let newSrc = src;
  if (already) {
    out.profile = already.profile;
    out.notes.push(`cucumber.js already loads ${name}${already.profile === 'default' ? '' : ` (profile ${already.profile})`}: left as it is.`);
  } else {
    const place = placeFor(name, layout, meta);
    out.profile = place.profile;
    if (place.profile === 'default') {
      const range = defaultRequireRange(src, layout.firstBlock);
      const edited = range && insertIntoArray(src, range, `'${glob}', ${MARK}`);
      if (!edited) {
        return { ...out, ok: false, code: 3, error: `cucumber.js has no require list this can add to. Add this line to the require list of its default profile yourself:\n    '${glob}',` };
      }
      newSrc = edited;
    } else if (place.create) {
      if (!hasDefaultProfile(src)) {
        return {
          ...out, ok: false, code: 3,
          error: `${name} is a platform pack, and this project's default profile already loads ${place.others.join(', ')}: `
            + 'platform packs share phrases, so it needs a profile of its own, and this cucumber.js has no `default` profile to build one on. '
            + `Give it one yourself, for example:\n\n${profileBlock(place.profile, [{ name, glob }], `${place.profile.toUpperCase().replace(/-/g, '_')}_LAUNCH_URL`)}`,
        };
      }
      const block = profileBlock(place.profile, [{ name, glob }], `${place.profile.toUpperCase().replace(/-/g, '_')}_LAUNCH_URL`);
      const cut = layout.pathsBlock ? layout.pathsBlock.start : src.length;
      newSrc = `${src.slice(0, cut).replace(/\n*$/, '\n')}\n${block}${src.slice(cut)}`;
      newSrc = refreshPathsBlock(newSrc);
      rec.createdProfile = place.profile;
      out.notes.push(`${name} is a platform pack and the default profile already loads ${place.others.join(', ')}: it has a profile of its own, "${place.profile}" (npx cucumber-js -p ${place.profile}). Its features go in tests/features/${dirName(name)}/.`);
    } else {
      // Into the profile its base or its group already has.
      const block = managedBlocks(src).blocks.find((b) => b.name === place.profile);
      const reqAt = block.text.search(/\brequire\s*:\s*\[/);
      const open = block.start + block.text.indexOf('[', reqAt);
      let edited = insertIntoArray(src, { open, close: matchingClose(src, open) }, `'${glob}', ${MARK}`);
      if (edited) {
        const b2 = managedBlocks(edited).blocks.find((b) => b.name === place.profile);
        const pOpen = edited.indexOf('[', b2.start + b2.text.search(/\bpaths\s*:/));
        const withPath = insertIntoArray(edited, { open: pOpen, close: matchingClose(edited, pOpen) }, `'tests/features/${dirName(name)}/**/*.feature',`);
        edited = withPath ? refreshPathsBlock(withPath) : edited;
      }
      if (!edited) return { ...out, ok: false, code: 3, error: `The profile "${place.profile}" in cucumber.js could not be read: add '${glob}' to its require list yourself.` };
      newSrc = edited;
      out.notes.push(`${name} goes with ${meta(name).base || 'its group'} in the profile "${place.profile}".`);
    }
    rec.require = glob;
    rec.profile = place.profile;
    out.changed.push(`cucumber.js: ${glob}${place.profile === 'default' ? '' : ` (profile ${place.profile})`}`);
  }

  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  let newPkg = null;
  if (deps[name]) {
    out.notes.push(`package.json already has ${name} (${deps[name]}): left as it is.`);
  } else {
    const range = rangeFor(pack.version);
    // A devDependencies block this makes is taken out again with the last pack in it.
    if (!pkg.devDependencies) record.createdDevDependencies = true;
    pkg.devDependencies = { ...(pkg.devDependencies || {}), [name]: range };
    newPkg = `${JSON.stringify(pkg, null, indentOf(pkgText))}\n`;
    rec.devDependency = range;
    out.changed.push(`package.json: ${name} ${range} (devDependencies)`);
  }

  if (newSrc !== src) fs.writeFileSync(cucFile, newSrc);
  if (newPkg) fs.writeFileSync(pkgFile, newPkg);
  if (newSrc !== src || newPkg) {
    record.packs[name] = rec;
    writeRecord(projectDir, record);
  }
  if (meta(name).kind === 'extension' && meta(name).base && !deps[meta(name).base] && !readCucumber(newSrc).packs.some((p) => p.name === meta(name).base)) {
    out.notes.push(`${name} builds on ${meta(name).base}.${pack.note ? ` ${pack.note}` : ` Add it too if this pack does not bring it along: --add-steps ${shortName(meta(name).base)}.`}`);
  }
  // What to fill in: the settings the README shows, and those of the cucumber.js the pack ships, if any.
  out.fill = settingsToFill(newSrc, [readme, packConfig].filter(Boolean).join('\n'), out.profile || 'default');
  return out;
}

/** Remove a line (exact text, with its newline) from the region [from, to) of src. */
function dropLine(src, text, from = 0, to = src.length) {
  const at = src.indexOf(text, from);
  if (at < 0 || at >= to) return null;
  const start = src.lastIndexOf('\n', at) + 1;
  let end = src.indexOf('\n', at);
  end = end < 0 ? src.length : end + 1;
  return src.slice(0, start) + src.slice(end);
}

/** Undo what addPack recorded for one pack, and nothing else. `{ ok, changed, notes, left }`. */
function removePack(projectDir, name) {
  const out = { ok: true, code: 0, name, changed: [], notes: [], left: [] };
  const record = readRecord(projectDir);
  const rec = record.packs[name] || {};
  if (!rec.devDependency && !rec.require) {
    const st = projectState(projectDir).packs[name];
    out.notes.push(st && (st.range || st.profile)
      ? `--add-steps did not add ${name} to this project (a platform plugin or a person did): nothing to take out, nothing changed.`
      : `${name} is not in this project: nothing to take out.`);
  } else {
    const pkgFile = path.join(projectDir, 'package.json');
    const cucFile = path.join(projectDir, 'cucumber.js');
    let src = readText(cucFile);
    if (rec.require && src !== null) {
      const { blocks } = managedBlocks(src);
      const block = rec.profile && rec.profile !== 'default' ? blocks.find((b) => b.name === rec.profile) : null;
      const line = `'${rec.require}', ${MARK}`;
      const from = block ? block.start : 0;
      const to = block ? block.end : readCucumber(src).firstBlock;
      const dropped = dropLine(src, line, from, to);
      if (dropped === null) {
        out.notes.push(`cucumber.js no longer has the line --add-steps wrote for ${name} (it was edited): left as it is.`);
      } else {
        src = dropped;
        out.changed.push(`cucumber.js: ${rec.require}${block ? ` (profile ${block.name})` : ''} taken out`);
        if (block) {
          const b2 = managedBlocks(src).blocks.find((b) => b.name === block.name);
          const pathLine = `'tests/features/${dirName(name)}/**/*.feature',`;
          const withoutPath = b2 ? dropLine(src, pathLine, b2.start, b2.end) : null;
          if (withoutPath !== null) src = withoutPath;
          const b3 = managedBlocks(src).blocks.find((b) => b.name === block.name);
          if (b3 && !readCucumber(src).packs.some((p) => p.profile === block.name)) {
            src = src.slice(0, b3.start).replace(/\n+$/, '\n') + src.slice(b3.end).replace(/^\n+/, '\n');
            out.changed.push(`cucumber.js: the profile "${block.name}" taken out (no pack left in it)`);
          }
          src = refreshPathsBlock(src).replace(/\n{3,}/g, '\n\n');
        }
        fs.writeFileSync(cucFile, src.replace(/\n*$/, '\n'));
      }
    }
    if (rec.devDependency) {
      const pkgText = readText(pkgFile);
      let pkg = null;
      try { pkg = JSON.parse(pkgText); } catch (_) { pkg = null; }
      if (pkg && pkg.devDependencies && pkg.devDependencies[name]) {
        delete pkg.devDependencies[name];
        if (!Object.keys(pkg.devDependencies).length && record.createdDevDependencies) {
          delete pkg.devDependencies;
          delete record.createdDevDependencies;
        }
        fs.writeFileSync(pkgFile, `${JSON.stringify(pkg, null, indentOf(pkgText))}\n`);
        out.changed.push(`package.json: ${name} taken out of devDependencies`);
      } else {
        out.notes.push(`package.json no longer lists ${name} in devDependencies: left as it is.`);
      }
    }
  }
  // What stays: the examples --examples copied (features are yours to keep or delete), and settings you filled in.
  const folder = path.join('tests', 'features', dirName(name));
  const features = featureFiles(path.join(projectDir, folder));
  if (features.length) {
    out.left.push(`${folder}/ (${features.length} feature${features.length === 1 ? '' : 's'}) stays: features are yours. Without the pack their steps are undefined, so delete the folder if you no longer want it (rm -r ${folder}).`);
  }
  const keepExamples = rec.examples;
  delete rec.devDependency; delete rec.require; delete rec.profile; delete rec.createdProfile;
  record.packs[name] = keepExamples ? { examples: keepExamples } : {};
  if (!features.length) delete record.packs[name];
  writeRecord(projectDir, record);
  return out;
}

/** Copy the example features a pack ships into tests/features/<pack>/, never over a file. */
function copyExamples(projectDir, name) {
  const out = { ok: true, code: 0, name, copied: [], kept: [], notes: [], folder: path.join('tests', 'features', dirName(name)) };
  const pkgDir = path.join(projectDir, 'node_modules', ...name.split('/'));
  if (!installedVersion(projectDir, name)) {
    return { ...out, ok: false, code: 4, error: `${name} is not installed in this project yet.` };
  }
  const from = ['tests/features', 'features', 'examples'].map((d) => path.join(pkgDir, d)).find(isDir);
  const files = from ? featureFiles(from) : [];
  if (!files.length) { out.notes.push(`${name} ships no example features.`); return out; }
  const dest = path.join(projectDir, out.folder);
  for (const rel of files) {
    const to = path.join(dest, ...rel.split('/'));
    try {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(path.join(from, ...rel.split('/')), to, fs.constants.COPYFILE_EXCL);
      out.copied.push(rel);
    } catch (e) {
      if (e && e.code === 'EEXIST') out.kept.push(rel); else throw e;
    }
  }
  if (out.copied.length) {
    const record = readRecord(projectDir);
    const rec = record.packs[name] || {};
    rec.examples = [...new Set([...(rec.examples || []), ...out.copied.map((r) => `${out.folder.split(path.sep).join('/')}/${r}`)])].sort();
    record.packs[name] = rec;
    writeRecord(projectDir, record);
  }
  return out;
}

/* ------------------------------------------------------------------ a suggestion, never an install */

/** The host DDEV gives a project: <name>.ddev.site, from its .ddev/config.yaml. */
function projectHost(projectDir) {
  const yml = readText(path.join(projectDir, '.ddev', 'config.yaml')) || '';
  const m = /^name:\s*["']?([A-Za-z0-9][A-Za-z0-9.-]*)["']?\s*$/m.exec(yml);
  return m ? `${m[1]}.ddev.site` : '';
}

let routerAddress = null;
async function routerHost() {
  if (process.env.WORKSPACE_DDEV_ROUTER) return process.env.WORKSPACE_DDEV_ROUTER;
  if (routerAddress === null) {
    routerAddress = await new Promise((resolve) => dns.lookup('ddev-router', (err) => resolve(err ? '127.0.0.1' : 'ddev-router')));
  }
  return routerAddress;
}

/** GET a page of a local DDEV site through the router (from this machine or from inside a container). */
async function fetchSitePage(url, { hops = 3, timeoutMs = 12000 } = {}) {
  const u = new URL(url);
  const host = await routerHost();
  const res = await new Promise((resolve, reject) => {
    const req = https.request({
      host, port: 443, method: 'GET', path: `${u.pathname}${u.search}`, servername: u.hostname, rejectUnauthorized: false, timeout: timeoutMs,
      headers: { Host: u.hostname, 'User-Agent': 'Mozilla/5.0 (compatible; Webship Workspace)', Accept: 'text/html' },
    }, (r) => {
      const parts = []; let size = 0;
      r.on('data', (d) => { size += d.length; if (size <= 2 * 1024 * 1024) parts.push(d); else r.destroy(); });
      const done = () => resolve({ status: r.statusCode, headers: r.headers, html: Buffer.concat(parts).toString('utf8') });
      r.on('end', done); r.on('close', done); r.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
  if ([301, 302, 303, 307, 308].includes(res.status) && res.headers.location && hops > 0) {
    const next = new URL(res.headers.location, u);
    if (next.hostname === u.hostname) return fetchSitePage(next.href, { hops: hops - 1, timeoutMs });
  }
  return res;
}

/** Which packs a page looks like it needs: [{ pack, evidence }], from the rules the shipped list gives each pack. */
function detectPacks(page, packs) {
  const html = String((page && page.html) || '');
  const headers = (page && page.headers) || {};
  const header = (n) => { const v = headers[n] || headers[n.toLowerCase()]; return Array.isArray(v) ? v.join(' ') : String(v || ''); };
  const generators = [...html.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0])
    .filter((t) => /\bname\s*=\s*["']?generator["']?/i.test(t))
    .map((t) => (/\bcontent\s*=\s*["']([^"']*)["']/i.exec(t) || [])[1]).filter(Boolean);
  if (header('x-generator')) generators.push(header('x-generator'));
  const poweredBy = header('x-powered-by');
  const assets = [...html.matchAll(/<(?:link|script)\b[^>]*?\b(?:href|src)\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
  const out = [];
  for (const pack of packs) {
    for (const rule of pack.detect || []) {
      let evidence = '';
      try {
        if (rule.generator) { const g = generators.find((x) => new RegExp(rule.generator, 'i').test(x)); if (g) evidence = `the generator meta tag says "${g}"`; }
        if (!evidence && rule.poweredBy && new RegExp(rule.poweredBy, 'i').test(poweredBy)) evidence = `X-Powered-By says "${poweredBy}"`;
        if (!evidence && rule.asset) { const a = assets.find((x) => new RegExp(rule.asset, 'i').test(x)); if (a) evidence = `the page loads ${a}`; }
        if (!evidence && rule.html) { const h = new RegExp(rule.html, 'i').exec(html); if (h) evidence = `the page carries "${h[0].slice(0, 60)}"`; }
      } catch (_) { evidence = ''; }
      if (evidence) { out.push({ pack, evidence }); break; }
    }
  }
  return out;
}

/** The packs that would fit the site a project serves and that it does not have yet. Never installs. */
async function suggestFor(projectDir, { list, fetchPage = fetchSitePage } = {}) {
  const host = projectHost(projectDir);
  if (!host) return { host: '', hits: [], error: 'no DDEV project name' };
  let page;
  try { page = await fetchPage(`https://${host}/`); } catch (e) { return { host, hits: [], error: String((e && e.message) || e) }; }
  const has = projectState(projectDir).packs;
  const hits = detectPacks(page, (list || []).filter((p) => !has[p.name]));
  return { host, hits, status: page.status };
}

/* ------------------------------------------------------------------ the command line */

function ago(ms) {
  const m = Math.round(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

function sourceLine(list) {
  const n = list.packs.length;
  if (list.source === 'npm') return `${n} on npm (asked just now; kept for a day)`;
  if (list.source === 'cache') return `${n} on npm (asked ${ago(Date.now() - list.at)}; kept for a day)`;
  if (list.source === 'stale-cache') return `${n} on npm when it was last reached, ${ago(Date.now() - list.at)} (it cannot be reached now: ${list.error})`;
  return `${n} in the list shipped with the Workspace (npm cannot be reached: ${list.error})`;
}

function printList(list, state, label) {
  const lines = [`The webship-js extra-steps packs: ${sourceLine(list)}.`, `✓ = in ${label}.`, ''];
  const w = Math.max(...list.packs.map((p) => p.name.length), 10);
  const t = Math.max(...list.packs.map((p) => p.title.length), 6);
  for (const p of list.packs) {
    const has = state.packs[p.name];
    const mark = has ? '✓' : ' ';
    const kind = p.kind === 'any-site' ? 'any site' : (p.kind === 'extension' ? `extension of ${shortName(p.base)}` : 'platform');
    const where = has ? `  [${has.range || 'not in package.json'}${has.installed ? `, ${has.installed} installed` : ', not installed'}${has.profile && has.profile !== 'default' ? `, profile ${has.profile}` : ''}]` : '';
    lines.push(`  ${mark} ${p.title.padEnd(t)}  ${p.name.padEnd(w)}  ${(p.version || '?').padEnd(7)} ${kind}${where}`);
    if (p.summary) lines.push(`      ${p.summary}`);
    lines.push(`      ${p.docs}`);
  }
  // A pack the project has that the list does not (a private one, or one taken off npm).
  for (const name of Object.keys(state.packs).filter((n) => !list.packs.some((p) => p.name === n))) {
    lines.push(`  ✓ ${name} (not in the list)`);
  }
  return lines.join('\n');
}

function fillLines(name, fill) {
  if (!fill.length) return [];
  const lines = [`  ${name} reads settings (worldParameters in cucumber.js) this project does not set yet:`];
  for (const f of fill) {
    if (f.key === 'users') {
      const handles = f.missingUsers.length ? f.missingUsers : f.nested;
      lines.push(`    users: the accounts of your site, by handle${handles.length ? ` (its README uses ${handles.join(', ')})` : ''}`);
    } else {
      lines.push(`    ${f.key}${f.nested.length ? `: ${f.nested.join(', ')}` : ''}`);
    }
  }
  lines.push(`  Nothing was filled in for you: take them from the pack's README or ${docsUrl(name)}, with your own values.`);
  return lines;
}

async function main(argv) {
  const [verb, projectDir, ...rest] = argv;
  const flags = new Set(rest.filter((a) => a.startsWith('--')));
  const args = rest.filter((a) => !a.startsWith('--'));
  const opt = (k) => { const a = rest.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : ''; };
  const say = (s) => process.stdout.write(`${s}\n`);
  const fail = (s, code = 1) => { process.stderr.write(`${s}\n`); return code; };
  if (!verb || !projectDir) return fail('Usage: step_packs.js <list|add|remove|examples|suggest|missing|profile-for|profiles> <project dir> [pack…]', 2);
  const dir = path.resolve(projectDir);
  const offline = flags.has('--offline') || process.env.WORKSPACE_STEPS_OFFLINE === '1';

  if (verb === 'missing') { notInstalled(dir).forEach((n) => say(n)); return 0; }
  if (verb === 'profile-for') { say(profileFor(dir, args[0])); return 0; }
  if (verb === 'profiles') { readCucumber(readText(path.join(dir, 'cucumber.js')) || '').profiles.forEach((p) => say(p.name)); return 0; }

  const list = await listPacks({ offline, refresh: flags.has('--refresh') });
  if (verb === 'list') {
    if (flags.has('--json')) { say(JSON.stringify({ ...list, project: projectState(dir) }, null, 2)); return 0; }
    say(printList(list, projectState(dir), opt('label') || path.basename(dir)));
    return 0;
  }

  // Every pack named, checked against the list before anything is touched.
  const resolve = (input) => {
    const name = packName(input);
    const pack = name && list.packs.find((p) => p.name === name);
    return { input, name, pack };
  };
  const wanted = args.flatMap((a) => a.split(',')).map((s) => s.trim()).filter(Boolean).map(resolve);
  if (['add', 'remove', 'examples'].includes(verb)) {
    if (!wanted.length) return fail(`Name a pack: ${verb} <project dir> <pack>[,<pack>…] (e.g. diffy, wordpress-steps or @webship-js/diffy-steps).`, 2);
    const has = projectState(dir).packs;
    const unknown = wanted.filter((w) => !w.name || (!w.pack && !(verb !== 'add' && has[w.name])));
    if (unknown.length) {
      return fail(`Not a webship-js step pack this list knows: ${unknown.map((u) => u.input).join(', ')}.\n`
        + `  The list (${sourceLine(list)}): ${list.packs.map((p) => p.short).join(', ')}.\n  See them all: cmd-tools-testing.sh <project> --list-steps`, 2);
    }
  }

  if (verb === 'add') {
    let status = 0;
    for (const w of wanted) {
      const readme = await readmeOf(dir, w.name, { offline });
      const known = new Map(list.packs.map((p) => [p.name, p]));
      const metaOf = (n) => known.get(n) || describePack({ name: n });
      const r = addPack(dir, w.pack, { readme, metaOf });
      say('');
      if (!r.ok) { status = r.code || 1; fail(`${w.name}: ${r.error}`); continue; }
      say(`${w.name} (${w.pack.version || 'latest'}${w.pack.kind === 'any-site' ? ', for any site' : ''}):`);
      r.changed.forEach((c) => say(`  ${c}`));
      r.notes.forEach((c) => say(`  ${c}`));
      if (!r.changed.length) say('  Nothing to add: it was all there already.');
      fillLines(w.name, r.fill).forEach((l) => say(l));
      if (!readme) say(`  Its README could not be read, so the glob is the usual one; check it against ${w.pack.docs}.`);
    }
    return status;
  }
  if (verb === 'remove') {
    for (const w of wanted) {
      const r = removePack(dir, w.name);
      say('');
      say(`${w.name}:`);
      r.changed.forEach((c) => say(`  ${c}`));
      r.notes.forEach((c) => say(`  ${c}`));
      r.left.forEach((c) => say(`  Left behind: ${c}`));
    }
    return 0;
  }
  if (verb === 'examples') {
    let status = 0;
    for (const w of wanted) {
      const r = copyExamples(dir, w.name);
      say('');
      if (!r.ok) { status = r.code || 1; fail(`${w.name}: ${r.error}`); continue; }
      say(`${w.name}: ${r.copied.length} example feature${r.copied.length === 1 ? '' : 's'} copied into ${r.folder}/${r.kept.length ? `, ${r.kept.length} left as ${r.kept.length === 1 ? 'it was' : 'they were'} (a file of that name is already there)` : ''}.`);
      r.copied.forEach((c) => say(`  + ${r.folder}/${c}`));
      r.kept.forEach((c) => say(`  = ${r.folder}/${c} (kept)`));
      r.notes.forEach((c) => say(`  ${c}`));
    }
    return status;
  }
  if (verb === 'suggest') {
    const s = await suggestFor(dir, { list: list.packs });
    for (const h of s.hits) {
      say(`  This site looks like ${h.pack.title} (${h.evidence}). The pack that fits: ${h.pack.name}`);
      say(`    ${h.pack.summary}`);
      say(`    Add it (nothing is installed until you do): cmd-tools-testing.sh <project> --add-steps ${h.pack.short}`);
      if (h.pack.note) say(`    ${h.pack.note}`);
    }
    return 0;
  }
  return fail(`Unknown verb: ${verb}`, 2);
}

module.exports = {
  PACK_RE, SEARCH_URLS, ORG_URL, CORE_GLOB, CORE_SETTINGS, MARK, RECORD, DAY,
  packName, dirName, shortName, docsUrl,
  shippedList, knownPacks, describePack, cacheFile, fetchRegistry, listPacks,
  objectKeys, readCucumber, projectSettings, readmeSettings, settingsToFill, globFor, readmeOf, packConfigOf,
  projectState, notInstalled, profileFor, placeFor, featureFiles,
  addPack, removePack, copyExamples,
  projectHost, fetchSitePage, detectPacks, suggestFor,
  main,
};

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => {
    process.stderr.write(`${(e && e.stack) || e}\n`);
    process.exitCode = 1;
  });
}
