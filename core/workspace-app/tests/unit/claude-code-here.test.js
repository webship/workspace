const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const server = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');

test('the SCREENS menu offers Claude Code in the same folder, beside New screen here', () => {
  assert.match(server, /screen-new-form\?workspace=\$\{encodeURIComponent\(sm\[1\]\)\}&amp;project=\$\{encodeURIComponent\(sm\[2\]\)\}&amp;kind=claude/);
  assert.match(server, /Claude Code here…/);
});

test('the New screen form opens on Claude Code when asked, keeping the place it was opened for', () => {
  assert.match(server, /if \(q\.get\('kind'\) === 'claude'\) pre = \{ \.\.\.\(pre \|\| \{\}\), kind: 'claude' \};/);
});
