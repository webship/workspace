/**
 * Building, sharing and deleting a project's knowledge graph.
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

const { ROOT, listProjects, workspaceDir } = require('../workspaces');
const { esc } = require('../html');
const { jobFragment, run, runningJobKey, startJob } = require('../jobs');
const { NAME_RE } = require('../views');
const { GRAPH_FILES, graphStoreDir } = require('../graphs');
const handlers = {
  '/actions/graphify': async ({ form, res, send, workspace, req }) => {
    const dir = workspaceDir(workspace);
    const script = 'cmd-tools-graphify.sh';
    const projectName = String(form.projectName || '');
    if (!fs.existsSync(path.join(dir, script))) return send('<div class="msg error">This workspace has no graphify script.</div>', 400);
    if (!NAME_RE.test(projectName) || !listProjects(dir).includes(projectName)) {
      return send('<div class="msg error">Unknown project.</div>', 400);
    }
    // graphify has no cross-process lock: two runs against one output directory race on the
    // manifest and the graph itself, and the loser's atomic replace silently wins.
    const jobKey = `graphify:${workspace}/${projectName}`;
    if (runningJobKey(jobKey)) {
      return send('<div class="msg error">A graph is already being built for this project.</div>', 409);
    }
    // Local parsing only — no API key, nothing leaves the machine. A large codebase takes a
    // while, so it gets the long build timeout rather than the default.
    const id = startJob(`🕸️ Graph <strong>${esc(projectName)}</strong>`, 'bash', [script, projectName], dir,
      { timeoutMs: 60 * 60 * 1000, echoLine: `bash ${script} ${projectName}`, key: jobKey });
    return send(jobFragment(id).html);
  },
  '/actions/graph-remove': async ({ form, res, send, workspace, req }) => {
    if (form.confirm !== 'yes') return send('<div class="msg error">Deleting requires confirmation.</div>', 400);
    const projectName = String(form.projectName || '');
    // The project itself may be long gone — a graph outlives it, and that is exactly a graph
    // worth throwing away. So the name is validated but not looked up.
    if (!NAME_RE.test(projectName)) return send('<div class="msg error">Unknown project.</div>', 400);
    if (runningJobKey(`graphify:${workspace}/${projectName}`)) {
      return send('<div class="msg error">A graph run is in progress for this project — wait for it to finish.</div>', 409);
    }
    const out = graphStoreDir(workspace, projectName);
    let real;
    try {
      real = fs.realpathSync(out);
      const base = fs.realpathSync(path.join(ROOT, 'graphs'));
      // Symlinks are resolved before anything is deleted: a project directory that is a link
      // would otherwise put rm outside the graph store entirely.
      if (!real.startsWith(base + path.sep) || !fs.statSync(real).isDirectory()) throw new Error('outside the store');
    } catch (_) {
      return send('<div class="msg error">No graph to delete.</div>', 404);
    }
    fs.rmSync(real, { recursive: true, force: true });
    res.setHeader('HX-Trigger', 'refresh-projects');
    return send(`<div class="msg assistant">🗑️ Deleted the graph of <strong>${esc(projectName)}</strong>. It is regenerable — build it again whenever you need it.</div>`);
  },
  '/actions/graph-mcp-command': async ({ form, res, send, workspace, req }) => {
    const projectName = String(form.projectName || '');
    if (!NAME_RE.test(projectName)) return send('<div class="msg error">Unknown project.</div>', 400);
    const graph = path.join(graphStoreDir(workspace, projectName), GRAPH_FILES.json);
    if (!fs.existsSync(graph)) return send('<div class="msg error">No graph yet — build it first.</div>', 409);
    const shown = graph.replace(ROOT, '~/workspace');
    return send(`
      <div class="msg assistant">
        <p>Serve the <strong>${esc(workspace)}/${esc(projectName)}</strong> graph to the Claude Code CLI:</p>
        <pre>claude mcp add --scope user graph-${esc(workspace)}-${esc(projectName)} -- graphify-mcp ${esc(shown)}</pre>
        <p class="uk-text-meta">Run it <strong>on the host</strong>, in a terminal. It speaks stdio, so there is no port
        and no daemon — the CLI starts the server when a session needs it. Open a NEW session to see the tools;
        rebuilding the graph needs no re-registration.</p>
      </div>`);
  },
};

module.exports = handlers;
