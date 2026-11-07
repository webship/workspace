/**
 * Upsun for Webship Workspace.
 *
 * The UPSUN menu on every site row (link, environments, live sites, activities, the deploy log,
 * get database and files, branch and data), a live-site chip on the project card, a "Link to
 * Upsun" option when a new folder is made, and the `/upsun-site/<workspace>/<project>` jump to
 * the environment the local code is on.
 *
 * Everything the dashboard is asked for goes through `api`; this package requires nothing from
 * the dashboard's own files, so it can be installed from npm and removed without a trace.
 */

const fs = require('fs');
const path = require('path');

const { upsunLinkOf } = require('./lib/link');

module.exports.register = (api) => {
  const { esc, workspaceDir, listProjects, isValidWorkspace, screenAction, iconHtml, NAME_RE } = api.lib;
  const env = require('./lib/environments')(api);
  const post = (name) => `/actions/p/${api.name}/${name}`;
  const fragment = (rest) => `/fragments/p/${api.name}/${rest}`;
  const SCRIPT = 'cmd-tools-upsun.sh';

  // Where this plugin shows itself: on rows whose workspace type allows `upsun` AND whose folder
  // has the command the plugin installed (plugins.sh --install puts it in every site workspace).
  const canUpsun = (key, allowed, dir) => allowed.has('upsun') && fs.existsSync(path.join(dir, SCRIPT));

  // ---- The UPSUN menu on a project row ---------------------------------------------------------

  api.addRowMenu('upsun', { label: 'UPSUN', row: 0 }, ({ key, project: p, dir, allowed, vals }) => {
    if (!canUpsun(key, allowed, dir)) return null;
    const u = upsunLinkOf(dir, p);
    const caption = !u ? 'not linked' : 'linked';
    if (!u) {
      // Not linked: the menu still opens, and says how to link. The workspace ships the command either way.
      return `<span class="act-with-status"><div class="uk-inline act-menu act-menu-upsun">
          <button class="uk-button uk-button-default uk-button-small upsun-unlinked" type="button" title="Not linked to Upsun"><span uk-icon="icon: cloud-upload; ratio: .7"></span> UPSUN <span uk-icon="icon: chevron-down; ratio: .6"></span></button>
          <div uk-dropdown="mode: click; pos: bottom-right"><ul class="uk-nav uk-dropdown-nav">
            <li class="uk-nav-header">Not linked to Upsun</li>
            <li><a href hx-post="${post('status')}" ${vals()}><span uk-icon="icon: info; ratio: .7"></span> Link and environments</a></li>
            <li class="uk-nav-divider"></li>
            <li class="uk-nav-header upsun-menu-note" data-group="how to link">Link it from ${esc(key)}:<br>
              <code>bash ${SCRIPT} ${esc(p)} --link &lt;upsun-project-id&gt;</code></li>
          </ul></div>
        </div><span class="act-status uk-text-meta">${esc(caption)}</span></span>`;
    }
    const idLine = `${esc(u.id || '(no id)')}${u.branch ? ` · <span title="the branch the local code is on">${esc(u.branch)}</span>` : ''}`
      + `${u.mismatch ? ` <span class="uk-label uk-label-danger upsun-mismatch" title="The git remote points at ${esc(u.remoteId)}">remote: ${esc(u.remoteId)}</span>` : ''}`;
    return `<span class="act-with-status"><div class="uk-inline act-menu act-menu-upsun">
        <button class="uk-button uk-button-default uk-button-small" type="button" title="UPSUN"><span uk-icon="icon: cloud-upload; ratio: .7"></span> UPSUN <span uk-icon="icon: chevron-down; ratio: .6"></span></button>
        <div uk-dropdown="mode: click; pos: bottom-right"><ul class="uk-nav uk-dropdown-nav">
          <li class="uk-nav-header upsun-menu-id" data-group="link">${idLine}</li>
          <li><a href hx-post="${post('envs')}" hx-vals='{"workspace":"${esc(key)}","projectName":"${esc(p)}"}' hx-target="#editor-modal-body" hx-swap="innerHTML"><span uk-icon="icon: world; ratio: .7"></span> Environments and live sites</a></li>
          <li class="uk-nav-header" data-group="live sites">Live sites</li>
          <li data-entry="live sites list"><ul class="uk-nav-sub" hx-get="${fragment(`envs/${encodeURIComponent(key)}/${encodeURIComponent(p)}`)}" hx-trigger="revealed" hx-swap="innerHTML"><li class="uk-nav-header">Loading…</li></ul></li>
          <li><a href hx-post="${post('status')}" ${vals()}><span uk-icon="icon: info; ratio: .7"></span> Link and environments</a></li>
          <li><a href hx-post="${post('activities')}" ${vals()}><span uk-icon="icon: list; ratio: .7"></span> Last 10 activities</a></li>
          <li><a href hx-post="${post('logs')}" ${vals()}><span uk-icon="icon: file-text; ratio: .7"></span> Most recent deploy log</a></li>
          <li class="uk-nav-divider"></li>
          <li><a href hx-post="${post('pull-form')}" hx-vals='{"workspace":"${esc(key)}","projectName":"${esc(p)}"}' hx-target="#editor-modal-body" hx-swap="innerHTML"><span uk-icon="icon: cloud-download; ratio: .7"></span> Get database &amp; files…</a></li>
          <li><a href hx-post="${post('environments')}" ${vals()}><span uk-icon="icon: git-branch; ratio: .7"></span> Branch and data…${u.env ? ` <span class="uk-text-meta">(${esc(u.env)})</span>` : ''}</a></li>
          <li class="uk-nav-divider"></li>
          <li><a href="https://console.upsun.com/projects/${encodeURIComponent(u.id)}" target="_blank"><span uk-icon="icon: link-external; ratio: .7"></span> Open in the Upsun console</a></li>
          <li class="uk-nav-header upsun-menu-note">Deploying, linking and init stay on the command line</li>
        </ul></div>
      </div><span class="act-status uk-text-meta">${esc(caption)}</span></span>`;
  });

  // ---- The live-site chip on the project card --------------------------------------------------

  api.addProjectChip(({ key, project: p, dir }) => {
    const cloud = upsunLinkOf(dir, p);
    if (!cloud) return null;
    return `<a class="proj-alias proj-plugin-link proj-upsun-link" href="/upsun-site/${encodeURIComponent(key)}/${encodeURIComponent(p)}" target="_blank" rel="noopener"
      title="The live Upsun site for the environment this code is on">${iconHtml('tabler:cloud-upload', 0.7)}<span class="pcard-chip-text">${esc(cloud.branch || cloud.env || cloud.id)}</span></a>`;
  });

  // ---- Actions: the command-line tool, run as a screen session ------------------------------

  const TOOL = {
    status: { verb: 'upsun', label: 'link and environments', args: [] },
    activities: { verb: 'upsun-activities', label: 'activities', args: ['--activities'] },
    logs: { verb: 'upsun-logs', label: 'deploy log', args: ['--logs'] },
  };
  for (const [name, act] of Object.entries(TOOL)) {
    api.addAction(name, ({ form, send, workspace }) => {
      const dir = workspaceDir(workspace);
      if (!fs.existsSync(path.join(dir, SCRIPT))) return send('<div class="msg error">This workspace has no Upsun tool.</div>', 400);
      const projectName = String(form.projectName || '');
      if (!NAME_RE.test(projectName) || !listProjects(dir).includes(projectName)) return send('<div class="msg error">Unknown project.</div>', 400);
      return screenAction(send, { workspace, project: projectName, projectDir: dir,
        ownerDir: path.join(dir, projectName), verb: act.verb,
        cmdLine: `bash ${SCRIPT} ${projectName}${act.args.length ? ` ${act.args.join(' ')}` : ''}`,
        label: `upsun ${act.label}` });
    });
  }
  for (const [name, handler] of Object.entries(env.actions)) api.addAction(name, handler);

  // ---- The live-sites list inside the menu ------------------------------------------------

  api.addFragment(async ({ send, rest }) => {
    const m = rest.match(/^envs\/([a-z0-9_-]+)\/([a-zA-Z0-9_-]+)$/);
    if (!m || !isValidWorkspace(m[1])) return send('', 404);
    const info = await env.upsunEnvironments(workspaceDir(m[1]), m[2]);
    const rows = (info && info.rows) || [];
    const items = rows.map((r) => {
      const here = r.envId === (info.branch || info.env);
      return r.url
        ? `<li><a href="${esc(r.url)}" target="_blank" title="${esc(r.url)}"><span uk-icon="icon: link-external; ratio: .7"></span> ${esc(r.title)}${here ? ' <span class="uk-text-meta">(this code)</span>' : ''}</a></li>`
        : `<li><span class="uk-text-meta"><span uk-icon="icon: ban; ratio: .7"></span> ${esc(r.title)} — ${esc((r.status || '').toLowerCase())}</span></li>`;
    }).join('');
    send(items || `<li class="uk-nav-header">${info && info.why === 'no token' ? 'No Upsun API token in plugin.upsun.settings.yml' : 'No environments'}</li>`);
  });

  // ---- The page: jump to the live site of the environment this code is on ------------------

  api.addPage(/^\/upsun-site\/([a-z0-9_-]+)\/([a-zA-Z0-9_-]+)$/, async ({ res, match }) => {
    if (!isValidWorkspace(match[1])) { res.writeHead(404); return res.end(); }
    const info = await env.upsunEnvironments(workspaceDir(match[1]), match[2]);
    const want = info && (info.branch || info.env || 'main');
    const row = info && (info.rows.find((r) => r.envId === want && r.url) || info.rows.find((r) => r.url));
    if (row) { res.writeHead(302, { Location: row.url }); return res.end(); }
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<p>No live Upsun URL for ${esc(match[2])}${info && info.why ? ` (${esc(info.why)})` : ''}.</p>`);
  });

  // ---- New folder: link it to an Upsun project, or create one with AI -----------------------

  const UPSUN_ID_RE = /^[a-z0-9]{8,20}$/;
  const shq = (v) => `'${String(v).replace(/'/g, `'\\''`)}'`;
  api.addFolderSetup({
    html: (ws, { allowed }) => {
      if (!canUpsun(ws, allowed, workspaceDir(ws))) return '';
      return `<div class="uk-margin-small-top folder-upsun">
            <span class="uk-text-meta">Upsun:</span>
            <label class="uk-margin-small-right"><input class="uk-radio" type="radio" name="upsun" value="none" checked> Not now</label>
            <label class="uk-margin-small-right"><input class="uk-radio" type="radio" name="upsun" value="link"> Link to an existing project</label>
            <label><input class="uk-radio" type="radio" name="upsun" value="create"> Create a new project and deploy it, with AI (it asks before creating anything billed)</label>
            <div class="folder-upsun-id uk-margin-small-top">
              <label class="uk-form-label" for="folder-upsun-id">Upsun project id</label>
              <input class="uk-input uk-form-small uk-form-width-medium" id="folder-upsun-id" name="upsun_id"
                     pattern="[a-z0-9]{8,20}" maxlength="20" placeholder="eeihb6tksv2ly">
            </div>
          </div>`;
    },
    steps: (ws, name, form, { allowed }) => {
      if (form.upsun !== 'link' || !canUpsun(ws, allowed, workspaceDir(ws))) return [];
      return [`( cd ${shq(name)} && { git rev-parse --git-dir >/dev/null 2>&1 || git init -q; } )`,
        `bash ${SCRIPT} ${shq(name)} --link ${shq(form.upsun_id)}`];
    },
    prompt: (ws, name, form) => {
      if (form.upsun !== 'create') return [];
      return [`Create a new Upsun project for this folder and deploy it. Before creating anything billed, ask me which organization, region and plan to use, and wait for my answer. `
        + 'If a setup session is configuring DDEV here, wait until .ddev/config.yaml exists. Then: git init if needed, upsun project:create, link it with `upsun project:set-remote`, '
        + 'write .upsun/config.yaml to match .ddev/config.yaml (PHP version, database, docroot), commit, and push to main. Never put a secret or key into the repository.'];
    },
    problem: (ws, form, { allowed }) => {
      if (form.upsun !== 'link' && form.upsun !== 'create') return '';
      if (!canUpsun(ws, allowed, workspaceDir(ws))) return 'This workspace does not link projects to Upsun.';
      if (form.upsun === 'link' && !UPSUN_ID_RE.test(String(form.upsun_id || ''))) return 'An Upsun project id is 8 to 20 lowercase letters and digits.';
      return '';
    },
  });
};
