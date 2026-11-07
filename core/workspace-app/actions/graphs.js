/**
 * Building a project's knowledge graph, and what you do with it afterwards.
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
const { wsUrl } = require('../urls');
const { findGraphifyScript, findRagifyScript } = require('../workspaces');
const { DDEV_ACTIONS } = require('../ddev');

async function graphify({ form, res, send, workspace, pathname }) {
    const dir = workspaceDir(workspace);
    const script = findGraphifyScript(dir);
    const projectName = String(form.projectName || '');
    if (!script) return send('<div class="msg error">No graphify script in this workspace.</div>', 400);
    if (!NAME_RE.test(projectName) || !listProjects(dir).includes(projectName)) {
      return send('<div class="msg error">Unknown project.</div>', 400);
    }
    // graphify has no cross-process lock: two runs against one graphify-out/
    // race on manifest.json, graph.json and cache/ast, and the loser's atomic
    // replace silently wins, corrupting the incremental gate.
    const jobKey = `graphify:${workspace}/${projectName}`;
    if (runningJobKey(jobKey)) {
      return send('<div class="msg error">A graph is already being built for this project.</div>', 409);
    }
    // Local AST extraction only: no API key, nothing leaves the machine. Big
    // codebases take a while, so it gets the long build timeout.
    const started = await startInScreen({ workspace, project: projectName, projectDir: dir, ownerDir: path.join(dir, projectName), verb: 'graphify',
      cmdLine: `bash ${JSON.stringify(script)} ${JSON.stringify(projectName)}`, label: 'graphify' });
    return send(screenStartedHtml(started, 'graphify', projectName), started.ok ? 200 : (started.already ? 409 : 500));
}

  // Commands the dashboard SHOWS rather than runs, with a copy button each.
  //
  // Two kinds end up here. `claude mcp add` writes ~/.claude.json — the CLI configuration of the
  // person at the keyboard, not of this web request. The Upsun pulls need cloud credentials this
  // container does not have and replace local data. Both are worth reading before they happen.
async function graph_mcp_command({ form, res, send, workspace, pathname }) {
    const projectName = String(form.projectName || '');
    if (!NAME_RE.test(projectName)) return send('<div class="msg error">Unknown project.</div>', 400);
    const graph = path.join(graphStoreDir(workspace, projectName), 'graph.json');
    if (!fs.existsSync(graph)) return send('<div class="msg error">No graph yet — build it first.</div>', 409);
    return send(commandBlock(
      `Serve the ${workspace}/${projectName} graph to the Claude Code CLI`,
      [`cd ${ROOT}/graphs && bash cmd-tools-graphs.sh ${workspace}/${projectName} -a mcp-register`,
        `claude mcp add --scope user graph-${workspace}-${projectName} -- graphify-mcp ${graph.replace(ROOT, '~/workspace')}`],
      'Run either one <strong>on the host</strong>, in a terminal. The first is the workspace command; '
      + 'the second is what it runs. stdio, so there is no port and no daemon — the CLI starts the server '
      + 'when a session needs it. Open a NEW session to see the tools; rebuilding the graph needs no '
      + 're-registration.'));
}

  // Delete a project's graph. Bounded to graphs/<workspace>/<project> — the whole point is that a
  // graph is regenerable, so this is the one cheap thing to throw away. The project itself is
  // never touched: nothing of the graph lives in it.
async function graph_remove({ form, res, send, workspace, pathname }) {
    if (form.confirm !== 'yes') return send('<div class="msg error">Deleting requires confirmation.</div>', 400);
    const projectName = String(form.projectName || '');
    // The project may be gone — a graph outlives it, and that is exactly a graph worth deleting.
    if (!NAME_RE.test(projectName)) {
      return send('<div class="msg error">Unknown project.</div>', 400);
    }
    if (runningJobKey(`graphify:${workspace}/${projectName}`)) {
      return send('<div class="msg error">A graph run is in progress for this project — wait for it to finish.</div>', 409);
    }
    const out = graphStoreDir(workspace, projectName);
    let real;
    try {
      real = fs.realpathSync(out);
      const base = fs.realpathSync(path.join(ROOT, 'graphs'));
      if (!real.startsWith(base + path.sep)) throw new Error('outside');
    } catch (_) { return send('<div class="msg assistant">No graph to delete.</div>'); }
    fs.rmSync(real, { recursive: true, force: true });
    res.setHeader('HX-Trigger', 'refresh-projects');
    return send(`<div class="msg assistant">🗑️ Deleted the graph for <strong>${esc(projectName)}</strong>. Rebuild it any time from the Graph menu.</div>`);
}

module.exports = {
  '/actions/graphify': graphify,
  '/actions/graph-mcp-command': graph_mcp_command,
  '/actions/graph-remove': graph_remove,
};
