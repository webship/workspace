/**
 * A project's captured mail, over Mailpit's own API.
 *
 * DDEV does not deliver a project's outgoing email — it captures it. Which means Mailpit is not a
 * curiosity: it is where every password reset, webform notification and cron warning a site "sent"
 * actually went, and until something reads it, nobody can tell a mail that was never sent from one
 * that was sent and never looked at.
 *
 * The link to Mailpit's own UI stays (it renders a message better than anything here would), but the
 * things you do REPEATEDLY belong on the row: how many are waiting, what the last ones were, is the
 * one I just triggered there, and clear them out before a test run.
 *
 * Three things shape this module:
 *
 *   - **The API is reachable from here.** This container resolves the project hostnames and the
 *     router terminates their TLS, so `https://<project>.ddev.site:8026/api/v1/…` answers directly —
 *     no `ddev exec`, no shelling out per request.
 *   - **Mailpit is only up while the project is.** Every call is given a short timeout and a failure
 *     is reported as "not answering" rather than as an empty mailbox: an empty inbox and an inbox
 *     that could not be read are different facts, and only one of them means the mail was not sent.
 *   - **Nothing is cached.** A mailbox is what you are looking at right now — you trigger a reset
 *     mail and refresh — so a cache here would only ever be a way of showing yesterday's answer.
 */

const MAIL_TIMEOUT_MS = 8000;

/** One call to a project's Mailpit, or a reason it could not be made. */
async function api(base, path, { method = 'GET', body } = {}) {
  if (!base) return { ok: false, error: 'This project has no Mailpit URL — is it running?' };
  const url = `${base.replace(/\/$/, '')}/api/v1${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MAIL_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method,
      signal: controller.signal,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) return { ok: false, error: `Mailpit answered ${res.status}` };
    const text = (await res.text()).trim();
    if (!text) return { ok: true, data: null };
    if (!/^[[{]/.test(text)) return { ok: true, data: text };
    try {
      return { ok: true, data: JSON.parse(text) };
    } catch (_) {
      return { ok: false, error: 'Mailpit sent something this could not read' };
    }
  } catch (err) {
    // A project that is stopped, a Mailpit that is still starting, a certificate nobody trusts: all
    // of them are "it did not answer", and none of them is "there is no mail".
    return { ok: false, error: err.name === 'AbortError' ? 'Mailpit did not answer in time' : String(err.message || err) };
  } finally {
    clearTimeout(timer);
  }
}

/** How much is in there: total and unread. */
async function mailInfo(base) {
  const r = await api(base, '/info');
  if (!r.ok) return r;
  return { ok: true, total: Number(r.data.Messages || 0), unread: Number(r.data.Unread || 0), version: r.data.Version || '' };
}

/**
 * The messages themselves, newest first — a search when one was typed, the plain list otherwise.
 *
 * Only the fields a list needs are kept. A message's body is one click away in Mailpit, which renders
 * HTML mail, attachments and the raw source far better than this panel ever would.
 */
async function mailList(base, { limit = 25, query = '' } = {}) {
  const q = String(query || '').trim();
  const r = q
    ? await api(base, `/search?query=${encodeURIComponent(q)}&limit=${limit}`)
    : await api(base, `/messages?limit=${limit}`);
  if (!r.ok) return r;
  const messages = (r.data.messages || []).map((m) => ({
    id: String(m.ID || ''),
    subject: String(m.Subject || '(no subject)'),
    from: (m.From && m.From.Address) || '',
    fromName: (m.From && m.From.Name) || '',
    to: (m.To || []).map((t) => t.Address).filter(Boolean),
    created: m.Created ? new Date(m.Created) : null,
    size: Number(m.Size || 0),
    read: !!m.Read,
    attachments: Number(m.Attachments || 0),
  }));
  return { ok: true, messages, total: Number(r.data.messages_count ?? r.data.total ?? messages.length) };
}

/** Everything in the mailbox, gone. The confirm belongs to the caller; this is the call. */
const deleteAllMail = (base) => api(base, '/messages', { method: 'DELETE' });

/** One message, gone — the id comes from a listing, never from a path. */
const deleteOneMail = (base, id) => api(base, '/messages', { method: 'DELETE', body: { IDs: [String(id)] } });

/** Everything marked read, which is how you tell the next one apart from all of these. */
const markAllRead = (base) => api(base, '/messages', { method: 'PUT', body: { Read: true } });

/** Where Mailpit shows one message, for the link out. */
const messageUrl = (base, id) => `${String(base).replace(/\/$/, '')}/view/${encodeURIComponent(id)}`;

// A Mailpit message id, as its API hands them out: a short URL-safe token. Checked before it is put
// in a URL or a delete, because it arrives from a browser.
const MAIL_ID_RE = /^[A-Za-z0-9_-]{6,64}$/;

module.exports = {
  MAIL_ID_RE, MAIL_TIMEOUT_MS,
  mailInfo, mailList, deleteAllMail, deleteOneMail, markAllRead, messageUrl,
};
