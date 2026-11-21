#!/usr/bin/env node
/**
 * webship-workspace — install and manage a Webship Workspace from npm.
 *
 *   webship-workspace init [dir]              make a workspace at dir (default ~/workspace): the core, an
 *                                             empty settings file, the dashboard installed and started
 *   webship-workspace plugin <verb> <name>    require | activate | install | configure | deactivate | uninstall | remove | list | check
 *                                             add --with-needs to require, activate or install and the plugins
 *                                             it needs are added first, in the same run
 *   webship-workspace catalog                 the plugins you can add, by family
 *   webship-workspace doctor [dir]            the commands the core and the plugins need on this machine: found,
 *                                             with the version, or missing, with how to install it (it installs nothing)
 *   webship-workspace update [dir]            refresh the core of an existing workspace from this package
 *
 * plugin, doctor and update are about the workspace you are standing in (or WORKSPACE_ROOT, or the dir
 * you name); ~/workspace when you are in none.
 *
 * The core ships empty: no workspace folders, no plugins. Everything is added later, one npm package
 * at a time, when you ask for it (`plugin require <name>` is `npm install @webship.co/workspace-<name>`
 * into the dashboard's package.json). The skeleton and the management stay in the core.
 *
 * Plain Node, no dependencies: this runs before anything is installed. Env for tests:
 *   WEBSHIP_WORKSPACE_SKIP_NPM=1   do not run npm install in the dashboard
 *   WEBSHIP_WORKSPACE_SKIP_DDEV=1  do not start the dashboard
 */

const crypto = require('crypto');
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

const APP_PACKAGE = path.join('core', 'workspace-app', 'package.json');

const isWorkspace = (dir) => fs.existsSync(path.join(dir, 'core', 'scripts', 'plugins.sh'));

/**
 * The workspace a command is about: the folder that was named, else WORKSPACE_ROOT, else
 * WEBSHIP_WORKSPACE_DIR, else the workspace this command is run in (the folder it stands in or one
 * above it), else ~/workspace. Someone standing in ~/sites/acme-workspace means that one, never another.
 */
function workspaceRoot(dirArg) {
  if (dirArg) return path.resolve(dirArg);
  if (process.env.WORKSPACE_ROOT) return path.resolve(process.env.WORKSPACE_ROOT);
  if (process.env.WEBSHIP_WORKSPACE_DIR) return path.resolve(process.env.WEBSHIP_WORKSPACE_DIR);
  for (let dir = process.cwd(); ; dir = path.dirname(dir)) {
    if (isWorkspace(dir)) return dir;
    if (path.dirname(dir) === dir) break;
  }
  return path.join(os.homedir(), 'workspace');
}

/**
 * The dashboard's package.json after an update: the package's own, plus every dependency the
 * workspace's copy has that the package's does not (the plugins required here, whatever their source:
 * an npm range, github:owner/repo, a path). A dependency the core itself names takes the core's version.
 */
function mergeAppPackage(from, to) {
  const next = JSON.parse(fs.readFileSync(from, 'utf8'));
  let mine = {};
  try { mine = JSON.parse(fs.readFileSync(to, 'utf8')); } catch (_) { return `${JSON.stringify(next, null, 2)}\n`; }
  const named = new Set([...Object.keys(next.dependencies || {}), ...Object.keys(next.devDependencies || {})]);
  for (const field of ['dependencies', 'devDependencies']) {
    for (const [name, spec] of Object.entries(mine[field] || {})) {
      if (named.has(name)) continue;
      next[field] = { ...(next[field] || {}), [name]: spec };
    }
  }
  return `${JSON.stringify(next, null, 2)}\n`;
}

// The dashboard's .ddev/ files that carry this machine's own values over the release's placeholders.
const DDEV_DIR = path.join('core', 'workspace-app', '.ddev');
const DDEV_CONFIG = path.join(DDEV_DIR, 'config.yaml');
const DDEV_DOCKERFILE = path.join(DDEV_DIR, 'web-build', 'Dockerfile.workspace-app');
const DDEV_DOOD = path.join(DDEV_DIR, 'docker-compose.dood.yaml');

/** This machine's dashboard, read before an update copies the release's .ddev/ over it. */
function readMachineDashboard(dest) {
  const read = (rel) => { try { return fs.readFileSync(path.join(dest, rel), 'utf8'); } catch (_) { return null; } };
  return { config: read(DDEV_CONFIG), dockerfile: read(DDEV_DOCKERFILE), dood: read(DDEV_DOOD) };
}

/**
 * Put this machine's own values back into the dashboard's .ddev/ after an update copied the release's
 * (#406): the DDEV project's identity (a second workspace on a machine has its own name, the hostnames
 * built from it, its own fqdns and router ports, which core/workspace-app/scripts/update.sh has always
 * kept) and the docker group GID that core/scripts/docker-gid.sh wrote for this host (the release ships
 * placeholders; with them every ddev command inside the dashboard fails after its next restart).
 * Answers what it kept, in words.
 */
function keepMachineDashboard(dest, old) {
  const kept = [];
  const file = (rel) => path.join(dest, rel);
  const line = (text, re) => { const m = String(text || '').match(re); return m ? m[0] : ''; };
  if (old.config && fs.existsSync(file(DDEV_CONFIG))) {
    let text = fs.readFileSync(file(DDEV_CONFIG), 'utf8');
    const was = (re) => line(old.config, re);
    const mine = (was(/^name:.*$/m).match(/^name:\s*(\S+)/) || [])[1] || '';
    const shipped = (line(text, /^name:.*$/m).match(/^name:\s*(\S+)/) || [])[1] || '';
    if (mine && shipped && mine !== shipped) {
      text = text.replace(/^name:.*$/m, `name: ${mine}`);
      // The hostnames are patterns built from the name (*.dev.<name>): renamed with it, or this checkout
      // would answer on the other one's domains.
      const esc = shipped.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      text = text.replace(new RegExp(`^(- "\\*\\..*?)${esc}"$`, 'gm'), `$1${mine}"`);
      kept.push(`the DDEV project name ${mine} (and the hostnames built from it)`);
    }
    for (const key of ['additional_fqdns', 'router_http_port', 'router_https_port']) {
      const re = new RegExp(`^${key}:.*$`, 'm');
      const before = was(re);
      if (before && before !== line(text, re)) {
        text = re.test(text) ? text.replace(re, before) : `${text.replace(/\n*$/, '\n')}${before}\n`;
        kept.push(before.replace(/:\s*/, ' '));
      }
    }
    fs.writeFileSync(file(DDEV_CONFIG), text);
  }
  const gidOf = (text) => (String(text || '').match(/groupmod -g (\d+) docker/) || [])[1] || '';
  const mineGid = gidOf(old.dockerfile);
  if (mineGid && fs.existsSync(file(DDEV_DOCKERFILE))) {
    const text = fs.readFileSync(file(DDEV_DOCKERFILE), 'utf8');
    const shippedGid = gidOf(text);
    if (shippedGid && shippedGid !== mineGid) {
      fs.writeFileSync(file(DDEV_DOCKERFILE), text.replace(/groupmod -g \d+ docker/g, `groupmod -g ${mineGid} docker`)
        .replace(/groupadd -g \d+ docker/g, `groupadd -g ${mineGid} docker`).replace(/usermod -g \d+ \$username/g, `usermod -g ${mineGid} $username`));
      kept.push(`the docker GID ${mineGid}`);
    }
  }
  const grantedOf = (text) => (String(text || '').match(/group_add:\s*\n\s*-\s*"(\d+)"/) || [])[1] || '';
  const mineGranted = grantedOf(old.dood);
  if (mineGranted && fs.existsSync(file(DDEV_DOOD))) {
    const text = fs.readFileSync(file(DDEV_DOOD), 'utf8');
    const shippedGranted = grantedOf(text);
    if (shippedGranted && shippedGranted !== mineGranted) {
      fs.writeFileSync(file(DDEV_DOOD), text.replace(/(group_add:\s*\n\s*-\s*)"\d+"/, `$1"${mineGranted}"`));
      if (!kept.some((k) => k.startsWith('the docker GID'))) kept.push(`the docker GID ${mineGranted}`);
    }
  }
  return kept;
}

// What the last init or update copied from the package, with the sha256 of each file: the next update
// removes what that release shipped and this one does not, while it is still as shipped (#407).
const SHIPPED = path.join('core', '.shipped-files');
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** The record of the last copy: { path: sha256 }, or null for a workspace made before the record existed. */
function readShipped(dest) {
  try {
    const out = {};
    for (const line of fs.readFileSync(path.join(dest, SHIPPED), 'utf8').split('\n')) {
      const m = line.match(/^([0-9a-f]{64}) {2}(.+)$/);
      if (m) out[m[2]] = m[1];
    }
    return out;
  } catch (_) { return null; }
}

/**
 * Remove what an earlier release shipped and this one does not (#407): from the record of the last copy,
 * and, for a workspace made before that record, from dropped-files.json (each file 1.0.0 to 1.0.18 shipped
 * and a later release dropped, with the hash of every released copy). A file is removed only while it is
 * exactly as shipped, never when the new package ships it again, never when a plugin's install record
 * claims it; a changed one stays and is named. Answers what to say.
 */
function removeDropped(dest, before, packaged) {
  const known = {};
  for (const [p, h] of Object.entries(before || {})) (known[p] = known[p] || new Set()).add(h);
  try {
    for (const [p, e] of Object.entries(JSON.parse(fs.readFileSync(path.join(CORE_SRC, 'bin', 'dropped-files.json'), 'utf8')))) {
      for (const h of e.sha256 || []) (known[p] = known[p] || new Set()).add(h);
    }
  } catch (_) { /* a package without the list */ }
  let record = '';
  try { record = fs.readFileSync(path.join(dest, 'core', 'config', 'plugins.installed.yml'), 'utf8'); } catch (_) { /* no plugin installed */ }
  const claimed = (p) => new RegExp(`^\\s*-\\s*['"]?${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]?\\s*$`, 'm').test(record);
  const removed = [];
  const said = [];
  for (const [p, hashes] of Object.entries(known)) {
    const file = path.join(dest, p);
    if (packaged.has(p) || !fs.existsSync(file) || !fs.statSync(file).isFile() || claimed(p)) continue;
    if (!hashes.has(sha256(file))) { said.push(`  kept ${p}: this release no longer ships it, and it was changed here`); continue; }
    fs.rmSync(file);
    removed.push(p);
    // Its folder too when that leaves it empty, never one the package ships or one plugins place into.
    for (let dir = path.dirname(file); ; dir = path.dirname(dir)) {
      const rel = path.relative(dest, dir);
      if (!rel || rel === 'core' || /^core\/(scripts\/plugins|workspace-app\/tests\/features\/plugins)$/.test(rel) || fs.existsSync(path.join(CORE_SRC, path.relative('core', rel)))) break;
      try { fs.rmdirSync(dir); } catch (_) { break; }
    }
  }
  if (removed.length) said.unshift(`  removed ${removed.length} file(s) an earlier release shipped and this one does not: ${removed.slice(0, 4).join(', ')}${removed.length > 4 ? ', …' : ''}`);
  return said;
}

/** Copy core/ into the workspace, skipping what belongs to a running install, never overwriting a settings file. */
function copyCore(dest) {
  const SKIP = new Set(['node_modules', 'actions.log', 'package-lock.json']);
  // This machine's own files are never copied from the package: settings.yml comes from the lean
  // template (once), workspace and plugin settings come with their plugins, the install record is local.
  const NEVER = /^core\/config\/(settings\.yml|workspace\..*\.settings\.yml|plugin\..*\.settings\.yml|plugins\.installed\.yml)$|^core\/workspace-app\/\.ddev\/config\.local\.yaml$/;
  const KEEP_IF_PRESENT = /^core\/config\/style\.yml$/;
  // shipped: what follows the package and was copied as it is (the record); packaged: every file the package
  // has, whatever this copy did with it (kept, merged, never copied) — nothing in it is ever removed.
  const shipped = new Map();
  const packaged = new Set();
  const walk = (src, rel) => {
    for (const e of fs.readdirSync(src, { withFileTypes: true })) {
      if (SKIP.has(e.name)) continue;
      const from = path.join(src, e.name);
      const relPath = path.join(rel, e.name);
      const to = path.join(dest, relPath);
      if (e.isDirectory()) { fs.mkdirSync(to, { recursive: true }); walk(from, relPath); continue; }
      packaged.add(relPath.split(path.sep).join('/'));
      if (NEVER.test(relPath)) continue;
      if (KEEP_IF_PRESENT.test(relPath)) { if (!fs.existsSync(to)) { fs.copyFileSync(from, to); fs.chmodSync(to, fs.statSync(from).mode & 0o777); } continue; }
      fs.mkdirSync(path.dirname(to), { recursive: true });
      // The dashboard's package.json is the core's AND this machine's: `plugin require` wrote the
      // plugins a person added into it. An update takes the core's file and keeps what was added.
      if (relPath === APP_PACKAGE && fs.existsSync(to)) { fs.writeFileSync(to, mergeAppPackage(from, to)); continue; }
      fs.copyFileSync(from, to);
      fs.chmodSync(to, fs.statSync(from).mode & 0o777);
      shipped.set(relPath.split(path.sep).join('/'), sha256(from));
    }
  };
  walk(CORE_SRC, 'core');
  // The dashboard's version chip reads this file, never package.json (an installation is not the package).
  fs.writeFileSync(path.join(dest, 'core', 'workspace-app', '.app-version'), require(path.join(PKG_ROOT, 'package.json')).version + '\n');
  for (const f of ['README.md', 'LICENSE']) if (fs.existsSync(path.join(PKG_ROOT, f)) && !fs.existsSync(path.join(dest, f))) fs.copyFileSync(path.join(PKG_ROOT, f), path.join(dest, f));
  // commands/ is the base's own folder: the dashboard's "Run a tool" and the Commands page call
  // commands/cmd-tools-commands.sh. Its cmd-*.sh are the base's and follow the package; the other
  // files there (README, the notes for AI CLIs) are written once and then left to the person.
  const cmdSrc = path.join(PKG_ROOT, 'commands');
  if (fs.existsSync(cmdSrc)) {
    const cmdDest = path.join(dest, 'commands');
    fs.mkdirSync(cmdDest, { recursive: true });
    for (const e of fs.readdirSync(cmdSrc, { withFileTypes: true })) {
      if (!e.isFile()) continue;
      const to = path.join(cmdDest, e.name);
      const own = /^cmd-.*\.sh$/.test(e.name);
      packaged.add(`commands/${e.name}`);
      if (!own && fs.existsSync(to)) continue;
      fs.copyFileSync(path.join(cmdSrc, e.name), to);
      if (own) { fs.chmodSync(to, 0o755); shipped.set(`commands/${e.name}`, sha256(path.join(cmdSrc, e.name))); }
    }
  }
  return { shipped, packaged };
}

/** Write the record of what this copy shipped. */
function writeShipped(dest, shipped) {
  const lines = [...shipped.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([p, h]) => `${h}  ${p}`);
  fs.writeFileSync(path.join(dest, SHIPPED), `${lines.join('\n')}\n`);
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
    for (const [name, label, summary] of f.plugins) lines.push(`  ${name.padEnd(24)} ${label}: ${summary}   (${SCOPE}/workspace-${name})`);
    lines.push('');
  }
  lines.push('Add one:  webship-workspace plugin require <name>   then activate, install, configure — or Settings → Add a plugin in the dashboard.');
  lines.push('A plugin that needs another one says so when you require it; add --with-needs to activate and what it needs is added first.');
  return lines.join('\n');
}

/**
 * The commands the core needs on this machine (core/scripts/needs.json), and those of the plugins of the
 * workspace at `root` when its dashboard is installed. Reports; installs nothing. True when nothing needed is missing.
 */
function doctor(root, { only = 'all', quiet = false } = {}) {
  const here = root && fs.existsSync(path.join(root, 'core', 'workspace-app', 'command-check.js'));
  const check = require(here ? path.join(root, 'core', 'workspace-app', 'command-check.js') : path.join(CORE_SRC, 'workspace-app', 'command-check.js'));
  const reports = [check.checkCore()];
  if (only === 'all' && !here && !quiet) say(`No workspace at ${root}: the commands the core needs are listed, no plugin was looked at. Name the folder (webship-workspace doctor <dir>) or run it from inside the workspace.\n`);
  if (only === 'all' && here) { try { reports.push(...check.checkPlugins()); } catch (_) { /* the dashboard is not installed yet: the core alone */ } }
  if (quiet) {
    const text = check.missingText(reports);
    if (text) { say('  commands this machine does not have (nothing is installed for you; `webship-workspace doctor` lists them all):'); say(text.split('\n').map((l) => `  ${l}`).join('\n')); }
  } else {
    say(check.reportText(reports));
  }
  return check.missingNeeded(reports).length === 0;
}

function init(dirArg, { update = false } = {}) {
  // init makes the folder it is given (or ~/workspace); update is about a workspace that exists.
  const dest = update ? workspaceRoot(dirArg) : path.resolve(dirArg || process.env.WEBSHIP_WORKSPACE_DIR || path.join(os.homedir(), 'workspace'));
  if (update && !isWorkspace(dest)) fail(`No workspace at ${dest}: nothing to update. Make one with:  webship-workspace init ${dirArg || ''}`.trimEnd());
  fs.mkdirSync(dest, { recursive: true });
  say(`${update ? 'Updating' : 'Making'} the Webship Workspace at ${dest}`);
  // Said before anything starts: what the core calls and this machine does not have.
  doctor(null, { only: 'core', quiet: true });
  const machine = update ? readMachineDashboard(dest) : null;
  const shippedBefore = update ? readShipped(dest) : null;
  const { shipped, packaged } = copyCore(dest);
  if (machine) {
    const kept = keepMachineDashboard(dest, machine);
    if (kept.length) say(`  kept this machine's dashboard: ${kept.join(', ')}`);
    // Whether that GID is still this host's: said only when it is not.
    if (fs.existsSync(path.join(dest, 'core', 'scripts', 'docker-gid.sh'))) {
      const gid = spawnSync('bash', [path.join(dest, 'core', 'scripts', 'docker-gid.sh'), '--check', '--quiet'], { encoding: 'utf8' });
      if (gid.status === 1 && /dashboard docker GID is/.test(gid.stdout || '')) say(String(gid.stdout).replace(/\n$/, ''));
    }
  }
  if (update) for (const line of removeDropped(dest, shippedBefore, packaged)) say(line);
  writeShipped(dest, shipped);
  const wroteSettings = writeSettings(dest);
  say(wroteSettings ? '  core/config/settings.yml written (empty: no workspaces, no plugins yet)' : '  core/config/settings.yml kept as it is');
  const app = path.join(dest, 'core', 'workspace-app');
  if (!process.env.WEBSHIP_WORKSPACE_SKIP_NPM) {
    say('  installing the dashboard (npm install in core/workspace-app)…');
    if (!run('npm', ['install', '--no-audit', '--no-fund'], app)) fail('npm install failed in core/workspace-app.');
    // The packages the plugins share (a family's base): npm install keeps the copy the lock file holds while it still
    // fits, so an update brings them to the newest version that fits (#650).
    if (update) {
      let shared = [];
      try { shared = require(path.join(app, 'shared-packages.js')).sharedPackages(app); } catch (_) { shared = []; }
      if (shared.length) {
        say(`  updating what the plugins share: ${shared.join(' ')}`);
        if (!run('npm', ['update', '--no-audit', '--no-fund', ...shared], app)) say('  npm could not update them; the plugins keep the versions they have.');
      }
    }
  }
  // Damage an earlier release did to settings.yml is repaired here, and said (settings-repair.js): the file
  // itself is never replaced, and what was repaired is kept as it was.
  if (update && fs.existsSync(path.join(app, 'node_modules', 'js-yaml'))) {
    const repaired = spawnSync(process.execPath, ['settings-repair.js'], { cwd: app, encoding: 'utf8', env: { ...process.env, WORKSPACE_ROOT: dest } });
    for (const line of String(repaired.stdout || '').split('\n').filter((l) => l.trim())) say(`  ${line}`);
  }
  // The plugins are still the versions that placed their files: note how those shipped each file, so the
  // first plugin update after this one keeps a file a person changed (records from 1.0.15 and earlier lack it).
  if (update && fs.existsSync(path.join(app, 'node_modules', 'js-yaml'))) {
    const noted = spawnSync(process.execPath, ['plugin-install.js', 'remember'], { cwd: app, encoding: 'utf8', env: { ...process.env, WORKSPACE_ROOT: dest } });
    const n = noted.status === 0 ? noted.stdout.split('\n').filter((l) => l.trim()).length : 0;
    if (n) say(`  noted how the installed version of ${n} plugin(s) shipped what it placed: a file you changed is kept when the plugin is updated`);
  }
  // What the last line may say: the address only when the dashboard was really started.
  let dashboard = 'skipped';
  if (!process.env.WEBSHIP_WORKSPACE_SKIP_DDEV) {
    const ddev = spawnSync('ddev', ['--version'], { encoding: 'utf8' });
    if (ddev.error || ddev.status !== 0) {
      dashboard = 'no-ddev';
      say('  DDEV is not installed: the dashboard runs in a DDEV project. Install it (https://ddev.readthedocs.io) and run:  webship-workspace init ' + (dirArg || ''));
    } else {
      say('  starting the dashboard (ddev start in core/workspace-app)…');
      dashboard = run('ddev', ['start', '-y'], app) ? 'started' : 'failed';
    }
  }
  // An update leaves a running dashboard on the version it holds in memory (ddev start does not restart a
  // running app): it is restarted when it serves this workspace, by the rule a plugin step uses (#408).
  let restart = '';
  if (update && fs.existsSync(path.join(dest, 'core', 'scripts', 'plugins.sh'))) {
    const r = spawnSync('bash', [path.join(dest, 'core', 'scripts', 'plugins.sh'), '--restart'], { cwd: dest, encoding: 'utf8', env: { ...process.env, WORKSPACE_ROOT: dest } });
    restart = String(r.stdout || '').trim();
  }
  // The host screen runner keeps the code it was started with: one this release changed is restarted when it runs
  // (the sessions keep running), so it does what this dashboard asks of it. An older runner refuses what it does not know.
  if (update) {
    const runnerFiles = ['scripts/screen-runner.js', 'host-processes.js', 'waiting.js', 'session-env.js'].map((f) => `core/workspace-app/${f}`);
    const host = path.join(app, 'scripts', 'screen-host.sh');
    if (fs.existsSync(host) && (!shippedBefore || runnerFiles.some((f) => shippedBefore[f] !== shipped.get(f)))) {
      const status = spawnSync('bash', [host, '--status'], { encoding: 'utf8' });
      if (/^Running/m.test(String(status.stdout || ''))) {
        const r = spawnSync('bash', [host, '--restart'], { encoding: 'utf8' });
        say(r.status === 0 ? '  restarted the screen runner, which this release changed (the sessions keep running)'
          : `  the screen runner did not restart:  bash ${host} --restart`);
      }
    }
  }
  // A changed .ddev/ takes effect when the dashboard's container is made new, which `ddev start` does not do to a running
  // one. And not with `ddev restart`: a container made from an older release's config shares the machine's process
  // space, and DDEV ends it with `kill -- -1`, which from there reaches the other containers' processes (#564).
  let ddevNote = '';
  if (update && (!shippedBefore || [...shipped.keys()].some((p) => p.startsWith('core/workspace-app/.ddev/') && shippedBefore[p] !== shipped.get(p)))) {
    let name = 'workspace';
    try { name = (fs.readFileSync(path.join(app, '.ddev', 'config.yaml'), 'utf8').match(/^name:\s*(\S+)/m) || [])[1] || name; } catch (_) { /* the default */ }
    ddevNote = `.ddev/ changed in this release. If the dashboard was running, restart it this way to take it (not ddev restart):  docker kill ddev-${name}-web && cd ${app} && ddev start`;
  }
  say('');
  const start = `cd ${app} && ddev start`;
  if (update) {
    const version = require(path.join(PKG_ROOT, 'package.json')).version;
    say(`Updated the workspace at ${dest} to ${version}.`);
    if (dashboard === 'failed') say(`The dashboard did not start: read what ddev said above, then:  ${start}`);
    else if (process.env.WORKSPACE_PLUGINS_NO_RESTART) say(`The dashboard was not restarted (WORKSPACE_PLUGINS_NO_RESTART is set). It runs ${version} once it is restarted:  cd ${app} && ddev restart`);
    else if (/\bstarted\b/.test(restart) && !/not running|another workspace/.test(restart)) say(`The dashboard was restarted: it runs ${version} now.`);
    else if (restart) say(restart);
    if (ddevNote) say(ddevNote);
  } else if (dashboard === 'started') say(`Done. The dashboard: https://workspace.ddev.site   (the tooling: ${dest}/core/scripts)`);
  else if (dashboard === 'failed') say(`The workspace is at ${dest}, but the dashboard did not start: read what ddev said above, then:  ${start}`);
  else if (dashboard === 'no-ddev') say(`The workspace is at ${dest}. The dashboard is not started: DDEV is missing. Once it is installed:  ${start}   (then https://workspace.ddev.site)`);
  else say(`Done. The workspace is at ${dest}. The dashboard was not started (WEBSHIP_WORKSPACE_SKIP_DDEV is set); start it with:  ${start}   (then https://workspace.ddev.site)`);
  say('');
  say(catalogText());
  // A dashboard that was asked for and did not come up is a failure a script must be able to see.
  if (dashboard === 'failed') process.exitCode = 1;
}

function plugin(verb, name, flags = []) {
  const verbs = ['require', 'activate', 'install', 'configure', 'deactivate', 'uninstall', 'remove', 'list', 'check', 'restart'];
  const usage = `webship-workspace plugin <${verbs.join('|')}> [name] [--with-needs]`;
  if (verb === 'help' || verb === '--help' || verb === '-h') { say(usage); return; }
  if (!verb) fail(`Which step? ${usage}`);
  if (!verbs.includes(verb)) fail(`webship-workspace plugin: there is no "${verb}" step.\n${usage}`);
  const root = workspaceRoot();
  const script = path.join(root, 'core', 'scripts', 'plugins.sh');
  if (!fs.existsSync(script)) fail(`No workspace at ${root} (core/scripts/plugins.sh is missing). Run it from inside your workspace, or make one: webship-workspace init`);
  // A bare name means the npm package of that name: `plugin require git` is `npm install @webship.co/workspace-git`.
  const spec = verb === 'require' && name && !/[@:/]/.test(name) ? `@webship.co/workspace-${name}` : name;
  const args = [script, `--${verb}`];
  if (spec) args.push(spec);
  // The flags plugins.sh knows, passed as they are (--with-needs).
  args.push(...flags.filter((f) => f === '--with-needs'));
  // The script works on the workspace it is in unless WORKSPACE_ROOT says otherwise: say which one was found.
  process.exit(run('bash', args, root, { WORKSPACE_ROOT: root }) ? 0 : 1);
}

/** The usage text: the header of this file, so the two never drift apart. */
function helpText() {
  return fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 21).map((l) => l.replace(/^ \* ?/, '')).join('\n');
}

const [cmd, ...rest] = process.argv.slice(2);
switch (cmd) {
  case 'init': init(rest[0]); break;
  case 'update': init(rest[0], { update: true }); break;
  case 'plugin': plugin(rest[0], rest.slice(1).find((a) => !a.startsWith('--')), rest.slice(1).filter((a) => a.startsWith('--'))); break;
  case 'catalog': say(catalogText()); break;
  case 'doctor': process.exit(doctor(workspaceRoot(rest[0])) ? 0 : 1); break;
  // Asking for the help is not a mistake: it goes to stdout and the exit code is 0.
  case undefined: case 'help': case '--help': case '-h': say(helpText()); break;
  case 'version': case '--version': case '-v': say(require(path.join(PKG_ROOT, 'package.json')).version); break;
  // A word this tool does not know is one: it is named, on stderr, before the help, and the exit code is 1.
  default: fail(`webship-workspace: there is no "${cmd}" command.\n\n${helpText()}`);
}
