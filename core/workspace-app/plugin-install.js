/**
 * Installing a plugin into the workspace: placing what its manifest names.
 *
 *   node plugin-install.js install <name>     place everything, idempotently
 *   node plugin-install.js uninstall <name>   remove exactly what install placed
 *   node plugin-install.js status [<name>]    what is placed, what is not, as JSON
 *   node plugin-install.js reach              after the workspaces list changed: the installed plugins' commands and
 *                                             AI items go into the folders that are workspaces now, and out of the rest
 *   node plugin-install.js remember [<name>]  note how the installed versions shipped what they placed (records from
 *                                             1.0.15 and earlier lack it), before npm replaces a package
 *
 * A package in node_modules is code the dashboard can require; the workspace is a tree of bash
 * scripts, DDEV config and settings files that know nothing about node_modules. This is the
 * bridge: it copies (never links — a link breaks the moment a package is updated or removed)
 * each piece to where the workspace expects it, records every path it wrote in
 * core/config/plugins.installed.yml, and keeps a managed block in .gitignore so a dev clone
 * never commits what an install placed.
 *
 *   scripts.functions   -> core/scripts/plugins/<name>/functions/   (bootstrap sources them)
 *   scripts.args        -> core/scripts/plugins/<name>/args/
 *   scripts.machine     -> core/scripts/plugins/<name>/
 *   scripts.hostInstall -> core/scripts/plugins/<name>/host-install.sh
 *   ddev.hostMounts     -> core/scripts/plugins/<name>/host-mounts.txt (host-mounts.sh reads it)
 *   commands.files      -> <workspace>/ for every named workspace that is active here (on the workspaces list),
 *                          else every active one of commands.types (__WORKSPACE__ filled in)
 *   ddev.compose        -> core/workspace-app/.ddev/docker-compose.plugin-<name>-<file>
 *   themes              -> core/config/
 *   settingsTemplate    -> core/config/plugin.<name>.settings.yml, only when absent, carrying the
 *                          values of the settings.yml block it replaces (legacySettingsKey)
 *   features            -> core/workspace-app/tests/features/plugins/<name>/  (webship-js runs them)
 *   ai.agents|skills|   -> ai-agents/ | ai-skills/ | ai-commands/ | ai-prompts/, when that workspace folder is
 *   commands|prompts       there. A file a person edited (or already had) is kept, at install and at uninstall.
 *
 * What a plugin `needs` from another plugin (plugin-needs.js) is checked first: an install whose needs are
 * not met places nothing, and an uninstall another installed plugin relies on removes nothing. A plugin
 * that is a workspace folder arriving later is reached too: the commands and AI items of the plugins
 * already installed are placed into it.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const yaml = require('js-yaml');

const { pluginByName, installedPlugins } = require('./plugin-manifest.mts');
const needs = require('./plugin-needs');
// The workspace root as the dashboard knows it — NOT __dirname's parents: inside the container the
// app runs at /var/www/html while the tree is bind-mounted at its own absolute path, and the record
// written from one side must be the one read from the other.
const { ROOT, CONFIG_DIR } = require('./workspaces');

const SCRIPTS_DIR = path.join(ROOT, 'core', 'scripts');
const DDEV_DIR = path.join(ROOT, 'core', 'workspace-app', '.ddev');
const RECORD = path.join(CONFIG_DIR, 'plugins.installed.yml');
const GITIGNORE = path.join(ROOT, '.gitignore');
const BLOCK_START = '# plugins — managed by core/scripts/plugins.sh; do not edit between the markers';
const BLOCK_END = '# end plugins';

const rel = (p) => path.relative(ROOT, p);

function readRecord() {
  try { return yaml.load(fs.readFileSync(RECORD, 'utf8')) || {}; } catch (_) { return {}; }
}
/**
 * Which plugin placed a path of the workspace, as { name, module, version }, or null: what an item's row
 * says it came with. An AI item is `ai-agents/<name>.md`, a skill `ai-skills/<name>/SKILL.md`. The first
 * plugin to have placed a path owns it (isAnothers keeps a second one from taking it).
 */
function placedBy(relPath, record = readRecord()) {
  const want = String(relPath || '').split(path.sep).join('/');
  if (!want) return null;
  for (const [name, entry] of Object.entries(record || {})) {
    if (entry && Array.isArray(entry.placed) && entry.placed.includes(want)) {
      return { name, module: String(entry.module || ''), version: String(entry.version || '') };
    }
  }
  return null;
}
function writeRecord(data) {
  fs.writeFileSync(RECORD, `# Written by core/scripts/plugins.sh: what each installed plugin placed in this tree.\n${yaml.dump(data)}`);
}

/** Whether a folder is a workspace of this dashboard: on settings.yml's workspaces list, and on disk. A folder that was taken off the list is not one. */
function isActiveWorkspace(key) {
  const { loadSettings } = require('./workspaces');
  return ((loadSettings().workspaces) || []).map(String).includes(String(key)) && fs.existsSync(path.join(ROOT, key));
}

/** Workspaces of the given types, from settings.yml and each workspace.<key>.settings.yml. */
function workspacesOfTypes(types) {
  const { loadWorkspaces } = require('./workspaces');
  const all = loadWorkspaces();
  return Object.entries(all).filter(([, m]) => types.includes(m.type)).map(([key]) => key);
}

/** A file's bytes with the placeholders filled in (__WORKSPACE__ in a command): what an install writes. */
function filled(data, fill) {
  return fill ? Buffer.from(Object.entries(fill).reduce((t, [k, v]) => t.split(k).join(v), data.toString('utf8'))) : data;
}

function copyFile(src, dest, { fill, mode } = {}) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, filled(fs.readFileSync(src), fill), { mode: mode || (fs.statSync(src).mode & 0o777) });
  if (mode) fs.chmodSync(dest, mode);
}

// The AI items a plugin ships: the manifest's `ai` block, by kind, and the workspace folder of each kind.
const AI_KINDS = { agents: 'ai-agents', skills: 'ai-skills', commands: 'ai-commands', prompts: 'ai-prompts' };

const sha = (data) => crypto.createHash('sha256').update(data).digest('hex');
const hashOf = (file) => { try { return sha(fs.readFileSync(file)); } catch (_) { return null; } };

/** The files of one manifest entry: the file itself, or every file of a folder (a skill is a folder). */
function filesOf(src) {
  if (!fs.statSync(src).isDirectory()) return [''];
  const out = [];
  const walk = (dir, relTo) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const r = relTo ? `${relTo}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), r); else if (e.isFile()) out.push(r);
    }
  };
  walk(src, '');
  return out.sort();
}

/**
 * Place the AI items of a plugin (agents, skills, commands, prompts) in the workspace folder of their kind,
 * where the dashboard lists them like any other item of that folder.
 *
 * These are files a person edits in place, so each one is recorded with the hash of what was placed:
 * a file that still is what the plugin placed is updated, a file that differs (edited here, or one the
 * person already had under that name) is kept, and uninstall removes only what is still the plugin's.
 */
function placeAiItems(plugin, entry, placed, hashes, notes) {
  const before = (entry && entry.hashes) || {};
  for (const [kind, key] of Object.entries(AI_KINDS)) {
    const list = ((plugin.manifest.ai || {})[kind]) || [];
    if (!list.length) continue;
    const folder = path.join(ROOT, key);
    if (!isActiveWorkspace(key)) {
      notes.push(`  skipped ${list.length} ${kind}: there is no ${key}/ workspace here (add the ${key} workspace: they are placed when it is installed)`);
      continue;
    }
    for (const f of list) {
      const src = path.join(plugin.dir, f);
      for (const inner of filesOf(src)) {
        const from = inner ? path.join(src, inner) : src;
        const dest = inner ? path.join(folder, path.basename(f), inner) : path.join(folder, path.basename(f));
        const r = rel(dest);
        const ours = sha(fs.readFileSync(from));
        const now = hashOf(dest);
        if (now === null || now === ours || (before[r] && now === before[r])) {
          if (now !== ours) copyFile(from, dest);
          placed.push(r);
          hashes[r] = ours;
        } else if (before[r]) {
          // Placed by an earlier install and edited since: the person's file, still recorded as this plugin's.
          placed.push(r);
          hashes[r] = before[r];
          notes.push(`  kept ${r} (edited here; the plugin's copy is ${path.join(plugin.dir, f, inner)})`);
          notes.kept.push(r);
        } else {
          notes.push(`  kept ${r} (a file of that name was already here)`);
        }
      }
    }
  }
}

/**
 * The plugin's own files, and where an install puts each: its functions, args, machine scripts and host
 * installer, its host mounts, its compose files, its commands (into the workspaces they belong to, or into
 * `commandFolders` when given), its themes, the files of the workspace folder it is, its features.
 * These follow the package: every install writes them again. `{ dest, src, fill }` or `{ dest, data }`.
 */
function ownFiles(plugin, { commandFolders = null } = {}) {
  const m = plugin.manifest;
  const name = plugin.name;
  const from = (f) => path.join(plugin.dir, f);
  const out = [];
  const scripts = m.scripts || {};
  const into = path.join(SCRIPTS_DIR, 'plugins', name);
  for (const f of scripts.functions || []) out.push({ dest: path.join(into, 'functions', path.basename(f)), src: from(f) });
  for (const f of scripts.args || []) out.push({ dest: path.join(into, 'args', path.basename(f)), src: from(f) });
  for (const f of scripts.machine || []) out.push({ dest: path.join(into, path.basename(f)), src: from(f) });
  if (scripts.hostInstall) out.push({ dest: path.join(into, 'host-install.sh'), src: from(scripts.hostInstall) });
  const ddev = m.ddev || {};
  if ((ddev.hostMounts || []).length) out.push({ dest: path.join(into, 'host-mounts.txt'), data: `${ddev.hostMounts.join('\n')}\n` });
  for (const f of ddev.compose || []) out.push({ dest: path.join(DDEV_DIR, `docker-compose.plugin-${name}-${path.basename(f).replace(/^docker-compose\./, '')}`), src: from(f), compose: true });
  const commands = m.commands || {};
  if ((commands.files || []).length) {
    // Named workspaces when the manifest lists them (only those that exist), else every one of the types.
    let folders = commandFolders;
    if (!folders) {
      const named = (commands.workspaces || []).filter((ws) => /^[a-z0-9_-]+$/.test(ws) && isActiveWorkspace(ws));
      folders = named.length ? named : workspacesOfTypes(commands.types || ['sites']);
    }
    for (const ws of folders.filter((w) => /^[a-z0-9_-]+$/.test(w))) {
      for (const f of commands.files) out.push({ dest: path.join(ROOT, ws, path.basename(f)), src: from(f), fill: { __WORKSPACE__: ws } });
    }
  }
  for (const f of m.themes || []) out.push({ dest: path.join(CONFIG_DIR, path.basename(f)), src: from(f) });
  const ws = m.workspace || null;
  if (ws && /^[a-z0-9_-]+$/.test(String(ws.key || ''))) {
    for (const f of ws.files || []) out.push({ dest: path.join(ROOT, ws.key, path.basename(f)), src: from(f), fill: { __WORKSPACE__: ws.key } });
  }
  // webship-js features, under tests/features/plugins/<name>/: the dashboard's cucumber paths cover every
  // folder below tests/features, so an installed plugin's scenarios run with `ddev test-dashboard browser`.
  for (const f of m.features || []) out.push({ dest: path.join(ROOT, 'core', 'workspace-app', 'tests', 'features', 'plugins', name, path.basename(f)), src: from(f) });
  return out;
}

/** What an install writes for one of the plugin's own files. */
const contentOf = (o) => (o.data !== undefined ? Buffer.from(o.data) : filled(fs.readFileSync(o.src), o.fill));

/** `<file>.yours`, or `<file>.yours-2` … when that is taken: where a person's changed copy is kept. */
function freeName(base) {
  if (!fs.existsSync(base)) return base;
  for (let n = 2; ; n += 1) if (!fs.existsSync(`${base}-${n}`)) return `${base}-${n}`;
}

/**
 * Note how the installed version shipped each file it placed, for an entry written before installs kept
 * those hashes (up to 1.0.15 the record held them for AI items only). Read from that version's package while
 * it is still in node_modules: plugins.sh --require runs this before npm replaces a package, and the update
 * of the base runs it before any plugin is updated. The next install can then tell a person's edit from the
 * old version's copy, and keep the edit. An entry whose package is no longer the version that placed its
 * files is left alone: a hash taken from another version would call every file changed.
 */
function remember(only = '') {
  const record = readRecord();
  const lines = [];
  let changed = false;
  for (const [name, entry] of Object.entries(record)) {
    if ((only && name !== only) || !entry || !Array.isArray(entry.placed)) continue;
    const plugin = pluginByName(name);
    if (!plugin || String(plugin.version || '') !== String(entry.version || '')) continue;
    const hashes = { ...(entry.hashes || {}) };
    const placedThen = new Set(entry.placed);
    // Its commands went to the folders the record names, whatever the workspaces list says now.
    const folders = [...new Set(entry.placed.map((p) => String(p).split('/')[0]))];
    let added = 0;
    for (const o of ownFiles(plugin, { commandFolders: folders })) {
      const r = rel(o.dest);
      if (!placedThen.has(r) || hashes[r]) continue;
      try { hashes[r] = sha(contentOf(o)); added += 1; } catch (_) { /* the package lacks that file */ }
    }
    if (!added) continue;
    entry.hashes = hashes;
    changed = true;
    lines.push(`  ${name}: noted how ${plugin.version} shipped ${added} placed file(s), so a change of yours is kept at its next install`);
  }
  if (changed) writeRecord(record);
  return lines;
}

/**
 * Remove one placed path, and the folders that leaves empty (a skill's folder, the plugin's folder under
 * tests/features/plugins/), never a folder at the workspace root. An AI item goes only while it still is
 * what the plugin placed.
 */
// Written once and then a person's: a workspace's settings file and its docs.
const WRITTEN_ONCE = /^core\/config\/workspace\.[a-z0-9_-]+\.settings\.yml$|\/(AGENTS|CLAUDE|README)\.md$/;
/** The plugin's own settings file, as a path of the tree (null when it has none). */
function settingsPath(plugin) {
  const m = (plugin && plugin.manifest) || {};
  return m.settingsTemplate ? rel(path.join(CONFIG_DIR, m.settingsFile || `plugin.${plugin.name}.settings.yml`)) : null;
}

/** Whether the file at a path two plugins place is, right now, the copy another plugin placed (not an edit). */
function isAnothers(record, name, p, now) {
  return Object.entries(record).some(([other, e]) => other !== name && e && e.hashes && e.hashes[p] && e.hashes[p] === now);
}

function removePlaced(p, hashes) {
  const file = path.join(ROOT, p);
  if (hashes && hashes[p]) {
    const now = hashOf(file);
    if (now !== null && now !== hashes[p]) return 'kept';
  }
  try { fs.rmSync(file); } catch (_) { return 'gone'; }
  for (let dir = path.dirname(file); dir.startsWith(ROOT) && dir !== ROOT && path.dirname(dir) !== ROOT; dir = path.dirname(dir)) {
    try { fs.rmdirSync(dir); } catch (_) { break; }   // not empty: it holds something else
  }
  return 'removed';
}

/** The managed .gitignore block: one line per placed path, so a dev clone stays clean. */
function updateGitignore(record) {
  let text = '';
  try { text = fs.readFileSync(GITIGNORE, 'utf8'); } catch (_) { /* a tree with no .gitignore */ }
  const lines = new Set();
  for (const entry of Object.values(record)) for (const p of entry.placed || []) lines.add(`/${p}`);
  lines.add('/core/config/plugins.installed.yml');
  lines.add('/core/scripts/plugins/');
  const block = `${BLOCK_START}\n${[...lines].sort().join('\n')}\n${BLOCK_END}\n`;
  const re = new RegExp(`${BLOCK_START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${BLOCK_END}\\n?`);
  text = re.test(text) ? text.replace(re, block) : `${text.replace(/\n*$/, '\n\n')}${block}`;
  fs.writeFileSync(GITIGNORE, text);
}

/** The settings template, carrying over the block it replaces in settings.yml when there is one. */
function placeSettings(plugin, placed) {
  const m = plugin.manifest;
  if (!m.settingsTemplate) return { restart: false };
  const dest = path.join(CONFIG_DIR, m.settingsFile || `plugin.${plugin.name}.settings.yml`);
  // Recorded every time, written only once: a path an earlier install recorded and this one does not is
  // removed as stale, and this file holds what the person configured.
  if (fs.existsSync(dest)) { placed.push(rel(dest)); return { restart: false }; }
  let text = fs.readFileSync(path.join(plugin.dir, m.settingsTemplate), 'utf8');
  if (m.legacySettingsKey) {
    try {
      const settings = yaml.load(fs.readFileSync(path.join(CONFIG_DIR, 'settings.yml'), 'utf8')) || {};
      // Dotted keys name a nested block: git.github is settings.git.github.
      const legacy = String(m.legacySettingsKey).split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), settings);
      if (legacy && typeof legacy === 'object') {
        for (const [k, v] of Object.entries(legacy)) {
          if (v == null || v === '' || v === 'CHANGE_ME') continue;
          const line = new RegExp(`^${k}:.*$`, 'm');
          const rendered = yaml.dump({ [k]: v }).trim();
          text = line.test(text) ? text.replace(line, rendered) : `${text.replace(/\n*$/, '\n')}${rendered}\n`;
        }
      }
    } catch (_) { /* settings.yml unreadable: the template ships as is */ }
  }
  fs.writeFileSync(dest, text, { mode: 0o600 });
  placed.push(rel(dest));
  return { restart: false };
}

/** The refusal of an install whose needs are not met: what is missing, and the one command that adds it. */
function unmetError(c) {
  const lines = [...c.problems.map((p) => `${c.name}: ${p}`), ...c.unmet.map((n) => `${c.name} needs ${needs.needText(n)}`)];
  const err = new Error(`${lines.join('\n')}\nNothing was placed. Add what it needs first, or all at once:\n  bash core/scripts/plugins.sh --install ${c.name} --with-needs`);
  err.unmet = c.unmet;
  return err;
}

function install(name, { nested = false } = {}) {
  const plugin = pluginByName(name);
  if (!plugin) throw new Error(`no plugin named '${name}' is installed in core/workspace-app (npm install it first)`);
  const m = plugin.manifest;
  const wants = needs.check(name);
  if (wants.unmet.length || wants.problems.length) throw unmetError(wants);
  const record = readRecord();
  const before = new Set((record[name] && record[name].placed) || []);
  const placed = [];
  const hashes = {};
  const notes = Object.assign([], { kept: [] });   // what to say besides "placed", and the recorded paths that were left as they are
  // What the last install placed and a person changed since. The plugin's own files (commands, functions,
  // compose files, features) follow the package, so they are written again below; the install says which.
  const was = (record[name] && record[name].hashes) || {};
  const changedHere = new Set(Object.keys(was).filter((p) => { const now = hashOf(path.join(ROOT, p)); return now !== null && now !== was[p] && !isAnothers(record, name, p, now); }));
  let restart = false;
  const ddev = m.ddev || {};
  // The plugin's own files follow the package: every install writes them again. One a person changed since
  // the last install is first kept beside it as <file>.yours, and the install names both.
  const yours = new Map();
  for (const o of ownFiles(plugin)) {
    const r = rel(o.dest);
    const next = contentOf(o);
    if (o.compose && (!fs.existsSync(o.dest) || !fs.readFileSync(o.dest).equals(next))) restart = true;
    if (changedHere.has(r)) {
      try {
        if (!fs.readFileSync(o.dest).equals(next)) { const keep = freeName(`${o.dest}.yours`); fs.copyFileSync(o.dest, keep); yours.set(r, rel(keep)); }
      } catch (_) { /* gone since: nothing to keep */ }
    }
    if (o.src) copyFile(o.src, o.dest, { fill: o.fill });
    else { fs.mkdirSync(path.dirname(o.dest), { recursive: true }); fs.writeFileSync(o.dest, next); }
    placed.push(r);
  }
  // A workspace folder the plugin IS (modules, themes, dev…): the folder, its settings file (placed once,
  // never overwritten — it holds this machine's lists — and kept on uninstall); its commands are above.
  // --activate puts the key on settings.yml's workspaces list; --deactivate takes it off.
  const ws = m.workspace || null;
  if (ws && /^[a-z0-9_-]+$/.test(String(ws.key || ''))) {
    const folder = path.join(ROOT, ws.key);
    fs.mkdirSync(folder, { recursive: true });
    if (ws.settingsTemplate) {
      const d = path.join(CONFIG_DIR, `workspace.${ws.key}.settings.yml`);
      // Recorded every time, placed only once: a path an earlier install recorded and this one does not is removed as stale.
      // Owner-only, like the plugin settings files: a workspace's file can hold a password (Penpot's) or a token
      // (RAG's). It was placed with the package file's mode, readable by every account of the machine; one placed
      // that way before is made owner-only on the next install.
      if (!fs.existsSync(d)) copyFile(path.join(plugin.dir, ws.settingsTemplate), d, { mode: 0o600 });
      else { try { const m = fs.statSync(d).mode & 0o777; if (m & 0o077) fs.chmodSync(d, m & 0o700); } catch (_) { /* unreadable: left */ } }
      placed.push(rel(d));
    }
    // Written once, for a person to edit: what the folder is for.
    for (const f of ws.docs || []) {
      const d = path.join(folder, path.basename(f));
      if (!fs.existsSync(d)) copyFile(path.join(plugin.dir, f), d, { fill: { __WORKSPACE__: ws.key } });
      placed.push(rel(d));
    }
  }
  placeAiItems(plugin, record[name], placed, hashes, notes);
  placeSettings(plugin, placed);
  // What an earlier install placed and this one did not (a workspace that changed type, a file the
  // manifest dropped) goes away, so the tree never holds a stale copy.
  for (const old of before) {
    if (placed.includes(old)) continue;
    if (removePlaced(old, (record[name] && record[name].hashes) || {}) === 'kept') notes.push(`  kept ${old} (this version no longer ships it, and it was changed here: it is yours now)`);
  }
  // The hash of everything placed, so an uninstall can tell the plugin's copy from a file a person changed.
  // A file that is written once (a settings file, a folder's docs) keeps the hash of what was first placed;
  // one that was already there before any install has none, and is treated as the person's.
  for (const p of placed) {
    if (hashes[p]) continue;
    if (WRITTEN_ONCE.test(p) || p === settingsPath(plugin)) { if (was[p]) hashes[p] = was[p]; else if (!before.has(p)) hashes[p] = hashOf(path.join(ROOT, p)); continue; }
    const now = hashOf(path.join(ROOT, p));
    if (now) hashes[p] = now;
    if (changedHere.has(p) && now !== null && yours.has(p)) notes.push(`  replaced ${p} (it had been changed here; a plugin's own files follow the package): your copy is kept as ${yours.get(p)}`);
  }
  for (const p of Object.keys(hashes)) if (hashes[p] === null) delete hashes[p];
  // What this install did not have to touch: recorded by the last one, and still exactly what was placed.
  // An install says "placed" for what is new or was written again with other content, and counts the rest.
  const unchanged = placed.filter((p) => before.has(p) && was[p] && hashes[p] === was[p] && !changedHere.has(p) && !notes.kept.includes(p));
  record[name] = { module: plugin.module, version: plugin.version, installed: new Date().toISOString(), placed };
  if (Object.keys(hashes).length) record[name].hashes = hashes;
  // What it needed and which plugin met each need, so an uninstall can still tell who relies on whom
  // when this package is gone from node_modules.
  if (wants.needs.length) { record[name].needs = wants.needs.map((n) => n.anyOf); record[name].metBy = wants.needs.map((n) => n.metBy); }
  writeRecord(record);
  updateGitignore(record);
  // A workspace folder that arrives after the plugins that place things into folders: their commands
  // and AI items are placed into it now, so the order plugins were added in does not matter.
  if (!nested && ws && ws.key) for (const line of reach(name, `now that ${ws.key}/ is here`)) notes.push(line);
  return { name, placed, unchanged, notes, restart: restart || (ddev.hostMounts || []).length > 0 && !before.size };
}

/**
 * Place again what the installed plugins put into workspace folders (their commands, their AI items), after
 * the set of active folders changed: a folder that was added or listed gets them, one that was taken off the
 * list loses them. Returns what to say. `except` is the plugin whose own step this is.
 */
function reach(except = '', why = '') {
  const lines = [];
  const record = readRecord();
  for (const other of Object.keys(record)) {
    if (other === except) continue;
    const p = pluginByName(other);
    if (!p || !(((p.manifest.commands || {}).files || []).length || Object.values(p.manifest.ai || {}).some((l) => (l || []).length))) continue;
    const had = new Set(record[other].placed || []);
    try {
      const again = install(other, { nested: true });
      const fresh = again.placed.filter((f) => !had.has(f));
      const gone = [...had].filter((f) => !again.placed.includes(f));
      const some = (list) => `${list.slice(0, 3).join(', ')}${list.length > 3 ? ', …' : ''}`;
      if (fresh.length) lines.push(`  ${other}: placed ${fresh.length} more file(s)${why ? ` ${why}` : ''} (${some(fresh)})`);
      if (gone.length) lines.push(`  ${other}: took ${gone.length} file(s) out of a folder that is no longer a workspace here (${some(gone)})`);
      // What happened once to a person's file is said here too: a copy kept as .yours, a dropped file kept.
      for (const n of again.notes || []) if (/^\s+replaced |no longer ships it/.test(n)) lines.push(`  ${other}: ${n.trim()}`);
    } catch (_) { /* its own needs are not met: its --install places them */ }
  }
  return lines;
}

function uninstall(name) {
  const record = readRecord();
  const entry = record[name];
  // Another plugin in use that needs this one, with no alternative here, keeps it.
  const relying = needs.dependents(name);
  if (relying.length) {
    const err = new Error(`${name} is needed by ${relying.map((d) => `${d.name} (${needs.groupText(d.anyOf)})`).join(', ')}.\nNothing was removed. Uninstall ${relying.length > 1 ? 'those' : 'that one'} first:\n${[...new Set(relying.map((d) => d.name))].map((d) => `  bash core/scripts/plugins.sh --uninstall ${d}`).join('\n')}`);
    err.dependents = relying;
    throw err;
  }
  if (!entry) return { name, removed: [] };
  const removed = [];
  const notes = [];
  const kept = [];
  const plugin = pluginByName(name);
  for (const p of entry.placed || []) {
    // A workspace's own settings file and its docs stay: they hold what a person put there.
    if (WRITTEN_ONCE.test(p)) continue;
    // The plugin's own settings file holds what a person configured (a token, an account, a list): it goes
    // only while it still is exactly what was placed. Anything else in it stays, and the uninstall says so.
    if (/^core\/config\/plugin\.[a-z0-9_-]+\.settings\.yml$/.test(p) || p === settingsPath(plugin)) {
      const now = hashOf(path.join(ROOT, p));
      if (now === null) continue;
      let untouched = !!(entry.hashes && entry.hashes[p]) && now === entry.hashes[p];
      // A record written before hashes were kept for this file: the template of the package says.
      if (!untouched && !(entry.hashes && entry.hashes[p]) && plugin && plugin.manifest.settingsTemplate) {
        try { untouched = now === sha(fs.readFileSync(path.join(plugin.dir, plugin.manifest.settingsTemplate))); } catch (_) { /* no template to compare with: it stays */ }
      }
      if (!untouched) { kept.push(p); notes.push(`  kept ${p} (it holds your settings; delete the file if you do not want them)`); continue; }
    }
    // A path another plugin places too, holding that plugin's copy: it is theirs, and it stays without a word.
    if (isAnothers(record, name, p, hashOf(path.join(ROOT, p)))) continue;
    const how = removePlaced(p, entry.hashes);
    if (how === 'removed') removed.push(p);
    else if (how === 'kept') { kept.push(p); notes.push(`  kept ${p} (edited here, so it stays)`); }
  }
  // What is left of the plugin's own scripts folder goes too, unless a file a person changed is in it.
  const own = `${rel(path.join(SCRIPTS_DIR, 'plugins', name))}/`;
  if (!kept.some((p) => p.startsWith(own))) { try { fs.rmSync(path.join(SCRIPTS_DIR, 'plugins', name), { recursive: true, force: true }); } catch (_) { /* nothing there */ } }
  delete record[name];
  writeRecord(record);
  updateGitignore(record);
  // A path two plugins place (a platform's builder that replaces a folder's example of the same name) belongs
  // to the one installed last; when that one goes, the other's copy comes back.
  for (const [other, e] of Object.entries(record)) {
    const shared = (e.placed || []).filter((p) => removed.includes(p));
    if (!shared.length || !pluginByName(other)) continue;
    try { install(other, { nested: true }); for (const p of shared) if (fs.existsSync(path.join(ROOT, p))) notes.push(`  restored ${p} (${other} places it too)`); } catch (_) { /* that plugin's --install puts it back */ }
  }
  return { name, removed, notes, restart: removed.some((p) => p.includes('/.ddev/')) };
}

function status(name) {
  const record = readRecord();
  const list = (name ? [pluginByName(name)].filter(Boolean) : installedPlugins());
  return list.map((p) => {
    const entry = record[p.name];
    const missing = entry ? (entry.placed || []).filter((f) => !fs.existsSync(path.join(ROOT, f))) : [];
    return { name: p.name, module: p.module, version: p.version, dir: p.dir, installed: !!entry, placed: entry ? entry.placed.length : 0, missing,
      settingsFile: p.manifest.settingsFile ? fs.existsSync(path.join(CONFIG_DIR, p.manifest.settingsFile)) : null };
  });
}

module.exports = { install, uninstall, status, reach, remember, ownFiles, isActiveWorkspace, placedBy, readRecord, RECORD };

if (require.main === module) {
  const [verb, name] = process.argv.slice(2);
  try {
    if (verb === 'install' && name) {
      const r = install(name);
      const same = new Set(r.unchanged || []);
      for (const p of r.placed) if (!r.notes.kept.includes(p) && !same.has(p)) console.log(`  placed ${p}`);
      for (const n of r.notes) console.log(n);
      // A second install of a plugin that did not change says so, instead of listing every file as placed again.
      if (same.size) console.log(same.size === r.placed.length ? `  nothing to do: all ${same.size} file(s) are in place, as the plugin ships them` : `  ${same.size} more file(s) were already in place, unchanged`);
      console.log(r.restart ? 'RESTART_NEEDED' : 'RESTART_NOT_NEEDED');
    } else if (verb === 'uninstall' && name) {
      const r = uninstall(name);
      for (const p of r.removed) console.log(`  removed ${p}`);
      for (const n of r.notes || []) console.log(n);
      console.log(r.restart ? 'RESTART_NEEDED' : 'RESTART_NOT_NEEDED');
    } else if (verb === 'remember') {
      for (const line of remember(name || '')) console.log(line);
    } else if (verb === 'reach') {
      for (const line of reach(name || '')) console.log(line);
    } else if (verb === 'status') {
      console.log(JSON.stringify(status(name), null, 2));
    } else {
      console.error('usage: node plugin-install.js install|uninstall|status|remember|reach [<name>]');
      process.exit(2);
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
