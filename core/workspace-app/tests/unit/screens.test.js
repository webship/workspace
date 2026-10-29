/**
 * The screens manager's own logic: which places a session may be started in,
 * how a target token resolves to a directory, and what the session-name rules
 * actually admit. These are the guards that keep a browser-supplied name out
 * of `screen`, so they are pinned here rather than left to the browser tests.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { screenTargets, screenTargetDir } = require('../../screens');
const { ROOT } = require('../../workspaces');

test('the workspace root is always a place to start a session', () => {
  const root = screenTargets().find((t) => t.value === 'root');
  assert.ok(root);
  assert.strictEqual(root.dir, ROOT);
});

test('every target resolves to a real directory inside the workspace', () => {
  for (const t of screenTargets().slice(0, 40)) {
    const dir = screenTargetDir(t.value);
    assert.ok(dir, `${t.value} resolves`);
    assert.ok(dir.startsWith(ROOT), `${dir} is inside the workspace`);
  }
});

test('a target token the server did not offer resolves to nothing', () => {
  for (const bad of ['', 'root/../..', 'p:dev:../../etc', '/etc', 'ws:no-such', 'p:no:no']) {
    assert.strictEqual(screenTargetDir(bad), null, `${bad} is refused`);
  }
});

test('workspace folders and projects are offered separately', () => {
  const targets = screenTargets();
  assert.ok(targets.some((t) => t.group === 'Workspace folders'));
  assert.ok(targets.some((t) => t.group === 'Projects'), 'at least one project is offered');
  const dev = targets.find((t) => t.value === 'ws:dev');
  assert.ok(dev && dev.dir === path.join(ROOT, 'dev'));
});

// The name rule is shared by the form, the actions and both /fragments routes:
// it must never admit a leading '-', which `screen` would read as an option.
const NAME_RE = /^[a-z0-9][a-zA-Z0-9_.-]*$/;

test('a session name may not start with a dash, and holds no shell characters', () => {
  for (const ok of ['build1', 'jira-varbase-2307', 'a.b_c-d', 'x']) assert.ok(NAME_RE.test(ok), ok);
  for (const bad of ['-d', '-S', '; rm -rf /', 'a b', '../x', 'a$b', 'A-first', '']) {
    assert.ok(!NAME_RE.test(bad), `${bad} is refused`);
  }
});

// The machine's sessions reach the dashboard through the folder both sides
// share: the runner republishes its list every two seconds, so a stale file
// means the runner is gone and nothing new may be started.
test('a published session list is trusted only while it is fresh', () => {
  const fs = require('fs');
  const path = require('path');
  const os = require('os');
  const { ROOT } = require('../../workspaces');
  const file = path.join(ROOT, '.screens', 'host-sessions.json');
  const had = fs.existsSync(file) ? fs.readFileSync(file) : null;
  const { hostSessionsFile } = require('../../jobs');
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ at: Date.now(), host: os.hostname(), sessions: [{ session: 'a--b--c' }] }));
    assert.equal(hostSessionsFile().sessions.length, 1, 'a list written now is the truth');
    fs.writeFileSync(file, JSON.stringify({ at: Date.now() - 60000, sessions: [{ session: 'a--b--c' }] }));
    assert.equal(hostSessionsFile(), null, 'a minute-old list means the runner stopped');
  } finally {
    if (had) fs.writeFileSync(file, had); else fs.rmSync(file, { force: true });
  }
});
