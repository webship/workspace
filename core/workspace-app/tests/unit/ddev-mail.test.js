/**
 * Managing a project's captured mail, not just linking to it.
 *
 * DDEV captures outgoing email instead of delivering it, so Mailpit is where every password reset,
 * webform notification and cron warning actually went. A link got you there; the things you do
 * repeatedly — is the mail I just triggered there, who was it addressed to, clear this out before the
 * next run — belong on the row.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const mail = require('../../ddev-mail');

const APP = path.join(__dirname, '../..');
const server = fs.readFileSync(path.join(APP, 'server.js'), 'utf8');
const page = fs.readFileSync(path.join(APP, 'ddev-mail-page.js'), 'utf8');
const actions = fs.readFileSync(path.join(APP, 'actions/ddev-mail.js'), 'utf8');
const mod = fs.readFileSync(path.join(APP, 'ddev-mail.js'), 'utf8');

test('a write answers `ok` in plain text, and that is a success', () => {
  // Found by deleting a real message: Mailpit answers reads with JSON and writes with the word `ok`,
  // so parsing everything as JSON reported "Unexpected token 'o'" for a delete that had WORKED — the
  // message gone and an error on the screen, which is the worst of both.
  assert.match(mod, /if \(!\/\^\[\[\{\]\/\.test\(text\)\) return \{ ok: true, data: text \};/);
  assert.match(mod, /Mailpit sent something this could not read/, 'and malformed JSON is still a failure');
});

test('an unreachable Mailpit is not an empty mailbox', () => {
  // The distinction the whole panel rests on: "no mail" would send somebody looking for a bug in
  // their site, when the truth is the project is stopped. Verified live against a hostname that does
  // not resolve.
  assert.match(mod, /AbortError' \? 'Mailpit did not answer in time'/);
  assert.match(page, /Mailpit is not answering/);
  assert.match(page, /This is not the same as\s*\n?\s*an empty mailbox/);
});

test('every call is bounded', () => {
  // A stopped project must not hang the panel: the fetch carries an abort signal, not a hope.
  assert.match(mod, /const MAIL_TIMEOUT_MS = \d+;/);
  assert.match(mod, /new AbortController\(\)/);
  assert.match(mod, /signal: controller\.signal/);
  assert.match(mod, /clearTimeout\(timer\)/);
});

test('a message id is checked before it is used', () => {
  for (const good of ['6KkYd2wXXZBR9COLnVTj29', '3s1V4blfdr7oNTtblQ27qO']) {
    assert.ok(mail.MAIL_ID_RE.test(good), good);
  }
  for (const bad of ['../../etc', 'a b', '', 'short', '<script>', 'x'.repeat(65)]) {
    assert.equal(mail.MAIL_ID_RE.test(bad), false, bad);
  }
  assert.match(actions, /if \(!mail\.MAIL_ID_RE\.test\(id\)\)/);
});

test('the URL rides along with the status refresh, https first', () => {
  // No extra call per row: the listing that answers "is it running" answers this too, and https is
  // the same service on the other port with the certificate DDEV issued. (This and the two tests
  // below were tests/unit/ddev-mailpit.test.js, which described the wiring before it moved into the
  // module — the assertions kept, the file folded in.)
  assert.match(page, /urlFromListing = \(row\) => String\(\(row && \(row\.mailpit_https_url \|\| row\.mailpit_url\)\) \|\| ''\)/);
  assert.match(server, /mailpit: ddevMail\.urlFromListing\(p\)/);
});

test('it is only offered while the project is up', () => {
  // DDEV reports a Mailpit URL for stopped projects too — 51 of them here — but the service only
  // answers while the containers are running, so an entry on a stopped row leads nowhere.
  assert.match(page, /if \(!running \|\| !mailpit\) return '';/);
  assert.match(page, /entry && entry\.status === 'running'/);
});

test('the label says captured, not sent', () => {
  // The distinction is the whole point: nothing left the machine, and that is why the mail is
  // findable at all.
  assert.match(page, /Every mail this project sends is captured rather than delivered/);
  assert.match(page, /Mail it captured \(Mailpit\)…/);
});

test('the mailbox is found from the status listing, never from the request', () => {
  // A URL in a form would let a request point this at anything; the row's own listing is the only
  // source, and only while the project is running.
  assert.match(page, /entry\.status === 'running' \? \(entry\.mailpit \|\| ''\) : ''/);
  assert.match(actions, /const base = await deps\.mailpitFor\(workspace, projectName\);/);
  assert.ok(!/form\.base|form\.mailpit|form\.url/.test(actions), 'no URL is ever read from the form');
});

test('the lookup awaits the status map rather than reading whatever is in memory', () => {
  // Straight after a restart the cache is empty for a second or two, and a synchronous read answered
  // "this project has no Mailpit — is it running?" about a project that was running perfectly well.
  // Reproduced, then fixed by awaiting the dashboard's own getter, which refreshes a cold cache.
  assert.match(page, /return async \(workspace, project\) => \{/);
  assert.match(page, /const st = \(await statusMap\(\)\) \|\| \{\};/);
  assert.match(server, /mailpitFor\(ddevStatusMap\)/, 'and the getter it is given is the refreshing one');
});

test('the feature owns its wiring: server.js holds four lines and no markup', () => {
  // One module per area, and "area" includes the route and the menu entry — not just the rendering.
  // Otherwise every new column or verb is another edit to a 7,000-line file.
  const mailLines = server.split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .filter((l) => /ddevMail|mailpit/i.test(l));
  assert.ok(mailLines.length <= 8, `server.js wires mail on ${mailLines.length} lines:\n${mailLines.join('\n')}`);
  assert.ok(!mailLines.some((l) => /<li>|<a |hx-get="\/fragments\/projects\/mail/.test(l)),
    'no mail markup in server.js');
  // Each of the four is a call into the module.
  assert.match(server, /const ddevMail = require\('\.\/ddev-mail-page'\);/);
  assert.match(server, /mailpit: ddevMail\.urlFromListing\(p\)/);
  assert.match(server, /\$\{ddevMail\.menuItemHtml\(\{ workspace: key, project: p, running, mailpit \}\)\}/);
  assert.match(server, /if \(await ddevMail\.handleFragment\(\{/);
  // And the module answers "not mine" rather than the server matching the path for it.
  assert.match(page, /if \(!m \|\| !isValidWorkspace\(m\[1\]\) \|\| !NAME_RE\.test\(m\[2\]\)\) return false;/);
});

test('deleting and emptying are confirmed, and each answers with the panel', () => {
  // A delete that leaves the list showing what it deleted is a control you have to refresh to
  // believe — so every verb answers with the panel rather than a toast.
  assert.match(actions, /if \(form\.confirm !== 'yes'\) return send\('<div class="msg error">Deleting a message needs confirmation/);
  assert.match(actions, /Emptying the mailbox needs confirmation/);
  assert.match(actions, /return send\(await panel\(workspace, c\.projectName, c\.base\)\);/);
  assert.match(page, /hx-trigger="confirmed-remove"/);
  assert.match(page, /hx-target="#editor-modal-body"/);
});

test('the panel says what a message is, and leaves reading it to Mailpit', () => {
  // Subject, who it was really for, when and how big — then out to Mailpit, which renders HTML mail
  // and attachments far better than this panel would.
  assert.match(page, /mail-subject/);
  assert.match(page, /mail\.messageUrl\(base, m\.id\)/);
  assert.match(page, /Open Mailpit/);
  assert.match(page, /Nothing here has left\s*\n?\s*the machine/);
  // An empty mailbox is stated as a fact worth having, not as a shrug.
  assert.match(page, /The mailbox is empty/);
});
