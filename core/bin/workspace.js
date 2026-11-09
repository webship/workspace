#!/usr/bin/env node
/**
 * webship-workspace — install and manage a Webship Workspace from npm.
 *
 *   webship-workspace init [dir]              make a workspace at dir (default ~/workspace): the core, an
 *                                             empty settings file, the dashboard installed and started
 *   webship-workspace plugin <verb> <name>    require | activate | install | configure | deactivate | uninstall | list
 *   webship-workspace catalog                 the plugins you can add, by family
 *   webship-workspace update [dir]            refresh the core of an existing workspace from this package
 *
 * The core ships empty: no workspace folders, no plugins. Everything is added later, one npm package
 * at a time, when you ask for it (`plugin require <name>` is `npm install @webship.co/workspace-<name>`
 * into the dashboard's package.json). The skeleton and the management stay in the core.
 *
 * Plain Node, no dependencies: this runs before anything is installed. Env for tests:
 *   WEBSHIP_WORKSPACE_SKIP_NPM=1   do not run npm install in the dashboard
 *   WEBSHIP_WORKSPACE_SKIP_DDEV=1  do not start the dashboard
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const PKG_ROOT = path.resolve(__dirname, '..', '..');   // the package: core/, README.md, LICENSE
const CORE_SRC = path.join(PKG_ROOT, 'core');

const say = (s) => process.stdout.write(`${s}\n`);
const fail = (s, code = 1) => { process.stderr.write(`${s}\n`); process.exit(code); };

function run(cmd, args, cwd, env = {}) {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', env: { ...process.env, ...env } });
  if (r.error) fail(`${cmd} could not be run: ${r.error.message}`);
  return r.status === 0;
}

/** Copy core/ into the workspace, skipping what belongs to a running install, never overwriting a settings file. */
function copyCore(dest) {
  const SKIP = new Set(['node_modules', 'actions.log', 'package-lock.json']);
  // This machine's own files are never copied from the package: settings.yml comes from the lean
  // template (once), workspace and plugin settings come with their plugins, the install record is local.
  const NEVER = /^core\/config\/(settings\.yml|workspace\..*\.settings\.yml|plugin\..*\.settings\.yml|plugins\.installed\.yml)$|^core\/workspace-app\/\.ddev\/config\.local\.yaml$/;
  const KEEP_IF_PRESENT = /^core\/config\/style\.yml$/;
  const walk = (src, rel) => {
    for (const e of fs.readdirSync(src, { withFileTypes: true })) {
      if (SKIP.has(e.name)) continue;
      const from = path.join(src, e.name);
      const relPath = path.join(rel, e.name);
      const to = path.join(dest, relPath);
      if (e.isDirectory()) { fs.mkdirSync(to, { recursive: true }); walk(from, relPath); continue; }
      if (NEVER.test(relPath)) continue;
      if (KEEP_IF_PRESENT.test(relPath) && fs.existsSync(to)) continue;
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
      fs.chmodSync(to, fs.statSync(from).mode & 0o777);
    }
  };
  walk(CORE_SRC, 'core');
  // The dashboard's version chip reads this file, never package.json (an installation is not the package).
  fs.writeFileSync(path.join(dest, 'core', 'workspace-app', '.app-version'), require(path.join(PKG_ROOT, 'package.json')).version + '\n');
  for (const f of ['README.md', 'LICENSE']) if (fs.existsSync(path.join(PKG_ROOT, f)) && !fs.existsSync(path.join(dest, f))) fs.copyFileSync(path.join(PKG_ROOT, f), path.join(dest, f));
}

/** settings.yml from the lean template: an empty workspaces list, no plugins, the placeholders to fill. */
function writeSettings(dest) {
  const file = path.join(dest, 'core', 'config', 'settings.yml');
  if (fs.existsSync(file)) return false;
  const template = path.join(CORE_SRC, 'config', 'settings.template.yml');
  fs.copyFileSync(template, file);
  fs.chmodSync(file, 0o600);
  return true;
}

function catalogText() {
  const { FAMILIES, SCOPE } = require(path.join(CORE_SRC, 'workspace-app', 'plugin-catalog.js'));
  const lines = ['What you can add (one npm package each; nothing is installed until you ask):', ''];
  for (const f of FAMILIES) {
    lines.push(`${f.label} — ${f.about}`);
    for (const [name, label] of f.plugins) lines.push(`  ${name.padEnd(24)} ${label}   (${SCOPE}/workspace-${name})`);
    lines.push('');
  }
  lines.push('Add one:  webship-workspace plugin require <name>   then activate, install, configure — or Settings → Plugins in the dashboard.');
  return lines.join('\n');
}

function init(dirArg, { update = false } = {}) {
  const dest = path.resolve(dirArg || process.env.WEBSHIP_WORKSPACE_DIR || path.join(os.homedir(), 'workspace'));
  fs.mkdirSync(dest, { recursive: true });
  say(`${update ? 'Updating' : 'Making'} the Webship Workspace at ${dest}`);
  copyCore(dest);
  const wroteSettings = writeSettings(dest);
  say(wroteSettings ? '  core/config/settings.yml written (empty: no workspaces, no plugins yet)' : '  core/config/settings.yml kept as it is');
  const app = path.join(dest, 'core', 'workspace-app');
  if (!process.env.WEBSHIP_WORKSPACE_SKIP_NPM) {
    say('  installing the dashboard (npm install in core/workspace-app)…');
    if (!run('npm', ['install', '--no-audit', '--no-fund'], app)) fail('npm install failed in core/workspace-app.');
  }
  if (!process.env.WEBSHIP_WORKSPACE_SKIP_DDEV) {
    const ddev = spawnSync('ddev', ['--version'], { encoding: 'utf8' });
    if (ddev.error || ddev.status !== 0) {
      say('  DDEV is not installed: the dashboard runs in a DDEV project. Install it (https://ddev.readthedocs.io) and run:  webship-workspace init ' + (dirArg || ''));
    } else {
      say('  starting the dashboard (ddev start in core/workspace-app)…');
      run('ddev', ['start', '-y'], app);
    }
  }
  say('');
  say(`Done. The dashboard: https://workspace.ddev.site   (the tooling: ${dest}/core/scripts)`);
  say('');
  say(catalogText());
}

function plugin(verb, name) {
  const verbs = ['require', 'activate', 'install', 'configure', 'deactivate', 'uninstall', 'list', 'restart'];
  if (!verbs.includes(verb)) fail(`plugin <${verbs.join('|')}> [name]`);
  const root = process.env.WORKSPACE_ROOT || path.resolve(process.env.WEBSHIP_WORKSPACE_DIR || path.join(os.homedir(), 'workspace'));
  const script = path.join(root, 'core', 'scripts', 'plugins.sh');
  if (!fs.existsSync(script)) fail(`No workspace at ${root} (core/scripts/plugins.sh is missing). Run: webship-workspace init`);
  // A bare name means the npm package of that name: `plugin require git` is `npm install @webship.co/workspace-git`.
  const spec = verb === 'require' && name && !/[@:/]/.test(name) ? `@webship.co/workspace-${name}` : name;
  const args = [script, `--${verb}`];
  if (spec) args.push(spec);
  process.exit(run('bash', args, root) ? 0 : 1);
}

const [cmd, ...rest] = process.argv.slice(2);
switch (cmd) {
  case 'init': init(rest[0]); break;
  case 'update': init(rest[0], { update: true }); break;
  case 'plugin': plugin(rest[0], rest[1]); break;
  case 'catalog': say(catalogText()); break;
  default:
    say(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 14).map((l) => l.replace(/^ \* ?/, '')).join('\n'));
    process.exit(cmd ? 1 : 0);
}
