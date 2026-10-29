/**
 * The assistant's thread: what keeps one conversation across pages.
 *
 * The two things that can quietly break it are both checked here. The id must travel in a cookie
 * scoped to the HUB domain — localStorage, or a cookie on the page's own host, would make /dev and
 * /test two different conversations, which is the bug this exists to fix. And the thread must carry
 * claude's session id, because a transcript redrawn in front of an agent that remembers none of it
 * reads as memory and is not.
 */

const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('fs');
const path = require('path');

const app = path.join(__dirname, '..', '..');
const chats = require(path.join(app, 'chat-threads'));
const { hubDomain } = require(path.join(app, 'workspaces'));

const withCookie = (id) => ({ headers: { cookie: `ws-per=50; ws-chat=${id}; ws-theme=dark` } });

test('the id comes from the cookie, and only in our own shape', () => {
  const id = chats.newId();
  assert.match(id, /^[a-f0-9]{32}$/);
  assert.strictEqual(chats.threadIdFrom(withCookie(id)), id);
  assert.strictEqual(chats.threadIdFrom({ headers: {} }), null);
  // The id names a file, so anything that is not the shape we write is not read back.
  for (const bad of ['../../etc/passwd', 'a'.repeat(31), 'A'.repeat(32), '']) {
    assert.strictEqual(chats.threadIdFrom(withCookie(bad)), null, `${bad} was accepted`);
  }
});

test('the cookie is scoped to the hub domain, so every workspace subdomain is one conversation', () => {
  const c = chats.threadCookie(chats.newId());
  assert.match(c, new RegExp(`Domain=\\.${hubDomain().replace(/\./g, '\\.')}`), 'not scoped to the hub');
  assert.match(c, /Path=\//);
  assert.match(c, /SameSite=Lax/);
  // No Max-Age on purpose: the conversation belongs to this browsing session.
  assert.ok(!/Max-Age/.test(c), 'the chat cookie must not outlive the browser');
});

test('a thread keeps the turns and the claude session, and reads back the same', () => {
  let t = chats.loadThread(withCookie(chats.newId()));
  assert.deepEqual(t.turns, []);
  assert.strictEqual(t.sessionId, null);
  t = chats.appendTurn(t, { role: 'user', text: 'what is running?' });
  t = chats.appendTurn({ ...t, sessionId: 'abc-123' }, { role: 'ai', html: '<p>Two projects.</p>' });
  try {
    const back = chats.readThread(t.id);
    assert.strictEqual(back.sessionId, 'abc-123', 'the session to resume must survive');
    assert.deepEqual(chats.historyFor(back), [
      { role: 'user', text: 'what is running?' },
      { role: 'ai', html: '<p>Two projects.</p>' },
    ], 'the history must be deep-chat’s own shape');
    // Written 0600: it is a chat log, and it says so on disk.
    assert.strictEqual(fs.statSync(path.join(chats.DIR, `${t.id}.json`)).mode & 0o777, 0o600);
  } finally {
    chats.clearThread(t.id);
  }
  assert.strictEqual(chats.readThread(t.id), null, 'clearing must remove the file');
});

test('a long conversation is trimmed from the front, not refused', () => {
  let t = chats.loadThread({ headers: {} });
  for (let i = 0; i < chats.MAX_TURNS + 10; i += 1) t = chats.appendTurn(t, { role: 'user', text: `turn ${i}` });
  try {
    assert.strictEqual(t.turns.length, chats.MAX_TURNS);
    assert.strictEqual(t.turns[t.turns.length - 1].text, `turn ${chats.MAX_TURNS + 9}`, 'the newest turn must be kept');
  } finally {
    chats.clearThread(t.id);
  }
});

test('the assistant resumes its session instead of starting over', () => {
  const src = fs.readFileSync(path.join(app, 'assistant.js'), 'utf8');
  assert.ok(!/'--no-session-persistence'/.test(src),
    'that flag is what threw the conversation away; it must not come back');
  assert.match(src, /'--session-id'/, 'the first turn names the session');
  assert.match(src, /'--resume'/, 'every later turn resumes it');
  assert.match(src, /if \(parsed\.session_id\) newSessionId/, 'what to resume next is read back from the run');
  assert.match(src, /if \(sessionId && result\.code !== 0\)/,
    'a session that is gone must still answer the question, on a fresh one');
});

test('the chat store is never committed and never synced', () => {
  const ignore = fs.readFileSync(path.join(app, '..', '..', '.gitignore'), 'utf8');
  assert.match(ignore, /core\/workspace-app\/\.chats\//, 'the chat log must be gitignored');
  for (const f of ['scripts/update.sh', path.join('..', 'scripts', 'sync-tooling.sh')]) {
    const sh = fs.readFileSync(path.join(app, f), 'utf8');
    assert.match(sh, /--exclude=\.chats/, `${f} would overwrite the conversations`);
  }
});
