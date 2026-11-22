/**
 * Which plugins this dashboard has, and what each one ships.
 *
 * A plugin is a node package whose package.json carries a `workspacePlugin` block — the manifest —
 * named as a dependency of this app (`npm install github:webship/workspace-upsun` is the whole
 * "require" step), or a folder under plugins/ with the same shape. The manifest says what the
 * installer has to place in the workspace (bash functions, per-workspace commands, DDEV compose
 * files, themes, a settings template) and what the loader wires in at startup (type actions, CSS,
 * labels). Nothing here loads a plugin's code: that is plugin-loader.js, and only for the ones that
 * are activated.
 *
 * Also a command, for plugins.sh (so it asks this module, never through `node -e` code of its own):
 *
 *   node plugin-manifest.mts [--json] [name]      the plugins, or one: name, package, version, folder (or JSON)
 *   node plugin-manifest.mts module <name>         its npm package, or nothing
 *   node plugin-manifest.mts workspace-key <name>  the workspace folder it is (manifest workspace.key), or nothing
 *   node plugin-manifest.mts settings-files <name> its settings files, one per line
 *   node plugin-manifest.mts of-package <package>  the plugin a package (or its short name) is, or nothing
 *   node plugin-manifest.mts source <name>         where it comes from: `npm<TAB><package>` or `folder<TAB><dir>`
 *
 * A name that is not a plugin here exits 1 for the list and prints nothing for the others. A word alone is always a
 * name, so a plugin called `source` is still found.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

/** A plugin's manifest: the `workspacePlugin` block of its package.json, as far as the core reads it here. */
export interface Manifest {
  name: string;
  label?: string;
  settingsFile?: string;
  settingsTemplate?: string;
  workspace?: { key?: string; settingsTemplate?: string } & Record<string, unknown>;
  scripts?: { functions?: string[]; args?: string[]; machine?: string[]; hostInstall?: unknown };
  ddev?: { compose?: string[]; hostMounts?: string[] };
  commands?: { files?: string[] };
  themes?: string[];
  features?: string[];
  ai?: Record<string, string[] | undefined>;
  [field: string]: unknown;
}

/** A plugin the app can see. */
export interface InstalledPlugin {
  name: string;
  /** Its npm package, or '' for a folder under plugins/ with no package.json. */
  module: string;
  dir: string;
  manifest: Manifest;
  version: string;
  description: string;
  /** What package.json asks for (a version range, a path), or `plugins/<folder>`. */
  spec: string;
}

/** The fields of a package.json read here. */
interface PackageJson {
  name?: string;
  version?: string;
  description?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  workspacePlugin?: Manifest;
}

export const APP_DIR: string = import.meta.dirname;
const requireHere = createRequire(import.meta.url);
// Overridable for tests, like WORKSPACE_ROOT: a temporary folder of fake plugins.
export const PLUGINS_DIR: string = process.env.WORKSPACE_PLUGINS_DIR || path.join(APP_DIR, 'plugins');

function readJson(file: string): PackageJson | null {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}

/** The directory a package resolves to, through this app's node_modules, or null. */
export function packageDir(moduleName: string): string | null {
  try {
    return path.dirname(requireHere.resolve(`${moduleName}/package.json`, { paths: [APP_DIR] }));
  } catch (_) {
    // A package whose package.json is not exported still has a directory under node_modules.
    const guess = path.join(APP_DIR, 'node_modules', ...moduleName.split('/'));
    return fs.existsSync(path.join(guess, 'package.json')) ? guess : null;
  }
}

/**
 * Every plugin package the app can see: `{ name, module, dir, manifest, version, description }`,
 * by manifest name. Dependencies first; a folder under plugins/ with the same name is the
 * fallback, the way the loader treats it.
 */
export function installedPlugins(): InstalledPlugin[] {
  const out = new Map<string, InstalledPlugin>();
  const own: PackageJson = readJson(path.join(APP_DIR, 'package.json')) || {};
  const deps = { ...(own.dependencies || {}), ...(own.devDependencies || {}) };
  for (const moduleName of Object.keys(deps)) {
    const dir = packageDir(moduleName);
    if (!dir) continue;
    const pkg = readJson(path.join(dir, 'package.json'));
    const m = pkg && pkg.workspacePlugin;
    if (!m || !m.name) continue;
    out.set(m.name, { name: m.name, module: moduleName, dir: fs.realpathSync(dir), manifest: m, version: pkg.version || '', description: pkg.description || '', spec: deps[moduleName] ?? '' });
  }
  let folders: string[] = [];
  try { folders = fs.readdirSync(PLUGINS_DIR, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch (_) { /* no plugins/ */ }
  for (const folder of folders) {
    const dir = path.join(PLUGINS_DIR, folder);
    const pkg = readJson(path.join(dir, 'package.json'));
    const m: Manifest | null = (pkg && pkg.workspacePlugin) || (fs.existsSync(path.join(dir, 'index.js')) ? { name: folder } : null);
    if (!m || !m.name || out.has(m.name)) continue;
    out.set(m.name, { name: m.name, module: (pkg && pkg.name) || '', dir, manifest: m, version: (pkg && pkg.version) || '', description: (pkg && pkg.description) || '', spec: `plugins/${folder}` });
  }
  return [...out.values()];
}

export function pluginByName(name: string): InstalledPlugin | null {
  return installedPlugins().find((p) => p.name === name) || null;
}

/**
 * How a plugin writes the words of its own name, read from its label: `woocommerce` labelled
 * "WooCommerce" gives { woocommerce: 'WooCommerce' }, and `django-cms` labelled "django CMS" gives
 * { django: 'django', cms: 'CMS' }. A label that does not spell the name word for word ("Magento Open
 * Source" for `magento`) gives nothing, and the usual title case stands.
 */
export function nameCasing(name: unknown, label: unknown): Record<string, string> {
  const parts = String(name || '').toLowerCase().split('-').filter(Boolean);
  const words = String(label || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length || parts.length !== words.length) return {};
  const out: Record<string, string> = {};
  for (let i = 0; i < parts.length; i += 1) {
    const word = words[i] ?? '';
    const part = parts[i] ?? '';
    if (word.toLowerCase() !== part) return {};
    out[part] = word;
  }
  return out;
}

/** Whether the manifest names anything an install has to place. */
export function needsInstall(m: Partial<Manifest> = {}): boolean {
  const s = m.scripts || {};
  return !!((s.functions || []).length || (s.args || []).length || (s.machine || []).length || s.hostInstall
    || ((m.ddev || {}).compose || []).length || ((m.ddev || {}).hostMounts || []).length
    || ((m.commands || {}).files || []).length || (m.themes || []).length || (m.features || []).length || m.settingsTemplate
    || Object.values(m.ai || {}).some((list) => (list || []).length));
}

/** The same, counting the workspace folder a plugin is: what has to be installed before another plugin can rely on it. */
export function placesSomething(m: Partial<Manifest> = {}): boolean {
  return needsInstall(m) || !!(m.workspace && m.workspace.key);
}

/** Its settings files: its own (settingsFile, or plugin.<name>.settings.yml when it only names a template) and, for a
 *  plugin that is a workspace folder, the folder's (workspace.<key>.settings.yml). */
export function settingsFilesOf(p: InstalledPlugin | null): string[] {
  const m: Partial<Manifest> = (p && p.manifest) || {};
  const out: string[] = [];
  if (p && (m.settingsFile || m.settingsTemplate)) out.push(m.settingsFile || `plugin.${p.name}.settings.yml`);
  const ws = m.workspace || {};
  if (ws.key && ws.settingsTemplate && /^[a-z0-9_-]+$/.test(String(ws.key))) out.push(`workspace.${ws.key}.settings.yml`);
  return out;
}

/** The plugin a package is: its whole name (a version after @ left out), or the short name of @scope/workspace-<short>. */
export function pluginOfPackage(spec: string): InstalledPlugin | null {
  const want = String(spec).replace(/@[^@/]*$/, '');
  return installedPlugins().find((x) => x.module && (x.module === want || x.module.replace(/^@[^/]+\//, '') === `workspace-${want}`)) || null;
}

/** Where a plugin comes from: an npm package this app depends on, or a folder. */
export function sourceOf(p: InstalledPlugin | null): string {
  if (!p) return '';
  const own: PackageJson = readJson(path.join(APP_DIR, 'package.json')) || {};
  const deps = { ...(own.dependencies || {}), ...(own.devDependencies || {}) };
  return p.module && deps[p.module] ? `npm\t${p.module}` : `folder\t${p.dir}`;
}

/** The command (see the top of the file). Answers what to print and the exit code. */
export function command(args: readonly string[]): { out: string; code: number } {
  const [verb, arg = ''] = args;
  const one = (): InstalledPlugin | null => pluginByName(arg);
  // A subcommand always has its argument, so one word alone is a plugin's name, whatever it is.
  if (args.length >= 2) switch (verb) {
    case 'module': return { out: (one() || { module: '' }).module, code: 0 };
    case 'workspace-key': { const w = one()?.manifest.workspace; return { out: w && w.key ? String(w.key) : '', code: 0 }; }
    case 'settings-files': return { out: settingsFilesOf(one()).join('\n'), code: 0 };
    case 'of-package': return { out: (pluginOfPackage(arg) || { name: '' }).name, code: 0 };
    case 'source': return { out: sourceOf(one()), code: 0 };
    default: break;
  }
  const json = args.includes('--json');
  const name = args.find((a) => !a.startsWith('--'));
  const list = name ? [pluginByName(name)].filter((p): p is InstalledPlugin => !!p) : installedPlugins();
  const out = json
    ? `${JSON.stringify(name ? list[0] || null : list, null, 2)}\n`
    : list.map((p) => `${p.name}\t${p.module || '-'}\t${p.version || '-'}\t${p.dir}\n`).join('');
  return { out, code: name && !list.length ? 1 : 0 };
}

// Run as a command (`node plugin-manifest.mts …`), not imported. import.meta.main is Node.js 24.2 and later.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { out, code } = command(process.argv.slice(2));
  process.stdout.write(out);
  process.exitCode = code;
}
