/**
 * Indexing a project into Milvus, searching it, and choosing which server holds it.
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
const { DDEV_ACTIONS } = require('../ddev');

async function rag_mcp_command({ form, res, send, workspace, pathname }) {
    const projectName = String(form.projectName || '');
    if (!NAME_RE.test(projectName)) return send('<div class="msg error">Unknown project.</div>', 400);
    const instance = ragInstanceFor(workspace, projectName);
    const collection = ragCollectionName(workspace, projectName);
    return send(commandBlock(
      `Serve the ${instance} RAG server to the Claude Code CLI`,
      [`cd ${ROOT}/rag && bash cmd-milvus-mcp.sh ${instance} -a register`,
        `claude mcp add --scope user rag-${instance} -- uvx --from mcp-server-milvus==0.1.1.dev9 --with "mcp<2" mcp-server-milvus --milvus-uri http://127.0.0.1:19530`],
      `Run either one <strong>on the host</strong>, in a terminal. One registration covers the whole `
      + `server, so every collection on it — including <code>${esc(collection)}</code> — is searchable `
      + `from the same 13 tools, and a new index needs no new registration. The workspace command is `
      + `the safer of the two: it resolves the published port for you and proves the server starts `
      + `before registering it.`));
}

  // Bind a project to a RAG server, or unbind it back to the shared default.
async function rag_bind({ form, res, send, workspace, pathname }) {
    const projectName = String(form.projectName || '');
    const instance = String(form.instance || '');
    if (!NAME_RE.test(projectName)) return send('<div class="msg error">Unknown project.</div>', 400);
    if (instance && !ragInstances().includes(instance)) {
      return send('<div class="msg error">No such RAG server in the rag workspace.</div>', 400);
    }
    ragWriteBinding(workspace, projectName, instance);
    ragInvalidate();
    res.setHeader('HX-Trigger', 'refresh-projects');
    const where = instance || `${milvusProjectName()} (the shared default)`;
    return send(`<div class="msg assistant">🔗 <strong>${esc(projectName)}</strong> now indexes into <strong>${esc(where)}</strong>.
      Re-index it to fill that server — the old collection stays where it was, so drop it first if it is stale.</div>`);
}

  // Build a new RAG server, and bind this project to it. Two steps deliberately kept in one
  // action: a server built and then not bound is a 2 GB stack nothing uses.
async function rag_server_new({ form, res, send, workspace, pathname }) {
    const projectName = String(form.projectName || '');
    const name = String(form.name || '').trim();
    if (!NAME_RE.test(projectName)) return send('<div class="msg error">Unknown project.</div>', 400);
    if (!NAME_RE.test(name)) return send('<div class="msg error">A server name is letters, digits, dashes and underscores.</div>', 400);
    if (ragInstances().includes(name)) return send(`<div class="msg error">A RAG server called ${esc(name)} already exists — pick it from the list instead.</div>`, 409);
    const ragDir = workspaceDir('rag');
    const script = 'cmd-milvus-project.sh';
    if (!fs.existsSync(path.join(ragDir, script))) return send('<div class="msg error">No Milvus builder in the rag workspace.</div>', 400);
    const jobKey = `milvus-build:${name}`;
    if (runningJobKey(jobKey)) return send('<div class="msg error">That server is already being built.</div>', 409);
    // Bound first: the build takes minutes, and the binding is what makes the row point at the new
    // server the moment it answers.
    ragWriteBinding(workspace, projectName, name);
    ragInvalidate();
    return screenAction(send, { workspace: 'rag', project: name, projectDir: ragDir, verb: 'milvus-build',
      cmdLine: `bash ${JSON.stringify(script)} ${JSON.stringify(name)}`, label: `build the RAG server ${name}` });
}

  // Build or rebuild a project's RAG index. The script does the work — this only guards the
  // arguments and keeps two runs off one collection, since a re-index drops and recreates it and
  // two of those racing would leave half of each.
async function ragify({ form, res, send, workspace, pathname }) {
    const dir = workspaceDir(workspace);
    const script = findRagifyScript(dir);
    const projectName = String(form.projectName || '');
    if (!script) return send('<div class="msg error">No ragify script in this workspace.</div>', 400);
    if (!NAME_RE.test(projectName) || !listProjects(dir).includes(projectName)) {
      return send('<div class="msg error">Unknown project.</div>', 400);
    }
    const instance = ragInstanceFor(workspace, projectName);
    const { up } = await ragCollections(instance);
    if (!up) {
      return send(`<div class="msg error">The ${esc(instance)} RAG server is not running — start it from the <a href="${wsUrl('rag')}">RAG workspace</a> first.</div>`, 409);
    }
    const jobKey = `ragify:${workspace}/${projectName}`;
    if (runningJobKey(jobKey)) {
      return send('<div class="msg error">This project is already being indexed.</div>', 409);
    }
    // BM25 inside the database: no embedding model, no API key, nothing leaves the machine. Long
    // timeout because a large tree is thousands of chunks.
    const started = await startInScreen({ workspace, project: projectName, projectDir: dir, ownerDir: path.join(dir, projectName), verb: 'ragify',
      cmdLine: `bash ${JSON.stringify(script)} ${JSON.stringify(projectName)}`, label: 'ragify' });
    return send(screenStartedHtml(started, 'ragify', projectName), started.ok ? 200 : (started.already ? 409 : 500));
}

async function rag_info({ form, res, send, workspace, pathname }) {
    const projectName = String(form.projectName || '');
    if (!NAME_RE.test(projectName)) return send('<div class="msg error">Unknown project.</div>', 400);
    const collection = ragCollectionName(workspace, projectName);
    const instance = ragInstanceFor(workspace, projectName);
    const described = await milvusPost('/v2/vectordb/collections/describe', { collectionName: collection }, 4000, instance);
    const stats = await milvusPost('/v2/vectordb/collections/get_stats', { collectionName: collection }, 4000, instance);
    if (!described || described.code !== 0) {
      return send('<div class="msg error">Milvus did not answer for this collection — is the instance running?</div>', 409);
    }
    const fields = (described.data.fields || []).map((f) => f.name);
    const functions = (described.data.functions || []).map((f) => `${f.name} (${f.type || 'function'})`);
    const rows = stats && stats.code === 0 ? stats.data.rowCount : '?';
    return send(`<div class="msg assistant">
      <strong>${esc(collection)}</strong><br>
      Chunks: <strong>${esc(String(rows))}</strong><br>
      Fields: <code>${esc(fields.join(', '))}</code><br>
      Functions: <code>${esc(functions.join(', ') || '—')}</code><br>
      <span class="uk-text-meta">Retrieval is BM25, built inside Milvus — no embedding model and no API key.</span>
    </div>`);
}

  // Search one index. Straight over Milvus's REST API rather than through the Python worker: the
  // dashboard container has no pymilvus, and full-text search on a BM25 function field takes the
  // query as plain text in `data`.
async function rag_search({ form, res, send, workspace, pathname }) {
    const projectName = String(form.projectName || '');
    const query = String(form.query || '').trim();
    if (!NAME_RE.test(projectName)) return send('<div class="msg error">Unknown project.</div>', 400);
    if (!query) return send('<p class="uk-text-meta">Type a question first.</p>');
    const collection = ragCollectionName(workspace, projectName);
    const body = await milvusPost('/v2/vectordb/entities/search', {
      collectionName: collection,
      data: [query],
      annsField: 'sparse',
      limit: 8,
      outputFields: ['path', 'start_line', 'end_line', 'text'],
    }, 20000, ragInstanceFor(workspace, projectName));
    if (!body || body.code !== 0) {
      return send(`<div class="msg error">Milvus refused the search${body && body.message ? `: ${esc(body.message)}` : ''}.</div>`);
    }
    const hits = body.data || [];
    if (!hits.length) return send(`<p class="uk-text-meta">No passage in <code>${esc(collection)}</code> matches ${esc(query)}.</p>`);
    const cards = hits.map((h) => {
      // The path is indexed as the first line of the chunk (so a filename matches even when the
      // words are not in the file) — show the body, not that duplicate.
      const text = String(h.text || '');
      const nl = text.indexOf('\n');
      const bodyText = nl === -1 ? text : text.slice(nl + 1);
      return `<div class="uk-card uk-card-default uk-card-small uk-card-body uk-margin-small">
        <div class="uk-text-bold">${esc(h.path)}<span class="uk-text-meta">:${esc(String(h.start_line))}-${esc(String(h.end_line))}</span>
          <span class="uk-label">score ${esc(String(Math.round((h.distance || 0) * 100) / 100))}</span></div>
        <pre class="uk-margin-small-top" style="max-height:16rem;overflow:auto"><code>${esc(bodyText.split('\n').slice(0, 24).join('\n'))}</code></pre>
      </div>`;
    }).join('');
    return send(`<p class="uk-text-meta">${hits.length} passages for ${esc(query)} in <code>${esc(collection)}</code>, best first.</p>${cards}`);
}

  // Drop one index. Regenerable by definition — a re-index rebuilds it from the tree — and the
  // project itself is never touched: nothing of the index lives in it.
async function rag_remove({ form, res, send, workspace, pathname }) {
    if (form.confirm !== 'yes') return send('<div class="msg error">Deleting requires confirmation.</div>', 400);
    const projectName = String(form.projectName || '');
    if (!NAME_RE.test(projectName)) return send('<div class="msg error">Unknown project.</div>', 400);
    if (runningJobKey(`ragify:${workspace}/${projectName}`)) {
      return send('<div class="msg error">An index run is in progress for this project — wait for it to finish.</div>', 409);
    }
    const collection = ragCollectionName(workspace, projectName);
    const body = await milvusPost('/v2/vectordb/collections/drop', { collectionName: collection }, 4000,
      ragInstanceFor(workspace, projectName));
    if (!body || body.code !== 0) {
      return send('<div class="msg error">Milvus did not drop the collection — is the instance running?</div>', 409);
    }
    ragInvalidate();
    res.setHeader('HX-Trigger', 'refresh-projects');
    return send(`<div class="msg assistant">🗑️ Deleted the index <strong>${esc(collection)}</strong>. Rebuild it any time from the RAG menu.</div>`);
}

module.exports = {
  '/actions/rag-mcp-command': rag_mcp_command,
  '/actions/rag-bind': rag_bind,
  '/actions/rag-server-new': rag_server_new,
  '/actions/ragify': ragify,
  '/actions/rag-info': rag_info,
  '/actions/rag-search': rag_search,
  '/actions/rag-remove': rag_remove,
};
