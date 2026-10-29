/**
 * Google Drive sync: a "Sync to Drive" button on the workspaces that hold files worth keeping
 * somewhere else (videos, audio, docs, specs, and the test reports of the test workspace).
 *
 * Set up per person, from the panel: paste the team's OAuth client id and secret once, press Connect
 * with your own Google account, and choose a storage folder (any folder, or one in a Google Workspace
 * shared drive). Every workspace then stores into <storage folder>/<workspace>, or into a folder of its
 * own if you chose one. The push is cmd-tools-google-drive-sync.sh run as a job, so the button and the command
 * line cannot disagree, and it asks before overwriting anything already on Drive.
 */

module.exports.register = (api) => {
  const fs = require('fs');
  const path = require('path');
  const crypto = require('crypto');
  const { esc, screenAction } = api.lib;
  const googleAuth = api.lib.auth;                 // the dashboard's sign-in: who is signed in, and the Google button
  const drive = require('./lib/drive');
  const ctx = require('./lib/context');
  const { workspaceDir, isValidWorkspace } = ctx;

  // The settings moved out of settings.yml into this plugin's own file; the first start does it, once.
  if (ctx.migrate()) console.log(`google-drive-sync: moved google_drive: from settings.yml to ${ctx.SETTINGS_FILE}`);

  const SCRIPT = 'cmd-tools-google-drive-sync.sh';
  const states = new Map();     // OAuth state -> expiry; one dashboard process, so memory is enough

  const msg = (html, kind = 'assistant') => `<div class="msg ${kind}">${html}</div>`;
  const folderUrl = (id) => `https://drive.google.com/drive/folders/${encodeURIComponent(id)}`;
  const base = `/fragments/p/${api.name}`;
  const post = (name) => `/actions/p/${api.name}/${name}`;
  const saveSetting = (dotted, value) => api.settings.set(dotted, value);
  const wsOk = (ws) => isValidWorkspace(ws) && api.appliesTo(ws);
  const vals = (o) => esc(JSON.stringify(o));
  const BODY = '#drive-sync-body';
  const MODAL = '#editor-modal-body';
  const reports = (ws) => drive.sourceOf(ws) === 'test-reports';

  // ---- Rail button -----------------------------------------------------------------------

  api.addPageActions(({ view, key, meta }) => {
    if (view !== 'workspace' || !key || !api.appliesTo(key)) return null;
    return {
      label: 'Google Drive',
      items: [
        `<button class="uk-button uk-button-default action-btn" hx-get="${base}/panel?workspace=${esc(key)}"`
        + ` hx-target="${MODAL}" hx-swap="innerHTML" title="${reports(key) ? 'Push the test reports of each project' : `Push ${esc(meta.label || key)}`} to Google Drive">`
        + `<span uk-icon="icon: cloud-upload; ratio: .8"></span><span class="action-label">${reports(key) ? 'Sync test reports' : 'Sync to Drive'}</span></button>`,
      ],
    };
  });

  // ---- Panel -----------------------------------------------------------------------------

  const wrap = (ws, inner) => `
    <div class="editor-card" id="drive-sync-card">
      <h3 class="uk-margin-small-bottom">Google Drive: ${esc(ws)}</h3>
      <div id="drive-sync-body">${inner}</div>
    </div>`;

  function setupForm(ws, s) {
    return `
      <p>Google Drive is not set up for you yet. It takes a minute, once.</p>
      <p class="uk-margin-small-bottom"><strong>Team setup (once, by whoever owns the Google Workspace):</strong> in
        <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener">Google Cloud Console</a>, enable the
        <em>Google Drive API</em> and create an <em>OAuth client ID</em> of type <em>Web application</em>, with the consent screen marked <em>Internal</em> so no verification or token expiry applies.
        Add this authorised redirect URI: <code>${esc(s.redirectUri)}</code>. Share the client id and secret with the team the way you share any secret.</p>
      <p class="uk-margin-small-bottom"><strong>Each person:</strong> paste them here. They are saved on this machine only.</p>
      <form class="uk-form-stacked" hx-post="${post('setup')}" hx-target="${MODAL}" hx-swap="innerHTML">
        <input type="hidden" name="workspace" value="${esc(ws)}">
        <input class="uk-input uk-form-small uk-margin-small-bottom" name="client_id" placeholder="OAuth client id" required autocomplete="off">
        <input class="uk-input uk-form-small uk-margin-small-bottom" type="password" name="client_secret" placeholder="OAuth client secret" required autocomplete="off">
        <button class="uk-button uk-button-primary" type="submit">Save</button>
      </form>
      <p class="uk-text-meta uk-margin-small-top">Scope <code>${esc(s.scope)}</code>: choosing a folder you already have needs full Drive access; the narrower drive.file scope only sees files this app made itself.</p>`;
  }

  async function nameOf(id) {
    try { return { ok: true, name: (await drive.getFile(id)).name }; } catch (err) { return { ok: false, name: err.message }; }
  }

  async function panel(ws, req) {
    const s = drive.driveSettings();
    if (!s.configured) return wrap(ws, setupForm(ws, s));
    if (!s.connected) {
      return wrap(ws, `
        <p>Connect the Google account whose Drive these files should go to.</p>
        <style>${googleAuth.BUTTON_CSS}</style>
        ${googleAuth.googleButton(`${base}/connect`, 'Sign in with Google to connect Drive', 'target="_blank" rel="noopener"')}
        <button class="uk-button uk-button-default" hx-get="${base}/panel?workspace=${esc(ws)}" hx-target="${MODAL}" hx-swap="innerHTML">I have connected, refresh</button>
        <p class="uk-text-meta uk-margin-small-top">Google opens in a new tab and sends you back here. If it says the redirect URI does not match, add <code>${esc(s.redirectUri)}</code> to the OAuth client.</p>`);
    }
    let account;
    try {
      const u = await drive.about();
      account = `${esc(u.displayName || '')} &lt;${esc(u.emailAddress || '')}&gt;`;
      // The account this Drive is meant to be: the dashboard sign-in if there is one, else the account setting.
      const me = req && googleAuth.sessionOf(req);
      const wanted = ((me && me.email) || s.account || '').toLowerCase();
      if (wanted && u.emailAddress && wanted !== String(u.emailAddress).toLowerCase()) {
        account += ` <span class="uk-text-warning uk-text-small">(expected ${esc(wanted)}; Disconnect and connect again to use that account)</span>`;
      }
    } catch (err) { account = `<span class="uk-text-danger">${esc(err.message)}</span>`; }

    const own = drive.parseFolderId(s.destinations[ws]);
    let where = '<em>no storage folder yet</em>';
    if (own || s.rootFolder) {
      const f = await nameOf(own || s.rootFolder);
      const link = f.ok ? `<a href="${folderUrl(own || s.rootFolder)}" target="_blank" rel="noopener"><span uk-icon="icon: folder; ratio: .8"></span> ${esc(f.name)}</a>` : `<span class="uk-text-danger">not reachable: ${esc(f.name)}</span>`;
      where = own ? `${link} <span class="uk-text-meta">(its own folder)</span>` : `${link} / <strong>${esc(ws)}</strong> <span class="uk-text-meta">(the storage folder)</span>`;
    }
    const targets = s.targets[ws] || [];
    const ready = (own || s.rootFolder) && fs.existsSync(path.join(workspaceDir(ws), SCRIPT)) && (reports(ws) || targets.length > 0);
    const browse = (target, label) => `<button class="uk-button uk-button-default uk-button-small" hx-get="${base}/folders?workspace=${esc(ws)}&parent=root&target=${target}" hx-target="${BODY}" hx-swap="innerHTML">${label}</button>`;
    const act = (dry) => `hx-post="${post('sync')}" hx-vals='${vals({ workspace: ws, dry: dry ? '1' : '' })}' hx-target="#drive-sync-result" hx-swap="innerHTML"`;
    return wrap(ws, `
      <p class="uk-margin-remove">Account: <strong>${account}</strong></p>
      <p class="uk-margin-small-top uk-margin-remove-bottom">Stores in: ${where}</p>
      <p class="uk-margin-small-top">
        ${browse('root', s.rootFolder ? 'Change the storage folder' : 'Choose the storage folder')}
        ${browse('ws', own ? 'Change this workspace\'s folder' : `A different folder for ${esc(ws)}`)}
        ${own ? `<button class="uk-button uk-button-link" hx-post="${post('clear')}" hx-vals='${vals({ workspace: ws })}' hx-target="${MODAL}" hx-swap="innerHTML">Use the storage folder</button>` : ''}</p>
      ${ready || (!reports(ws) && !targets.length && (own || s.rootFolder)) ? '' : msg(`Choose a storage folder first, and make sure ${esc(SCRIPT)} is in this folder (run <code>sync-tooling.sh --pull</code>).`, 'error')}
      ${reports(ws) ? '' : `
      <form class="uk-margin-small-top" hx-post="${post('targets')}" hx-target="${MODAL}" hx-swap="innerHTML">
        <input type="hidden" name="workspace" value="${esc(ws)}">
        <label class="uk-text-small"><strong>Only these files are pushed</strong>, one per line: a name (<code>*.mp4</code>, any depth), a path (<code>guide/*.pdf</code>) or a folder (<code>guide/</code>). Nothing else goes.</label>
        <textarea class="uk-textarea uk-form-small uk-margin-small-top" name="targets" rows="${Math.min(8, Math.max(3, targets.length + 1))}" placeholder="*.mp4">${esc(targets.join('\n'))}</textarea>
        <button class="uk-button uk-button-default uk-button-small uk-margin-small-top" type="submit">Save targets</button>
        ${targets.length ? '' : '<span class="uk-text-danger uk-text-small uk-margin-small-left">No files selected yet, so nothing can be pushed.</span>'}
      </form>`}
      ${reports(ws) ? '<p class="uk-text-meta uk-margin-remove-bottom">Pushes the test reports, failure screenshots and recordings of each project, as <code>&lt;project&gt;/&lt;module&gt;/reports | screenshots | videos</code>. Not the projects themselves.</p>' : ''}
      <div class="uk-margin-small-top">
        <button class="uk-button uk-button-default" ${ready ? '' : 'disabled'} ${act(true)}><span uk-icon="icon: search; ratio: .8"></span> Preview</button>
        <button class="uk-button uk-button-primary" ${ready ? '' : 'disabled'} ${act(false)}><span uk-icon="icon: cloud-upload; ratio: .8"></span> Sync now</button>
        <button class="uk-button uk-button-link uk-margin-small-left" hx-post="${post('disconnect')}" hx-vals='${vals({ workspace: ws })}' hx-target="${MODAL}" hx-swap="innerHTML" title="Forget the stored token on this machine">Disconnect</button>
      </div>
      <p class="uk-text-meta">New and changed files go up. Nothing on Drive is ever deleted, and you are asked before anything already there is overwritten. Skipped: ${esc(s.exclude.join(', '))} and symbolic links.</p>
      <div id="drive-sync-result"></div>`);
  }

  // ---- Folder browser --------------------------------------------------------------------

  async function trail(parent) {
    if (parent === 'root') return [{ id: 'root', name: 'My Drive' }];
    if (parent === 'shared') return [{ id: 'shared', name: 'Shared with me' }];
    if (parent === 'drives') return [{ id: 'drives', name: 'Shared drives' }];
    if (parent === 'starred') return [{ id: 'starred', name: 'Starred' }];
    if (parent === 'recent') return [{ id: 'recent', name: 'Recent' }];
    const chain = [];
    let id = parent;
    let top = null;
    for (let i = 0; i < 8 && id; i += 1) {
      const f = await drive.getFile(id);
      top = f;
      const parents = f.parents || [];
      if (!parents.length && !f.driveId && f.name === 'My Drive') break;   // the root itself
      chain.unshift({ id: f.id, name: f.name });
      id = parents[0];
    }
    let first = { id: 'root', name: 'My Drive' };
    if (top && top.driveId) first = { id: 'drives', name: 'Shared drives' };
    else if (top && !(top.parents || []).length && top.name !== 'My Drive') first = { id: 'shared', name: 'Shared with me' };
    return [first, ...chain];
  }

  async function browser(ws, parent, target) {
    const crumbs = await trail(parent);
    const locs = drive.driveSettings().locations;
    // At the top, My Drive's own folders; the other places are links, and only the ones the setting allows.
    const folders = parent === 'root' && !locs.includes('my_drive') ? [] : await drive.listFolders(parent);
    const link = (id, label) => `<a hx-get="${base}/folders?workspace=${esc(ws)}&parent=${esc(id)}&target=${esc(target)}" hx-target="${BODY}" hx-swap="innerHTML">${esc(label)}</a>`;
    const here = crumbs[crumbs.length - 1];
    const inFolder = !['root', 'shared', 'drives', 'starred', 'recent'].includes(parent);
    const what = target === 'root' ? 'the storage folder for every workspace' : `the folder for ${ws}`;
    return `
      <p class="uk-text-small uk-margin-small-bottom">Choose ${esc(what)}.</p>
      <p class="uk-text-small uk-margin-small-bottom">${crumbs.map((c) => link(c.id, c.name)).join(' / ')}
        ${parent === 'root' ? [locs.includes('shared_with_me') && link('shared', 'Shared with me'), locs.includes('shared_drives') && link('drives', 'Shared drives'), locs.includes('starred') && link('starred', 'Starred'), locs.includes('recent') && link('recent', 'Recent')].filter(Boolean).map((l) => ` · ${l}`).join('') : ''}</p>
      <ul class="uk-list uk-list-divider uk-margin-remove" style="max-height:18rem;overflow:auto">
        ${folders.map((f) => `<li class="uk-flex uk-flex-middle"><span class="uk-flex-1">${link(f.id, f.name)}</span>
          <button class="uk-button uk-button-primary uk-button-small" hx-post="${post('choose')}" hx-vals='${vals({ workspace: ws, folder: f.id, target })}' hx-target="${MODAL}" hx-swap="innerHTML">Choose</button></li>`).join('')
          || `<li class="uk-text-meta">${parent === 'root' && !locs.includes('my_drive') ? 'Pick a place above.' : 'Nothing here.'}</li>`}
      </ul>
      ${inFolder ? `<p class="uk-margin-small-top"><button class="uk-button uk-button-default uk-button-small" hx-post="${post('choose')}" hx-vals='${vals({ workspace: ws, folder: here.id, target })}' hx-target="${MODAL}" hx-swap="innerHTML">Use ${esc(here.name)} itself</button></p>` : ''}
      ${inFolder || parent === 'root' ? `
      <form class="uk-margin-small-top uk-flex" hx-post="${post('mkdir')}" hx-target="${BODY}" hx-swap="innerHTML">
        <input type="hidden" name="workspace" value="${esc(ws)}"><input type="hidden" name="parent" value="${esc(parent)}"><input type="hidden" name="target" value="${esc(target)}">
        <input class="uk-input uk-form-small" name="name" placeholder="New folder here, e.g. ${target === 'root' ? 'Webship Workspace' : esc(ws)}" required>
        <button class="uk-button uk-button-default uk-button-small uk-margin-small-left uk-text-nowrap" type="submit">Create</button></form>` : ''}
      <form class="uk-margin-small-top uk-flex" hx-post="${post('choose')}" hx-target="${MODAL}" hx-swap="innerHTML">
        <input type="hidden" name="workspace" value="${esc(ws)}"><input type="hidden" name="target" value="${esc(target)}">
        <input class="uk-input uk-form-small" name="folder" placeholder="…or paste a Drive folder link or id" required>
        <button class="uk-button uk-button-default uk-button-small uk-margin-small-left uk-text-nowrap" type="submit">Use it</button></form>
      <p class="uk-margin-small-top"><button class="uk-button uk-button-link" hx-get="${base}/panel?workspace=${esc(ws)}" hx-target="${MODAL}" hx-swap="innerHTML">Back</button></p>`;
  }

  // ---- Fragments -------------------------------------------------------------------------

  api.addFragment(({ send, req, res, rest, searchParams }) => {
    const ws = String(searchParams.get('workspace') || '');
    const fail = (err) => send(msg(esc(err.message || String(err)), 'error'), 500);

    if (rest === 'connect') {
      const s = drive.driveSettings();
      if (!s.configured) return send(msg('Paste the OAuth client id and secret into the Sync panel first.', 'error'), 400);
      const state = crypto.randomBytes(18).toString('hex');
      states.set(state, Date.now() + 10 * 60 * 1000);
      const me = googleAuth.sessionOf(req);
      res.writeHead(302, { Location: drive.authUrl(state, (me && me.email) || s.account) });
      return res.end();
    }

    if (rest === 'callback') {
      const page = (body, status = 200) => send(`<!doctype html><meta charset="utf-8"><title>Google Drive</title><body style="font-family:sans-serif;max-width:34rem;margin:4rem auto;padding:0 1rem">${body}</body>`, status);
      const state = String(searchParams.get('state') || '');
      const until = states.get(state);
      states.delete(state);
      if (!until || until < Date.now()) return page('<h2>That link has expired</h2><p>Press Connect in the dashboard again.</p>', 400);
      if (searchParams.get('error')) return page(`<h2>Google did not connect</h2><p>${esc(searchParams.get('error'))}</p>`, 400);
      drive.exchangeCode(String(searchParams.get('code') || '')).then((tokens) => {
        saveSetting('refresh_token', tokens.refresh_token);
        page('<h2>Google Drive is connected</h2><p>You can close this tab and press <strong>refresh</strong> in the dashboard.</p>');
      }).catch((err) => page(`<h2>Could not connect</h2><p>${esc(err.message)}</p>`, 500));
      return undefined;
    }

    if (!wsOk(ws)) return send(msg('Google Drive sync is not enabled for this workspace.', 'error'), 400);
    if (rest === 'panel') return panel(ws, req).then(send, fail);
    if (rest === 'folders') {
      const parent = String(searchParams.get('parent') || 'root');
      const target = searchParams.get('target') === 'root' ? 'root' : 'ws';
      if (!['root', 'shared', 'drives', 'starred', 'recent'].includes(parent) && !drive.parseFolderId(parent)) return send(msg('Not a Drive folder.', 'error'), 400);
      return browser(ws, parent, target).then(send, fail);
    }
    return send(msg('Unknown Google Drive fragment.', 'error'), 404);
  });

  // ---- Actions ---------------------------------------------------------------------------

  const guard = (fn) => (ctx) => {
    if (!wsOk(ctx.workspace)) return ctx.send(msg('Google Drive sync is not enabled for this workspace.', 'error'), 400);
    return Promise.resolve(fn(ctx)).catch((err) => ctx.send(msg(esc(err.message), 'error'), 500));
  };

  api.addAction('setup', guard(async ({ form, send, workspace }) => {
    const id = String(form.client_id || '').trim();
    const secret = String(form.client_secret || '').trim();
    if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(id)) return send(msg('That does not look like a Google OAuth client id (it ends in .apps.googleusercontent.com).', 'error'), 400);
    if (secret.length < 8 || /\s/.test(secret)) return send(msg('That does not look like a client secret.', 'error'), 400);
    saveSetting('client_id', id);
    saveSetting('client_secret', secret);
    return send(await panel(workspace));
  }));

  api.addAction('choose', guard(async ({ form, send, workspace }) => {
    const id = drive.parseFolderId(form.folder);
    if (!id || id === 'root') return send(msg('Open a folder first, or paste a link to one. My Drive itself is not a folder to store into.', 'error'), 400);
    const f = await drive.getFile(id);
    if (f.mimeType !== drive.FOLDER) return send(msg(`${esc(f.name)} is a file, not a folder.`, 'error'), 400);
    drive.assertAllowed(f);
    saveSetting(form.target === 'root' ? 'root_folder' : `destinations.${workspace}`, id);
    return send(await panel(workspace));
  }));

  api.addAction('targets', guard(async ({ form, send, workspace }) => {
    const lines = String(form.targets || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length > 60) return send(msg('That is a lot of targets. Use folders or broader patterns, 60 at most.', 'error'), 400);
    const bad = lines.find((l) => /(^|\/)\.\.(\/|$)|^\/|[\\\0"`$]|[\u0000-\u001f]/.test(l));
    if (bad) return send(msg(`${esc(bad)} is not a target: no leading slash, no .. and no quotes or backslashes.`, 'error'), 400);
    api.settings.setList(`targets.${workspace}`, lines);
    return send(await panel(workspace));
  }));

  api.addAction('clear', guard(async ({ send, workspace }) => {
    saveSetting(`destinations.${workspace}`, '');
    return send(await panel(workspace));
  }));

  api.addAction('mkdir', guard(async ({ form, send, workspace }) => {
    const parent = drive.parseFolderId(form.parent);
    const name = String(form.name || '').trim();
    if (!parent || ['shared', 'drives', 'starred', 'recent'].includes(form.parent)) return send(msg('Open a folder to make the new one in.', 'error'), 400);
    if (!name || /[\\/]/.test(name)) return send(msg('A folder name has no slash.', 'error'), 400);
    await drive.createFolder(name, parent);
    return send(await browser(workspace, form.parent, form.target === 'root' ? 'root' : 'ws'));
  }));

  api.addAction('disconnect', guard(async ({ send, workspace }) => {
    saveSetting('refresh_token', '');
    return send(await panel(workspace));
  }));

  // The check before the write: compare with Drive first, and when that would overwrite a file or write
  // into a sub folder already there, show exactly which and wait for an explicit approval.
  api.addAction('sync', guard(async ({ form, send, workspace }) => {
    const script = path.join(workspaceDir(workspace), SCRIPT);
    if (!fs.existsSync(script)) return send(msg(`${esc(SCRIPT)} is missing from ${esc(workspace)}.`, 'error'), 400);
    const dry = form.dry === '1';
    const approved = form.approve === '1';

    if (!dry && !approved) {
      const plan = await drive.planWorkspace(workspace);
      if (plan.empty) return send(msg(esc(plan.empty)));
      if (plan.needsApproval) {
        const list = (items, mark) => `<ul class="uk-list uk-text-small uk-margin-small" style="max-height:10rem;overflow:auto">${items.slice(0, 60).map((r) => `<li><code>${mark} ${esc(r)}</code></li>`).join('')}${items.length > 60 ? `<li>… and ${items.length - 60} more</li>` : ''}</ul>`;
        return send(`
          <div class="msg error">
            <strong>This is already on Google Drive.</strong> Nothing has been written.
            ${plan.overwrites.length ? `<p class="uk-margin-small-bottom">Would <strong>overwrite ${plan.overwrites.length} file(s)</strong> with the version on this machine:</p>${list(plan.overwrites, '~')}` : ''}
            ${plan.merges.length ? `<p class="uk-margin-small-bottom">Would write into <strong>${plan.merges.length} sub folder(s)</strong> that exist:</p>${list(plan.merges, '=')}` : ''}
            <p class="uk-margin-small-bottom">${plan.stats.created} new file(s) would be added. Nothing on Drive is deleted.</p>
            <button class="uk-button uk-button-danger uk-button-small" hx-post="${post('sync')}" hx-vals='${vals({ workspace, approve: '1' })}' hx-target="#drive-sync-result" hx-swap="innerHTML">Approve and sync</button>
            <button class="uk-button uk-button-default uk-button-small" hx-get="${base}/panel?workspace=${esc(workspace)}" hx-target="${MODAL}" hx-swap="innerHTML">Cancel</button>
          </div>`);
      }
    }

    const flags = [...(dry ? ['--dry-run'] : []), ...(approved ? ['--overwrite'] : [])];
    // A Screen session like every other command: it shows on the Screens page, survives a dashboard restart and
    // can be attached from a terminal. One name for preview and sync, so the two can never run at once.
    return screenAction(send, {
      workspace, project: '', projectDir: workspaceDir(workspace), ownerDir: workspaceDir(workspace), verb: 'google-drive-sync',
      cmdLine: `bash ${JSON.stringify(script)}${flags.map((f) => ` ${f}`).join('')}`,
      label: `${dry ? 'Preview' : 'Sync'} ${workspace} to Google Drive`,
    });
  }));
};
