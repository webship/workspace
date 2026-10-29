/**
 * The DDEV verbs a project row offers.
 *
 * One module per area of the dashboard, each exporting the handlers it owns keyed by the path that
 * reaches them. server.js merges the maps and dispatches; nothing here knows about routing, and
 * adding an action is adding an entry rather than another branch in a 1,250-line function.
 *
 * Every handler takes the same context: the parsed form, the response, a `send` that writes an HTML
 * fragment, and the workspace the request named.
 */

const fs = require('fs');
const path = require('path');

const { esc } = require('../html');
const { humanSize, humanTime } = require('../format');
const { ROOT, loadWorkspaces, workspaceDir } = require('../workspaces');
const {
  run, jobFragment, runningJobKey, startJob, ddevProjectName, listProjects,
  startInScreen, screenStartedHtml, screenAction,
} = require('../jobs');
const { graphStoreDir } = require('../graphs');
const {
  milvusProjectName, ragInstances, ragBindings, ragInstanceFor, ragWriteBinding,
  ragCollectionName, milvusPost, ragCollections, ragInvalidate,
} = require('../rag');
const {
  findTestReports, testReportFor, invalidateTestReports, testMediaHtml, testingStackOf,
} = require('../test-reports');
const { NAME_RE, SCRIPT_RE } = require('../validate');
const { commandBlock } = require('../command-block');
const { upsunLinkOf } = require('../upsun');
const { wsUrl } = require('../urls');
const { findGraphifyScript, findRagifyScript } = require('../workspaces');
const { DDEV_ACTIONS, projectDdevCommands, serialiseRouter, touchesRouter } = require('../ddev');
const snapshots = require('../ddev-snapshots');
const ddevImport = require('../ddev-import');

async function ddev_start({ form, res, send, workspace, pathname }) {
    const projectName = String(form.projectName || '');
    if (!NAME_RE.test(projectName)) return send('<div class="msg error">Invalid project name.</div>', 400);
    const projectDir = path.join(workspaceDir(workspace), projectName);
    if (!ddevProjectName(projectDir)) return send('<div class="msg error">Not a DDEV project.</div>', 400);
    const verb = pathname === '/actions/ddev-start' ? 'start' : 'stop';
    // `ddev start` accepts -y (skip confirmation); `ddev stop` has no such flag.
    const args = verb === 'start' ? ['start', '-y'] : ['stop'];
    // Both verbs recreate the shared ddev-router, so they take the router lock: five
    // concurrent starts is what left the machine with no router and every workspace URL
    // dead. See serialiseRouter() in ../ddev.js.
    const cmdLine = serialiseRouter(`ddev ${args.join(' ')}`);
    const started = await startInScreen({ workspace, project: projectName, projectDir, verb, cmdLine, label: `ddev ${verb}` });
    return send(screenStartedHtml(started, `ddev ${verb}`, projectName), started.ok ? 200 : (started.already ? 409 : 500));
}

// Every remaining DDEV verb shares one handler, driven by the table in ddev.js: they differ only
// in the arguments, the timeout and whether the project has to be running.
async function ddev_verb({ form, res, send, workspace, pathname }) {
    const act = DDEV_ACTIONS[pathname];
    const projectName = String(form.projectName || '');
    if (!NAME_RE.test(projectName)) return send('<div class="msg error">Invalid project name.</div>', 400);
    const projectDir = path.join(workspaceDir(workspace), projectName);
    const ddevName = ddevProjectName(projectDir);
    if (!ddevName) return send('<div class="msg error">Not a DDEV project.</div>', 400);
    let args = act.args;
    // A destructive command is never one click away, and the dashboard is not
    // the only door — the guard lives here, not only in the markup.
    if (act.destructive && form.confirm !== 'yes') {
      return send(`<div class="msg error">${esc(act.label)} ${esc(act.confirmWhy || 'destroys data')} — it needs confirmation.</div>`, 400);
    }
    // A verb that takes a snapshot name: the name is checked against what is ON DISK, not merely
    // against a pattern, so a restore or a delete cannot be asked for something that is not there —
    // and the answer comes back now rather than from a screen session three seconds later.
    if (act.named) {
      const raw = String(form.snapshot || '').trim();
      if (raw) {
        if (!snapshots.SNAPSHOT_NAME_RE.test(raw)) {
          return send('<div class="msg error">A snapshot name starts with a letter or digit and holds letters, digits, dots, dashes and underscores.</div>', 400);
        }
        if (pathname === '/actions/ddev-snapshot') {
          args = [...args, '--name', raw];
        } else {
          const found = snapshots.findSnapshot(projectDir, raw);
          if (!found) return send(`<div class="msg error">No snapshot called <strong>${esc(raw)}</strong> in this project.</div>`, 404);
          if (pathname === '/actions/ddev-snapshot-restore') {
            // The engine and version a snapshot was taken from are in its file name, and DDEV will
            // refuse a restore across them. Saying so here names both versions; ddev's own refusal
            // arrives inside a screen session somebody has to open to read.
            const can = snapshots.restorable(found, snapshots.projectDbVersion(projectDir));
            if (!can.ok) return send(`<div class="msg error">${esc(can.why)}</div>`, 409);
            // `restore` takes the name as a POSITIONAL argument; `--name` belongs to taking one and
            // to `--cleanup`. Given the flag, ddev prints its help and the log reads like a crash.
            args = [...args, raw];
          } else {
            args = [...args, '--name', raw];
          }
        }
      } else if (pathname !== '/actions/ddev-snapshot') {
        return send('<div class="msg error">Name the snapshot.</div>', 400);
      }
    }
    if (act.needsRunning) {
      // Asked of the project itself rather than the dashboard's status map:
      // that map lives in server.js, which requires this file — importing it
      // back would be a cycle, and this is one cheap call on one project.
      const desc = await run('ddev', ['describe', '--json-output'], projectDir, { timeoutMs: 60 * 1000 });
      let status = '';
      try { status = JSON.parse(desc.stdout).raw.status || ''; } catch (_) { status = ''; }
      if (status !== 'running') {
        return send(`<div class="msg error">${esc(projectName)} is not running — start it first.</div>`, 400);
      }
    }
    if (act.toBackups) {
      // A dump belongs in the workspace's backups folder, never in the home directory or
      // the project itself.
      const outDir = path.join(loadWorkspaces()[workspace].backupsDir);
      try { fs.mkdirSync(outDir, { recursive: true }); } catch (_) { /* reported by ddev */ }
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
      args = [...args, '--gzip', '--file', path.join(outDir, `${projectName}--db--${stamp}.sql.gz`)];
    }
    // Before anything destructive: a dump into the workspace's backups folder.
    // `sql:drop` leaves nothing behind, so this is the only copy there will be.
    // && not ; — nothing is dropped unless the dump actually succeeded.
    let line = `ddev ${args.join(' ')}`;
    if (act.backupFirst) {
      const outDir = path.join(loadWorkspaces()[workspace].backupsDir);
      try { fs.mkdirSync(outDir, { recursive: true }); } catch (_) { /* the session reports it */ }
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
      const dump = path.join(outDir, `${projectName}--before-sql-drop--${stamp}.sql.gz`);
      line = `echo "Backing the database up first…" && ddev export-db --gzip --file ${JSON.stringify(dump)}`
        + ` && echo "Saved ${dump}" && ${line}`;
    }
    // `ddev restart` recreates the router like start and stop do, so it queues with
    // them rather than racing. The rest (drush, composer, snapshot, logs) leave the
    // router alone and stay parallel — serialising those would make the dashboard feel
    // broken for no reason.
    if (touchesRouter(args)) line = serialiseRouter(line);
    // Every DDEV command runs detached in a screen named after the project: no
    // toast to follow the user around, and the row's SCREENS group lists it.
    const verb = pathname.replace('/actions/ddev-', '');
    const started = await startInScreen({ workspace, project: projectName, projectDir, verb, cmdLine: line, label: act.label });
    return send(screenStartedHtml(started, act.label, projectName), started.ok ? 200 : (started.already ? 409 : 500));
}

/**
 * Put a database back into a project.
 *
 * The dump is named by BASENAME and looked up in the workspace's own backups folder, so no path from
 * a browser ever reaches a command line. A snapshot is taken first, in the same line with `&&`:
 * importing replaces every table, and the database it replaces is often the only copy of an
 * afternoon's work — the same shape `drush sql:drop` already uses before it drops.
 */
async function ddev_import_db({ form, send, workspace }) {
  const projectName = String(form.projectName || '');
  if (!NAME_RE.test(projectName)) return send('<div class="msg error">Invalid project name.</div>', 400);
  const projectDir = path.join(workspaceDir(workspace), projectName);
  if (!ddevProjectName(projectDir)) return send('<div class="msg error">Not a DDEV project.</div>', 400);
  if (form.confirm !== 'yes') {
    return send('<div class="msg error">Importing replaces every table in the database — it needs confirmation.</div>', 400);
  }
  const backupsDir = loadWorkspaces()[workspace].backupsDir;
  const dump = ddevImport.findDump(backupsDir, form.dump);
  if (!dump) return send('<div class="msg error">No such dump in this workspace\'s backups.</div>', 404);
  const file = path.join(backupsDir, dump.name);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const cmdLine = `echo "Taking a snapshot first…" && ddev snapshot --name before-import-${stamp}`
    + ` && ddev import-db --file ${JSON.stringify(file)}`
    + ` && echo "Imported ${dump.name}. The database as it was is the snapshot before-import-${stamp}."`;
  const started = await startInScreen({
    workspace, project: projectName, projectDir, verb: 'import-db', cmdLine, label: `ddev import-db ${dump.name}`,
  });
  return send(screenStartedHtml(started, `ddev import-db ${dump.name}`, projectName),
    started.ok ? 200 : (started.already ? 409 : 500));
}

// One of the project's own `.ddev/commands/<service>/*`. The name is checked against
// what the project actually ships, so only a real command can be run.
async function ddev_project_command({ form, send, workspace }) {
  const projectName = String(form.projectName || '');
  if (!NAME_RE.test(projectName)) return send('<div class="msg error">Invalid project name.</div>', 400);
  const projectDir = path.join(workspaceDir(workspace), projectName);
  if (!ddevProjectName(projectDir)) return send('<div class="msg error">Not a DDEV project.</div>', 400);
  const cmd = String(form.command || '');
  if (!projectDdevCommands(projectDir).some((c) => c.name === cmd)) return send('<div class="msg error">This project does not ship that command.</div>', 400);
  const started = await startInScreen({ workspace, project: projectName, projectDir, verb: cmd, cmdLine: `ddev ${cmd}`, label: `ddev ${cmd}` });
  return send(screenStartedHtml(started, `ddev ${cmd}`, projectName), started.ok ? 200 : (started.already ? 409 : 500));
}

module.exports = {
  '/actions/ddev-project-command': ddev_project_command,
  '/actions/ddev-import-db': ddev_import_db,
  '/actions/ddev-restart': ddev_verb,
  '/actions/ddev-describe': ddev_verb,
  '/actions/ddev-logs': ddev_verb,
  '/actions/ddev-drush-cr': ddev_verb,
  '/actions/ddev-drush-uli': ddev_verb,
  '/actions/ddev-export-db': ddev_verb,
  '/actions/ddev-mutagen-sync': ddev_verb,
  '/actions/ddev-xdebug-on': ddev_verb,
  '/actions/ddev-xdebug-off': ddev_verb,
  '/actions/ddev-xdebug-status': ddev_verb,
  '/actions/ddev-auth-ssh': ddev_verb,
  '/actions/ddev-share': ddev_verb,
  '/actions/ddev-diagnose': ddev_verb,
  '/actions/ddev-tls-diagnose': ddev_verb,
  '/actions/ddev-port-diagnose': ddev_verb,
  '/actions/ddev-db-match': ddev_verb,
  '/actions/ddev-mutagen-status': ddev_verb,
  '/actions/ddev-mutagen-reset': ddev_verb,
  '/actions/ddev-drush-sql-drop': ddev_verb,
  '/actions/ddev-snapshot': ddev_verb,
  '/actions/ddev-snapshot-restore': ddev_verb,
  '/actions/ddev-snapshot-delete': ddev_verb,
  '/actions/ddev-drush-status': ddev_verb,
  '/actions/ddev-drush-cex': ddev_verb,
  '/actions/ddev-drush-cim': ddev_verb,
  '/actions/ddev-drush-updb': ddev_verb,
  '/actions/ddev-composer-update': ddev_verb,
  '/actions/ddev-composer-install': ddev_verb,
  '/actions/ddev-start': ddev_start,
  '/actions/ddev-stop': ddev_start,
};

// `ddev config` for a folder DDEV does not manage yet, or one it does. Every value is picked from the lists in
// ddev-options.js (the DDEV docs), so nothing typed reaches the shell line.
async function ddev_config({ form, send, workspace }) {
  const dir = workspaceDir(workspace);
  const projectName = String(form.projectName || '');
  if (!NAME_RE.test(projectName) || !listProjects(dir).includes(projectName)) {
    return send('<div class="msg error">Unknown project.</div>', 400);
  }
  const opts = require('../ddev-options');
  const args = ['config', '--auto=false', `--project-name=${projectName}`, ...opts.configArgs(form)];
  return screenAction(send, { workspace, project: projectName, projectDir: path.join(dir, projectName),
    verb: 'config', cmdLine: `ddev ${opts.shellArgs(args)}`, label: 'ddev config' });
}

module.exports['/actions/ddev-config'] = ddev_config;
module.exports.CONFIG_CHOICES = require('../ddev-options').CHOICES;
