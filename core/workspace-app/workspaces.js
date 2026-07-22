const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const CONFIG_DIR = process.env.WEBSHIP_WORKSPACE_CONFIG || path.join(process.env.HOME, 'workspace/core/config');
const ROOT = process.env.WEBSHIP_WORKSPACE_ROOT || path.join(process.env.HOME, 'workspace');

// Presentational-only (icon/subtitle) — everything functional (paths, script names,
// which workspaces exist) is read live from settings.yml / workspace.<name>.settings.yml
// and the filesystem, so a new workspace added there shows up with no code change.
// `icon` is a UIKit icon name (https://getuikit.com/docs/icon), rendered
// with the vendored uikit-icons.min.js.
// `noun` is what one item in the folder is called (only real projects are
// "projects"); `plural` overrides irregular plurals.
const PRESENTATION = {
  products:   { icon: 'cart',        subtitle: 'Internal & External Products', noun: 'product' },
  dev:        { icon: 'code',        subtitle: 'Development Projects', noun: 'project' },
  test:       { icon: 'check',       subtitle: 'Testing Environment', noun: 'project' },
  demos:      { icon: 'desktop',     subtitle: 'Demo Sites', noun: 'demo' },
  sandboxes:  { icon: 'future',      subtitle: 'Experimental Projects', noun: 'sandbox', plural: 'sandboxes' },
  projects:   { icon: 'folder',      subtitle: 'Client Projects', noun: 'project' },
  profiles:   { icon: 'world',       subtitle: 'Distros', noun: 'profile' },
  themes:     { icon: 'paint-bucket', subtitle: 'Contrib & Private Themes', noun: 'theme' },
  modules:    { icon: 'grid',        subtitle: 'Contrib & Private Modules', noun: 'module' },
  libraries:  { icon: 'album',       subtitle: 'Third-Party Libraries', noun: 'library', plural: 'libraries' },
  forked:     { icon: 'git-branch',  subtitle: 'Forked / Customized Copies', noun: 'fork' },
  docs:       { icon: 'file-text',   subtitle: 'Documentation Projects', noun: 'doc', kind: 'files' },
  agents:     { icon: 'happy',       subtitle: 'AI Automation', label: 'AI Agents', noun: 'agent', kind: 'files' },
  skills:     { icon: 'star',        subtitle: 'AI Skill Definitions', label: 'AI Skills', noun: 'skill', kind: 'files' },
  prompts:    { icon: 'pencil',      subtitle: 'Reusable AI Prompts', noun: 'prompt', kind: 'files' },
  recipes:    { icon: 'list',        subtitle: 'Development Recipes', noun: 'recipe' },
  components: { icon: 'thumbnails',  subtitle: 'SDC, React, Canvas Code, HTMX & Web Components', noun: 'component' },
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
    const database = wsSettings.database || {};
    const dir = doc.path || path.join(ROOT, name);
    const pres = PRESENTATION[name] || { icon: 'folder', subtitle: name };

    map[name] = {
      key: name,
      dir,
      dbPrefix: database.prefix || `${name}_`,
      backupsDir: path.join(backupsRoot, doc.name || name),
      icon: pres.icon,
      subtitle: pres.subtitle,
      label: pres.label || name.charAt(0).toUpperCase() + name.slice(1),
      noun: pres.noun || 'item',
      nounPlural: pres.plural || `${pres.noun || 'item'}s`,
      kind: pres.kind || 'projects',
    };
  }
  return map;
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

module.exports = {
  ROOT,
  hubDomain,
  CONFIG_DIR,
  loadWorkspaces,
  isValidWorkspace,
  workspaceDir,
  findBackupScript,
  findRemoveScript,
  findFilemodeScript,
  findBuilderScripts,
  builderLabel,
};
