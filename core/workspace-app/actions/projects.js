/**
 * Building, removing, backing up and restoring a project, and running its tests.
 *
 * One module per area of the dashboard, each exporting the handlers it owns keyed by the path
 * that reaches them. server.js merges the maps and dispatches; nothing here knows about routing,
 * and adding an action is adding an entry rather than another branch in a 650-line function.
 *
 * Every handler takes the same context: the parsed form, the response, a `send` that writes an
 * HTML fragment, and the workspace the request named.
 */

const fs = require('fs');
const path = require('path');

const { builderLabel, findBackupScript, findBuilderScripts, findRemoveScript, listProjects, loadWorkspaces, workspaceDir } = require('../workspaces');
const { esc } = require('../html');
const { jobFragment, run, runningJobKey, startJob } = require('../jobs');
const { NAME_RE, SCRIPT_RE, parseBuilderArgs, testingStackOf } = require('../views');
const handlers = {
  '/actions/build': async ({ form, res, send, workspace, req, pathname }) => {
    const dir = workspaceDir(workspace);
    const script = String(form.script || '');
    const projectName = String(form.projectName || '');
    if (!SCRIPT_RE.test(script) || !findBuilderScripts(dir).includes(script)) return send('<div class="msg error">Unknown build script.</div>', 400);
    // cmd-build-<thing>.sh builds one particular profile or theme into a directory it already
    // knows, so it takes no name — asking for one and passing it would hand the script an
    // argument it never reads.
    const takesName = /^cmd-.*-project\.sh$/.test(script);
    if (takesName && !NAME_RE.test(projectName)) return send('<div class="msg error">Invalid project name.</div>', 400);
    // Structured Arguments UI fields (argb: checkboxes, argv: value inputs)
    // take precedence; fall back to the legacy free-text `flags` (kept for
    // the API and the AI assistant).
    const schema = parseBuilderArgs(dir, script);
    const schemaFlags = new Map(schema.map((a) => [a.flag, a]));
    let flags = [];
    let usedStructured = false;
    for (const [k, v] of Object.entries(form)) {
      if (k.startsWith('argb:')) {
        usedStructured = true;
        const flag = k.slice(5);
        if (schemaFlags.has(flag)) flags.push(flag);
      } else if (k.startsWith('argv:')) {
        usedStructured = true;
        const flag = k.slice(5);
        const meta = schemaFlags.get(flag);
        const val = String(v).trim();
        if (meta && val && val !== String(meta.def)) flags.push(`${flag}=${val}`);
      }
    }
    if (!usedStructured) {
      flags = String(form.flags || '--install').trim().split(/\s+/).filter((f) => /^--[a-zA-Z0-9=_.,:@^~\/-]*$/.test(f));
    }
    // Full distribution builds (composer create-project + install) can far
    // exceed the default 15m on a cold composer cache.
    // Echo the exact final command as the first terminal line.
    const argv = takesName ? [script, projectName, ...flags] : [script, ...flags];
    const shown = takesName ? projectName : builderLabel(dir, script);
    const finalCmd = `bash ${argv.join(' ')}`;
    const id = startJob(`🏗️ Build <strong>${esc(shown)}</strong> (${esc(builderLabel(dir, script))})`, 'bash', argv, dir, { timeoutMs: 60 * 60 * 1000, echoLine: finalCmd });
    return send(jobFragment(id).html);
  },
  '/actions/quick-build': null, // set below to the same handler as /actions/build,
  '/actions/testing-configure': async ({ form, res, send, workspace, req, pathname }) => {
    const dir = workspaceDir(workspace);
    const projectName = String(form.projectName || '');
    const script = 'cmd-tools-testing.sh';
    const isRun = pathname.endsWith('-run');
    if (!fs.existsSync(path.join(dir, script))) return send('<div class="msg error">No testing script in this workspace.</div>', 400);
    if (!NAME_RE.test(projectName) || !listProjects(dir).includes(projectName)) {
      return send('<div class="msg error">Unknown project.</div>', 400);
    }
    // Running a suite before the stack exists fails deep inside cucumber; say so here instead.
    if (isRun && testingStackOf(dir, projectName) === 'none') {
      return send('<div class="msg error">No testing stack in this project yet — set the environment up first.</div>', 409);
    }
    const jobKey = `testing:${workspace}/${projectName}`;
    if (runningJobKey(jobKey)) {
      return send('<div class="msg error">A testing job is already running for this project.</div>', 409);
    }
    const args = isRun ? [script, projectName, '--run'] : [script, projectName];
    // A suite is minutes, not seconds: the default job timeout would kill a real run.
    const id = startJob(`${isRun ? '🧪 Run tests' : '🧰 Set up testing'} <strong>${esc(projectName)}</strong>`,
      'bash', args, dir,
      { timeoutMs: 90 * 60 * 1000, echoLine: `bash ${args.join(' ')}`, key: jobKey });
    return send(jobFragment(id).html);
  },
  '/actions/testing-run': null, // set below to the same handler as /actions/testing-configure,
  '/actions/backup': async ({ form, res, send, workspace, req, pathname }) => {
    const dir = workspaceDir(workspace);
    const script = findBackupScript(dir);
    if (!script) return send('<div class="msg error">No backup script in this workspace.</div>', 400);
    if (!NAME_RE.test(String(form.projectName || ''))) return send('<div class="msg error">Invalid project name.</div>', 400);
    const id = startJob(`💾 Backup <strong>${esc(form.projectName)}</strong>`, 'bash', [script, form.projectName], dir);
    return send(jobFragment(id).html);
  },
  '/actions/remove': async ({ form, res, send, workspace, req, pathname }) => {
    const dir = workspaceDir(workspace);
    const script = findRemoveScript(dir);
    if (!script) return send('<div class="msg error">No remove script in this workspace.</div>', 400);
    if (form.confirm !== 'yes') return send('<div class="msg error">Destructive action requires confirmation.</div>', 400);
    if (!NAME_RE.test(String(form.projectName || ''))) return send('<div class="msg error">Invalid project name.</div>', 400);
    const id = startJob(`🗑️ Remove <strong>${esc(form.projectName)}</strong>`, 'bash', [script, form.projectName], dir);
    return send(jobFragment(id).html);
  },
  '/actions/restore': async ({ form, res, send, workspace, req, pathname }) => {
    const meta = loadWorkspaces()[workspace];
    const file = String(form.file || '');
    if (form.confirm !== 'yes') return send('<div class="msg error">Restore requires confirmation.</div>', 400);
    // Backup filenames come from the backup scripts: <ws>---<project>--<stamp>.tar.gz
    const m = file.match(/^([a-z]+)---([a-zA-Z0-9_.-]+)--([0-9_-]+)\.tar\.gz$/);
    if (!m) return send('<div class="msg error">Unrecognized backup filename.</div>', 400);
    const projectName = m[2];
    // `.` and `..` would name the workspace directory itself as the restore target.
    if (/^\.+$/.test(projectName)) return send('<div class="msg error">Unrecognized backup filename.</div>', 400);
    const archive = path.join(meta.backupsDir, file);
    if (!fs.existsSync(archive)) return send('<div class="msg error">Backup file not found.</div>', 404);
    const targetDir = path.join(meta.dir, projectName);
    if (fs.existsSync(targetDir)) {
      return send(`<div class="msg error">'${esc(projectName)}' already exists in this workspace — remove it first, then restore.</div>`, 409);
    }

    // The archives were created from inside the workspace folder, so they
    // extract back to <workspace>/<project>/. Then, if a matching DB dump
    // sits next to the archive, bring the project up and import it — all as
    // one streaming job. (file/projectName are regex-validated above, so
    // embedding them in the shell line is safe.)
    const dbCandidates = [`${file.replace(/\.tar\.gz$/, '')}-db.sql.gz`, `${file.replace(/\.tar\.gz$/, '')}-db.sql`];
    const dbFile = dbCandidates.map((f) => path.join(meta.backupsDir, f)).find((f) => fs.existsSync(f));
    let shellLine = `set -e; echo "Extracting ${file}…"; tar -xzf '${archive}'`;
    if (dbFile) {
      shellLine += ` && if [ -f '${targetDir}/.ddev/config.yaml' ]; then cd '${targetDir}' && ddev start -y && echo "Importing database…" && ddev import-db --file='${dbFile}'; else echo "Not a DDEV project — import the DB dump manually: ${path.basename(dbFile)}"; fi`;
    }
    const id = startJob(`♻️ Restore <strong>${esc(projectName)}</strong> from <code>${esc(file)}</code>`, 'bash', ['-c', shellLine], meta.dir);
    return send(jobFragment(id).html);
  },
  '/actions/backup-delete': async ({ form, res, send, workspace, req, pathname }) => {
    const meta = loadWorkspaces()[workspace];
    const file = String(form.file || '');
    if (form.confirm !== 'yes') return send('<div class="msg error">Deleting a backup requires confirmation.</div>', 400);
    // Two shapes live in a backups folder: a project archive from the backup scripts, and a
    // standalone dump from a row's "Export the database". Both are deletable here — a file the
    // dashboard writes has to be a file the dashboard can remove.
    const isArchive = /^[a-z]+---[a-zA-Z0-9_.-]+--[0-9_-]+\.tar\.gz$/.test(file) && !file.includes('/');
    const isDump = /^[a-zA-Z0-9_-]+--db--[0-9-]+\.sql\.gz$/.test(file);
    if (!isArchive && !isDump) return send('<div class="msg error">Unrecognized backup filename.</div>', 400);
    const archive = path.join(meta.backupsDir, file);
    if (!fs.existsSync(archive)) return send('<div class="msg error">Backup file not found.</div>', 404);
    const removed = [];
    // An archive carries a companion dump beside it; a standalone dump is only itself.
    for (const f of isDump ? [archive] : [archive,
      path.join(meta.backupsDir, file.replace(/\.tar\.gz$/, '-db.sql.gz')),
      path.join(meta.backupsDir, file.replace(/\.tar\.gz$/, '-db.sql'))]) {
      if (fs.existsSync(f)) { fs.unlinkSync(f); removed.push(path.basename(f)); }
    }
    res.setHeader('HX-Trigger', 'refresh-projects');
    return send(`<div class="msg assistant"><p>🗑️ Deleted backup:</p><pre>${esc(removed.join('\n'))}</pre></div>`);
  },
};

// The same handler, reached by a second path.
handlers['/actions/quick-build'] = handlers['/actions/build'];

// The same handler, reached by a second path.
handlers['/actions/testing-run'] = handlers['/actions/testing-configure'];

module.exports = handlers;
