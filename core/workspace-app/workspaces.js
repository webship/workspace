const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const CONFIG_DIR = process.env.WORKSPACE_CONFIG || path.join(process.env.HOME, 'workspace/core/config');
const ROOT = process.env.WORKSPACE_ROOT || path.join(process.env.HOME, 'workspace');

// Presentational-only (icon/subtitle) — everything functional (paths, script names,
// which workspaces exist) is read live from settings.yml / workspace.<name>.settings.yml
// and the filesystem, so a new workspace added there shows up with no code change.
// `icon` is a UIKit icon name (https://getuikit.com/docs/icon), rendered
// with the vendored uikit-icons.min.js.
// `noun` is what one item in the folder is called (only real projects are
// "projects"); `plural` overrides irregular plurals.
const PRESENTATION = {
  products:   { icon: 'tabler:shopping-cart',        subtitle: 'Internal & External Products', noun: 'product' },
  dev:        { icon: 'tabler:code',        subtitle: 'Development Projects', noun: 'project' },
  test:       { icon: 'tabler:checkbox',       subtitle: 'Testing Environment', noun: 'project' },
  demos:      { icon: 'tabler:device-desktop',     subtitle: 'Demo Sites', noun: 'demo' },
  sandboxes:  { icon: 'tabler:flask',      subtitle: 'Experimental Projects', noun: 'sandbox', plural: 'sandboxes' },
  projects:   { icon: 'tabler:folder',      subtitle: 'Client Projects', noun: 'project' },
  profiles:   { icon: 'tabler:world',       subtitle: 'Distros', noun: 'profile' },
  themes:     { icon: 'tabler:paint', subtitle: 'Contrib & Private Themes', noun: 'theme' },
  modules:    { icon: 'tabler:apps',        subtitle: 'Contrib & Private Modules', noun: 'module' },
  libraries:  { icon: 'tabler:library',       subtitle: 'Third-Party Libraries', noun: 'library', plural: 'libraries' },
  docs:       { icon: 'tabler:file-text',   subtitle: 'Documentation Projects', noun: 'doc', kind: 'files' },
  agents:     { icon: 'tabler:robot-face',       subtitle: 'AI Automation', label: 'AI Agents', noun: 'agent', kind: 'files' },
  skills:     { icon: 'tabler:star',        subtitle: 'AI Skill Definitions', label: 'AI Skills', noun: 'skill', kind: 'files' },
  prompts:    { icon: 'tabler:pencil',      subtitle: 'Reusable AI Prompts', noun: 'prompt', label: 'AI Prompts', kind: 'files' },
  recipes:    { icon: 'tabler:list-check',        subtitle: 'Development Recipes', noun: 'recipe' },
};

function loadYaml(file) {
  try {
    return yaml.load(fs.readFileSync(file, 'utf8')) || {};
  } catch (_) {
    return {};
  }
}

function loadSettings() {
  return loadYaml(path.join(CONFIG_DIR, 'settings.yml'));
}

/**
 * Everything under `style:` in settings.yml, resolved and validated in one place.
 *
 * The keys were declared long before anything read them, and what did read them read the file
 * again and applied its own defaulting — so a nonsense value meant a different thing depending on
 * which caller saw it. Here a bad value is a missing value, once.
 *
 * Note what these are: `mode` and `editor_theme` are defaults for someone who has expressed no
 * preference. The toggle stores a real choice, and a stored choice always wins.
 */
function styleSettings() {
  const s = loadSettings().style || {};
  const oneOf = (v, allowed, fallback) => (allowed.includes(String(v)) ? String(v) : fallback);
  // A filename under public/, not a path or a URL: everything is served locally, and a settings
  // file that could point the logo at another host would be a way to make this page load one.
  const asset = (v, fallback) => (typeof v === 'string' && /^[A-Za-z0-9._-]+$/.test(v) && !v.startsWith('.') ? v : fallback);
  const logo = asset(s.logo, 'logo.png');
  return {
    workspaceName: typeof s.workspace_name === 'string' && s.workspace_name.trim()
      ? s.workspace_name.trim() : 'workspace',
    mode: oneOf(s.mode, ['light', 'dark', 'system'], 'light'),
    editorTheme: oneOf(s.editor_theme, ['auto', 'light', 'dark'], 'auto'),
    // Which palette the dashboard wears. Validated against what is on disk by themes.js rather
    // than against a list here, so adding a theme is adding a directory.
    theme: typeof s.theme === 'string' && /^[a-z0-9-]+$/.test(s.theme) ? s.theme : 'default',
    logo,
    // Falls back to the one logo rather than to a second file that may not exist: most marks read
    // on both surfaces, and a broken image is worse than a slightly dim one.
    logoOnDark: asset(s.logo_on_dark, logo),
    favicon: asset(s.favicon, logo),
  };
}

/**
 * The AI assistant panel's own settings, resolved and validated like the style block.
 *
 * These are preferences about the room you work in rather than about the workspace: whether the
 * machine listens, whether it talks back, and how fast. They reach the browser as one attribute on
 * the component, because the component is configured in JavaScript and the page is the only thing
 * that has read the file.
 */
function assistantSettings() {
  const a = loadSettings().assistant || {};
  const bool = (v, fallback) => (typeof v === 'boolean' ? v : fallback);
  const num = (v, allowed, fallback) => (allowed.includes(Number(v)) ? Number(v) : fallback);
  return {
    voiceInput: bool(a.voice_input, true),
    // 0 is a real choice, not a missing value: it means nothing is ever sent for you.
    submitAfterSilence: num(a.submit_after_silence, [0, 1500, 2500, 4000], 2500),
    voiceOutput: bool(a.voice_output, true),
    speechRate: num(a.speech_rate, [0.75, 1, 1.25, 1.5], 1),
    intro: bool(a.intro, true),
  };
}

// The hub's base domain. Locally this is workspace.ddev.site; set
// `hub_domain:` in settings.yml (plus matching additional_fqdns + DNS +
// nginx server_names) to run the whole system as a remote development
// workspace hub on a public domain, e.g. workspace.example.com →
// dev.workspace.example.com → myproject.dev.workspace.example.com.
function hubDomain() {
  return loadSettings().hub_domain || 'workspace.ddev.site';
}

// Rebuilt with a 2s TTL memo: still effectively live (a settings.yml edit
// shows up on the next page load) without re-reading ~17 YAML files for the
// many helper calls within a single request.
let _wsCache = null;
let _wsCacheAt = 0;
function loadWorkspaces() {
  const now = Date.now();
  if (_wsCache && now - _wsCacheAt < 2000) return _wsCache;
  const map = _loadWorkspacesFresh();
  _wsCache = map;
  _wsCacheAt = now;
  return map;
}

function _loadWorkspacesFresh() {
  const settings = loadSettings();
  const names = Array.isArray(settings.workspaces) ? settings.workspaces : [];
  const backupsRoot = settings.backups || path.join(ROOT, 'backups');

  const map = {};
  for (const name of names) {
    const wsSettings = loadYaml(path.join(CONFIG_DIR, `workspace.${name}.settings.yml`));
    const doc = wsSettings.doc || {};
    const dir = doc.path || path.join(ROOT, name);
    // The hardcoded table is the default; a workspace's own file overrides it, so a workspace
    // added to the tree can carry its icon and description without a code change — which is
    // otherwise the difference between a real card and a folder icon.
    const own = wsSettings.presentation || {};
    const pres = { ...(PRESENTATION[name] || { icon: 'folder', subtitle: name }), ...own };

    map[name] = {
      key: name,
      dir,
      backupsDir: path.join(backupsRoot, doc.name || name),
      icon: pres.icon,
      subtitle: pres.subtitle,
      label: pres.label || name.charAt(0).toUpperCase() + name.slice(1),
      noun: pres.noun || 'item',
      nounPlural: pres.plural || pres.nounPlural || `${pres.noun || 'item'}s`,
      kind: pres.kind || 'projects',
    };
  }
  return map;
}

// After a write to settings.yml the 2s memo would serve the OLD list for up to two seconds —
// long enough that a reordered card grid re-renders exactly as it was and the move looks lost.
function invalidateWorkspaces() {
  _wsCache = null;
  _wsCacheAt = 0;
}

function isValidWorkspace(name) {
  return Object.prototype.hasOwnProperty.call(loadWorkspaces(), name);
}

function workspaceDir(name) {
  const ws = loadWorkspaces()[name];
  return ws ? ws.dir : null;
}

// Discover which of a folder's cmd-*.sh scripts serve a given purpose, by filename
// convention, instead of hand-mapping every workspace to a fixed script name.
function findScript(dir, patterns) {
  let files = [];
  try {
    files = fs.readdirSync(dir);
  } catch (_) {
    return null;
  }
  for (const re of patterns) {
    const hit = files.find((f) => re.test(f));
    if (hit) return hit;
  }
  return null;
}

function findBackupScript(dir) {
  return findScript(dir, [/^cmd-tools?-backup-.*\.sh$/]);
}

function findSyncScript(dir) {
  return findScript(dir, [/^cmd-tools?-sync-.*\.sh$/]);
}

function findRemoveScript(dir) {
  return findScript(dir, [/^cmd-tools-remove\.sh$/]);
}

function findFilemodeScript(dir) {
  return findScript(dir, [/^cmd-tools?-git-change-filemode-to-false\.sh$/]);
}

function findBuilderScripts(dir) {
  let files = [];
  try {
    files = fs.readdirSync(dir);
  } catch (_) {
    return [];
  }
  return files
    .filter((f) => /^cmd-.*-project\.sh$/.test(f) && !/automated-testing|bulk-/.test(f))
    .sort();
}

// Human-readable label for a builder script: the `# workspace-name: ...`
// header near the top of the cmd-*.sh file, falling back to the filename.
function builderLabel(dir, script) {
  try {
    const head = fs.readFileSync(path.join(dir, script), 'utf8').slice(0, 500);
    const m = head.match(/^# workspace-name:\s*(.+)$/m);
    if (m) return m[1].trim();
  } catch (_) { /* fall through */ }
  return script;
}

// What a workspace currently holds: the project directories in it, and the archives beside it.
// Here rather than in server.js because both are facts about a workspace, and more than one
// module needs to ask.
function listProjects(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
      .map((e) => e.name);
  } catch (_) {
    return [];
  }
}

// A standalone database dump written by a project row's "Export the database". A project archive
// ships its own companion dump named `<archive>-db.sql.gz`, which belongs to that archive rather
// than being a backup in its own right — this pattern matches only the standalone ones, so an
// archive still appears as the single row it is.
const DB_DUMP_RE = /^[a-zA-Z0-9_-]+--db--[0-9-]+\.sql\.gz$/;

// Any .tar.gz is an archive. Deliberately not the stricter `<ws>---<item>--<stamp>` shape the
// restore and delete guards use: the docs and worklogs backups carry a `.md` in the item segment,
// and a listing that quietly dropped them would hide real backups.
function listBackups(key) {
  const meta = loadWorkspaces()[key];
  try {
    return fs.readdirSync(meta.backupsDir)
      .filter((f) => f.endsWith('.tar.gz') || DB_DUMP_RE.test(f))
      .map((f) => {
        const st = fs.statSync(path.join(meta.backupsDir, f));
        return { file: f, size: st.size, mtime: st.mtime, kind: DB_DUMP_RE.test(f) ? 'db' : 'project' };
      })
      .sort((a, b) => b.mtime - a.mtime);
  } catch (_) {
    return [];
  }
}

// A project's real DDEV name (from its .ddev/config.yaml), or null if it
// isn't a DDEV project. The name usually equals the folder name (the build
// scripts pass --project-name=<folder>), but not necessarily.
function ddevProjectName(projectDir) {
  try {
    const cfg = fs.readFileSync(path.join(projectDir, '.ddev', 'config.yaml'), 'utf8');
    const m = cfg.match(/^name:\s*(\S+)/m);
    return m ? m[1] : null;
  } catch (_) {
    return null;
  }
}

module.exports = {
  ddevProjectName,
  listProjects,
  listBackups,
  ROOT,
  hubDomain,
  styleSettings,
  assistantSettings,
  CONFIG_DIR,
  loadYaml,
  loadWorkspaces,
  invalidateWorkspaces,
  isValidWorkspace,
  workspaceDir,
  findBackupScript,
  findSyncScript,
  findRemoveScript,
  findFilemodeScript,
  findBuilderScripts,
  builderLabel,
};
