/*
 * workspace dashboard — basic Node.js (node:http, no framework) + HTMX.
 * All interactivity is server-rendered HTML fragments swapped in by HTMX;
 * the only client scripts are the vendored htmx.min.js and a tiny ui.js.
 */
const http = require('http');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const querystring = require('querystring');
const {
  ROOT,
  hubDomain,
  loadWorkspaces,
  isValidWorkspace,
  styleSettings,
  workspaceDir,
  listProjects,
} = require('./workspaces');
const {
  SETTINGS_FILE_RE,
} = require('./settings');

const PUBLIC_DIR = path.join(__dirname, 'public');

// Default navigation scheme: workspace subdomains under the hub domain
// (workspace.ddev.site locally; hub_domain in settings.yml for a public
// remote-hub deployment).

const { esc } = require('./html');
const { readListState, setListCookies } = require('./lists');
const { DDEV_ACTIONS } = require('./ddev');
const { graphStoreDir, GRAPH_FILES } = require('./graphs');
const { milvusPost, ragInstanceFor, ragCollectionName, ragCollections } = require('./rag');
const { iconHtml, tablerIcons } = require('./icons');
const { assembleCss } = require('./themes');
const { commandRowsHtml, commandFile, toolingRepo } = require('./commands');
const { run, jobs, runningJobKey, startJob, jobFragment } = require('./jobs');
const { assistantReply } = require('./assistant');
const {
  INSTALL_TARGETS, VIDEO_RE, REVIEWABLE_RE, humanSize, ITEM_TEMPLATES, NAME_RE, SCRIPT_RE,
  itemFile, listItems, testingStackOf, projectTestRuns, testRunHtml,
  itemRowsHtml, editorFormHtml, settingsPage, pageShell, homePage, workspaceCardsHtml,
  ddevStatusMap, projectRowsHtml, parseBuilderArgs, builderArgsHtml, backupRowsHtml,
  backupsPage, workspacePage, resultFragment, HOME_URL, wsUrl,
} = require('./views');



/* ---------------- file-item workspaces (agents, skills, prompts, docs) --- */






/* ---------------- test runs and their evidence ------------------------- */






/* ---------------- shared page chrome ---------------- */

/* ---------------- settings editor -------------------------------------- */




// The assistant's logo mark: a large + small four-point sparkle (inline SVG,
// inherits currentColor) — used in the panel header and the floating launcher.

// The AI assistant panel — included on EVERY page. `floating` renders it as
// the bottom-right widget with a launcher button; inline renders it in flow.


/* ---------------- pages ---------------- */




// Backup archives for a workspace: ${backups}/<workspace>/*.tar.gz created by
// the cmd-tool*-backup-*.sh scripts, newest first.








/* ---------------- HTMX fragments/actions ---------------- */


// Append-only audit trail of every action the dashboard executes — request
// logs don't survive container restarts, so destructive operations (remove,
// build) must be attributable after the fact from this file.
const AUDIT_LOG = path.join(__dirname, 'actions.log');
function audit(pathname, form, result) {
  const line = JSON.stringify({
    time: new Date().toISOString(),
    action: pathname,
    workspace: form.workspace,
    projectName: form.projectName,
    script: form.script,
    file: form.file,
    ok: result === undefined ? undefined : !!result,
  });
  try { fs.appendFileSync(AUDIT_LOG, line + '\n'); } catch (_) { /* never block the action */ }
}

/**
 * Every action the dashboard can run, merged from the modules that own them.
 *
 * This was one 650-line function of `if (pathname === …)`. Splitting it by area means an action
 * lives next to the ones it resembles, a module imports only what its own handlers use, and
 * adding one is adding a map entry rather than another branch to read past.
 */
const ACTIONS = {
  ...require('./actions/projects'),
  ...require('./actions/items'),
  ...require('./actions/config'),
  ...require('./actions/ddev'),
  ...require('./actions/graphs'),
  ...require('./actions/rag'),
  ...require('./actions/assistant'),
  ...require('./actions/commands'),
};

// Actions that carry no workspace to validate: the assistant is asked about anything, status is
// about the machine, and save-settings edits core/config rather than a workspace.
const WORKSPACE_FREE = new Set(['/actions/chat', '/actions/status', '/actions/save-settings']);
// Neither of these is a change worth an audit line, and both happen constantly.
const UNAUDITED = new Set(['/actions/status', '/actions/chat']);

async function handleAction(pathname, form, res, req) {
  const send = (html, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  };
  if (!UNAUDITED.has(pathname)) audit(pathname, form);

  const handler = ACTIONS[pathname];
  if (!handler) return send('<div class="msg error">Unknown action.</div>', 404);

  const workspace = form.workspace || 'dev';
  if (!WORKSPACE_FREE.has(pathname) && !isValidWorkspace(workspace)) {
    return send('<div class="msg error">Unknown workspace.</div>', 400);
  }
  return handler({ form, res, send, workspace, req, pathname });
}

/* ---------------- static files ---------------- */

const MIME = {
  '.css': 'text/css', '.js': 'application/javascript', '.html': 'text/html',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

function serveStatic(pathname, res) {
  const file = path.join(PUBLIC_DIR, path.normalize(pathname).replace(/^([.][.][/\\])+/, ''));
  if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
  return true;
}

/* ---------------- server ---------------- */

const server = http.createServer(async (req, res) => {
  let { pathname } = new URL(req.url, 'http://localhost');

  // Workspace subdomains: <ws>.workspace.ddev.site serves that workspace's
  // pages — / maps to the workspace page and /backups to its backups page.
  // Absolute paths (/actions, /fragments, /files, assets) work unchanged.
  const hostMatch = String(req.headers.host || '').match(new RegExp(`^([a-z0-9_-]+)\\.${hubDomain().replace(/\./g, '\\.')}(?::\\d+)?$`));
  if (hostMatch && isValidWorkspace(hostMatch[1])) {
    if (pathname === '/') pathname = `/${hostMatch[1]}`;
    else if (pathname === '/backups' || pathname === '/backups/') pathname = `/${hostMatch[1]}/backups`;
  }

  try {
    if (req.method === 'GET') {
      if (pathname === '/' ) {
        const body = homePage();
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(body);
      }
      if (pathname === '/actions/status') return handleAction(pathname, {}, res, req);
      const jobMatch = pathname.match(/^\/fragments\/job\/([a-z0-9-]+)$/);
      if (jobMatch) {
        const frag = jobFragment(jobMatch[1]);
        // When the job finishes, refresh the project/backup lists so status
        // badges and buttons reflect the new state.
        if (frag.done) res.setHeader('HX-Trigger', 'refresh-projects');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(frag.html);
      }
      const itemsMatch = pathname.match(/^\/fragments\/([a-z0-9_-]+)\/items$/);
      if (itemsMatch && isValidWorkspace(itemsMatch[1])) {
        const itemsState = readListState(req);
        setListCookies(res, itemsState);
        const body = itemRowsHtml(itemsMatch[1], itemsState);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(body);
      }
      const newMatch = pathname.match(/^\/fragments\/([a-z0-9_-]+)\/new$/);
      if (newMatch && isValidWorkspace(newMatch[1]) && loadWorkspaces()[newMatch[1]].kind === 'files') {
        const key = newMatch[1];
        const body = editorFormHtml(key, '', (ITEM_TEMPLATES[key] || ITEM_TEMPLATES.docs)('my-' + loadWorkspaces()[key].noun), true);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(body);
      }
      const editMatch = pathname.match(/^\/fragments\/([a-z0-9_-]+)\/edit\/([a-zA-Z0-9_%.-]+)$/);
      if (editMatch && isValidWorkspace(editMatch[1])) {
        const key = editMatch[1];
        const name = decodeURIComponent(editMatch[2]);
        if (!NAME_RE.test(name)) { res.writeHead(400); return res.end('bad name'); }
        const file = itemFile(key, name);
        if (!fs.existsSync(file)) { res.writeHead(404); return res.end('not found'); }
        const body = editorFormHtml(key, name, fs.readFileSync(file, 'utf8'), false);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(body);
      }
      const aiFormMatch = pathname.match(/^\/fragments\/(agents|skills|prompts)\/ai-form$/);
      if (aiFormMatch) {
        const key = aiFormMatch[1];
        const meta = loadWorkspaces()[key];
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(`
          <div class="uk-card uk-card-default uk-card-body uk-margin-top editor-card">
            <h3 class="uk-margin-small-bottom">Generate a ${esc(meta.noun)} with AI</h3>
            <form hx-post="/actions/generate-item" hx-target="#webship-workspace-output" hx-swap="innerHTML">
              <input type="hidden" name="workspace" value="${esc(key)}">
              <input class="uk-input uk-margin-small-bottom" name="name" placeholder="${esc(meta.noun)}-name" required pattern="[a-zA-Z0-9_\\-]+">
              <textarea class="uk-textarea" name="description" rows="4" placeholder="Describe what this ${esc(meta.noun)} should do — e.g. 'reviews cmd-*.sh scripts for DDEV-only compliance and reports violations'" required></textarea>
              <div class="uk-margin-small-top">
                <button type="submit" class="uk-button uk-button-primary"><span uk-icon="icon: bolt; ratio: .8"></span> Generate</button>
              </div>
            </form>
          </div>`);
      }
      if (pathname === '/fragments/docs/screenshot-form') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(`
          <div class="uk-card uk-card-default uk-card-body uk-margin-top editor-card">
            <h3 class="uk-margin-small-bottom">Screenshot a site → docs/&lt;name&gt;.png</h3>
            <form class="uk-grid uk-grid-small" uk-grid hx-post="/actions/screenshot" hx-target="#webship-workspace-output" hx-swap="innerHTML">
              <input type="hidden" name="workspace" value="docs">
              <div class="uk-width-1-3@s"><input class="uk-input" name="name" placeholder="shot-name" required pattern="[a-zA-Z0-9_\\-]+"></div>
              <div class="uk-width-1-2@s"><input class="uk-input" name="url" placeholder="https://mysite.ddev.site" required></div>
              <div class="uk-width-1-6@s"><button type="submit" class="uk-button uk-button-primary uk-width-1-1">Capture</button></div>
            </form>
          </div>`);
      }
      if (pathname === '/fragments/docs/site-doc-form') {
        const wsOptions = Object.values(loadWorkspaces())
          .filter((w) => w.kind !== 'files')
          .map((w) => `<option value="${esc(w.key)}">${esc(w.label)}</option>`).join('');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(`
          <div class="uk-card uk-card-default uk-card-body uk-margin-top editor-card">
            <h3 class="uk-margin-small-bottom">Generate site documentation (AI → Markdown + PDF)</h3>
            <form class="uk-grid uk-grid-small" uk-grid hx-post="/actions/generate-doc" hx-target="#webship-workspace-output" hx-swap="innerHTML">
              <input type="hidden" name="workspace" value="docs">
              <div class="uk-width-1-4@s"><select class="uk-select" name="sourceWorkspace">${wsOptions}</select></div>
              <div class="uk-width-1-4@s"><input class="uk-input" name="projectName" placeholder="site/project name" required pattern="[a-zA-Z0-9_\\-]+"></div>
              <div class="uk-width-1-4@s"><input class="uk-input" name="docName" placeholder="doc-name" required pattern="[a-zA-Z0-9_\\-]+"></div>
              <div class="uk-width-1-4@s"><button type="submit" class="uk-button uk-button-primary uk-width-1-1">Generate</button></div>
            </form>
          </div>`);
      }
      // Searching an index, in the dialog. A GET renders the form; the same path with ?q= runs the
      // search, so the form posts to itself and there is one route rather than two.
      const ragSearchMatch = pathname.match(/^\/fragments\/([a-z0-9_-]+)\/rag-search\/([a-zA-Z0-9_%.-]+)$/);
      if (ragSearchMatch && isValidWorkspace(ragSearchMatch[1])) {
        const wsKey = ragSearchMatch[1];
        const project = decodeURIComponent(ragSearchMatch[2]);
        if (!NAME_RE.test(project)) { res.writeHead(400); return res.end('bad name'); }
        const q = String(new URL(req.url, 'http://localhost').searchParams.get('q') || '').trim().slice(0, 500);
        const instance = ragInstanceFor(wsKey, project);
        const collection = ragCollectionName(wsKey, project);
        const url = `/fragments/${encodeURIComponent(wsKey)}/rag-search/${encodeURIComponent(project)}`;

        let results = '';
        if (q) {
          // Sparse search against the BM25 function the collection carries. `data` is the raw
          // query text: the database embeds it with the same function it indexed with, which is
          // the whole point of building the vectors inside Milvus.
          const body = await milvusPost('/v2/vectordb/entities/search', {
            collectionName: collection,
            data: [q],
            annsField: 'sparse',
            limit: 10,
            outputFields: ['path', 'start_line', 'end_line', 'text'],
          }, 15000, instance);
          if (!body || body.code !== 0) {
            results = `<div class="msg error">${esc((body && body.message) || `No answer from ${instance}.`)}</div>`;
          } else if (!body.data || !body.data.length) {
            results = `<p class="uk-text-meta">Nothing in ${esc(collection)} matches “${esc(q)}”.</p>`;
          } else {
            // A chunk is a line RANGE, and the range is what makes a hit openable: it is the
            // difference between "it is in this file" and "it is at this line".
            results = body.data.map((hit) => {
              const lines = hit.start_line ? `${hit.start_line}${hit.end_line && hit.end_line !== hit.start_line ? `–${hit.end_line}` : ''}` : '';
              return `
              <div class="rag-hit">
                <div class="rag-hit-head"><code>${esc(String(hit.path || '?'))}${lines ? `:${esc(lines)}` : ''}</code><span class="uk-text-meta">score ${esc(String(Math.round((hit.distance || 0) * 1000) / 1000))}</span></div>
                <pre>${esc(String(hit.text || '').slice(0, 1200))}</pre>
              </div>`;
            }).join('');
          }
        }

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(`
    <div class="uk-card uk-card-default uk-card-body editor-card">
      <h3 class="uk-margin-small-bottom">Search ${esc(project)}</h3>
      <p class="uk-text-meta">${esc(collection)} on ${esc(instance)} — the prose, templates and config a graph does not read.</p>
      <div class="list-controls">
        <div class="lc-group lc-find">
          <input class="uk-input uk-form-small list-search" type="search" name="q" value="${esc(q)}"
                 placeholder="Ask it something…" aria-label="Search this index" autofocus
                 hx-get="${esc(url)}" hx-target="#editor-modal-body" hx-swap="innerHTML"
                 hx-trigger="keyup[key=='Enter'], search">
          <button class="uk-button uk-button-primary uk-button-small" type="button"
                  hx-get="${esc(url)}" hx-target="#editor-modal-body" hx-swap="innerHTML"
                  hx-include="closest .list-controls"><span uk-icon="icon: search; ratio: .7"></span> Search</button>
        </div>
      </div>
      <div class="rag-results">${results}</div>
      <div class="uk-margin-small-top">
        <button type="button" class="uk-button uk-button-default uk-modal-close">Close</button>
      </div>
    </div>`);
      }

      // The graph as a single archive, to hand to another workspace. Streamed straight out of
      // tar: a graph runs to tens of megabytes and buffering it would hold the whole thing in the
      // app's memory.
      const graphDlMatch = pathname.match(/^\/graph\/([a-z0-9_-]+)\/([a-zA-Z0-9_.-]+)\/download$/);
      if (graphDlMatch && isValidWorkspace(graphDlMatch[1])) {
        const [, wsKey, project] = graphDlMatch;
        if (project.includes('..')) { res.writeHead(400); return res.end('bad name'); }
        let real;
        try {
          real = fs.realpathSync(graphStoreDir(wsKey, project));
          const base = fs.realpathSync(path.join(ROOT, 'graphs'));
          if (!real.startsWith(base + path.sep) || !fs.statSync(real).isDirectory()) throw new Error('outside');
        } catch (_) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          return res.end('No graph yet — build one from the Graph menu on the project row.');
        }
        const archive = `${wsKey}--${project}--graph.tar.gz`;
        res.writeHead(200, {
          'Content-Type': 'application/gzip',
          'Content-Disposition': `attachment; filename="${archive.replace(/[^A-Za-z0-9._-]/g, '_')}"`,
          'X-Content-Type-Options': 'nosniff',
        });
        const tar = spawn('tar', ['-czf', '-', '-C', path.dirname(real), path.basename(real)],
          { stdio: ['ignore', 'pipe', 'pipe'] });
        tar.stdout.pipe(res);
        tar.stderr.resume();
        tar.on('error', () => { try { res.destroy(); } catch (_) { /* client gone */ } });
        res.on('close', () => { try { tar.kill(); } catch (_) { /* already exited */ } });
        return;
      }

      // The picture, and the report. Symlinks are resolved before the path is trusted: a project
      // directory that is a link would otherwise read outside the workspace, and this container
      // bind-mounts ~/.claude as well as ~/workspace.
      const graphMatch = pathname.match(/^\/graph\/([a-z0-9_-]+)\/([a-zA-Z0-9_-]+)(\/report)?$/);
      if (graphMatch && isValidWorkspace(graphMatch[1])) {
        const wantsReport = !!graphMatch[3];
        const file = path.join(graphStoreDir(graphMatch[1], graphMatch[2]),
          wantsReport ? GRAPH_FILES.report : GRAPH_FILES.html);
        let real = null;
        try {
          const base = fs.realpathSync(path.join(ROOT, 'graphs'));
          real = fs.realpathSync(file);
          if (!real.startsWith(base + path.sep)) real = null;
          if (real && !fs.statSync(real).isFile()) real = null;
        } catch (_) { real = null; }
        if (!real) {
          res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
          return res.end('<div class="msg error">No graph yet — build one from the Graph menu on the project row.</div>');
        }
        if (wantsReport) {
          // The report opens in the dialog, so it is delivered as a fragment rather than as a
          // file: markdown in a <pre>, which is what it is.
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          return res.end(`
    <div class="uk-card uk-card-default uk-card-body editor-card">
      <h3 class="uk-margin-small-bottom">${esc(graphMatch[2])} — graph report</h3>
      <pre class="graph-report">${esc(fs.readFileSync(real, 'utf8'))}</pre>
      <div class="uk-margin-small-top">
        <a class="uk-button uk-button-default" href="/graph/${esc(graphMatch[1])}/${esc(graphMatch[2])}" target="_blank"><span uk-icon="icon: image; ratio: .8"></span> Open the graph</a>
        <button type="button" class="uk-button uk-button-default uk-modal-close">Close</button>
      </div>
    </div>`);
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return fs.createReadStream(real).pipe(res);
      }
      if (pathname === '/fragments/commands/list') {
        const state = readListState(req);
        setListCookies(res, state);
        const body = commandRowsHtml(state);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(body);
      }
      // Creating a command: by hand in the editor, or written by the AI. One form, because the
      // choice is the same decision made twice and two forms would drift apart.
      const cmdNewMatch = pathname.match(/^\/fragments\/commands\/new(?:\/([a-z0-9_-]+))?$/);
      if (cmdNewMatch) {
        const preset = cmdNewMatch[1] && isValidWorkspace(cmdNewMatch[1]) ? cmdNewMatch[1] : '';
        const options = Object.entries(loadWorkspaces())
          .filter(([, m]) => m.kind !== 'files')
          .map(([k, m]) => `<option value="${esc(k)}"${k === preset ? ' selected' : ''}>${esc(m.label)}</option>`).join('');
        const body = `
    <div class="uk-card uk-card-default uk-card-body editor-card">
      <h3 class="uk-margin-small-bottom">New command</h3>
      <p class="uk-text-meta">A command lives in the workspace it runs from, and is named <code>cmd-&lt;something&gt;.sh</code>.
        Either way you get the bootstrap chain, the settings load and the argparse block already right.</p>
      <div class="uk-grid uk-grid-small uk-margin-small-bottom" uk-grid>
        <div class="uk-width-1-3@s">
          <label class="uk-text-meta">Workspace
            <select class="uk-select" id="cmd-new-target" name="target">${options}</select></label>
        </div>
        <div class="uk-width-1-3@s">
          <label class="uk-text-meta">File name
            <input class="uk-input" id="cmd-new-name" name="newName" placeholder="cmd-my-thing.sh"
                   pattern="cmd-[a-zA-Z0-9_.\\-]+\\.sh" required></label>
        </div>
        <div class="uk-width-1-3@s">
          <label class="uk-text-meta">Shown as (optional)
            <input class="uk-input" id="cmd-new-label" name="label" placeholder="Drupal 11.4 (recommended project)"></label>
        </div>
      </div>
      <ul uk-tab class="uk-margin-small-bottom">
        <li class="uk-active"><a href>Write it myself</a></li>
        <li><a href>Have the AI write it</a></li>
      </ul>
      <ul class="uk-switcher">
        <li>
          <p class="uk-text-meta">Creates the scaffold and nothing else — open it in the editor afterwards to fill it in.</p>
          <button class="uk-button uk-button-primary" hx-post="/actions/command-new"
                  hx-include="#cmd-new-target, #cmd-new-name, #cmd-new-label"
                  hx-target="#webship-workspace-output" hx-swap="innerHTML">
            <span uk-icon="icon: file-add; ratio: .8"></span> Create the scaffold</button>
        </li>
        <li>
          <p class="uk-text-meta">Describe what it should do. It reads the workspace and the other commands first, so what it
            writes matches how they are written.</p>
          <textarea class="uk-textarea" id="cmd-new-desc" name="description" rows="4"
                    placeholder="Back up every project in this workspace, oldest first, keeping the last five archives"></textarea>
          <p class="uk-margin-small-top">
            <button class="uk-button uk-button-secondary" hx-post="/actions/command-generate"
                    hx-include="#cmd-new-target, #cmd-new-name, #cmd-new-desc"
                    hx-target="#webship-workspace-output" hx-swap="innerHTML">
              <span uk-icon="icon: bolt; ratio: .8"></span> Write it with AI</button>
          </p>
        </li>
      </ul>
      <div class="uk-margin-small-top"><button type="button" class="uk-button uk-button-default uk-modal-close">Close</button></div>
    </div>`;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(body);
      }
      // Proposing one back: the summary is not optional in practice — it becomes the issue.
      const cmdProposeMatch = pathname.match(/^\/fragments\/commands\/propose\/([a-z0-9_-]+)\/([a-zA-Z0-9_%.-]+)$/);
      if (cmdProposeMatch) {
        const [, wsKey, rawName] = cmdProposeMatch;
        const name = decodeURIComponent(rawName);
        if (!commandFile(wsKey, name)) { res.writeHead(404); return res.end('not a command'); }
        const { repo, ref } = toolingRepo();
        const vals = `hx-vals='{"workspace":"${esc(wsKey)}","file":"${esc(name)}"}'`;
        const body = `
    <div class="uk-card uk-card-default uk-card-body editor-card">
      <h3 class="uk-margin-small-bottom">Propose ${esc(wsKey)}/${esc(name)}</h3>
      <p class="uk-text-meta">To <strong>${esc(repo)}</strong>, against <code>${esc(ref)}</code>.
        Nothing is pushed from here: the agent files an issue and opens a pull request, leaves the
        human-review boxes unticked, and never merges.</p>
      <label class="uk-text-meta">What is it for? This becomes the issue and the pull request description.
        <textarea class="uk-textarea" id="cmd-propose-summary" name="summary" rows="3"
                  placeholder="Builds a Drupal 11.4 site with the testing stack already configured"></textarea></label>
      <div class="uk-margin-small-top">
        <button class="uk-button uk-button-default" hx-post="/actions/command-propose" ${vals}
                hx-include="#cmd-propose-summary" hx-target="#webship-workspace-output" hx-swap="innerHTML">
          <span uk-icon="icon: search; ratio: .8"></span> Show me the plan</button>
        <button class="uk-button uk-button-primary arm-step" data-armed="0"
                hx-post="/actions/command-propose" hx-vals='{"workspace":"${esc(wsKey)}","file":"${esc(name)}","confirm":"yes"}'
                hx-include="#cmd-propose-summary" hx-trigger="confirmed-remove"
                hx-target="#webship-workspace-output" hx-swap="innerHTML">
          <span uk-icon="icon: git-pull-request; ratio: .8"></span> Open the pull request</button>
        <button type="button" class="uk-button uk-button-default uk-modal-close">Close</button>
      </div>
    </div>`;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(body);
      }
      const cmdEditMatch = pathname.match(/^\/fragments\/commands\/edit\/([a-z0-9_-]+)\/([a-zA-Z0-9_%.-]+)$/);
      if (cmdEditMatch) {
        const [, wsKey, rawName] = cmdEditMatch;
        const name = decodeURIComponent(rawName);
        const full = commandFile(wsKey, name);
        if (!full) { res.writeHead(404); return res.end('not a command'); }
        const content = fs.readFileSync(full, 'utf8');
        const lines = content.split('\n').length;
        // data-ace="sh": the same editor the markdown items get, in shell mode — which the
        // vendored markdown mode file already defines, so no extra download.
        const body = `
    <div class="uk-card uk-card-default uk-card-body editor-card">
      <h3 class="uk-margin-small-bottom">${esc(wsKey)}/${esc(name)}</h3>
      <p class="uk-text-meta">${lines} lines · runs from <code>${esc(wsKey)}/</code></p>
      <form hx-post="/actions/command-save" hx-target="#webship-workspace-output" hx-swap="innerHTML">
        <input type="hidden" name="workspace" value="${esc(wsKey)}">
        <input type="hidden" name="file" value="${esc(name)}">
        <textarea class="uk-textarea editor-area" name="content" rows="20" spellcheck="false"
                  data-ace="sh" aria-label="${esc(name)}">${esc(content)}</textarea>
        <div class="uk-margin-small-top">
          <button type="submit" class="uk-button uk-button-primary"><span uk-icon="icon: check; ratio: .8"></span> Save</button>
          <button type="button" class="uk-button uk-button-default uk-modal-close">Close</button>
        </div>
      </form>
    </div>`;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(body);
      }
      const reviewMatch = pathname.match(/^\/fragments\/([a-z0-9_-]+)\/review\/([a-zA-Z0-9_%.-]+)$/);
      if (reviewMatch && isValidWorkspace(reviewMatch[1])) {
        const key = reviewMatch[1];
        const name = decodeURIComponent(reviewMatch[2]);
        if (!/^[a-zA-Z0-9_.-]+$/.test(name) || name.includes('..')) { res.writeHead(400); return res.end('bad name'); }
        const full = path.join(workspaceDir(key), name);
        if (!fs.existsSync(full) || !fs.statSync(full).isFile() || !REVIEWABLE_RE.test(name)) {
          res.writeHead(404); return res.end('not reviewable');
        }
        const st = fs.statSync(full);
        const src = `/files/${encodeURIComponent(key)}/${encodeURIComponent(name)}`;
        const ext = path.extname(name).toLowerCase();
        let body;
        if (ext === '.pdf') {
          // <object>, not <iframe>: showing a PDF needs the browser's own viewer, and where there
          // is none an iframe renders an empty white box with nothing said about why. <object>
          // falls back to its children instead, so the reason is stated and the file is still
          // reachable. Not sandboxed either way — the sandbox attribute disables that viewer.
          body = `<object class="review-frame" type="application/pdf" data="${src}#view=FitH" title="${esc(name)}">
              <div class="review-fallback">
                <p>This browser has no built-in PDF viewer, so it cannot be shown here.</p>
                <p><a class="uk-button uk-button-primary uk-button-small" href="${src}?download=1">Download it</a>
                   <a class="uk-button uk-button-default uk-button-small" href="${src}" target="_blank">or open it in a tab</a></p>
              </div>
            </object>`;
        } else if (/\.html?$/.test(ext)) {
          // The dashboard generated this page, but it is still a whole document being framed:
          // sandbox="" gives it a unique origin and no scripts, forms or navigation. Inline CSS,
          // which is what pandoc --standalone emits, still applies.
          body = `<iframe class="review-frame" src="${src}" title="${esc(name)}" sandbox="" referrerpolicy="no-referrer"></iframe>`;
        } else {
          body = `<img class="review-image" src="${src}" alt="${esc(name)}">`;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(`
    <div class="uk-card uk-card-default uk-card-body editor-card">
      <h3 class="uk-margin-small-bottom">${esc(name)}</h3>
      <p class="uk-text-meta">${humanSize(st.size)} · ${st.mtime.toISOString().slice(0, 16).replace('T', ' ')} · from <code>${esc(key)}/</code></p>
      ${body}
      <div class="uk-margin-small-top">
        <a class="uk-button uk-button-primary" href="${src}?download=1"><span uk-icon="icon: download; ratio: .8"></span> Download</a>
        <a class="uk-button uk-button-default" href="${src}" target="_blank"><span uk-icon="icon: link-external; ratio: .8"></span> Open in a tab</a>
        <button type="button" class="uk-button uk-button-default uk-modal-close">Close</button>
      </div>
    </div>`);
      }
      // Assembled, not read from disk: base, then every component, then the chosen theme.
      // Built BEFORE the head goes out — see the note on ordering below.
      if (pathname === '/style.css') {
        const css = assembleCss(styleSettings().theme);
        res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
        return res.end(css);
      }
      const fileMatch = pathname.match(/^\/files\/([a-z0-9_-]+)\/([a-zA-Z0-9_%.-]+)$/);
      if (fileMatch && isValidWorkspace(fileMatch[1])) {
        const name = decodeURIComponent(fileMatch[2]);
        if (name.includes('..') || name.includes('/')) { res.writeHead(400); return res.end('bad name'); }
        const file = path.join(workspaceDir(fileMatch[1]), name);
        if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end('not found'); }
        const type = { '.pdf': 'application/pdf', '.html': 'text/html; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.png': 'image/png',
          '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime',
          '.webm': 'video/webm', '.ogg': 'video/ogg', '.ogv': 'video/ogg' }[path.extname(file).toLowerCase()] || 'application/octet-stream';
        const size = fs.statSync(file).size;
        // The dialog offers a Download beside its viewer. Without this the link merely opens the
        // file again, which is not what a button called Download does. Decided here rather than
        // with setHeader, because writeHead's own headers win over anything set before it.
        const disposition = new URL(req.url, 'http://localhost').searchParams.has('download')
          ? `attachment; filename="${name.replace(/"/g, '')}"`
          : 'inline';
        // A <video> seeks by asking for a byte range. Answering the whole file with a 200 makes the
        // browser download all of it before the first frame and disables scrubbing entirely, so a
        // range request gets the 206 it asked for.
        const range = VIDEO_RE.test(file) ? req.headers.range : undefined;
        if (range) {
          const m = /^bytes=(\d*)-(\d*)$/.exec(range);
          if (m) {
            let start = m[1] === '' ? null : parseInt(m[1], 10);
            let end = m[2] === '' ? null : parseInt(m[2], 10);
            if (start === null) { start = Math.max(0, size - (end || 0)); end = size - 1; }
            if (end === null || end >= size) end = size - 1;
            if (Number.isNaN(start) || start > end || start >= size) {
              res.writeHead(416, { 'Content-Range': `bytes */${size}` });
              return res.end();
            }
            res.writeHead(206, {
              'Content-Type': type,
              'Content-Length': end - start + 1,
              'Content-Range': `bytes ${start}-${end}/${size}`,
              'Accept-Ranges': 'bytes',
            });
            return fs.createReadStream(file, { start, end }).pipe(res);
          }
        }
        res.writeHead(200, {
          'Content-Type': type,
          'Content-Length': size,
          'Content-Disposition': disposition,
          ...(VIDEO_RE.test(file) ? { 'Accept-Ranges': 'bytes' } : {}),
        });
        return fs.createReadStream(file).pipe(res);
      }
      const playMatch = pathname.match(/^\/fragments\/([a-z0-9_-]+)\/play\/([a-zA-Z0-9_%.-]+)$/);
      if (playMatch && isValidWorkspace(playMatch[1])) {
        const name = decodeURIComponent(playMatch[2]);
        if (!VIDEO_RE.test(name) || name.includes('..') || name.includes('/')) { res.writeHead(400); return res.end('bad name'); }
        const dir = workspaceDir(playMatch[1]);
        if (!fs.existsSync(path.join(dir, name))) { res.writeHead(404); return res.end('not found'); }
        // <stem>-poster.jpg is the convention, so the player shows a frame before it is played.
        const stem = name.replace(VIDEO_RE, '');
        const poster = ['-poster.jpg', '-poster.jpeg', '-poster.png']
          .map((s2) => `${stem}${s2}`).find((f) => fs.existsSync(path.join(dir, f)));
        const src = `/files/${playMatch[1]}/${encodeURIComponent(name)}`;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(`
          <div class="msg assistant">
            <p><span uk-icon="icon: play-circle; ratio: .8"></span> <strong>${esc(name)}</strong></p>
            <video class="uk-width-1-1" controls preload="metadata"${poster ? ` poster="/files/${playMatch[1]}/${encodeURIComponent(poster)}"` : ''} src="${src}"></video>
          </div>`);
      }

      if (pathname === '/settings' || pathname.startsWith('/settings/')) {
        const wanted = decodeURIComponent(pathname.slice('/settings/'.length) || '');
        const section = wanted === 'commands' || SETTINGS_FILE_RE.test(wanted) ? wanted : '';
        const body = settingsPage(section, readListState(req));
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(body);
      }

      if (pathname === '/fragments/icons') {
        const params = new URL(req.url, 'http://localhost').searchParams;
        const q = String(params.get('q') || '').trim().toLowerCase();
        // Which tile to draw as chosen. The grid is where you look to see what is selected, so it
        // has to be told — the checked radio that guarantees a value lives outside it.
        const current = String(params.get('current') || '');
        const all = [...tablerIcons()].sort();
        const hits = q ? all.filter((i) => i.includes(q)) : all;
        // Paged rather than search-only: 4,736 tiles inline would be a multi-megabyte page, but
        // making search the only way in means you cannot browse — and you often do not know the
        // name of the icon you want.
        const PER_PAGE = 120;
        const pages = Math.max(1, Math.ceil(hits.length / PER_PAGE));
        const page = Math.min(Math.max(1, parseInt(params.get('page'), 10) || 1), pages);
        const shown = hits.slice((page - 1) * PER_PAGE, page * PER_PAGE);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        if (!hits.length) return res.end(`<span class="uk-text-meta">No icon matches “${esc(q)}”.</span>`);
        const tiles = shown.map((i) => `
          <input class="icon-radio" type="radio" name="icon" id="ic-${esc(i)}" value="tabler:${esc(i)}"${`tabler:${i}` === current ? ' checked' : ''}>
          <label class="icon-choice" for="ic-${esc(i)}" title="${esc(i)}">${iconHtml(`tabler:${i}`, 0.9)}</label>`).join('');
        const pager = pages > 1 ? `
          <div class="icon-pager uk-text-meta">
            ${page > 1 ? `<button type="button" class="uk-button uk-button-default uk-button-small" hx-get="/fragments/icons?page=${page - 1}&current=${encodeURIComponent(current)}" hx-include=".icon-filter" hx-target="#icon-grid-wrap" hx-swap="innerHTML">Previous</button>` : ''}
            <span>${(page - 1) * PER_PAGE + 1}–${Math.min(page * PER_PAGE, hits.length)} of ${hits.length}</span>
            ${page < pages ? `<button type="button" class="uk-button uk-button-default uk-button-small" hx-get="/fragments/icons?page=${page + 1}&current=${encodeURIComponent(current)}" hx-include=".icon-filter" hx-target="#icon-grid-wrap" hx-swap="innerHTML">Next</button>` : ''}
          </div>` : '';
        return res.end(`<div class="icon-grid">${tiles}</div>${pager}`);
      }

      const testsMatch = pathname.match(/^\/fragments\/([a-z0-9_-]+)\/tests\/([a-zA-Z0-9_.-]+)$/);
      if (testsMatch && isValidWorkspace(testsMatch[1])) {
        const project = decodeURIComponent(testsMatch[2]);
        if (!NAME_RE.test(project) || !listProjects(workspaceDir(testsMatch[1])).includes(project)) {
          res.writeHead(404); return res.end('not found');
        }
        const body = testRunHtml(testsMatch[1], project);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(body);
      }

      // One artifact out of a project's tests/ directory. Everything is resolved and then checked
      // to be inside that directory, so a crafted path cannot walk out of it.
      const projFileMatch = pathname.match(/^\/project-files\/([a-z0-9_-]+)\/([a-zA-Z0-9_.-]+)\/(.+)$/);
      if (projFileMatch && isValidWorkspace(projFileMatch[1])) {
        const [, key, project, relRaw] = projFileMatch;
        if (!NAME_RE.test(project) || !listProjects(workspaceDir(key)).includes(project)) {
          res.writeHead(404); return res.end('not found');
        }
        const testsRoot = path.resolve(workspaceDir(key), project, 'tests');
        const file = path.resolve(testsRoot, decodeURIComponent(relRaw).replace(/^tests\//, ''));
        if (file !== testsRoot && !file.startsWith(testsRoot + path.sep)) { res.writeHead(400); return res.end('bad path'); }
        if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end('not found'); }
        const type = { '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.json': 'application/json',
          '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.pdf': 'application/pdf',
          '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.ogg': 'video/ogg', '.ogv': 'video/ogg',
          '.mov': 'video/quicktime' }[path.extname(file).toLowerCase()] || 'application/octet-stream';
        const size = fs.statSync(file).size;
        // A recording is seeked with a range request; answering the whole file with a 200 makes
        // the browser fetch all of it before the first frame and disables scrubbing.
        const range = VIDEO_RE.test(file) ? req.headers.range : undefined;
        const m = range && /^bytes=(\d*)-(\d*)$/.exec(range);
        if (m) {
          let start = m[1] === '' ? null : parseInt(m[1], 10);
          let end = m[2] === '' ? null : parseInt(m[2], 10);
          if (start === null) { start = Math.max(0, size - (end || 0)); end = size - 1; }
          if (end === null || end >= size) end = size - 1;
          if (Number.isNaN(start) || start > end || start >= size) {
            res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end();
          }
          res.writeHead(206, { 'Content-Type': type, 'Content-Length': end - start + 1,
            'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes' });
          return fs.createReadStream(file, { start, end }).pipe(res);
        }
        res.writeHead(200, { 'Content-Type': type, 'Content-Length': size,
          ...(VIDEO_RE.test(file) ? { 'Accept-Ranges': 'bytes' } : {}) });
        return fs.createReadStream(file).pipe(res);
      }

      if (pathname === '/fragments/jobs/running') {
        const running = [...jobs.entries()].filter(([, j]) => !j.done);
        const body = running.map(([id]) => jobFragment(id).html).join('');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(body);
      }

      const argsMatch = pathname.match(/^\/fragments\/([a-z0-9_-]+)\/builder-args$/);
      if (argsMatch && isValidWorkspace(argsMatch[1])) {
        const script = new URL(req.url, 'http://localhost').searchParams.get('script') || '';
        const body = builderArgsHtml(argsMatch[1], script);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(body);
      }
      const fragMatch = pathname.match(/^\/fragments\/([a-z0-9_-]+)\/projects$/);
      if (fragMatch && isValidWorkspace(fragMatch[1])) {
        const projState = readListState(req);
        setListCookies(res, projState);
        const body = await projectRowsHtml(fragMatch[1], workspaceDir(fragMatch[1]), projState);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(body);
      }
      const backupsMatch = pathname.match(/^\/fragments\/([a-z0-9_-]+)\/backups$/);
      if (backupsMatch && isValidWorkspace(backupsMatch[1])) {
        const backupState = readListState(req);
        setListCookies(res, backupState);
        const body = backupRowsHtml(backupsMatch[1], backupState);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(body);
      }
      const backupsPageMatch = pathname.match(/^\/([a-z0-9_-]+)\/backups\/?$/);
      if (backupsPageMatch && isValidWorkspace(backupsPageMatch[1])) {
        const body = backupsPage(backupsPageMatch[1], readListState(req));
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(body);
      }
      const wsKey = pathname.replace(/^\/+|\/+$/g, '');
      if (isValidWorkspace(wsKey)) {
        const body = await workspacePage(wsKey, readListState(req));
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(body);
      }
      if (serveStatic(pathname, res)) return;
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }

    // deep-chat speaks JSON, not form-encoded HTMX fragments, so it gets its own route rather
    // than going through handleAction: it posts { messages: [...] } and expects a Response object
    // back ({ html }), with anything else in the JSON left for our own responseInterceptor.
    if (req.method === 'POST' && pathname === '/actions/deep-chat') {
      let raw = '';
      req.on('data', (d) => { raw += d; if (raw.length > 1e6) req.destroy(); });
      req.on('end', async () => {
        const json = (o, status = 200) => {
          res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify(o));
        };
        try {
          const parsed = JSON.parse(raw || '{}');
          const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
          // Only the newest user turn is the ask; deep-chat keeps the transcript for display.
          const last = [...messages].reverse().find((m) => m.role !== 'ai');
          const message = String((last && (last.text || last.message)) || '').trim();
          if (!message) return json({ error: 'Empty message.' }, 400);
          audit('/actions/chat', { workspace: '-', projectName: message.slice(0, 120) });
          const { replyHtml, directive } = await assistantReply(message, String(parsed.context || ''));
          // `html` is deep-chat's own field; `directive` is ours, read by the response interceptor.
          return json({ html: `<div class="dc-reply">${replyHtml}</div>`, directive });
        } catch (err) {
          return json({ error: err.message || 'Assistant failed.' }, 500);
        }
      });
      return;
    }

    if (req.method === 'POST' && pathname.startsWith('/actions/')) {
      let body = '';
      req.on('data', (d) => { body += d; if (body.length > 1e6) req.destroy(); });
      req.on('end', () => handleAction(pathname, querystring.parse(body), res, req));
      return;
    }

    res.writeHead(405, { 'Content-Type': 'text/plain' });
    res.end('Method not allowed');
  } catch (err) {
    // A handler that throws AFTER writing its response used to take the whole dashboard down:
    // writeHead here threw ERR_HTTP_HEADERS_SENT, which is not catchable from inside this catch,
    // so node killed the process and supervisord restarted it into the same crash on the next
    // request. Report it and close the response that is already open.
    console.error('Request failed:', req.method, req.url, err && err.stack);
    if (res.headersSent) { try { res.end(); } catch (_) { /* already gone */ } return; }
    if (req.headers['hx-request']) {
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(`<div class="msg error">Server error: ${esc(err.message)}</div>`);
    }
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end(`Server error: ${err.message}`);
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`workspace-dashboard (node:http + HTMX) listening on :${PORT}`);
});
