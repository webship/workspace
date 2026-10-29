/**
 * The three things done to a project's captured mail: mark it read, delete one, empty the mailbox.
 *
 * Each answers with the PANEL rather than a toast, because every one of them changes what the panel
 * says — a delete that leaves the list showing the message it deleted is a control you have to
 * refresh to believe.
 *
 * The Mailpit URL is never taken from the request: it is read from the same DDEV listing the row's
 * status comes from, so a request can only ever reach the mailbox of the project it named.
 */

const path = require('path');

const { esc } = require('../html');
const { workspaceDir } = require('../workspaces');
const { ddevProjectName } = require('../jobs');
const { NAME_RE } = require('../validate');
const mail = require('../ddev-mail');
const { mailPanelHtml } = require('../ddev-mail-page');

/**
 * The project a request names, and where its Mailpit is.
 *
 * `mailpitFor` is injected by server.js when it merges this map, because the status listing lives
 * there — this module must not grow its own copy of it, and must not take a URL from a form.
 */
async function context(deps, form, workspace) {
  const projectName = String(form.projectName || '');
  if (!NAME_RE.test(projectName)) return { error: 'Invalid project name.' };
  const projectDir = path.join(workspaceDir(workspace), projectName);
  if (!ddevProjectName(projectDir)) return { error: 'Not a DDEV project.' };
  const base = await deps.mailpitFor(workspace, projectName);
  if (!base) return { error: 'This project has no Mailpit — it is probably not running.' };
  return { projectName, base };
}

function make(deps) {
  const panel = (workspace, projectName, base, q = '') =>
    mailPanelHtml({ workspace, project: projectName, base, q });

  async function mail_read({ form, send, workspace }) {
    const c = await context(deps, form, workspace);
    if (c.error) return send(`<div class="msg error">${esc(c.error)}</div>`, 400);
    const r = await mail.markAllRead(c.base);
    if (!r.ok) return send(`<div class="msg error">Mailpit did not answer: ${esc(r.error)}</div>`, 502);
    return send(await panel(workspace, c.projectName, c.base));
  }

  async function mail_delete({ form, send, workspace }) {
    const c = await context(deps, form, workspace);
    if (c.error) return send(`<div class="msg error">${esc(c.error)}</div>`, 400);
    if (form.confirm !== 'yes') return send('<div class="msg error">Deleting a message needs confirmation.</div>', 400);
    const id = String(form.id || '');
    // The id comes from a listing this panel drew, and it goes into a request body — checked against
    // the shape Mailpit issues rather than passed along.
    if (!mail.MAIL_ID_RE.test(id)) return send('<div class="msg error">That is not a message id.</div>', 400);
    const r = await mail.deleteOneMail(c.base, id);
    if (!r.ok) return send(`<div class="msg error">Mailpit did not answer: ${esc(r.error)}</div>`, 502);
    return send(await panel(workspace, c.projectName, c.base));
  }

  async function mail_clear({ form, send, workspace }) {
    const c = await context(deps, form, workspace);
    if (c.error) return send(`<div class="msg error">${esc(c.error)}</div>`, 400);
    // Emptying a mailbox is not undoable, and a mailbox under test is often the evidence somebody is
    // in the middle of reading.
    if (form.confirm !== 'yes') return send('<div class="msg error">Emptying the mailbox needs confirmation.</div>', 400);
    const r = await mail.deleteAllMail(c.base);
    if (!r.ok) return send(`<div class="msg error">Mailpit did not answer: ${esc(r.error)}</div>`, 502);
    return send(await panel(workspace, c.projectName, c.base));
  }

  return {
    '/actions/ddev-mail-read': mail_read,
    '/actions/ddev-mail-delete': mail_delete,
    '/actions/ddev-mail-clear': mail_clear,
  };
}

module.exports = { make, context };
