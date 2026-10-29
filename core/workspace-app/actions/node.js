/**
 * The NODE menu on a project row: npm and yarn for any folder with a package.json.
 *
 * It follows the COMPOSER menu (actions/composer.js) and reuses its machinery: every command runs in
 * a SCREEN SESSION that stays open to be read, the page shows only the toast at the top, and a second
 * click replaces a session only once its command has finished — a run still going is left alone.
 * Unlike COMPOSER there is no manifest mode: every workspace gets the whole menu.
 *
 * DDEV only, as with composer:
 *
 *   - A DDEV project runs `ddev npm` / `ddev yarn`, in its own web container (the site projects all
 *     carry `corepack_enable: true`, so a pinned Yarn 4 is what runs).
 *   - Any other folder runs in the DASHBOARD's DDEV container: `ddev exec -d <folder> npm …`. When the
 *     project pins yarn in `packageManager`, it runs `corepack yarn`, so the pinned version runs rather
 *     than the container's Yarn 1.
 *
 * Which manager: the menu offers both, as a yarn and an npm tab, each saying whether its lock file is
 * there. The tab that opens is the one the project uses — its `packageManager` pin, else its lock file.
 * Yarn 1 (classic) and Yarn 2+ (berry) differ in several commands, so every entry carries three forms;
 * which Yarn a folder has is read from the folder (`packageManager`, `.yarnrc.yml`), never from the request.
 *
 * The handler runs only what these tables name for that manager, a package that looks like an npm
 * package name (never a git URL, a tarball or a file: path), and a script package.json declares.
 */

const fs = require('fs');
const path = require('path');

const { esc } = require('../html');
const { workspaceDir } = require('../workspaces');
const { screenStartedHtml } = require('../jobs');
const { NAME_RE } = require('../validate');
const { lingerTail } = require('./git');
const { startUnlessRunning, terminalLink, isDdevProject, dashboardDir, sq, SAFE_PATH_RE } = require('./composer');

// The order of the tabs. yarn first: every site project in this tree uses it.
const MANAGERS = ['yarn', 'npm'];
const NODE_GROUPS = ['Daily', 'Inspect', 'Maintenance'];

// Each command in its three forms: npm, Yarn 1 (yarn1) and Yarn 2+ (yarn). null = that manager has no
// such command, and the entry is not offered. In the order people reach for them.
const NODE_RUN_ACTIONS = {
  '/actions/node-install':  { group: 'Daily',       npm: ['install'],          yarn1: ['install'],                     yarn: ['install'] },
  '/actions/node-ci':       { group: 'Daily',       npm: ['ci'],               yarn1: ['install', '--frozen-lockfile'], yarn: ['install', '--immutable'],
    needsLock: true, title: 'Install exactly what the lock file says, and fail if package.json disagrees with it' },
  '/actions/node-outdated': { group: 'Daily',       npm: ['outdated'],         yarn1: ['outdated'],                    yarn: ['upgrade-interactive'] },
  '/actions/node-audit':    { group: 'Daily',       npm: ['audit'],            yarn1: ['audit'],                       yarn: ['npm', 'audit'] },
  '/actions/node-list':     { group: 'Inspect',     npm: ['ls', '--depth=0'],  yarn1: ['list', '--depth=0'],           yarn: ['info', '--name-only'] },
  '/actions/node-version':  { group: 'Inspect',     npm: ['--version'],        yarn1: ['--version'],                   yarn: ['--version'] },
  '/actions/node-update':   { group: 'Maintenance', npm: ['update'],           yarn1: ['upgrade'],                     yarn: null },
  '/actions/node-dedupe':   { group: 'Maintenance', npm: ['dedupe'],           yarn1: null,                            yarn: ['dedupe'] },
  '/actions/node-cache':    { group: 'Maintenance', npm: ['cache', 'verify'],  yarn1: ['cache', 'clean'],              yarn: ['cache', 'clean'] },
};

// Take a package from the field. Only add accepts a version after the name.
const NODE_PACKAGE_ACTIONS = {
  '/actions/node-add':      { button: 'add',       npm: ['install'],               yarn1: ['add'],          yarn: ['add'],          version: true },
  '/actions/node-upgrade':  { button: 'upgrade',   npm: ['update'],                yarn1: ['upgrade'],      yarn: ['up'] },
  '/actions/node-remove':   { button: 'remove',    npm: ['uninstall'],             yarn1: ['remove'],       yarn: ['remove'] },
  '/actions/node-add-dev':  { button: 'add --dev', npm: ['install', '--save-dev'], yarn1: ['add', '--dev'], yarn: ['add', '--dev'], version: true },
  '/actions/node-why':      { button: 'why',       npm: ['explain'],               yarn1: ['why'],          yarn: ['why'] },
};

const NODE_SCRIPT_ROUTE = '/actions/node-script';

// npm's own package-name shape, optionally scoped. A version is range characters only: no quote, $,
// backtick, backslash or colon, so a git URL, a tarball or a file: path can never pass.
const NPM_NAME_RE = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const NPM_VERSION_RE = /^[A-Za-z0-9.^~*|<>=_ -]{1,60}$/;
const SCRIPT_NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9_:.@/-]{0,80}$/;
// Run by npm and yarn themselves around install, publish and version — not something to run by hand.
const LIFECYCLE = new Set(['install', 'preinstall', 'postinstall', 'prepare', 'prepublish', 'prepublishOnly',
  'prepack', 'postpack', 'publish', 'postpublish', 'preversion', 'version', 'postversion', 'dependencies',
  'preuninstall', 'uninstall', 'postuninstall']);

function hasPackageJson(dir) {
  try { return fs.statSync(path.join(dir, 'package.json')).isFile(); } catch (_) { return false; }
}

/** What the folder says about itself: the manifest, the pin, the lock files, and which Yarn. */
function nodeInfo(dir) {
  let pkg = null;
  try { pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')); } catch (_) { /* valid: false */ }
  if (!pkg || typeof pkg !== 'object') pkg = null;
  const has = (f) => { try { return fs.existsSync(path.join(dir, f)); } catch (_) { return false; } };
  const m = pkg && typeof pkg.packageManager === 'string' ? /^(npm|yarn|pnpm)@(\d+)[^+\s]*/.exec(pkg.packageManager) : null;
  const pinned = m ? { name: m[1], major: Number(m[2]), spec: m[0] } : null;
  const locks = { yarn: has('yarn.lock'), npm: has('package-lock.json') };
  const yarnBerry = (pinned && pinned.name === 'yarn' && pinned.major >= 2) || has('.yarnrc.yml');
  const preferred = (pinned && MANAGERS.includes(pinned.name)) ? pinned.name
    : (locks.yarn ? 'yarn' : (locks.npm ? 'npm' : 'npm'));
  return { valid: !!pkg, pkg, pinned, locks, yarnBerry, preferred, nodeModules: has('node_modules') };
}

/** The arguments an entry runs with for this manager in this folder, or null when it has none. */
function nodeArgsFor(action, manager, info) {
  if (manager === 'npm') return action.npm || null;
  return ((info && info.yarnBerry) ? action.yarn : action.yarn1) || null;
}

/** Why this package value must not run, or '' when it may. */
function nodePackageRefusal(value, { version = false } = {}) {
  const v = String(value || '').trim();
  if (!v) return 'type a package first, as name or @scope/name';
  const at = v.indexOf('@', 1);
  const name = at > 0 ? v.slice(0, at) : v;
  if (!NPM_NAME_RE.test(name)) return 'that is not a package name (name or @scope/name, lower case)';
  if (at < 0) return '';
  if (!version) return 'a version only goes with add';
  return NPM_VERSION_RE.test(v.slice(at + 1)) ? '' : 'that is not a version or range';
}

/**
 * The folder's own scripts. Lifecycle hooks — install, prepare… and the pre/post twin of another
 * script — run by themselves, so they are not offered; `prettier` or `postcss` are ordinary scripts.
 */
function nodeScripts(pkg) {
  const scripts = (pkg && typeof pkg.scripts === 'object' && pkg.scripts) || {};
  const names = Object.keys(scripts);
  const isHook = (n) => LIFECYCLE.has(n)
    || names.some((o) => o !== n && (n === `pre${o}` || n === `post${o}`));
  return names
    .filter((n) => !isHook(n) && SCRIPT_NAME_RE.test(n))
    .map((n) => ({ name: n, command: typeof scripts[n] === 'string' ? scripts[n] : '' }));
}

/**
 * The line a node session runs. No `$` anywhere: the runner hands it to an outer `bash -lc "…"`.
 * Paths are checked against SAFE_PATH_RE and single-quoted.
 */
function nodeScreenCommand(label, manager, args, { isDdev, projectDir, pinned }) {
  let line;
  if (isDdev) {
    line = `ddev ${manager} ${args.join(' ')}`;
  } else {
    // Corepack would stop to ask before downloading the pinned Yarn; `env` sets that off without a `$`.
    const bin = (manager === 'yarn' && pinned && pinned.name === 'yarn')
      ? 'env COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack yarn' : manager;
    line = `cd ${sq(dashboardDir())} && ddev exec -d ${sq(projectDir)} ${bin} ${args.join(' ')}`;
  }
  return `${line}; ${lingerTail(label)}`;
}

async function node_run({ form, send, workspace, pathname }) {
  const isScript = pathname === NODE_SCRIPT_ROUTE;
  const act = NODE_RUN_ACTIONS[pathname] || NODE_PACKAGE_ACTIONS[pathname];
  if (!act && !isScript) return send('<div class="msg error">Unknown node command.</div>', 404);
  const projectName = String(form.projectName || '');
  if (!NAME_RE.test(projectName)) return send('<div class="msg error">Invalid project name.</div>', 400);
  const manager = String(form.manager || '');
  if (!MANAGERS.includes(manager)) return send('<div class="msg error">Pick npm or yarn.</div>', 400);

  // What the request carries is checked before anything on disk is looked at.
  const isPackage = !!NODE_PACKAGE_ACTIONS[pathname];
  if (isPackage) {
    const why = nodePackageRefusal(form.package, act);
    if (why) return send(`<div class="msg error">Not running ${esc(manager)} ${esc(act.button)}: ${esc(why)}.</div>`, 400);
  }
  const script = String(form.script || '');
  if (isScript && !SCRIPT_NAME_RE.test(script)) return send('<div class="msg error">Invalid script name.</div>', 400);

  const projectDir = path.join(workspaceDir(workspace), projectName);
  if (!hasPackageJson(projectDir)) {
    return send(`<div class="msg error">${esc(projectName)} has no package.json.</div>`, 400);
  }
  if (!SAFE_PATH_RE.test(projectDir)) {
    return send('<div class="msg error">Not running it: the folder path has characters a shell line cannot carry safely.</div>', 400);
  }
  const info = nodeInfo(projectDir);

  let args;
  let verb;
  if (isScript) {
    if (!nodeScripts(info.pkg).some((s) => s.name === script)) {
      return send(`<div class="msg error">${esc(projectName)}'s package.json has no script called ${esc(script)}.</div>`, 400);
    }
    args = ['run', script];
    verb = `${manager}-run-${script.replace(/[^\w-]/g, '-')}`;
  } else {
    const base = nodeArgsFor(act, manager, info);
    if (!base) return send(`<div class="msg error">${esc(manager)} has no such command in ${esc(projectName)}.</div>`, 400);
    if (act.needsLock && !info.locks[manager]) {
      return send(`<div class="msg error">${esc(projectName)} has no ${manager === 'npm' ? 'package-lock.json' : 'yarn.lock'} to install from.</div>`, 400);
    }
    args = [...base];
    verb = `${manager}-${pathname.replace('/actions/node-', '')}`;
  }
  // The label goes into the session's closing echo: the manager and the command, never the typed package.
  const label = `${manager} ${args.join(' ')}`;
  if (isPackage) args.push(sq(String(form.package).trim()));

  const isDdev = isDdevProject(projectDir);
  if (!isDdev && !isDdevProject(dashboardDir())) {
    return send('<div class="msg error">This folder is not a DDEV project, and the dashboard\'s own DDEV project was not found to run it in.</div>', 500);
  }

  const started = await startUnlessRunning({ workspace, project: projectName, projectDir, verb,
    cmdLine: nodeScreenCommand(label, manager, args, { isDdev, projectDir, pinned: info.pinned }), label });
  if (started.stillRunning) {
    return send(`<div class="msg error"><code>${esc(label)}</code> is still running on <strong>${esc(projectName)}</strong> — ${terminalLink(started.session, 'open it')}. Left alone.</div>`, 409);
  }
  if (!started.ok) return send(screenStartedHtml(started, label, projectName), started.already ? 409 : 500);
  // These change node_modules or a lock file: reload as the toast leaves, so the caption is current.
  const reload = !isScript && /^(install|ci|add|remove|uninstall|update|upgrade|up|dedupe)$/.test(args[0]);
  return send(`<div class="msg assistant flash-now"${reload ? ' data-reload-on-close="1"' : ''}><code>${esc(label)}</code> on <strong>${esc(projectName)}</strong> — ${terminalLink(started.session, 'open the output')}</div>`);
}

module.exports = {
  MANAGERS,
  NODE_GROUPS,
  NODE_RUN_ACTIONS,
  NODE_PACKAGE_ACTIONS,
  NODE_SCRIPT_ROUTE,
  hasPackageJson,
  nodeInfo,
  nodeArgsFor,
  nodePackageRefusal,
  nodeScripts,
  nodeScreenCommand,
  ...Object.fromEntries([...Object.keys(NODE_RUN_ACTIONS), ...Object.keys(NODE_PACKAGE_ACTIONS), NODE_SCRIPT_ROUTE]
    .map((route) => [route, node_run])),
};
