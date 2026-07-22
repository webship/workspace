const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const CONFIG_DIR = process.env.WEBSHIP_WORKSPACE_CONFIG || path.join(process.env.HOME, 'workspace/core/config');
const ROOT = process.env.WEBSHIP_WORKSPACE_ROOT || path.join(process.env.HOME, 'workspace');

// Presentational-only (icon/subtitle) — everything functional (paths, script names,
// which workspaces exist) is read live from settings.yml / workspace.<name>.settings.yml
// and the filesystem, so a new workspace added there shows up with no code change.
const PRESENTATION = {
  products:   { icon: '📦', subtitle: 'Internal & External Products' },
  dev:        { icon: '💻', subtitle: 'Development Projects' },
  test:       { icon: '🧪', subtitle: 'Testing Environment' },
  demos:      { icon: '🖥️', subtitle: 'Demo Sites' },
  sandboxes:  { icon: '🎲', subtitle: 'Experimental Projects' },
  projects:   { icon: '📁', subtitle: 'Client Projects' },
  profiles:   { icon: '🌐', subtitle: 'Distros' },
  themes:     { icon: '🎨', subtitle: 'Drupal Themes' },
  modules:    { icon: '🧩', subtitle: 'Drupal Modules' },
  libraries:  { icon: '📚', subtitle: 'Third-Party Libraries' },
  forked:     { icon: '🍴', subtitle: 'Forked / Customized Copies' },
  docs:       { icon: '📄', subtitle: 'Documentation Projects' },
  agents:     { icon: '🤖', subtitle: 'AI Automation' },
  skills:     { icon: '🧠', subtitle: 'AI Skill Definitions' },
  recipes:    { icon: '📖', subtitle: 'Development Recipes' },
  components: { icon: '🧱', subtitle: 'Reusable Components' },
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

// Rebuilt on every call — cheap (a handful of small YAML files) and always fresh,
// so adding a workspace to settings.yml is picked up without restarting the server.
function loadWorkspaces() {
  const settings = loadSettings();
  const names = Array.isArray(settings.workspaces) ? settings.workspaces : [];
  const backupsRoot = settings.backups || path.join(ROOT, 'backups');

  const map = {};
  for (const name of names) {
    const wsSettings = loadYaml(path.join(CONFIG_DIR, `workspace.${name}.settings.yml`));
    const doc = wsSettings.doc || {};
    const database = wsSettings.database || {};
    const dir = doc.path || path.join(ROOT, name);
    const pres = PRESENTATION[name] || { icon: '📂', subtitle: name };

    map[name] = {
      key: name,
      dir,
      dbPrefix: database.prefix || `${name}_`,
      backupsDir: path.join(backupsRoot, doc.name || name),
      icon: pres.icon,
      subtitle: pres.subtitle,
      label: name.charAt(0).toUpperCase() + name.slice(1),
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

module.exports = {
  ROOT,
  CONFIG_DIR,
  loadWorkspaces,
  isValidWorkspace,
  workspaceDir,
  findBackupScript,
  findRemoveScript,
  findFilemodeScript,
  findBuilderScripts,
};
