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
 *   node plugin-needs.mts lines <name>        one line per need, for plugins.sh
 *   node plugin-needs.mts say <name>          the same, for a person
 *   node plugin-needs.mts dependents <name>   who needs this one, and would be left without
 *   node plugin-needs.mts active <name>       exits 0 when it is activated here (plugins.<name>.enabled), else 1
 *   node plugin-needs.mts json [<name>]       everything, as JSON
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load as loadYaml } from 'js-yaml';

import { installedPlugins, placesSomething, APP_DIR, type InstalledPlugin } from './plugin-manifest.mts';
import { SCOPE } from './plugin-catalog.mts';
// Still JavaScript: what is read of them is named where it is used.
import * as workspacesModule from './workspaces.js';
import * as commandCheck from './command-check.js';

interface WorkspacesView { ROOT: string; CONFIG_DIR: string; loadSettings(): { plugins?: unknown; workspaces?: unknown } }
interface CommandCheckView {
  split(value: unknown): { plugins: unknown; commands: unknown; problems: string[] };
  commandEntries(list: unknown): { problems: string[] };
}
const { ROOT, CONFIG_DIR, loadSettings } = workspacesModule as unknown as WorkspacesView;
const { split, commandEntries } = commandCheck as unknown as CommandCheckView;

export const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
const KINDS = ['needs', 'suggests'] as const;
type Kind = typeof KINDS[number];

/** What the answers are read from: the packages, what is activated, what is recorded as installed, the folders listed. */
export interface NeedsState {
  plugins: Map<string, InstalledPlugin>;
  active: Set<string>;
  record: Record<string, { needs?: unknown } | undefined>;
  workspaces: Set<string>;
}

/** One need or suggestion: its alternatives, what meets it, the one that would be added, and how. */
export interface Need { anyOf: string[]; metBy: string | null; pick: string; required: boolean; spec: string }

/** What one plugin needs and suggests, and where each stands. */
export interface NeedsCheck { name: string; needs: Need[]; suggests: Need[]; unmet: Need[]; problems: string[]; cycle: string[] | null }

/** A manifest's `needs` or `suggests` as groups of alternatives, and what is wrong with it. */
export function normalize(given: unknown, self: string = ''): { groups: string[][]; problems: string[] } {
  const groups: string[][] = [];
  // An object holds the plugins under `plugins` (and commands, which command-check.js reads); a list is the plugins.
  const parts = split(given);
  const value = parts.plugins;
  const problems = [...parts.problems, ...commandEntries(parts.commands).problems];
  if (value == null) return { groups, problems };
  if (!Array.isArray(value)) return { groups, problems: [...problems, 'must be a list of plugin names (a list inside it means any one of them), or { plugins, commands }'] };
  for (const entry of value) {
    const names: unknown[] = Array.isArray(entry) ? entry : [entry];
    const bad = names.filter((n) => typeof n !== 'string' || !NAME_RE.test(n));
    if (!names.length || bad.length) { problems.push(`${JSON.stringify(entry)} is not a plugin name or a list of plugin names`); continue; }
    if (names.includes(self)) { problems.push(`${self} names itself`); continue; }
    groups.push([...new Set(names as string[])]);
  }
  return { groups, problems };
}

/** The state every answer is read from: the plugin packages, what is activated, what is recorded as installed, the workspaces. */
export function state(): NeedsState {
  const plugins = new Map(installedPlugins().map((p) => [p.name, p]));
  // settings.yml's plugins block, read here and not through the loader: requiring the loader loads every
  // activated plugin's code, which a check from the command line has no use for.
  const block = loadSettings().plugins;
  const configs: Record<string, { enabled?: unknown } | null> = (block && typeof block === 'object') ? block as Record<string, { enabled?: unknown } | null> : {};
  const active = new Set(Object.entries(configs || {}).filter(([, c]) => c && (c.enabled === true || String(c.enabled) === 'true')).map(([n]) => n));
  let record: NeedsState['record'] = {};
  try { record = (loadYaml(fs.readFileSync(path.join(CONFIG_DIR, 'plugins.installed.yml'), 'utf8')) as NeedsState['record'] | null) || {}; } catch (_) { record = {}; }
  const listed = loadSettings().workspaces;
  const workspaces = new Set((Array.isArray(listed) ? listed : []).map(String));
  return { plugins, active, record, workspaces };
}

/** The workspace folder a plugin of that name is: its manifest's key, or the name itself while the package is not here. */
function workspaceKeyOf(name: string, st: NeedsState): string {
  const p = st.plugins.get(name);
  if (p) return (p.manifest.workspace && p.manifest.workspace.key) ? String(p.manifest.workspace.key) : '';
  return name;
}

/** Whether the workspace has that plugin: activated and installed, or its folder already listed. `without` is a plugin to count as gone. */
export function isMet(name: string, st: NeedsState, without: string = ''): boolean {
  if (name === without) return false;
  const p = st.plugins.get(name);
  if (p && st.active.has(name) && (st.record[name] || !placesSomething(p.manifest))) return true;
  // A plugin that is going is no longer what lists its folder; a folder nobody's plugin made stays.
  const key = workspaceKeyOf(name, st);
  if (!key || !st.workspaces.has(key) || !fs.existsSync(path.join(ROOT, key))) return false;
  return !(p && st.record[name]) || st.active.has(name);
}

/** The npm spec a needed plugin is required with: the same source as the plugin that needs it. */
export function specFor(dependent: Pick<InstalledPlugin, 'spec' | 'module'> | null | undefined, need: string): string {
  const spec = String((dependent && dependent.spec) || '');
  const mod = String((dependent && dependent.module) || '');
  const scope = mod.startsWith('@') ? (mod.split('/')[0] ?? SCOPE) : SCOPE;
  const git = spec.match(/^(github:|git\+https:\/\/github\.com\/|git\+ssh:\/\/git@github\.com\/|https:\/\/github\.com\/)([^/#]+)\/workspace-[a-z0-9-]+?(\.git)?(#.*)?$/);
  if (git) return `${git[1]}${git[2]}/workspace-${need}${git[3] || ''}`;
  const file = spec.match(/^file:(.+)$/);
  if (file) {
    const sibling = path.resolve(APP_DIR, file[1] ?? '', '..', `workspace-${need}`);
    if (fs.existsSync(path.join(sibling, 'package.json'))) return sibling;
  }
  return `${scope}/workspace-${need}`;
}

/** A chain of needs that comes back to where it started, among the packages that are here, or null. */
function cycleFrom(name: string, st: NeedsState, trail: string[] = []): string[] | null {
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
export function pickOf(group: readonly string[], st: NeedsState): string {
  return group.find((n) => isMet(n, st)) || group.find((n) => st.active.has(n)) || group.find((n) => st.plugins.has(n)) || group[0] || '';
}

/**
 * What one plugin needs and suggests, and where each stands:
 * `{ name, needs: [{ anyOf, metBy, pick, required, spec }], suggests: [...], unmet: [...], problems: [], cycle }`.
 */
export function check(name: string, st: NeedsState = state()): NeedsCheck | null {
  const plugin = st.plugins.get(name);
  if (!plugin) return null;
  const out: NeedsCheck = { name, needs: [], suggests: [], unmet: [], problems: [], cycle: null };
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
function needsInUse(name: string, st: NeedsState): string[][] {
  const p = st.plugins.get(name);
  if (p) return normalize(p.manifest.needs, name).groups;
  const entry = st.record[name];
  return normalize(entry && entry.needs, name).groups;
}

/** The plugins in use (activated or installed) that need this one and have no other alternative here: `[{ name, anyOf }]`. */
export function dependents(name: string, st: NeedsState = state()): { name: string; anyOf: string[] }[] {
  const out: { name: string; anyOf: string[] }[] = [];
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

export const groupText = (anyOf: readonly string[]): string => (anyOf.length > 1 ? `one of ${anyOf.join(', ')}` : anyOf[0] ?? '');

/** One need, as a person reads it. A suggestion is never added, so it does not say which one would be. */
export function needText(n: Need, kind: Kind = 'needs'): string {
  if (n.metBy) return `${groupText(n.anyOf)} (${kind === 'needs' ? 'met by' : 'here:'} ${n.metBy})`;
  return `${groupText(n.anyOf)} (not here${kind === 'needs' && n.anyOf.length > 1 ? `; ${n.pick} is the one added` : ''})`;
}

/** The `needs: … · suggests: …` line of a list or a card, or '' for a plugin that declares neither. */
export function summary(c: NeedsCheck | null | undefined): string {
  if (!c) return '';
  const parts: string[] = [];
  if (c.needs.length) parts.push(`needs: ${c.needs.map((n) => needText(n)).join(' · ')}`);
  if (c.suggests.length) parts.push(`suggests: ${c.suggests.map((n) => needText(n, 'suggests')).join(' · ')}`);
  if (c.problems.length) parts.push(`problem: ${c.problems.join('; ')}`);
  return parts.join('   ');
}

// Run as a command (`node plugin-needs.mts …`), not imported. import.meta.main is Node.js 24.2 and later.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [verb, name = ''] = process.argv.slice(2);
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
  } else if (verb === 'active' && name) {
    process.exitCode = st.active.has(name) ? 0 : 1;
  } else if (verb === 'dependents' && name) {
    for (const d of dependents(name, st)) process.stdout.write(`${d.name}\t${groupText(d.anyOf)}\n`);
  } else {
    process.stderr.write('usage: node plugin-needs.mts lines|say|dependents|active|json <name>\n');
    process.exit(2);
  }
}
