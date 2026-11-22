/**
 * What a plugin needs from another plugin, and whether this workspace has it.
 *
 * A manifest may say `needs` and `suggests`, the same shape for both: a list whose entries are a
 * plugin's name, or a list of names when any one of them will do (the first is the one added when
 * none is here):
 *
 *   "needs":    [["dev", "test", "sandboxes", "demos"], "ai-agents"]
 *   "suggests": ["graph"]
 *
 * Either key may also be an object, when the plugin needs commands on the machine too (command-check.js
 * reads those): `"needs": { "plugins": [["dev", "test"]], "commands": ["upsun"] }`. A list is the plugins.
 *
 * A need is about the WORKSPACE, not about node_modules: it is met when that plugin is activated and
 * installed here — or, for a plugin that is a workspace folder, when a folder of that key is already
 * on the workspaces list (a workspace made before folders were plugins). npm resolves a package's own
 * dependencies; nothing here does. `needs` stops an activate and an install until they are met and
 * stops the needed plugin from being deactivated or uninstalled; `suggests` is only said.
 *
 *   node plugin-needs.js lines <name>        one line per need, for plugins.sh
 *   node plugin-needs.js say <name>          the same, for a person
 *   node plugin-needs.js dependents <name>   who needs this one, and would be left without
 *   node plugin-needs.js json [<name>]       everything, as JSON
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const { installedPlugins, placesSomething, APP_DIR } = require('./plugin-manifest');
const { ROOT, CONFIG_DIR, loadSettings } = require('./workspaces');
const { SCOPE } = require('./plugin-catalog.mts');
const { split, commandEntries } = require('./command-check');

const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
const KINDS = ['needs', 'suggests'];

/** A manifest's `needs` or `suggests` as groups of alternatives, and what is wrong with it. */
function normalize(given, self = '') {
  const groups = [];
  // An object holds the plugins under `plugins` (and commands, which command-check.js reads); a list is the plugins.
  const parts = split(given);
  const value = parts.plugins;
  const problems = [...parts.problems, ...commandEntries(parts.commands).problems];
  if (value == null) return { groups, problems };
  if (!Array.isArray(value)) return { groups, problems: [...problems, 'must be a list of plugin names (a list inside it means any one of them), or { plugins, commands }'] };
  for (const entry of value) {
    const names = Array.isArray(entry) ? entry : [entry];
    const bad = names.filter((n) => typeof n !== 'string' || !NAME_RE.test(n));
    if (!names.length || bad.length) { problems.push(`${JSON.stringify(entry)} is not a plugin name or a list of plugin names`); continue; }
    if (names.includes(self)) { problems.push(`${self} names itself`); continue; }
    groups.push([...new Set(names)]);
  }
  return { groups, problems };
}

/** The state every answer is read from: the plugin packages, what is activated, what is recorded as installed, the workspaces. */
function state() {
  const plugins = new Map(installedPlugins().map((p) => [p.name, p]));
  // settings.yml's plugins block, read here and not through the loader: requiring the loader loads every
  // activated plugin's code, which a check from the command line has no use for.
  const block = loadSettings().plugins;
  const configs = (block && typeof block === 'object') ? block : {};
  const active = new Set(Object.entries(configs || {}).filter(([, c]) => c && (c.enabled === true || String(c.enabled) === 'true')).map(([n]) => n));
  let record = {};
  try { record = yaml.load(fs.readFileSync(path.join(CONFIG_DIR, 'plugins.installed.yml'), 'utf8')) || {}; } catch (_) { record = {}; }
  const workspaces = new Set(((loadSettings().workspaces) || []).map(String));
  return { plugins, active, record, workspaces };
}

/** The workspace folder a plugin of that name is: its manifest's key, or the name itself while the package is not here. */
function workspaceKeyOf(name, st) {
  const p = st.plugins.get(name);
  if (p) return (p.manifest.workspace && p.manifest.workspace.key) ? String(p.manifest.workspace.key) : '';
  return name;
}

/** Whether the workspace has that plugin: activated and installed, or its folder already listed. `without` is a plugin to count as gone. */
function isMet(name, st, without = '') {
  if (name === without) return false;
  const p = st.plugins.get(name);
  if (p && st.active.has(name) && (st.record[name] || !placesSomething(p.manifest))) return true;
  // A plugin that is going is no longer what lists its folder; a folder nobody's plugin made stays.
  const key = workspaceKeyOf(name, st);
  if (!key || !st.workspaces.has(key) || !fs.existsSync(path.join(ROOT, key))) return false;
  return !(p && st.record[name]) || st.active.has(name);
}

/** The npm spec a needed plugin is required with: the same source as the plugin that needs it. */
function specFor(dependent, need) {
  const spec = String((dependent && dependent.spec) || '');
  const mod = String((dependent && dependent.module) || '');
  const scope = mod.startsWith('@') ? mod.split('/')[0] : SCOPE;
  const git = spec.match(/^(github:|git\+https:\/\/github\.com\/|git\+ssh:\/\/git@github\.com\/|https:\/\/github\.com\/)([^/#]+)\/workspace-[a-z0-9-]+?(\.git)?(#.*)?$/);
  if (git) return `${git[1]}${git[2]}/workspace-${need}${git[3] || ''}`;
  const file = spec.match(/^file:(.+)$/);
  if (file) {
    const sibling = path.resolve(APP_DIR, file[1], '..', `workspace-${need}`);
    if (fs.existsSync(path.join(sibling, 'package.json'))) return sibling;
  }
  return `${scope}/workspace-${need}`;
}

/** A chain of needs that comes back to where it started, among the packages that are here, or null. */
function cycleFrom(name, st, trail = []) {
  if (trail.includes(name)) return [...trail.slice(trail.indexOf(name)), name];
  const p = st.plugins.get(name);
  if (!p) return null;
  for (const group of normalize(p.manifest.needs, name).groups) {
    // Only the plugin that would be added matters: an alternative that is already here ends the chain.
    const pick = pickOf(group, st);
    if (isMet(pick, st)) continue;
    const found = cycleFrom(pick, st, [...trail, name]);
    if (found) return found;
  }
  return null;
}

/** Of the alternatives, the one that counts: what already meets the need, else what is nearest to it, else the first. */
function pickOf(group, st) {
  return group.find((n) => isMet(n, st)) || group.find((n) => st.active.has(n)) || group.find((n) => st.plugins.has(n)) || group[0];
}

/**
 * What one plugin needs and suggests, and where each stands:
 * `{ name, needs: [{ anyOf, metBy, pick, required, spec }], suggests: [...], unmet: [...], problems: [], cycle }`.
 */
function check(name, st = state()) {
  const plugin = st.plugins.get(name);
  if (!plugin) return null;
  const out = { name, needs: [], suggests: [], problems: [], cycle: null };
  for (const kind of KINDS) {
    const { groups, problems } = normalize(plugin.manifest[kind], name);
    for (const p of problems) out.problems.push(`${kind}: ${p}`);
    for (const anyOf of groups) {
      const metBy = anyOf.find((n) => isMet(n, st)) || null;
      const pick = metBy || pickOf(anyOf, st);
      out[kind].push({ anyOf, metBy, pick, required: st.plugins.has(pick), spec: specFor(plugin, pick) });
    }
  }
  out.unmet = out.needs.filter((n) => !n.metBy);
  out.cycle = cycleFrom(name, st);
  if (out.cycle) out.problems.push(`needs: a cycle (${out.cycle.join(' → ')}); none of them can be added before the other`);
  return out;
}

/** The declared needs of a plugin in use: its manifest's, or what its install recorded when the package is gone. */
function needsInUse(name, st) {
  const p = st.plugins.get(name);
  if (p) return normalize(p.manifest.needs, name).groups;
  const entry = st.record[name];
  return normalize(entry && entry.needs, name).groups;
}

/** The plugins in use (activated or installed) that need this one and have no other alternative here: `[{ name, anyOf }]`. */
function dependents(name, st = state()) {
  const out = [];
  const inUse = new Set([...st.active, ...Object.keys(st.record)]);
  for (const other of inUse) {
    if (other === name) continue;
    for (const anyOf of needsInUse(other, st)) {
      if (!anyOf.includes(name) || !isMet(name, st)) continue;
      if (anyOf.some((n) => isMet(n, st, name))) continue;
      out.push({ name: other, anyOf });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

const groupText = (anyOf) => (anyOf.length > 1 ? `one of ${anyOf.join(', ')}` : anyOf[0]);

/** One need, as a person reads it. A suggestion is never added, so it does not say which one would be. */
function needText(n, kind = 'needs') {
  if (n.metBy) return `${groupText(n.anyOf)} (${kind === 'needs' ? 'met by' : 'here:'} ${n.metBy})`;
  return `${groupText(n.anyOf)} (not here${kind === 'needs' && n.anyOf.length > 1 ? `; ${n.pick} is the one added` : ''})`;
}

/** The `needs: … · suggests: …` line of a list or a card, or '' for a plugin that declares neither. */
function summary(c) {
  if (!c) return '';
  const parts = [];
  if (c.needs.length) parts.push(`needs: ${c.needs.map((n) => needText(n)).join(' · ')}`);
  if (c.suggests.length) parts.push(`suggests: ${c.suggests.map((n) => needText(n, 'suggests')).join(' · ')}`);
  if (c.problems.length) parts.push(`problem: ${c.problems.join('; ')}`);
  return parts.join('   ');
}

module.exports = { normalize, state, isMet, specFor, check, dependents, summary, needText, groupText, pickOf, NAME_RE };

if (require.main === module) {
  const [verb, name] = process.argv.slice(2);
  const st = state();
  if (verb === 'json') {
    const list = name ? [check(name, st)] : [...st.plugins.keys()].map((n) => check(n, st));
    process.stdout.write(`${JSON.stringify(name ? list[0] : list, null, 2)}\n`);
  } else if (verb === 'lines' && name) {
    // NEED|SUGGEST <pick> <met|unmet> <required|missing> <spec> <alternatives, comma separated>; PROBLEM <text>
    const c = check(name, st);
    if (!c) process.exit(1);
    for (const p of c.problems) process.stdout.write(`PROBLEM ${p}\n`);
    for (const kind of KINDS) for (const n of c[kind]) process.stdout.write(`${kind === 'needs' ? 'NEED' : 'SUGGEST'} ${n.pick} ${n.metBy ? 'met' : 'unmet'} ${n.required ? 'required' : 'missing'} ${n.spec} ${n.anyOf.join(',')}\n`);
  } else if (verb === 'say' && name) {
    const c = check(name, st);
    if (!c) process.exit(1);
    for (const n of c.needs) process.stdout.write(`  ${name} needs ${needText(n)}\n`);
    for (const n of c.suggests) process.stdout.write(`  ${name} suggests ${needText(n, 'suggests')}\n`);
    for (const p of c.problems) process.stdout.write(`  ${name}: ${p}\n`);
  } else if (verb === 'dependents' && name) {
    for (const d of dependents(name, st)) process.stdout.write(`${d.name}\t${groupText(d.anyOf)}\n`);
  } else {
    process.stderr.write('usage: node plugin-needs.js lines|say|dependents|json <name>\n');
    process.exit(2);
  }
}
