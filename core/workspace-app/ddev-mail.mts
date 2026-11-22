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

export const MAIL_TIMEOUT_MS = 8000;

/** A call that could not be made, or was answered with something this cannot read. */
export interface MailFailure { ok: false; error: string }

/** What Mailpit's API answered: parsed JSON, plain text, or nothing. */
export type ApiResult = { ok: true; data: unknown } | MailFailure;

/** The fields of Mailpit's /info that are read. */
interface MailpitInfo { Messages?: number; Unread?: number; Version?: string }

/** One message of Mailpit's /messages or /search, the fields a list needs. */
interface MailpitMessage {
  ID?: string; Subject?: string; From?: { Address?: string; Name?: string } | null; To?: { Address?: string }[] | null;
  Created?: string; Size?: number; Read?: boolean; Attachments?: number;
}

/** One message as the panel lists it. */
export interface MailMessage {
  id: string; subject: string; from: string; fromName: string; to: string[];
  created: Date | null; size: number; read: boolean; attachments: number;
}

/** What is read of an answer: an object, or an empty one when the answer was not one. */
const fields = <T,>(data: unknown): Partial<T> => (data && typeof data === 'object' ? data as Partial<T> : {});

/** One call to a project's Mailpit, or a reason it could not be made. */
async function api(base: string | null | undefined, path: string,
  { method = 'GET', body }: { method?: string; body?: unknown } = {}): Promise<ApiResult> {
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
    const e = err instanceof Error ? err : null;
    return { ok: false, error: e && e.name === 'AbortError' ? 'Mailpit did not answer in time' : String((e && e.message) || err) };
  } finally {
    clearTimeout(timer);
  }
}

/** How much is in there: total and unread. */
export async function mailInfo(base: string | null | undefined): Promise<MailFailure | { ok: true; total: number; unread: number; version: string }> {
  const r = await api(base, '/info');
  if (!r.ok) return r;
  const info = fields<MailpitInfo>(r.data);
  return { ok: true, total: Number(info.Messages || 0), unread: Number(info.Unread || 0), version: info.Version || '' };
}

/**
 * The messages themselves, newest first — a search when one was typed, the plain list otherwise.
 *
 * Only the fields a list needs are kept. A message's body is one click away in Mailpit, which renders
 * HTML mail, attachments and the raw source far better than this panel ever would.
 */
export async function mailList(base: string | null | undefined, { limit = 25, query = '' }: { limit?: number; query?: unknown } = {}):
  Promise<MailFailure | { ok: true; messages: MailMessage[]; total: number }> {
  const q = String(query || '').trim();
  const r = q
    ? await api(base, `/search?query=${encodeURIComponent(q)}&limit=${limit}`)
    : await api(base, `/messages?limit=${limit}`);
  if (!r.ok) return r;
  const list = fields<{ messages: MailpitMessage[]; messages_count: number; total: number }>(r.data);
  const messages = (list.messages || []).map((m): MailMessage => ({
    id: String(m.ID || ''),
    subject: String(m.Subject || '(no subject)'),
    from: (m.From && m.From.Address) || '',
    fromName: (m.From && m.From.Name) || '',
    to: (m.To || []).map((t) => t.Address).filter((a): a is string => !!a),
    created: m.Created ? new Date(m.Created) : null,
    size: Number(m.Size || 0),
    read: !!m.Read,
    attachments: Number(m.Attachments || 0),
  }));
  return { ok: true, messages, total: Number(list.messages_count ?? list.total ?? messages.length) };
}

/** Everything in the mailbox, gone. The confirm belongs to the caller; this is the call. */
export const deleteAllMail = (base: string | null | undefined): Promise<ApiResult> => api(base, '/messages', { method: 'DELETE' });

/** One message, gone — the id comes from a listing, never from a path. */
export const deleteOneMail = (base: string | null | undefined, id: unknown): Promise<ApiResult> => api(base, '/messages', { method: 'DELETE', body: { IDs: [String(id)] } });

/** Everything marked read, which is how you tell the next one apart from all of these. */
export const markAllRead = (base: string | null | undefined): Promise<ApiResult> => api(base, '/messages', { method: 'PUT', body: { Read: true } });

/** Where Mailpit shows one message, for the link out. */
export const messageUrl = (base: unknown, id: string): string => `${String(base).replace(/\/$/, '')}/view/${encodeURIComponent(id)}`;

// A Mailpit message id, as its API hands them out: a short URL-safe token. Checked before it is put
// in a URL or a delete, because it arrives from a browser.
export const MAIL_ID_RE = /^[A-Za-z0-9_-]{6,64}$/;
