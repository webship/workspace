/**
 * Setting a project's testing environment up, running its suite, and deleting what a run left.
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
  startInScreen, screenStartedHtml,
} = require('../jobs');
const {
  milvusProjectName, ragInstances, ragBindings, ragInstanceFor, ragWriteBinding,
  ragCollectionName, milvusPost, ragCollections, ragInvalidate,
} = require('../rag');
const {
  findTestReports, testReportFor, invalidateTestReports, testMediaHtml, testingStackOf,
} = require('../test-reports');
const { NAME_RE, SCRIPT_RE } = require('../validate');
const { commandBlock } = require('../command-block');
const { wsUrl } = require('../urls');
const { findGraphifyScript, findRagifyScript } = require('../workspaces');
const { DDEV_ACTIONS } = require('../ddev');

  // Delete one screenshot/recording, or all of a report's.
  //
  // Evidence from a finished run, and the next run writes its own — so it is deletable, unlike
  // anything else in a project. Three things keep it safe:
  //   * no path ever comes from the request. The name is looked up in the report's OWN file list,
  //     the same rule the viewer uses, so a crafted name resolves to nothing.
  //   * every resolved file is realpath-checked to be inside the project directory.
  //   * a screenshot takes its DOM dump with it: the dump is written per failed step and is
  //     meaningless once the picture is gone.
async function test_media_delete({ form, res, send, workspace, pathname }) {
    const dir = workspaceDir(workspace);
    const projectName = String(form.projectName || '');
    const kind = String(form.kind || '') === 'videos' ? 'videos' : 'shots';
    if (form.confirm !== 'yes') return send('<div class="msg error">Deleting requires confirmation.</div>', 400);
    if (!NAME_RE.test(projectName) || !fs.existsSync(path.join(dir, projectName))) {
      return send('<div class="msg error">Unknown project.</div>', 400);
    }
    const t = testReportFor(dir, projectName);
    if (!t) return send('<div class="msg error">No report for this project.</div>', 404);

    const listed = kind === 'videos' ? t.report.videos : t.report.shots;
    const wanted = String(form.name || '');
    const picked = form.all === 'yes' ? listed : listed.filter((f) => f.name === wanted);
    if (!picked.length) return send('<div class="msg error">That file is not in the report.</div>', 404);

    // A screenshot's DOM dump shares its stem.
    const stem = (n) => n.replace(/\.(png|jpe?g|html?)$/i, '');
    const doms = kind === 'shots'
      ? t.report.doms.filter((d) => picked.some((f) => stem(d.name) === stem(f.name)))
      : [];

    const root = fs.realpathSync(path.join(dir, projectName));
    let removed = 0;
    let bytes = 0;
    for (const f of [...picked, ...doms]) {
      const full = path.join(dir, projectName, f.file);
      let real;
      try {
        real = fs.realpathSync(full);
        if (!real.startsWith(root + path.sep)) continue;   // outside the project: not ours to delete
      } catch (_) { continue; }                            // already gone
      try {
        bytes += fs.statSync(real).size;
        fs.unlinkSync(real);
        removed += 1;
      } catch (_) { /* raced with something else */ }
    }
    invalidateTestReports();
    res.setHeader('HX-Trigger', 'refresh-projects');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(`<div class="msg assistant test-media-flash">🗑️ Deleted ${removed} file${removed === 1 ? '' : 's'} (${esc(humanSize(bytes))}).</div>`
      + testMediaHtml(workspace, projectName, kind, 1));
}

  // Set up a project's testing environment, and run its suite. Both are the workspace command,
  // run as a job — they take minutes (an add-on install pulls browsers; a Webship suite is
  // hundreds of scenarios) and both must not overlap on one project: two configures race on the
  // same scaffold, and two runs write the same report.
async function testing_configure({ form, res, send, workspace, pathname }) {
    const dir = workspaceDir(workspace);
    const projectName = String(form.projectName || '');
    const script = 'cmd-tools-testing.sh';
    const isRun = pathname.endsWith('-run');
    if (!fs.existsSync(path.join(dir, script))) return send('<div class="msg error">No testing script in this workspace.</div>', 400);
    if (!NAME_RE.test(projectName) || !listProjects(dir).includes(projectName)) {
      return send('<div class="msg error">Unknown project.</div>', 400);
    }
    if (isRun && testingStackOf(dir, projectName) === 'none') {
      return send('<div class="msg error">No testing stack in this project yet — set the environment up first.</div>', 409);
    }
    const jobKey = `testing:${workspace}/${projectName}`;
    if (runningJobKey(jobKey)) {
      return send('<div class="msg error">A testing job is already running for this project.</div>', 409);
    }
    const args = isRun ? [script, projectName, '--run'] : [script, projectName];
    const started = await startInScreen({ workspace, project: projectName, projectDir: dir, ownerDir: path.join(dir, projectName),
      verb: isRun ? 'tests' : 'tests-setup', cmdLine: `bash ${JSON.stringify(script)} ${JSON.stringify(projectName)}${isRun ? ' --run' : ''}`,
      label: isRun ? 'run the tests' : 'set up testing' });
    return send(screenStartedHtml(started, isRun ? 'run the tests' : 'set up testing', projectName), started.ok ? 200 : (started.already ? 409 : 500));
}

module.exports = {
  '/actions/test-media-delete': test_media_delete,
  '/actions/testing-configure': testing_configure,
  '/actions/testing-run': testing_configure,
};
