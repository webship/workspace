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
const ddevImport = require('../ddev-import.mts');
const { shq } = require('../shell-quote.mts');

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
    return send('<div class="msg error">Not a project on another runtime than DDEV: it has no file of the runtime layer of the Webship Workspace (an x-webship block in compose.yaml, .lando.yml or .docksal/docksal.yml).</div>', 400);
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

/**
 * Put a database back into a project on another runtime (webship/workspace#859), as DDEV's import does: the dump is
 * named by its basename and looked up in the workspace's own backups, so no path from a browser reaches a command
 * line. Runtimes have no snapshot, so the database is exported into the backups first, in the same line with `&&`:
 * if the export fails nothing is imported. The runtime layer's import-db does the rest (for PostgreSQL #846's safe
 * import, which leaves the database as it was unless the whole dump went in).
 */
async function runtime_import_db({ form, send, workspace }) {
  const projectName = String(form.projectName || '');
  if (!NAME_RE.test(projectName)) return send('<div class="msg error">Invalid project name.</div>', 400);
  const projectDir = path.join(workspaceDir(workspace), projectName);
  const project = projectRuntime.readProject(projectDir);
  if (!projectRuntime.isRuntimeProject(project)) return send('<div class="msg error">Not a project on another runtime than DDEV.</div>', 400);
  if (project.database === 'none') return send(`<div class="msg error">${esc(projectName)} has no database.</div>`, 400);
  if (form.confirm !== 'yes') return send('<div class="msg error">Importing replaces every table in the database — it needs confirmation.</div>', 400);
  projectRuntime.invalidate(projectDir);
  if (await projectRuntime.stateOf(project) === 'stopped') return send(`<div class="msg error">${esc(projectName)} is not running: start it first.</div>`, 400);
  const backupsDir = loadWorkspaces()[workspace].backupsDir;
  const dump = ddevImport.findDump(backupsDir, form.dump);
  if (!dump) return send('<div class="msg error">No such dump in this workspace\'s backups.</div>', 404);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const before = path.join(backupsDir, `${projectName}--db--before-import-${stamp}.sql.gz`);
  const exportLine = projectRuntime.verbLine(['export-db', shq(`--file=${before}`)]);
  const importLine = projectRuntime.verbLine(['import-db', shq(`--file=${path.join(backupsDir, dump.name)}`)]);
  if (!exportLine || !importLine) return send('<div class="msg error">Not run: the workspace path has characters a shell line cannot carry safely.</div>', 400);
  const cmdLine = `echo "Exporting the database first…" && ${exportLine} && echo "Importing ${dump.name.replace(/[^\w.-]/g, '_')}…" && ${importLine}`
    + ` && echo "Imported. The database as it was is ${path.basename(before)}, in this workspace's backups."`;
  const label = `${project.runtime} import-db ${dump.name}`;
  const started = await startInScreen({ workspace, project: projectName, projectDir, verb: 'import-db', cmdLine, label });
  return send(screenStartedHtml(started, label, projectName), started.ok ? 200 : (started.already ? 409 : 500));
}

const routes = { '/actions/runtime-import-db': runtime_import_db };
for (const route of Object.keys(RUNTIME_ACTIONS)) routes[route] = runtime_verb;

module.exports = routes;
// Not a route: the table, for the menu and the tests (server.js spreads this module into its actions by path).
Object.defineProperty(module.exports, 'RUNTIME_ACTIONS', { value: RUNTIME_ACTIONS, enumerable: false });
