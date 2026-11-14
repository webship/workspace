/**
 * Installing a plugin into the workspace: placing what its manifest names.
 *
 *   node plugin-install.js install <name>     place everything, idempotently
 *   node plugin-install.js uninstall <name>   remove exactly what install placed
 *   node plugin-install.js status [<name>]    what is placed, what is not, as JSON
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
 *   commands.files      -> <workspace>/ for every workspace of commands.types (__WORKSPACE__ filled in)
 *   ddev.compose        -> core/workspace-app/.ddev/docker-compose.plugin-<name>-<file>
 *   themes              -> core/config/
 *   settingsTemplate    -> core/config/plugin.<name>.settings.yml, only when absent, carrying the
 *                          values of the settings.yml block it replaces (legacySettingsKey)
 *   features            -> core/workspace-app/tests/features/plugins/<name>/  (webship-js runs them)
 *   ai.agents|skills|   -> ai-agents/ | ai-skills/ | ai-commands/ | ai-prompts/, when that workspace folder is
 *   commands|prompts       there. A file a person edited (or already had) is kept, at install and at uninstall.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const yaml = require('js-yaml');

const { pluginByName, installedPlugins } = require('./plugin-manifest');
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
function writeRecord(data) {
  fs.writeFileSync(RECORD, `# Written by core/scripts/plugins.sh: what each installed plugin placed in this tree.\n${yaml.dump(data)}`);
}

/** Workspaces of the given types, from settings.yml and each workspace.<key>.settings.yml. */
function workspacesOfTypes(types) {
  const { loadWorkspaces } = require('./workspaces');
  const all = loadWorkspaces();
  return Object.entries(all).filter(([, m]) => types.includes(m.type)).map(([key]) => key);
}

function copyFile(src, dest, { fill } = {}) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  let data = fs.readFileSync(src);
  if (fill) data = Buffer.from(Object.entries(fill).reduce((t, [k, v]) => t.split(k).join(v), data.toString('utf8')));
  fs.writeFileSync(dest, data, { mode: fs.statSync(src).mode & 0o777 });
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
    if (!fs.existsSync(folder)) {
      notes.push(`  skipped ${list.length} ${kind}: there is no ${key}/ workspace here (add the ${key} workspace, then --install ${plugin.name} again)`);
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
 * Remove one placed path, and the folders that leaves empty (a skill's folder, the plugin's folder under
 * tests/features/plugins/), never a folder at the workspace root. An AI item goes only while it still is
 * what the plugin placed.
 */
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
  if (fs.existsSync(dest)) return { restart: false };
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

function install(name) {
  const plugin = pluginByName(name);
  if (!plugin) throw new Error(`no plugin named '${name}' is installed in core/workspace-app (npm install it first)`);
  const m = plugin.manifest;
  const record = readRecord();
  const before = new Set((record[name] && record[name].placed) || []);
  const placed = [];
  const hashes = {};
  const notes = Object.assign([], { kept: [] });   // what to say besides "placed", and the recorded paths that were left as they are
  let restart = false;
  const scripts = m.scripts || {};
  const into = path.join(SCRIPTS_DIR, 'plugins', name);
  for (const f of scripts.functions || []) { const d = path.join(into, 'functions', path.basename(f)); copyFile(path.join(plugin.dir, f), d); placed.push(rel(d)); }
  for (const f of scripts.args || []) { const d = path.join(into, 'args', path.basename(f)); copyFile(path.join(plugin.dir, f), d); placed.push(rel(d)); }
  for (const f of scripts.machine || []) { const d = path.join(into, path.basename(f)); copyFile(path.join(plugin.dir, f), d); placed.push(rel(d)); }
  if (scripts.hostInstall) { const d = path.join(into, 'host-install.sh'); copyFile(path.join(plugin.dir, scripts.hostInstall), d); placed.push(rel(d)); }
  const ddev = m.ddev || {};
  if ((ddev.hostMounts || []).length) {
    const d = path.join(into, 'host-mounts.txt');
    fs.mkdirSync(into, { recursive: true });
    fs.writeFileSync(d, `${ddev.hostMounts.join('\n')}\n`);
    placed.push(rel(d));
  }
  for (const f of ddev.compose || []) {
    const d = path.join(DDEV_DIR, `docker-compose.plugin-${name}-${path.basename(f).replace(/^docker-compose\./, '')}`);
    const fresh = !fs.existsSync(d) || !fs.readFileSync(d).equals(fs.readFileSync(path.join(plugin.dir, f)));
    copyFile(path.join(plugin.dir, f), d);
    placed.push(rel(d));
    if (fresh) restart = true;
  }
  const commands = m.commands || {};
  if ((commands.files || []).length) {
    // Named workspaces when the manifest lists them (only those that exist), else every one of the types.
    const named = (commands.workspaces || []).filter((ws) => /^[a-z0-9_-]+$/.test(ws) && fs.existsSync(path.join(ROOT, ws)));
    for (const ws of named.length ? named : workspacesOfTypes(commands.types || ['sites'])) {
      for (const f of commands.files) {
        const d = path.join(ROOT, ws, path.basename(f));
        copyFile(path.join(plugin.dir, f), d, { fill: { __WORKSPACE__: ws } });
        placed.push(rel(d));
      }
    }
  }
  for (const f of m.themes || []) { const d = path.join(CONFIG_DIR, path.basename(f)); copyFile(path.join(plugin.dir, f), d); placed.push(rel(d)); }
  // A workspace folder the plugin IS (modules, themes, dev…): the folder, its settings file (placed once,
  // never overwritten — it holds this machine's lists — and kept on uninstall) and its commands.
  // --activate puts the key on settings.yml's workspaces list; --deactivate takes it off.
  const ws = m.workspace || null;
  if (ws && /^[a-z0-9_-]+$/.test(String(ws.key || ''))) {
    const folder = path.join(ROOT, ws.key);
    fs.mkdirSync(folder, { recursive: true });
    if (ws.settingsTemplate) {
      const d = path.join(CONFIG_DIR, `workspace.${ws.key}.settings.yml`);
      // Recorded every time, placed only once: a path an earlier install recorded and this one does not is removed as stale.
      if (!fs.existsSync(d)) copyFile(path.join(plugin.dir, ws.settingsTemplate), d);
      placed.push(rel(d));
    }
    for (const f of ws.files || []) {
      const d = path.join(folder, path.basename(f));
      copyFile(path.join(plugin.dir, f), d, { fill: { __WORKSPACE__: ws.key } });
      placed.push(rel(d));
    }
    // Written once, for a person to edit: what the folder is for.
    for (const f of ws.docs || []) {
      const d = path.join(folder, path.basename(f));
      if (!fs.existsSync(d)) copyFile(path.join(plugin.dir, f), d, { fill: { __WORKSPACE__: ws.key } });
      placed.push(rel(d));
    }
  }
  // webship-js features, under tests/features/plugins/<name>/: the dashboard's cucumber paths cover every
  // folder below tests/features, so an installed plugin's scenarios run with `ddev test-dashboard browser`.
  for (const f of m.features || []) { const d = path.join(ROOT, 'core', 'workspace-app', 'tests', 'features', 'plugins', name, path.basename(f)); copyFile(path.join(plugin.dir, f), d); placed.push(rel(d)); }
  placeAiItems(plugin, record[name], placed, hashes, notes);
  placeSettings(plugin, placed);
  // What an earlier install placed and this one did not (a workspace that changed type, a file the
  // manifest dropped) goes away, so the tree never holds a stale copy.
  for (const old of before) if (!placed.includes(old)) removePlaced(old, (record[name] && record[name].hashes) || {});
  record[name] = { module: plugin.module, version: plugin.version, installed: new Date().toISOString(), placed };
  if (Object.keys(hashes).length) record[name].hashes = hashes;
  writeRecord(record);
  updateGitignore(record);
  return { name, placed, notes, restart: restart || (ddev.hostMounts || []).length > 0 && !before.size };
}

function uninstall(name) {
  const record = readRecord();
  const entry = record[name];
  if (!entry) return { name, removed: [] };
  const removed = [];
  const notes = [];
  for (const p of entry.placed || []) {
    // A workspace's own settings file and its docs stay: they hold what a person put there.
    if (/^core\/config\/workspace\.[a-z0-9_-]+\.settings\.yml$/.test(p) || /\/(AGENTS|CLAUDE|README)\.md$/.test(p)) continue;
    const how = removePlaced(p, entry.hashes);
    if (how === 'removed') removed.push(p);
    else if (how === 'kept') notes.push(`  kept ${p} (edited here, so it stays)`);
  }
  try { fs.rmSync(path.join(SCRIPTS_DIR, 'plugins', name), { recursive: true, force: true }); } catch (_) { /* nothing there */ }
  delete record[name];
  writeRecord(record);
  updateGitignore(record);
  // A path two plugins place (a platform's builder that replaces a folder's example of the same name) belongs
  // to the one installed last; when that one goes, the other's copy comes back.
  for (const [other, e] of Object.entries(record)) {
    const shared = (e.placed || []).filter((p) => removed.includes(p));
    if (!shared.length || !pluginByName(other)) continue;
    try { install(other); for (const p of shared) notes.push(`  restored ${p} (${other} places it too)`); } catch (_) { /* that plugin's --install puts it back */ }
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

module.exports = { install, uninstall, status, RECORD };

if (require.main === module) {
  const [verb, name] = process.argv.slice(2);
  try {
    if (verb === 'install' && name) {
      const r = install(name);
      for (const p of r.placed) if (!r.notes.kept.includes(p)) console.log(`  placed ${p}`);
      for (const n of r.notes) console.log(n);
      console.log(r.restart ? 'RESTART_NEEDED' : 'RESTART_NOT_NEEDED');
    } else if (verb === 'uninstall' && name) {
      const r = uninstall(name);
      for (const p of r.removed) console.log(`  removed ${p}`);
      for (const n of r.notes || []) console.log(n);
      console.log(r.restart ? 'RESTART_NEEDED' : 'RESTART_NOT_NEEDED');
    } else if (verb === 'status') {
      console.log(JSON.stringify(status(name), null, 2));
    } else {
      console.error('usage: node plugin-install.js install|uninstall|status [<name>]');
      process.exit(2);
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
