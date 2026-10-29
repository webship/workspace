/**
 * Mailpit, as one feature: its menu item, its route, its panel and where its mailbox is.
 *
 * `server.js` knows four things about mail, and each of them is one line: which URL a listing row
 * carries, the menu item for a project, the fragment route, and the lookup the actions are handed.
 * Everything else — the markup, the wiring, the "is it running" rule — lives here, so adding a column
 * to the panel or a verb to the toolbar never touches the server file.
 *
 * The API client is `ddev-mail.js`; the three write verbs are `actions/ddev-mail.js`. This module is
 * what joins them to the dashboard.
 */

const path = require('path');

const { esc } = require('./html');
const { humanSize, humanTime } = require('./format');
const { workspaceDir } = require('./workspaces');
const { ddevProjectName } = require('./jobs');
const { NAME_RE } = require('./validate');
const mail = require('./ddev-mail');

// `/fragments/projects/mail/<workspace>/<project>` — the one path this feature answers on, matched
// here rather than in the server's chain of patterns.
const FRAGMENT_RE = /^\/fragments\/projects\/mail\/([a-z0-9_-]+)\/([a-zA-Z0-9_-]+)$/;

/**
 * The Mailpit URL a `ddev list` row carries, if any.
 *
 * https first: it is the same service on the other port, with the certificate DDEV issued.
 */
const urlFromListing = (row) => String((row && (row.mailpit_https_url || row.mailpit_url)) || '');

/**
 * Where a project's mailbox is, given the status map the dashboard already keeps.
 *
 * Takes a GETTER rather than the map, because the map is replaced on every refresh — holding the
 * object would pin whichever one happened to be current when this was wired up. And it is ASYNCHRONOUS,
 * because straight after a restart that map is empty for a second or two: a synchronous read answers
 * "this project has no Mailpit — is it running?" about a project that is running perfectly well.
 * Awaiting the dashboard's own getter refreshes a cold cache first.
 *
 * A stopped project answers '': DDEV reports a URL for one (51 of them here), but Mailpit only runs
 * while the containers do, and a link that cannot answer is worse than none.
 */
function mailpitFor(statusMap) {
  return async (workspace, project) => {
    try {
      const dir = workspaceDir(workspace);
      if (!dir) return '';
      const st = (await statusMap()) || {};
      const projectPath = path.join(dir, project);
      const byPath = st[`@${projectPath}`];
      const byName = st[ddevProjectName(projectPath)];
      // The same rule the row's status uses: an entry whose approot is some other directory is a
      // stale registration, not this project.
      const entry = byPath || (byName && (!byName.approot || byName.approot === projectPath) ? byName : null);
      return entry && entry.status === 'running' ? (entry.mailpit || '') : '';
    } catch (_) {
      return '';
    }
  };
}

/**
 * The DDEV-menu entry, or '' when there is no mailbox to open.
 *
 * DDEV captures every mail a project sends rather than delivering it, and Mailpit holds them on the
 * project's own hostname — so a site that "sends no email" locally has almost always sent them all,
 * into here. The URL costs nothing to know, because the 20-second status refresh already carries it.
 */
function menuItemHtml({ workspace, project, running, mailpit }) {
  if (!running || !mailpit) return '';
  return `<li><a href hx-get="/fragments/projects/mail/${encodeURIComponent(workspace)}/${encodeURIComponent(project)}"
      hx-target="#editor-modal-body" hx-swap="innerHTML"
      hx-on::after:request="UIkit.modal('#editor-modal').show()"
      title="Every mail this project sends is captured rather than delivered — read, search and clear it"><span uk-icon="icon: mail; ratio: .7"></span> Mail it captured (Mailpit)…</a></li>`;
}

/**
 * The fragment route. Returns true when it answered, false when the path was not ours — so the
 * server's chain asks one question rather than carrying the whole branch.
 */
async function handleFragment({ pathname, req, res, isValidWorkspace, mailpit }) {
  const m = FRAGMENT_RE.exec(pathname);
  if (!m || !isValidWorkspace(m[1]) || !NAME_RE.test(m[2])) return false;
  const q = new URL(req.url, 'http://localhost').searchParams.get('q') || '';
  const html = await mailPanelHtml({ workspace: m[1], project: m[2], base: await mailpit(m[1], m[2]), q });
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
  return true;
}

const SHOW = 25;

async function mailPanelHtml({ workspace, project, base, q = '' }) {
  const panelUrl = `/fragments/projects/mail/${encodeURIComponent(workspace)}/${encodeURIComponent(project)}`;
  const vals = (extra) => esc(JSON.stringify({ workspace, projectName: project, ...extra }));
  const info = await mail.mailInfo(base);

  // Mailpit not answering is not an empty mailbox, and saying so is the whole reason this panel is
  // worth more than a link: "no mail" would send somebody looking for a bug in their site.
  if (!info.ok) {
    return `
    <div class="editor-card">
      <h3 class="uk-margin-small-bottom">Mail from ${esc(project)}</h3>
      <div class="msg error">Mailpit is not answering: ${esc(info.error)}.
        <p class="uk-text-meta">It runs with the project, so start the project and try again. This is not the same as
          an empty mailbox — nothing here says whether the site sent anything.</p></div>
    </div>`;
  }

  const listed = await mail.mailList(base, { limit: SHOW, query: q });
  const messages = listed.ok ? listed.messages : [];
  const rows = messages.map((m) => `
    <li class="${m.read ? '' : 'mail-unread'}">
      <div class="mail-line">
        <a class="mail-subject" href="${esc(mail.messageUrl(base, m.id))}" target="_blank" rel="noopener"
           title="Open this message in Mailpit">${m.read ? '' : '<span class="mail-dot" aria-label="unread">●</span> '}${esc(m.subject)}</a>
        <span class="uk-text-meta mail-meta">${esc(m.created ? humanTime(m.created) : '')} · ${esc(humanSize(m.size))}${
  m.attachments ? ` · ${m.attachments} attachment${m.attachments === 1 ? '' : 's'}` : ''}</span>
        <span class="mail-actions">
          <button class="uk-button uk-button-link mail-drop arm-step" title="Delete this message"
            hx-post="/actions/ddev-mail-delete" hx-vals='${vals({ id: m.id, confirm: 'yes' })}'
            hx-target="#editor-modal-body" hx-swap="innerHTML" hx-trigger="confirmed-remove">✕</button>
        </span>
      </div>
      <p class="uk-text-meta mail-who">${esc(m.fromName ? `${m.fromName} <${m.from}>` : m.from)} → ${esc(m.to.join(', ') || '(nobody)')}</p>
    </li>`).join('');

  return `
    <div class="editor-card">
      <h3 class="uk-margin-small-bottom">Mail from ${esc(project)}
        <span class="uk-badge">${info.total}</span>${info.unread ? ` <span class="uk-label uk-label-warning">${info.unread} unread</span>` : ''}</h3>
      <p class="uk-text-meta">DDEV captures every mail this project sends instead of delivering it, so this is
        where a password reset, a webform notification or a cron warning actually went. Nothing here has left
        the machine.</p>

      <div class="mail-tools">
        <form class="mail-search" hx-get="${esc(panelUrl)}" hx-target="#editor-modal-body" hx-swap="innerHTML"
              hx-trigger="submit, keyup[key=='Enter'] from:find input">
          <input class="uk-input uk-form-small" type="search" name="q" value="${esc(q)}"
                 placeholder="Search subject, address, body…" aria-label="Search this mailbox">
          <button class="uk-button uk-button-default uk-button-small" type="submit">Search</button>
          ${q ? `<a class="uk-button uk-button-link uk-button-small" href hx-get="${esc(panelUrl)}" hx-target="#editor-modal-body" hx-swap="innerHTML">clear</a>` : ''}
        </form>
        <span class="mail-bulk">
          ${info.unread ? `<button class="uk-button uk-button-default uk-button-small" hx-post="/actions/ddev-mail-read"
            hx-vals='${vals({})}' hx-target="#editor-modal-body" hx-swap="innerHTML">Mark all read</button>` : ''}
          ${info.total ? `<button class="uk-button uk-button-danger uk-button-small arm-step"
            hx-post="/actions/ddev-mail-clear" hx-vals='${vals({ confirm: 'yes' })}'
            hx-target="#editor-modal-body" hx-swap="innerHTML" hx-trigger="confirmed-remove"
            title="Delete every message in this mailbox">Empty the mailbox</button>` : ''}
          <a class="uk-button uk-button-default uk-button-small" href="${esc(base)}" target="_blank" rel="noopener"
             title="Mailpit's own interface, which renders a message properly">Open Mailpit</a>
        </span>
      </div>

      ${messages.length
    ? `<ul class="uk-list uk-list-divider mail-list">${rows}</ul>${
      listed.total > messages.length ? `<p class="uk-text-meta">Showing the newest ${messages.length} of ${listed.total} — the rest are in Mailpit.</p>` : ''}`
    : q
      ? `<p class="uk-text-meta">Nothing in this mailbox matches “${esc(q)}”.</p>`
      : '<p class="uk-text-meta">The mailbox is empty. This project has sent nothing since it was last cleared — which, for a site under test, is worth knowing before you go looking for the mail somewhere else.</p>'}
    </div>`;
}

module.exports = { mailPanelHtml, menuItemHtml, handleFragment, mailpitFor, urlFromListing, FRAGMENT_RE, SHOW };
