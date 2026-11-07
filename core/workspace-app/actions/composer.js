/**
 * The COMPOSER menu on a project row: composer commands for any folder with a composer.json.
 *
 * Every command runs in a SCREEN SESSION, like the DDEV menu's "Composer update", and the page
 * shows only the toast at the top that links to it. The session stays open after the output,
 * waiting for Enter, and closes by itself after 15 minutes — `composer validate` is over before
 * anyone could open it otherwise.
 *
 * DDEV only, and there are two ways to be inside DDEV:
 *
 *   - A DDEV project runs `ddev composer`, in that project's own web container.
 *   - A folder that is not a DDEV project (a library, a module clone in products/) runs composer in
 *     the DASHBOARD's DDEV container, which bind-mounts ~/workspace at the same path: `ddev exec -d
 *     <folder> composer`. There is no host composer to fall back on, and there must not be.
 *
 * Four kinds of entry: inspect (read-only), change (install, update…), one package (require,
 * remove, why…, from a field) and the project's OWN scripts from composer.json, with their aliases.
 * The handler runs only what these tables name, a package that looks like a package, and a script
 * the folder's composer.json actually declares — so a hand-built request cannot run anything else.
 *
 * The full menu is only for the SITE workspaces — dev, test, demos, sandboxes, projects — which set
 * `composer: full` in their own settings file. Everywhere else (products, modules, themes, recipes,
 * profiles, and any workspace that says nothing) the mode is `manifest`: the menu only ADDS to
 * composer.json without running an install — require / require --dev / remove with --no-update, which
 * write composer.json and nothing else — plus validate. No install, no update, and scripts only in a DDEV
 * folder that has a composer.lock (the DDEV menu lists them). Manifest is
 * the default so that a new workspace never installs by accident, and the handler enforces the same
 * list, so a hand-built request cannot install there either.
 *
 * A second click on a command whose session is still open replaces it only when that session has
 * FINISHED (its log ends with the "Press Enter" line). One still running is left alone and the
 * toast links to it: a `composer update` is minutes of work, and a click must never kill it.
 */

const fs = require('fs');
const path = require('path');

const { esc } = require('../html');
const { ROOT, workspaceDir, loadWorkspaces } = require('../workspaces');
const { startInScreen, screenStartedHtml, hostRunnerRequest } = require('../jobs');
const { NAME_RE } = require('../validate');
const { lingerTail, LINGER_MARK } = require('../linger');

// In the order people reach for them: what is run every day first, then looking around, then the rare ones.
const COMPOSER_RUN_ACTIONS = {
  '/actions/composer-install':        { group: 'Daily',       label: 'composer install',             args: ['install'] },
  '/actions/composer-update':         { group: 'Daily',       label: 'composer update',              args: ['update'] },
  '/actions/composer-outdated':       { group: 'Daily',       label: 'composer outdated --direct',   args: ['outdated', '--direct'] },
  '/actions/composer-validate':       { group: 'Daily',       label: 'composer validate',            args: ['validate', '--no-check-publish'], manifest: true },
  '/actions/composer-update-dry-run': { group: 'Inspect',     label: 'composer update --dry-run',    args: ['update', '--dry-run'] },
  '/actions/composer-show':           { group: 'Inspect',     label: 'composer show --direct',       args: ['show', '--direct'] },
  '/actions/composer-show-tree':      { group: 'Inspect',     label: 'composer show --tree',         args: ['show', '--tree'] },
  '/actions/composer-audit':          { group: 'Inspect',     label: 'composer audit',               args: ['audit'] },
  '/actions/composer-platform':       { group: 'Inspect',     label: 'composer check-platform-reqs', args: ['check-platform-reqs'] },
  '/actions/composer-licenses':       { group: 'Inspect',     label: 'composer licenses',            args: ['licenses'] },
  '/actions/composer-update-lock':    { group: 'Maintenance', label: 'composer update --lock',       args: ['update', '--lock'] },
  '/actions/composer-dump-autoload':  { group: 'Maintenance', label: 'composer dump-autoload -o',    args: ['dump-autoload', '--optimize'] },
};

// The order the groups are shown in.
const COMPOSER_GROUPS = ['Daily', 'Inspect', 'Maintenance'];

// Take a package from the field. Only require accepts a version constraint after the name.
const COMPOSER_PACKAGE_ACTIONS = {
  '/actions/composer-require':        { label: 'composer require',       args: ['require'],                              button: 'require',   constraint: true, manifestArgs: ['require', '--no-update'] },
  '/actions/composer-update-package': { label: 'composer update -W',     args: ['update', '--with-all-dependencies'],    button: 'update -W' },
  '/actions/composer-remove':         { label: 'composer remove',        args: ['remove'],                               button: 'remove', manifestArgs: ['remove', '--no-update'] },
  '/actions/composer-require-dev':    { label: 'composer require --dev', args: ['require', '--dev'],                     button: 'require --dev', constraint: true, manifestArgs: ['require', '--dev', '--no-update'] },
  '/actions/composer-why':            { label: 'composer why',           args: ['why'],                                  button: 'why' },
};

const SCRIPT_ROUTE = '/actions/composer-script';

/** What the menu offers, and the handler runs, in a workspace of this mode. */
function composerActionsFor(mode) {
  if (mode === 'full') return { run: COMPOSER_RUN_ACTIONS, packages: COMPOSER_PACKAGE_ACTIONS, scripts: true };
  const run = Object.fromEntries(Object.entries(COMPOSER_RUN_ACTIONS).filter(([, a]) => a.manifest));
  const packages = Object.fromEntries(Object.entries(COMPOSER_PACKAGE_ACTIONS).filter(([, a]) => a.manifestArgs)
    .map(([route, a]) => [route, { ...a, args: a.manifestArgs, label: `${a.label} --no-update` }]));
  return { run, packages, scripts: false };
}

function composerModeOf(workspace) {
  try { return (loadWorkspaces()[workspace] || {}).composerMode === 'full' ? 'full' : 'manifest'; } catch (_) { return 'manifest'; }
}

// vendor/name as Composer itself defines it, then an optional `:constraint` of version characters
// only. No quote, $, backtick or backslash can pass: the value is single-quoted into a shell line.
const PACKAGE_RE = /^[a-z0-9]([_.-]?[a-z0-9]+)*\/[a-z0-9](([_.]|-{1,2})?[a-z0-9]+)*$/;
const CONSTRAINT_RE = /^[A-Za-z0-9.^~*|,<>=@ -]{1,60}$/;
const SCRIPT_NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9_:.-]{0,80}$/;
const SAFE_PATH_RE = /^[\w/.@+~-]+$/;

/** The dashboard's own DDEV project, whose container runs composer for non-DDEV folders. */
function dashboardDir() { return path.join(ROOT, 'core', 'workspace-app'); }

function hasComposerJson(dir) {
  try { return fs.statSync(path.join(dir, 'composer.json')).isFile(); } catch (_) { return false; }
}

function isDdevProject(dir) {
  try { return fs.existsSync(path.join(dir, '.ddev', 'config.yaml')); } catch (_) { return false; }
}

/** Why this package value must not run, or '' when it may. */
function packageRefusal(value, { constraint = false } = {}) {
  const v = String(value || '').trim();
  if (!v) return 'type a package first, as vendor/name';
  const [name, ...rest] = v.split(':');
  if (!PACKAGE_RE.test(name)) return 'that is not a package name (vendor/name, lower case)';
  if (!rest.length) return '';
  if (!constraint) return 'a version constraint only goes with require';
  return CONSTRAINT_RE.test(rest.join(':')) ? '' : 'that is not a version constraint';
}

/**
 * The folder's own scripts, which is what "custom commands" are in Composer. Event hooks
 * (pre-/post-…) run by themselves during install and update, so they are not offered by hand.
 * A script whose name could not be passed safely to a shell is left out rather than escaped.
 */
function composerScripts(dir) {
  let pkg;
  try { pkg = JSON.parse(fs.readFileSync(path.join(dir, 'composer.json'), 'utf8')); } catch (_) { return []; }
  const scripts = (pkg && typeof pkg.scripts === 'object' && pkg.scripts) || {};
  const aliases = (pkg && typeof pkg['scripts-aliases'] === 'object' && pkg['scripts-aliases']) || {};
  const descriptions = (pkg && typeof pkg['scripts-descriptions'] === 'object' && pkg['scripts-descriptions']) || {};
  return Object.keys(scripts)
    .filter((name) => !/^(pre|post)-/.test(name) && !['init', 'command'].includes(name) && SCRIPT_NAME_RE.test(name))
    .map((name) => ({
      name,
      aliases: (Array.isArray(aliases[name]) ? aliases[name] : []).filter((a) => typeof a === 'string' && SCRIPT_NAME_RE.test(a)),
      description: typeof descriptions[name] === 'string' ? descriptions[name] : '',
    }));
}

const sq = (s) => `'${s}'`;

/**
 * The line a composer session runs. No `$` anywhere: the runner hands it to an outer `bash -lc "…"`,
 * which would expand it too early. Paths are checked against SAFE_PATH_RE and single-quoted.
 */
function composerScreenCommand(label, args, { isDdev, projectDir }) {
  const composer = isDdev
    ? `ddev composer --no-interaction --ansi ${args.join(' ')}`
    : `cd ${sq(dashboardDir())} && ddev exec -d ${sq(projectDir)} composer --no-interaction --ansi ${args.join(' ')}`;
  return `${composer}; ${lingerTail(label)}`;
}

/** Has this session's command finished, so that it is only waiting to be read? */
function sessionFinished(logText) {
  const lines = String(logText || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return lines.length > 0 && lines[lines.length - 1].includes(LINGER_MARK);
}

function sessionLogTail(session) {
  try {
    const file = path.join(ROOT, '.screens', `${session}.log`);
    const size = fs.statSync(file).size;
    const fd = fs.openSync(file, 'r');
    try {
      const len = Math.min(size, 4096);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, size - len);
      return buf.toString('utf8');
    } finally { fs.closeSync(fd); }
  } catch (_) { return ''; }
}

/** Start the session; replace one still open from last time only if its command has finished. */
async function startUnlessRunning(opts) {
  let started = await startInScreen(opts);
  for (let i = 0; started.already && i < 3; i += 1) {
    if (!sessionFinished(sessionLogTail(started.session))) return { ...started, stillRunning: true };
    await hostRunnerRequest('stop', { session: started.session });
    await new Promise((resolve) => setTimeout(resolve, 400));
    started = await startInScreen(opts);
  }
  return started;
}

function terminalLink(session, text) {
  return `<a href="/terminal/${encodeURIComponent(session)}" target="_blank" rel="noopener">${esc(text)}</a>`;
}

async function composer_run({ form, send, workspace, pathname }) {
  const isScript = pathname === SCRIPT_ROUTE;
  const act = COMPOSER_RUN_ACTIONS[pathname] || COMPOSER_PACKAGE_ACTIONS[pathname];
  if (!act && !isScript) return send('<div class="msg error">Unknown composer command.</div>', 404);
  const projectName = String(form.projectName || '');
  if (!NAME_RE.test(projectName)) return send('<div class="msg error">Invalid project name.</div>', 400);

  // The workspace's mode decides before anything else: a package clone never installs.
  const allowed = composerActionsFor(composerModeOf(workspace));
  const use = isScript ? null : (allowed.run[pathname] || allowed.packages[pathname]);
  // A DDEV folder that is installed (composer.lock) runs its own scripts in any workspace: they are its commands.
  const installedDdev = (dir) => isDdevProject(dir) && fs.existsSync(path.join(dir, 'composer.lock'));
  const scriptsHere = allowed.scripts || (NAME_RE.test(String(form.projectName || ''))
    && installedDdev(path.join(workspaceDir(workspace), String(form.projectName))));
  if (isScript ? !scriptsHere : !use) {
    return send(`<div class="msg error">Not run in ${esc(workspace)}: this workspace only edits composer.json — validate, and require or remove with --no-update.</div>`, 403);
  }

  // What the request carries is checked before anything on disk is looked at.
  let args = use ? [...use.args] : [];
  let label = use ? use.label : '';
  let verb = pathname.replace('/actions/', '');
  if (COMPOSER_PACKAGE_ACTIONS[pathname]) {
    const why = packageRefusal(form.package, use);
    if (why) return send(`<div class="msg error">Not running ${esc(use.label)}: ${esc(why)}.</div>`, 400);
    args.push(sq(String(form.package).trim()));
  }
  const script = String(form.script || '');
  if (isScript && !SCRIPT_NAME_RE.test(script)) return send('<div class="msg error">Invalid script name.</div>', 400);

  const projectDir = path.join(workspaceDir(workspace), projectName);
  if (!hasComposerJson(projectDir)) {
    return send(`<div class="msg error">${esc(projectName)} has no composer.json.</div>`, 400);
  }
  if (!SAFE_PATH_RE.test(projectDir)) {
    return send(`<div class="msg error">Not running composer: the folder path has characters a shell line cannot carry safely.</div>`, 400);
  }
  if (isScript) {
    if (!composerScripts(projectDir).some((s) => s.name === script)) {
      return send(`<div class="msg error">${esc(projectName)}'s composer.json has no script called ${esc(script)}.</div>`, 400);
    }
    args = ['run-script', script];
    label = `composer run-script ${script}`;
    verb = `composer-script-${script.replace(/[^\w-]/g, '-')}`;
  }
  const isDdev = isDdevProject(projectDir);
  if (!isDdev && !isDdevProject(dashboardDir())) {
    return send('<div class="msg error">This folder is not a DDEV project, and the dashboard\'s own DDEV project was not found to run composer in.</div>', 500);
  }

  const started = await startUnlessRunning({ workspace, project: projectName, projectDir, verb,
    cmdLine: composerScreenCommand(label, args, { isDdev, projectDir }), label });
  if (started.stillRunning) {
    return send(`<div class="msg error"><code>${esc(label)}</code> is still running on <strong>${esc(projectName)}</strong> — ${terminalLink(started.session, 'open it')}. Left alone.</div>`, 409);
  }
  if (!started.ok) return send(screenStartedHtml(started, label, projectName), started.already ? 409 : 500);
  // install, update, require and remove change composer.lock: reload as the toast leaves, so the caption is current.
  const reload = /^(install|update|require|remove)$/.test(args[0]) && !args.includes('--dry-run');
  return send(`<div class="msg assistant flash-now"${reload ? ' data-reload-on-close="1"' : ''}><code>${esc(label)}</code> on <strong>${esc(projectName)}</strong> — ${terminalLink(started.session, 'open the output')}</div>`);
}

module.exports = {
  COMPOSER_RUN_ACTIONS,
  COMPOSER_PACKAGE_ACTIONS,
  COMPOSER_GROUPS,
  SCRIPT_ROUTE,
  composerActionsFor,
  composerModeOf,
  hasComposerJson,
  isDdevProject,
  packageRefusal,
  composerScripts,
  composerScreenCommand,
  sessionFinished,
  // Shared with the NODE menu (actions/node.js), which runs npm and yarn the same way.
  sq,
  SAFE_PATH_RE,
  dashboardDir,
  startUnlessRunning,
  terminalLink,
  ...Object.fromEntries([...Object.keys(COMPOSER_RUN_ACTIONS), ...Object.keys(COMPOSER_PACKAGE_ACTIONS), SCRIPT_ROUTE]
    .map((route) => [route, composer_run])),
};
