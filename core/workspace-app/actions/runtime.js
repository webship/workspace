/**
 * The verbs of a project on another container runtime than DDEV (webship/workspace#694): Docker Compose, Podman,
 * Kubernetes. The row's runtime menu (DOCKER, PODMAN, K8S) posts here.
 *
 * Each verb runs as a screen session in the project, like the DDEV menu's, through core/scripts/runtime-verb.sh:
 * it loads the workspace and calls `ddev <verb>`, and the runtime layer (core/scripts/functions/fun-runtime.sh)
 * gives the verb its meaning on that runtime. Nothing here knows docker, podman or kubectl.
 */

const fs = require('fs');
const path = require('path');

const { esc } = require('../html.mts');
const { loadWorkspaces, workspaceDir } = require('../workspaces');
const { startInScreen, screenStartedHtml } = require('../jobs');
const { NAME_RE } = require('../validate.mts');
const projectRuntime = require('../project-runtime');

/**
 * `needsRunning` is refused when the runtime says the site is stopped, not attempted. `destructive` needs the
 * confirm the menu's armed item sends. `toBackups` writes into the workspace's backups folder. `changes` are the
 * verbs after which the row's state is read again.
 */
const RUNTIME_ACTIONS = {
  '/actions/runtime-start':        { verb: 'start', args: ['start', '-y'], changes: true },
  '/actions/runtime-stop':         { verb: 'stop', args: ['stop'], changes: true },
  '/actions/runtime-restart':      { verb: 'restart', args: ['restart'], changes: true },
  '/actions/runtime-describe':     { verb: 'describe', args: ['describe'] },
  '/actions/runtime-logs':         { verb: 'logs', args: ['logs'] },
  // A shell in the web container, as the user the site runs as: a session to open in Screens and type into.
  '/actions/runtime-shell':        { verb: 'shell', args: ['ssh'], needsRunning: true },
  // The containers and the database volume (or the namespace) go; the files stay.
  '/actions/runtime-delete':       { verb: 'delete', args: ['delete', '-O', '-y'], destructive: true, changes: true,
    confirmWhy: 'removes the containers and the database of this site (its files stay)' },
  '/actions/runtime-drush-status': { verb: 'drush-status', args: ['drush', 'status'], needsRunning: true },
  '/actions/runtime-drush-cr':     { verb: 'drush-cr', args: ['drush', 'cr'], needsRunning: true },
  '/actions/runtime-drush-uli':    { verb: 'drush-uli', args: ['drush', 'uli'], needsRunning: true },
  '/actions/runtime-export-db':    { verb: 'export-db', args: ['export-db'], needsRunning: true, toBackups: true },
};

async function runtime_verb({ form, send, workspace, pathname }) {
  const act = RUNTIME_ACTIONS[pathname];
  const projectName = String(form.projectName || '');
  if (!NAME_RE.test(projectName)) return send('<div class="msg error">Invalid project name.</div>', 400);
  const projectDir = path.join(workspaceDir(workspace), projectName);
  const project = projectRuntime.readProject(projectDir);
  if (!projectRuntime.isRuntimeProject(project)) {
    return send('<div class="msg error">Not a project on Docker Compose, Podman or Kubernetes: it has no compose.yaml written by the Webship Workspace.</div>', 400);
  }
  const label = `${project.runtime} ${act.verb}`;
  if (act.destructive && form.confirm !== 'yes') {
    return send(`<div class="msg error">${esc(label)} ${esc(act.confirmWhy || 'destroys data')}: it needs confirmation.</div>`, 400);
  }
  if (act.needsRunning) {
    // Asked of the runtime now, not of what a row last showed: this is one project and one cheap call.
    projectRuntime.invalidate(projectDir);
    const state = await projectRuntime.stateOf(project);
    if (state === 'stopped') return send(`<div class="msg error">${esc(projectName)} is not running: start it first.</div>`, 400);
  }
  let args = act.args;
  if (act.toBackups) {
    const outDir = loadWorkspaces()[workspace].backupsDir;
    try { fs.mkdirSync(outDir, { recursive: true }); } catch (_) { /* the session reports it */ }
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    args = [...args, `--file=${path.join(outDir, `${projectName}--db--${stamp}.sql.gz`)}`];
  }
  const cmdLine = projectRuntime.verbLine(args);
  if (!cmdLine) return send('<div class="msg error">Not run: the workspace path has characters a shell line cannot carry safely.</div>', 400);
  const started = await startInScreen({ workspace, project: projectName, projectDir, verb: act.verb, cmdLine, label });
  if (act.changes) projectRuntime.invalidate(projectDir);
  // The page is told when the session is done, so the row shows the state the verb left.
  const answer = started.ok && act.changes ? { ...started, watch: true } : started;
  return send(screenStartedHtml(answer, label, projectName), started.ok ? 200 : (started.already ? 409 : 500));
}

const routes = {};
for (const route of Object.keys(RUNTIME_ACTIONS)) routes[route] = runtime_verb;

module.exports = routes;
// Not a route: the table, for the menu and the tests (server.js spreads this module into its actions by path).
Object.defineProperty(module.exports, 'RUNTIME_ACTIONS', { value: RUNTIME_ACTIONS, enumerable: false });
