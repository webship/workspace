/**
 * The screens manager's own logic: which places a session may be started in,
 * how a target token resolves to a directory, and what the session-name rules
 * actually admit. These are the guards that keep a browser-supplied name out
 * of `screen`, so they are pinned here rather than left to the browser tests.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { copyConfig } = require('./_isolated-config');

// The targets are read from a tree built here, not from this checkout: a fresh clone holds the
// workspace folders and no project in any of them. The modules read their root once, at load, so
// it is set before they are required.
const APP = path.join(__dirname, '../..');
const REPO = path.join(APP, '../..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-screens-root-'));
process.env.WORKSPACE_ROOT = root;

const { screenTargets, screenTargetDir } = require('../../screens');
const { ROOT, loadWorkspaces } = require('../../workspaces');

before(() => {
  fs.mkdirSync(path.join(root, 'core'), { recursive: true });
  copyConfig(path.join(REPO, 'core/config'), path.join(root, 'core/config'));
  fs.symlinkSync(path.join(REPO, 'core/scripts'), path.join(root, 'core/scripts'));
  fs.symlinkSync(APP, path.join(root, 'core/workspace-app'));
  // Every workspace folder, as a clone has them; one project in dev/; a dot folder, which is not one.
  for (const w of Object.values(loadWorkspaces())) fs.mkdirSync(w.dir, { recursive: true });
  fs.mkdirSync(path.join(root, 'dev', 'blog1', '.ddev'), { recursive: true });
  fs.mkdirSync(path.join(root, 'dev', '.cache'), { recursive: true });
});

after(() => fs.rmSync(root, { recursive: true, force: true }));

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
  const blog = targets.find((t) => t.value === 'p:dev:blog1');
  assert.ok(blog && blog.group === 'Projects' && blog.dir === path.join(ROOT, 'dev', 'blog1'),
    'the project in dev/ is offered under Projects');
  assert.ok(!targets.some((t) => t.value === 'p:dev:.cache'), 'a dot folder is not a project');
});

// The name rule is shared by the form, the actions and both /fragments routes:
// it must never admit a leading '-', which `screen` would read as an option.
const NAME_RE = /^[a-z0-9][a-zA-Z0-9_.-]*$/;

test('a session name may not start with a dash, and holds no shell characters', () => {
  for (const ok of ['build1', 'jira-webship-2307', 'a.b_c-d', 'x']) assert.ok(NAME_RE.test(ok), ok);
  for (const bad of ['-d', '-S', '; rm -rf /', 'a b', '../x', 'a$b', 'A-first', '']) {
    assert.ok(!NAME_RE.test(bad), `${bad} is refused`);
  }
});

// The machine's sessions reach the dashboard through the folder both sides
// share: the runner republishes its list every two seconds, so a stale file
// means the runner is gone and nothing new may be started.
test('a published session list is trusted only while it is fresh', () => {
  const file = path.join(ROOT, '.screens', 'host-sessions.json');
  const { hostSessionsFile } = require('../../jobs');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ at: Date.now(), host: os.hostname(), sessions: [{ session: 'a--b--c' }] }));
  assert.equal(hostSessionsFile().sessions.length, 1, 'a list written now is the truth');
  fs.writeFileSync(file, JSON.stringify({ at: Date.now() - 60000, sessions: [{ session: 'a--b--c' }] }));
  assert.equal(hostSessionsFile(), null, 'a minute-old list means the runner stopped');
});
