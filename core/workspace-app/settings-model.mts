/**
 * Settings, as people think of it now: a lean base and the plugins added to it.
 *
 * This is the model the Settings pages draw from, and nothing here draws: which family a plugin
 * belongs to, the one state it is in and the one action that comes next, which settings files are a
 * plugin's own, and what each file is for in a line. Kept apart from the pages so the rules are
 * tested without a workspace, and so the home page, a plugin's page and the modal cannot disagree.
 */

import { FAMILIES as CATALOG, SCOPE } from './plugin-catalog.mts';
import type { Manifest } from './plugin-manifest.mts';
import type { Need } from './plugin-needs.mts';

/** A family of Settings. */
export interface Family { id: string; label: string; icon: string; about: string }

/** What a manifest may say for Settings, besides what plugin-manifest.mts reads. */
export type SettingsManifest = Partial<Manifest> & { family?: string; summary?: string };

/** What a need of a plugin that is not met says: the plugin to pick for it. */
export type Unmet = Partial<Need> & { pick: string };
/** What plugin-needs says of a plugin's needs, as far as Settings reads it: the unmet ones, the problems, all of them. */
export interface Wants { unmet?: Unmet[]; problems?: string[]; needs?: Need[]; suggests?: Need[] }

/** A command a plugin needs or suggests, and whether it was found here. */
export interface CommandCheck { kind: string; name: string; state: string; anyOf?: string[]; why?: string; where?: string; version?: string; hint?: string }

/** A plugin, as far as its name, family and line are read. */
export interface PluginLike {
  name: string;
  module?: string;
  version?: string;
  description?: string;
  manifest?: SettingsManifest | null;
  [field: string]: unknown;
}

/** A plugin as the Plugins page knows it (plugins-page.js rows()), as far as Settings reads it. */
export interface PluginRow extends PluginLike {
  /** 0 required, 1 activated, 2 installed, 3 configured; a row without one is in none of them. */
  step?: number;
  wants?: Wants | null;
  /** What plugin-install's status() says of it: installed, how many files it placed, which are missing. */
  placed?: { missing?: string[]; installed?: boolean; placed?: number } | null;
  /** Its package spec, the plugins that need it, and whether the dashboard loaded it (plugins-page.js rows()). */
  spec?: string;
  neededBy?: string[];
  loaded?: boolean;
  commands?: CommandCheck[];
  todo?: string[];
  [field: string]: unknown;
}

/** The next thing to do with a plugin: a step the script runs, or a page to open. */
export interface Action { kind: 'post' | 'link'; label: string; verb?: string; withNeeds?: boolean; href?: string }

/** The one state a plugin is in. */
export interface PluginState {
  id: string; label: string; tone: string; icon: string; attention: boolean; active: boolean; note: string; action: Action;
  /** The newer version on npm, or ''. */
  update: string;
}

/** A plugin row with what Settings adds to it. */
export type GroupedPlugin = PluginRow & { family: string; label: string; summary: string; state: PluginState };

/** A catalogue entry, as Settings reads it. */
interface Listed { family: string; label: string; summary: string }

/** The families Settings groups plugins by, in the order they are shown. */
export const FAMILIES: Family[] = [
  { id: 'platforms', label: 'Platforms', icon: 'tabler:stack-2', about: 'Builders and tools for one platform.' },
  { id: 'folders', label: 'Workspace folders', icon: 'tabler:folders', about: 'A folder of projects or items, with its settings file and its commands.' },
  { id: 'ai', label: 'AI', icon: 'tabler:sparkles', about: 'Agents, skills, commands and prompts, kept as files and installed into an AI CLI.' },
  { id: 'hosting', label: 'Hosting providers', icon: 'tabler:cloud', about: 'Link a project to its host: environments, data, deploys, logs.' },
  { id: 'forges', label: 'Git forges', icon: 'tabler:git-merge', about: 'The repository, its issues and requests, and the credential used there.' },
  { id: 'containers', label: 'Container runtimes', icon: 'tabler:box', about: 'A menu for projects that run on a runtime other than the default one.' },
  { id: 'databases', label: 'Databases', icon: 'tabler:database-cog', about: 'The DATABASE menu of a project: a console, tables and sizes, export and import, a web admin.' },
  { id: 'features', label: 'Features', icon: 'tabler:puzzle', about: 'A menu, a page or a service the base does not carry.' },
];
const FAMILY_IDS = new Set(FAMILIES.map((f) => f.id));
export const familyById = (id: string): Family => FAMILIES.find((f) => f.id === id) || (FAMILIES[FAMILIES.length - 1] as Family);

// The catalogue's own family ids, as Settings names them.
const FROM_CATALOG: Record<string, string> = { workspaces: 'folders', drives: 'features' };
export const catalogIndex = (): Map<string, Listed> => {
  const map = new Map<string, Listed>();
  for (const f of CATALOG) {
    for (const [name, label, summary] of f.plugins) {
      const entry = { family: FROM_CATALOG[f.id] || f.id, label, summary };
      map.set(name, entry);
      // Also by its package: a plugin whose manifest name is not its catalogue id (Google Drive is
      // `google-drive-sync` in its manifest, `google-drive` in the catalogue) is still found (#435).
      map.set(`module:${SCOPE}/workspace-${name}`, entry);
    }
  }
  return map;
};
/** A plugin's catalogue entry: by its name, else by its package. */
const listedIn = (index: Map<string, Listed>, plugin: PluginLike | null | undefined, name: string): Listed | undefined => index.get(name) || (plugin && plugin.module ? index.get(`module:${plugin.module}`) : undefined);

const isAiFolder = (name: unknown): boolean => /^ai-[a-z0-9-]+$/.test(String(name || ''));
const shipsBuilder = (m: SettingsManifest = {}): boolean => ((m.commands || {}).files || []).some((f) => /cmd-[a-z0-9.-]+-project\.sh$/.test(String(f)));

/**
 * The family of a plugin. What the plugin says wins (`manifest.family`, behind the `settings-family`
 * capability); then what it is: an `ai-*` folder, a folder, a platform (it ships a builder and is not
 * a folder); then where the catalogue lists it; then Features.
 */
export function familyOf(plugin: PluginLike | null | undefined, index: Map<string, Listed> = catalogIndex()): string {
  const m: SettingsManifest = (plugin && plugin.manifest) || {};
  const name = (plugin && plugin.name) || m.name || '';
  if (m.family && FAMILY_IDS.has(String(m.family))) return String(m.family);
  if (isAiFolder(name)) return 'ai';
  const listed = listedIn(index, plugin, name);
  if (listed && FAMILY_IDS.has(listed.family)) return listed.family;
  if (m.workspace && m.workspace.key) return 'folders';
  if (shipsBuilder(m)) return 'platforms';
  return 'features';
}

const firstSentence = (text: unknown): string => {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  const m = t.match(/^(.{20,140}?[.:])(\s|$)/);
  if (m) return (m[1] ?? '').replace(/[.:]$/, '').trim();
  if (t.length <= 140) return t.replace(/[.:]$/, '').trim();
  // Longer than a line: cut at a word, and say it goes on.
  return `${t.slice(0, 140).replace(/[\s,;:]+\S*$/, '')}…`;
};

/**
 * One line that says what a plugin is: its own `manifest.summary`, else the catalogue's line, else the
 * start of its description. Never its package name, and never its own name said again: '' when nothing
 * says what it is (the row then says "No description").
 */
export function summaryOf(plugin: PluginLike | null | undefined, index: Map<string, Listed> = catalogIndex()): string {
  const m: SettingsManifest = (plugin && plugin.manifest) || {};
  if (m.summary) return String(m.summary).replace(/\s+/g, ' ').trim().slice(0, 160);
  const listed = listedIn(index, plugin, (plugin && plugin.name) || '');
  if (listed && listed.summary) return listed.summary;
  // "Drupal for Webship Workspace" says nothing the name beside it has not said; backticks are markup, not words.
  // A description that opens "<Name> for Webship Workspace: …" says it after the colon (#435).
  const text = String((plugin && plugin.description) || '').replace(/`/g, '').replace(/\s+/g, ' ').trim();
  const lead = text.match(/^[^:.]{1,60}?\s+for (the )?Webship Workspace:\s*(.+)$/i);
  const said = lead ? firstSentence(lead[2] ?? '').replace(/^./, (c) => c.toUpperCase())
    : firstSentence(text).replace(/\s+for (the )?Webship Workspace$/i, '');
  return said.toLowerCase() === nameOf(plugin, index).toLowerCase() ? '' : said;
}

/** The name Settings shows for a plugin, the same everywhere: its manifest's label, else the catalogue's name, else its id with capitals. */
export function nameOf(plugin: PluginLike | null | undefined, index: Map<string, Listed> = catalogIndex()): string {
  const m: SettingsManifest = (plugin && plugin.manifest) || {};
  const id = (plugin && plugin.name) || m.name || '';
  if (m.label) return String(m.label);
  const listed = listedIn(index, plugin, id);
  if (listed && listed.label) return listed.label;
  return id.split('-').filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/** The settings files that are a plugin's own: its settings file, and its folder's when it is a folder. */
export function filesOf(plugin: PluginLike | null | undefined): { file: string; kind: 'plugin' | 'folder' }[] {
  const m: SettingsManifest = (plugin && plugin.manifest) || {};
  const out: { file: string; kind: 'plugin' | 'folder' }[] = [];
  if (m.settingsFile) out.push({ file: String(m.settingsFile), kind: 'plugin' });
  if (m.workspace && m.workspace.key) out.push({ file: `workspace.${m.workspace.key}.settings.yml`, kind: 'folder' });
  return out;
}

const picksText = (unmet: readonly Unmet[]): string => unmet.map((n) => n.pick).join(' and ');

/**
 * The one state a plugin is in, and the one action that comes next.
 *
 * `row` is what the Plugins page already knows of a plugin: `{ name, step, wants, placed, manifest }`
 * (step 0 required, 1 activated, 2 installed, 3 configured). `latest` is the newest version on npm
 * when that is known. Answers `{ id, label, tone, icon, attention, active, action, note }`; `action`
 * is `{ kind: 'post', verb, label, withNeeds }` for a step the script runs, or `{ kind: 'link', href, label }`.
 */
export function stateOf(row: PluginRow, { latest = '', isNewer = () => false }: { latest?: string; isNewer?: (a: unknown, b: unknown) => boolean } = {}): PluginState {
  const name = row.name;
  // A row without a step is in none of the steps below, as `undefined` compared never is.
  const step = row.step ?? Number.NaN;
  const page = `/settings/plugin/${encodeURIComponent(name)}`;
  const wants = row.wants || { unmet: [], problems: [] };
  const unmet = wants.problems && wants.problems.length ? [] : (wants.unmet || []);
  const withNeeds = unmet.length > 0;
  const added = withNeeds ? ` with ${picksText(unmet)}` : '';
  const update = latest && isNewer(latest, row.version) ? latest : '';
  // `attention` is a blocker: the plugin will not work until something is done. A newer version is not one.
  const base = { update, active: step >= 1 };
  if (wants.problems && wants.problems.length) {
    return { ...base, id: 'problem', label: 'Needs cannot be met', tone: 'danger', icon: 'tabler:alert-triangle', attention: true,
      note: wants.problems.join('; '), action: { kind: 'link', href: `${page}#needs`, label: 'See why' } };
  }
  if (step <= 0) {
    return { ...base, id: 'not-active', label: 'Not active', tone: 'muted', icon: 'tabler:circle-dashed', attention: false,
      note: withNeeds ? `Needs ${picksText(unmet)}, which is not here yet` : '',
      action: { kind: 'post', verb: 'activate', label: `Activate${added}`, withNeeds } };
  }
  if (step === 1) {
    return { ...base, id: 'not-installed', label: 'Not installed', tone: 'warning', icon: 'tabler:package-import', attention: true,
      note: withNeeds ? `Needs ${picksText(unmet)}, which is not here yet` : 'Activated; its files are not placed yet',
      action: { kind: 'post', verb: 'install', label: `Install${added}`, withNeeds } };
  }
  if (withNeeds) {
    return { ...base, id: 'needs', label: `Needs ${picksText(unmet)}`, tone: 'warning', icon: 'tabler:link-off', attention: true,
      note: 'Something it needs is no longer here',
      action: { kind: 'post', verb: 'install', label: `Add ${picksText(unmet)}`, withNeeds: true } };
  }
  // A command it needs, checked here and not found (#433). One that cannot be checked from where the dashboard
  // runs (the host's, seen from the dashboard's container) is not known to be missing and changes nothing.
  const noCommand = [...new Set((row.commands || []).filter((c) => c.kind === 'needs' && c.state === 'missing').map((c) => c.name))];
  const noCommandText = noCommand.length ? `${noCommand.join(' and ')} ${noCommand.length === 1 ? 'is' : 'are'} not on this machine` : '';
  const missing = (row.placed && row.placed.missing) || [];
  if (missing.length) {
    return { ...base, id: 'files-missing', label: 'Files missing', tone: 'warning', icon: 'tabler:file-off', attention: true,
      note: `${missing.length} placed file${missing.length === 1 ? ' is' : 's are'} gone`,
      action: { kind: 'post', verb: 'install', label: 'Reinstall', withNeeds: false } };
  }
  if (step === 2) {
    const todo = row.todo || [];
    const said = todo.length ? `Still the placeholder: ${todo.join(', ')}` : 'Its settings are not filled in yet';
    return { ...base, id: 'needs-settings', label: 'Needs settings', tone: 'warning', icon: 'tabler:adjustments-alt', attention: true,
      note: noCommandText ? `${said}; ${noCommandText}` : said,
      action: { kind: 'link', href: `${page}#settings`, label: 'Configure' } };
  }
  if (noCommand.length) {
    return { ...base, id: 'needs-command', label: `Needs ${noCommand.join(' and ')}`, tone: 'warning', icon: 'tabler:terminal-2', attention: true,
      note: noCommandText, action: { kind: 'link', href: `${page}#needs`, label: 'How to install' } };
  }
  return { ...base, id: 'ready', label: 'Ready', tone: 'ok', icon: 'tabler:circle-check', attention: false,
    note: '', action: { kind: 'link', href: page, label: 'Open' } };
}

/** The plugins of a workspace by family, in the family order, each with its family, summary and state; empty families are left out. */
export function groupByFamily(rows: readonly PluginRow[], options: { latest?: Record<string, string>; isNewer?: (a: unknown, b: unknown) => boolean } = {}): (Family & { plugins: GroupedPlugin[] })[] {
  const index = catalogIndex();
  const latest = options.latest || {};
  const byId = new Map(FAMILIES.map((f) => [f.id, { ...f, plugins: [] as GroupedPlugin[] }]));
  for (const row of rows) {
    const family = familyOf(row, index);
    byId.get(family)?.plugins.push({ ...row, family, label: nameOf(row, index), summary: summaryOf(row, index),
      state: stateOf(row, { latest: (row.module && latest[row.module]) || '', isNewer: options.isNewer }) });
  }
  const label = (p: GroupedPlugin): string => String(p.label || p.name).toLowerCase();
  for (const f of byId.values()) f.plugins.sort((a, b) => label(a).localeCompare(label(b)));
  return [...byId.values()].filter((f) => f.plugins.length);
}

/** How many plugins are in each bucket the filter offers. */
export function counts(groups: readonly { plugins: GroupedPlugin[] }[]): Record<'all' | 'attention' | 'active' | 'inactive' | 'ready' | 'updates', number> {
  const all = groups.flatMap((g) => g.plugins);
  return { all: all.length, attention: all.filter((p) => p.state.attention).length,
    active: all.filter((p) => p.state.active).length, inactive: all.filter((p) => !p.state.active).length,
    ready: all.filter((p) => p.state.id === 'ready').length,
    // Every plugin with a newer version on npm, active or not: its own count, never part of another one.
    updates: all.filter((p) => p.state.update).length };
}

const THEME_RE = /^theme\.([a-z0-9_-]+)\.yml$/i;
const WORKSPACE_RE = /^workspace\.(.+)\.settings\.yml$/;
const PLUGIN_RE = /^plugin\.(.+)\.settings\.yml$/;

/**
 * Every settings file under core/config, by what it belongs to: the base (`settings.yml`), the
 * styles (`style.yml` and each `theme.*.yml`), a plugin (its own file, its folder's file), a folder
 * no plugin here made, or nothing known.
 */
export function sortFiles(files: readonly string[], plugins: readonly PluginLike[]):
  { general: string[]; styles: string[]; owned: Map<string, { plugin: string; kind: string }>; folders: string[]; other: string[] } {
  const owner = new Map<string, { plugin: string; kind: string }>();
  for (const p of plugins) for (const f of filesOf(p)) owner.set(f.file, { plugin: p.name, kind: f.kind });
  const out = { general: [] as string[], styles: [] as string[], owned: owner, folders: [] as string[], other: [] as string[] };
  for (const f of files) {
    if (f === 'settings.yml') out.general.push(f);
    else if (f === 'style.yml' || THEME_RE.test(f)) out.styles.push(f);
    else if (owner.has(f)) continue;
    else if (WORKSPACE_RE.test(f)) out.folders.push(f);
    else out.other.push(f);
  }
  return out;
}

/** What one settings file is for, in a line: never the same sentence for every file. */
export function fileHint(file: string, { folderSubtitle = '', pluginLabel = '' }: { folderSubtitle?: string; pluginLabel?: string } = {}): string {
  if (file === 'settings.yml') return 'The workspace name, the install account, who contributions are credited to, git forges and AI keys';
  if (file === 'style.yml') return 'Which style the dashboard wears';
  if (file === 'ai.settings.yml') return 'The AI CLIs and models this workspace uses';
  const theme = file.match(THEME_RE);
  if (theme) return `The variables of the ${theme[1]} style`;
  const ws = file.match(WORKSPACE_RE);
  if (ws) return folderSubtitle || `The ${ws[1]}/ folder: its name, icon and what its commands read`;
  const plugin = file.match(PLUGIN_RE);
  if (plugin) return `Settings of the ${pluginLabel || plugin[1]} plugin`;
  return 'A settings file under core/config';
}
