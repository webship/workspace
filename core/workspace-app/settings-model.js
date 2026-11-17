/**
 * Settings, as people think of it now: a lean base and the plugins added to it.
 *
 * This is the model the Settings pages draw from, and nothing here draws: which family a plugin
 * belongs to, the one state it is in and the one action that comes next, which settings files are a
 * plugin's own, and what each file is for in a line. Kept apart from the pages so the rules are
 * tested without a workspace, and so the home page, a plugin's page and the modal cannot disagree.
 */

const { FAMILIES: CATALOG, SCOPE } = require('./plugin-catalog');

/** The families Settings groups plugins by, in the order they are shown. */
const FAMILIES = [
  { id: 'platforms', label: 'Platforms', icon: 'tabler:stack-2', about: 'Builders and tools for one platform.' },
  { id: 'folders', label: 'Workspace folders', icon: 'tabler:folders', about: 'A folder of projects or items, with its settings file and its commands.' },
  { id: 'ai', label: 'AI', icon: 'tabler:sparkles', about: 'Agents, skills, commands and prompts, kept as files and installed into an AI CLI.' },
  { id: 'hosting', label: 'Hosting providers', icon: 'tabler:cloud', about: 'Link a project to its host: environments, data, deploys, logs.' },
  { id: 'forges', label: 'Git forges', icon: 'tabler:git-merge', about: 'The repository, its issues and requests, and the credential used there.' },
  { id: 'containers', label: 'Container runtimes', icon: 'tabler:box', about: 'A menu for projects that run on a runtime other than the default one.' },
  { id: 'features', label: 'Features', icon: 'tabler:puzzle', about: 'A menu, a page or a service the base does not carry.' },
];
const FAMILY_IDS = new Set(FAMILIES.map((f) => f.id));
const familyById = (id) => FAMILIES.find((f) => f.id === id) || FAMILIES[FAMILIES.length - 1];

// The catalogue's own family ids, as Settings names them.
const FROM_CATALOG = { workspaces: 'folders', drives: 'features' };
const catalogIndex = () => {
  const map = new Map();
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
const listedIn = (index, plugin, name) => index.get(name) || (plugin && plugin.module ? index.get(`module:${plugin.module}`) : undefined);

const isAiFolder = (name) => /^ai-[a-z0-9-]+$/.test(String(name || ''));
const shipsBuilder = (m = {}) => ((m.commands || {}).files || []).some((f) => /cmd-[a-z0-9.-]+-project\.sh$/.test(String(f)));

/**
 * The family of a plugin. What the plugin says wins (`manifest.family`, behind the `settings-family`
 * capability); then what it is: an `ai-*` folder, a folder, a platform (it ships a builder and is not
 * a folder); then where the catalogue lists it; then Features.
 */
function familyOf(plugin, index = catalogIndex()) {
  const m = (plugin && plugin.manifest) || {};
  const name = (plugin && plugin.name) || m.name || '';
  if (m.family && FAMILY_IDS.has(String(m.family))) return String(m.family);
  if (isAiFolder(name)) return 'ai';
  const listed = listedIn(index, plugin, name);
  if (listed && FAMILY_IDS.has(listed.family)) return listed.family;
  if (m.workspace && m.workspace.key) return 'folders';
  if (shipsBuilder(m)) return 'platforms';
  return 'features';
}

const firstSentence = (text) => {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  const m = t.match(/^(.{20,140}?[.:])(\s|$)/);
  if (m) return m[1].replace(/[.:]$/, '').trim();
  if (t.length <= 140) return t.replace(/[.:]$/, '').trim();
  // Longer than a line: cut at a word, and say it goes on.
  return `${t.slice(0, 140).replace(/[\s,;:]+\S*$/, '')}…`;
};

/**
 * One line that says what a plugin is: its own `manifest.summary`, else the catalogue's line, else the
 * start of its description. Never its package name, and never its own name said again: '' when nothing
 * says what it is (the row then says "No description").
 */
function summaryOf(plugin, index = catalogIndex()) {
  const m = (plugin && plugin.manifest) || {};
  if (m.summary) return String(m.summary).replace(/\s+/g, ' ').trim().slice(0, 160);
  const listed = listedIn(index, plugin, (plugin && plugin.name) || '');
  if (listed && listed.summary) return listed.summary;
  // "Drupal for Webship Workspace" says nothing the name beside it has not said; backticks are markup, not words.
  // A description that opens "<Name> for Webship Workspace: …" says it after the colon (#435).
  const text = String((plugin && plugin.description) || '').replace(/`/g, '').replace(/\s+/g, ' ').trim();
  const lead = text.match(/^[^:.]{1,60}?\s+for (the )?Webship Workspace:\s*(.+)$/i);
  const said = lead ? firstSentence(lead[2]).replace(/^./, (c) => c.toUpperCase())
    : firstSentence(text).replace(/\s+for (the )?Webship Workspace$/i, '');
  return said.toLowerCase() === nameOf(plugin, index).toLowerCase() ? '' : said;
}

/** The name Settings shows for a plugin, the same everywhere: its manifest's label, else the catalogue's name, else its id with capitals. */
function nameOf(plugin, index = catalogIndex()) {
  const m = (plugin && plugin.manifest) || {};
  const id = (plugin && plugin.name) || m.name || '';
  if (m.label) return String(m.label);
  const listed = listedIn(index, plugin, id);
  if (listed && listed.label) return listed.label;
  return id.split('-').filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
}

/** The settings files that are a plugin's own: its settings file, and its folder's when it is a folder. */
function filesOf(plugin) {
  const m = (plugin && plugin.manifest) || {};
  const out = [];
  if (m.settingsFile) out.push({ file: String(m.settingsFile), kind: 'plugin' });
  if (m.workspace && m.workspace.key) out.push({ file: `workspace.${m.workspace.key}.settings.yml`, kind: 'folder' });
  return out;
}

const picksText = (unmet) => unmet.map((n) => n.pick).join(' and ');

/**
 * The one state a plugin is in, and the one action that comes next.
 *
 * `row` is what the Plugins page already knows of a plugin: `{ name, step, wants, placed, manifest }`
 * (step 0 required, 1 activated, 2 installed, 3 configured). `latest` is the newest version on npm
 * when that is known. Answers `{ id, label, tone, icon, attention, active, action, note }`; `action`
 * is `{ kind: 'post', verb, label, withNeeds }` for a step the script runs, or `{ kind: 'link', href, label }`.
 */
function stateOf(row, { latest = '', isNewer = () => false } = {}) {
  const name = row.name;
  const page = `/settings/plugin/${encodeURIComponent(name)}`;
  const wants = row.wants || { unmet: [], problems: [] };
  const unmet = wants.problems && wants.problems.length ? [] : (wants.unmet || []);
  const withNeeds = unmet.length > 0;
  const added = withNeeds ? ` with ${picksText(unmet)}` : '';
  const update = latest && isNewer(latest, row.version) ? latest : '';
  // `attention` is a blocker: the plugin will not work until something is done. A newer version is not one.
  const base = { update, active: row.step >= 1 };
  if (wants.problems && wants.problems.length) {
    return { ...base, id: 'problem', label: 'Needs cannot be met', tone: 'danger', icon: 'tabler:alert-triangle', attention: true,
      note: wants.problems.join('; '), action: { kind: 'link', href: `${page}#needs`, label: 'See why' } };
  }
  if (row.step <= 0) {
    return { ...base, id: 'not-active', label: 'Not active', tone: 'muted', icon: 'tabler:circle-dashed', attention: false,
      note: withNeeds ? `Needs ${picksText(unmet)}, which is not here yet` : '',
      action: { kind: 'post', verb: 'activate', label: `Activate${added}`, withNeeds } };
  }
  if (row.step === 1) {
    return { ...base, id: 'not-installed', label: 'Not installed', tone: 'warning', icon: 'tabler:package-import', attention: true,
      note: withNeeds ? `Needs ${picksText(unmet)}, which is not here yet` : 'Activated; its files are not placed yet',
      action: { kind: 'post', verb: 'install', label: `Install${added}`, withNeeds } };
  }
  if (withNeeds) {
    return { ...base, id: 'needs', label: `Needs ${picksText(unmet)}`, tone: 'warning', icon: 'tabler:link-off', attention: true,
      note: 'Something it needs is no longer here',
      action: { kind: 'post', verb: 'install', label: `Add ${picksText(unmet)}`, withNeeds: true } };
  }
  const missing = (row.placed && row.placed.missing) || [];
  if (missing.length) {
    return { ...base, id: 'files-missing', label: 'Files missing', tone: 'warning', icon: 'tabler:file-off', attention: true,
      note: `${missing.length} placed file${missing.length === 1 ? ' is' : 's are'} gone`,
      action: { kind: 'post', verb: 'install', label: 'Reinstall', withNeeds: false } };
  }
  if (row.step === 2) {
    return { ...base, id: 'needs-settings', label: 'Needs settings', tone: 'warning', icon: 'tabler:adjustments-alt', attention: true,
      note: 'Its settings are not filled in yet',
      action: { kind: 'link', href: `${page}#settings`, label: 'Configure' } };
  }
  return { ...base, id: 'ready', label: 'Ready', tone: 'ok', icon: 'tabler:circle-check', attention: false,
    note: '', action: { kind: 'link', href: page, label: 'Open' } };
}

/** The plugins of a workspace by family, in the family order, each with its family, summary and state; empty families are left out. */
function groupByFamily(rows, options = {}) {
  const index = catalogIndex();
  const latest = options.latest || {};
  const byId = new Map(FAMILIES.map((f) => [f.id, { ...f, plugins: [] }]));
  for (const row of rows) {
    const family = familyOf(row, index);
    byId.get(family).plugins.push({ ...row, family, label: nameOf(row, index), summary: summaryOf(row, index),
      state: stateOf(row, { latest: latest[row.module] || '', isNewer: options.isNewer }) });
  }
  const label = (p) => String(p.label || p.name).toLowerCase();
  for (const f of byId.values()) f.plugins.sort((a, b) => label(a).localeCompare(label(b)));
  return [...byId.values()].filter((f) => f.plugins.length);
}

/** How many plugins are in each bucket the filter offers. */
function counts(groups) {
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
function sortFiles(files, plugins) {
  const owner = new Map();
  for (const p of plugins) for (const f of filesOf(p)) owner.set(f.file, { plugin: p.name, kind: f.kind });
  const out = { general: [], styles: [], owned: owner, folders: [], other: [] };
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
function fileHint(file, { folderSubtitle = '', pluginLabel = '' } = {}) {
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

module.exports = { FAMILIES, familyById, familyOf, nameOf, summaryOf, filesOf, stateOf, groupByFamily, counts, sortFiles, fileHint, catalogIndex };
