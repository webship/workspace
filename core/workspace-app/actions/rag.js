/**
 * Building, searching, describing and dropping a project's RAG index.
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

const { listProjects, workspaceDir } = require('../workspaces');
const { esc } = require('../html');
const { jobFragment, run, runningJobKey, startJob } = require('../jobs');
const { NAME_RE } = require('../views');
const { milvusPost, ragCollectionName, ragCollections, ragInstanceFor } = require('../rag');
const handlers = {
  '/actions/ragify': async ({ form, res, send, workspace, req }) => {
    const dir = workspaceDir(workspace);
    const script = 'cmd-tools-ragify.sh';
    const projectName = String(form.projectName || '');
    if (!fs.existsSync(path.join(dir, script))) return send('<div class="msg error">This workspace has no ragify script.</div>', 400);
    if (!NAME_RE.test(projectName) || !listProjects(dir).includes(projectName)) {
      return send('<div class="msg error">Unknown project.</div>', 400);
    }
    // Two indexers writing one collection interleave their upserts, and the result is a
    // collection that is neither run's.
    const jobKey = `ragify:${workspace}/${projectName}`;
    if (runningJobKey(jobKey)) {
      return send('<div class="msg error">This project is already being indexed.</div>', 409);
    }
    const state = await ragCollections(ragInstanceFor(workspace, projectName));
    if (!state || !state.up) {
      return send(`<div class="msg error">${esc(ragInstanceFor(workspace, projectName))} is not running — start it in the RAG workspace first.</div>`, 409);
    }
    // The default mode is BM25: Milvus builds the sparse vectors itself, so no model, no key, and
    // nothing leaves this machine. Dense embeddings are opt-in from the command line.
    const id = startJob(`📚 Index <strong>${esc(projectName)}</strong>`, 'bash', [script, projectName], dir,
      { timeoutMs: 60 * 60 * 1000, echoLine: `bash ${script} ${projectName}`, key: jobKey });
    return send(jobFragment(id).html);
  },
  '/actions/rag-info': async ({ form, res, send, workspace, req }) => {
    const projectName = String(form.projectName || '');
    if (!NAME_RE.test(projectName)) return send('<div class="msg error">Unknown project.</div>', 400);
    const instance = ragInstanceFor(workspace, projectName);
    const collection = ragCollectionName(workspace, projectName);
    const stats = await milvusPost('/v2/vectordb/collections/describe', { collectionName: collection }, 6000, instance);
    if (!stats || stats.code !== 0) {
      return send(`<div class="msg error">Could not read ${esc(collection)} from ${esc(instance)}.</div>`, 409);
    }
    const count = await milvusPost('/v2/vectordb/entities/query',
      { collectionName: collection, filter: 'id >= 0', outputFields: ['count(*)'], limit: 1 }, 8000, instance);
    const chunks = count && count.code === 0 && count.data && count.data[0] ? count.data[0]['count(*)'] : null;
    const fields = (stats.data.fields || []).map((f) => f.name).join(', ');
    const functions = (stats.data.functions || []).map((f) => `${f.name} (${f.type})`).join(', ');
    return send(`
      <div class="msg assistant">
        <p><strong>${esc(collection)}</strong> on <strong>${esc(instance)}</strong></p>
        <pre>chunks:    ${chunks === null ? 'unknown' : esc(String(chunks))}
  fields:    ${esc(fields || '—')}
  functions: ${esc(functions || '—')}</pre>
        <p class="uk-text-meta">A function is what builds the sparse vector inside the database — that is
        what BM25 mode means, and why indexing needs no model and no key.</p>
      </div>`);
  },
  '/actions/rag-remove': async ({ form, res, send, workspace, req }) => {
    if (form.confirm !== 'yes') return send('<div class="msg error">Deleting requires confirmation.</div>', 400);
    const projectName = String(form.projectName || '');
    if (!NAME_RE.test(projectName)) return send('<div class="msg error">Unknown project.</div>', 400);
    if (runningJobKey(`ragify:${workspace}/${projectName}`)) {
      return send('<div class="msg error">This project is being indexed — wait for it to finish.</div>', 409);
    }
    const instance = ragInstanceFor(workspace, projectName);
    const collection = ragCollectionName(workspace, projectName);
    // Milvus's drop is idempotent and answers code 0 for a collection that was never there, so
    // without this the dashboard would report having deleted something that did not exist.
    const state = await ragCollections(instance);
    if (!state || !state.up) {
      return send(`<div class="msg error">${esc(instance)} is not running — nothing can be dropped while it is down.</div>`, 409);
    }
    if (!state.list.includes(collection)) {
      return send(`<div class="msg error">No index to delete — ${esc(collection)} is not in ${esc(instance)}.</div>`, 404);
    }
    const out = await milvusPost('/v2/vectordb/collections/drop', { collectionName: collection }, 10000, instance);
    if (!out || out.code !== 0) {
      return send(`<div class="msg error">Could not drop ${esc(collection)}: ${esc((out && out.message) || 'no answer from ' + instance)}</div>`, 409);
    }
    res.setHeader('HX-Trigger', 'refresh-projects');
    return send(`<div class="msg assistant">🗑️ Dropped <strong>${esc(collection)}</strong>. It is regenerable — index the project again whenever you need it.</div>`);
  },
  '/actions/rag-mcp-command': async ({ form, res, send, workspace, req }) => {
    const projectName = String(form.projectName || '');
    if (!NAME_RE.test(projectName)) return send('<div class="msg error">Unknown project.</div>', 400);
    const instance = ragInstanceFor(workspace, projectName);
    const collection = ragCollectionName(workspace, projectName);
    return send(`
      <div class="msg assistant">
        <p>Serve <strong>${esc(collection)}</strong> to the Claude Code CLI:</p>
        <pre>cd ~/workspace/rag &amp;&amp; bash cmd-milvus-mcp.sh ${esc(instance)}</pre>
        <p class="uk-text-meta">Run it <strong>on the host</strong>. It prints the <code>claude mcp add</code> line for this
        instance, including the gRPC port it was published on — the database is reached on 127.0.0.1 from
        outside its own network, so the port is the part worth not guessing.</p>
      </div>`);
  },
};

module.exports = handlers;
