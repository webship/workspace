const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');

test('exit types /exit and then Enter, only into a live Claude Code session, and only with confirm', () => {
  const src = read('actions', 'claude-session.js');
  assert.match(src, /if \(form\.confirm !== 'yes'\)/);
  assert.match(src, /if \(!\(await isClaudeSession\(session\)\)\)/);
  assert.match(src, /\['-S', session, '-X', 'stuff', '\\x1b'\]/);
  assert.match(src, /\['-S', session, '-X', 'stuff', '\/exit'\]/);
  assert.match(src, /\['-S', session, '-X', 'stuff', '\\r'\]/);
});

test('resume starts claude --resume with the newest conversation in that folder, never an id from the request', () => {
  const src = read('actions', 'claude-session.js');
  assert.match(src, /claudeSessions\.sessionsFor\(dir, \{ limit: 1, resumableOnly: true \}\)/);
  assert.match(src, /cmd: `exec claude --resume \$\{last\.id\}`/);
  assert.match(src, /claudeSessions\.isSessionId\(last\.id\)/);
  assert.doesNotMatch(src, /form\.(id|resume)/);
});

test('the SCREENS menu offers Exit for each live Claude session, and Resume when none runs', () => {
  const { menuItems } = require('../../actions/claude-session');
  const agents = new Set(['dev--p1--claude']);
  const html = menuItems({ ws: 'dev', project: 'p1', sessions: [{ session: 'dev--p1--claude', state: 'Detached' }, { session: 'dev--p1--shell', state: 'Detached' }], agents, dir: '' });
  assert.match(html, /class="arm-step" title="Exit Claude Code in dev--p1--claude \(\/exit\)"/);
  assert.equal((html.match(/claude-exit/g) || []).length, 1);
  assert.doesNotMatch(html, /claude-resume/);
  assert.equal(menuItems({ ws: 'dev', project: 'p1', sessions: [], agents: new Set(), dir: '' }), '');
});

test('the Screens page, the card menu and the actions are wired in', () => {
  assert.match(read('server.js'), /\.\.\.require\('\.\/actions\/claude-session'\)/);
  assert.match(read('server.js'), /require\('\.\/actions\/claude-session'\)\.menuItems\(/);
  assert.match(read('screens.js'), /claudeHere\.has\(s\.session\) && !dead \?/);
  assert.match(read('actions', 'screens.js'), /\n  onHostScreen,\n/);
});
