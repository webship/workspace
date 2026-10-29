/**
 * The dashboard's own log, and the workspace a request belongs to.
 *
 * A refused New screen form left nothing behind, and the form defaulted to the workspace root, which the
 * dispatcher then rejected as an unknown workspace, while the page it came from was the Dev workspace.
 */

const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', '..', f), 'utf8');
const server = read('server.js');

function freshLog() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-log-'));
  process.env.WORKSPACE_APP_LOG = path.join(dir, 'logs', 'dashboard.log');
  delete require.cache[require.resolve('../../event-log')];
  return { log: require('../../event-log'), file: process.env.WORKSPACE_APP_LOG };
}

test('an event is one JSON line with a time, a level and the event', () => {
  const { log, file } = freshLog();
  log.logEvent('warn', 'action.rejected', { action: '/actions/screen-new', status: 400 });
  const row = JSON.parse(fs.readFileSync(file, 'utf8').trim());
  assert.equal(row.level, 'warn');
  assert.equal(row.event, 'action.rejected');
  assert.equal(row.status, 400);
  assert.match(row.time, /^\d{4}-\d\d-\d\dT/);
  assert.equal((fs.statSync(file).mode & 0o777), 0o600, 'readable by this user only');
});

test('a prompt is clipped, and secrets in it never reach the file', () => {
  const { log } = freshLog();
  const text = log.clip('use sk-abcdefghijklmnop1234 and password: hunter2 and Bearer abcdefgh12345678 then ghp_abcdefghijklmnop1234');
  assert.ok(!/sk-abcdef|hunter2|abcdefgh12345678|ghp_abcdef/.test(text), text);
  assert.match(text, /\[redacted\]/);
  assert.ok(log.clip('x'.repeat(900), 500).length <= 501, 'clipped to the limit');
});

test('html in a message becomes text', () => {
  const { log } = freshLog();
  assert.equal(log.plain('<div class="msg error">Unknown workspace.</div>'), 'Unknown workspace.');
});

test('the file rotates past its size and keeps a few', () => {
  const { log, file } = freshLog();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'x'.repeat(log.MAX_BYTES + 10));
  log.logEvent('info', 'after.rotation');
  assert.ok(fs.existsSync(`${file}.1`), 'the old one is kept');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8').trim()).event, 'after.rotation');
});

test('a log that cannot be written never throws', () => {
  const blocker = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ws-log-')), 'file');
  fs.writeFileSync(blocker, 'x');
  process.env.WORKSPACE_APP_LOG = path.join(blocker, 'logs', 'dashboard.log');
  delete require.cache[require.resolve('../../event-log')];
  assert.doesNotThrow(() => require('../../event-log').logEvent('error', 'x'));
});

test('a form that names no workspace takes the one its host names', () => {
  assert.match(server, /const workspace = form\.workspace \|\| hostWorkspaceOf\(req\) \|\| 'dev';/);
  assert.match(server, /String\(q\.get\('workspace'\) \|\| hostWorkspaceOf\(req\)\)/,
    'and the New screen form opens on it');
});

test('New screen in the workspace root is a place, not an unknown workspace', () => {
  assert.match(server, /const isRootScreen = pathname === '\/actions\/screen-new' && workspace === 'root';/);
  assert.match(server, /!isRootScreen && !isValidWorkspace\(workspace\)/);
});

test('every refusal, failure and crash is logged', () => {
  assert.match(server, /if \(status >= 400\) logRejected\(pathname, form, workspace, status, html\);/);
  assert.match(server, /eventLog\.logEvent\('error', 'action\.failed'/);
  assert.match(server, /process\.on\('uncaughtExceptionMonitor'/);
  assert.match(server, /eventLog\.logEvent\('info', 'app\.started'/);
});

test('a rejected screen keeps its prompt', () => {
  assert.match(server, /prompt: eventLog\.clip\(form\.command, 500\)/);
});

test('on a workspace address the workspace is not asked', () => {
  const screens = read('screens.js');
  assert.match(screens, /const locked = !!p\.hostWorkspace && p\.hostWorkspace === ws;/);
  assert.match(screens, /locked \? `<input type="hidden" name="workspace" value="\$\{esc\(ws\)\}">`/,
    'a hidden field carries it, so the folder list and the action still know it');
  assert.match(server, /newScreenFormHtml\(pre && \{ \.\.\.pre, hostWorkspace: hostWorkspaceOf\(req\) \}\)/);
});

test('a new screen starts knowing its workspace, project and folder', () => {
  const act = read('actions/screens.js');
  assert.match(act, /WEBSHIP_WORKSPACE: pm \? pm\[1\] : wm \? wm\[1\] : ''/);
  assert.match(act, /WEBSHIP_PROJECT: pm \? pm\[2\] : ''/);
  assert.match(act, /WEBSHIP_WORKSPACE_DIR: dir/);
  assert.match(act, /inner = \/\^exec \/\.test\(inner\) \? `exec env \$\{vars\} \$\{inner\.slice\(5\)\}`/,
    'inside the exec: a command that stops starting with exec is piped through tee, and claude then prints and quits');
});
