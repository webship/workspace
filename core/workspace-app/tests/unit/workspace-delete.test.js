/**
 * Deleting a workspace, against a temporary tree: only one with nothing in it goes, and only with both typed answers.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-delete-'));
const CONFIG = path.join(ROOT, 'core', 'config');
fs.mkdirSync(CONFIG, { recursive: true });
process.env.WORKSPACE_ROOT = ROOT;
process.env.WORKSPACE_CONFIG = CONFIG;

fs.writeFileSync(path.join(CONFIG, 'settings.yml'), '# kept\nworkspaces:\n  - dev\n  - emptyws\n  - busyws\n  - docs\nother: 1\n');
for (const name of ['dev', 'emptyws', 'busyws', 'docs']) {
  fs.writeFileSync(path.join(CONFIG, `workspace.${name}.settings.yml`), `doc:\n  name: ${name}\n`);
  fs.mkdirSync(path.join(ROOT, name));
}
fs.writeFileSync(path.join(ROOT, 'emptyws', 'cmd-tools-remove.sh'), '#!/bin/bash\n');
fs.writeFileSync(path.join(ROOT, 'emptyws', 'README.md'), '# emptyws\n');
fs.mkdirSync(path.join(ROOT, 'busyws', 'project1'));
fs.mkdirSync(path.join(ROOT, 'docs', '.hidden'));

const wsDelete = require('../../workspace-delete');

test('a folder with only tooling is unused; content, hidden folders, backups and sessions are not', () => {
  assert.deepStrictEqual(wsDelete.usage('emptyws', { sessions: [] }).reasons, []);
  assert.match(wsDelete.usage('busyws', { sessions: [] }).reasons.join(), /1 item in its folder \(project1\)/);
  assert.match(wsDelete.usage('docs', { sessions: [] }).reasons.join(), /\.hidden/);
  assert.match(wsDelete.usage('emptyws', { sessions: ['emptyws--shell'] }).reasons.join(), /1 screen session running/);
  assert.deepStrictEqual(wsDelete.usage('dev', { sessions: ['emptyws--shell'] }).reasons, []);
  fs.mkdirSync(path.join(ROOT, 'backups', 'dev'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'backups', 'dev', 'x.tar.gz'), '');
  assert.match(wsDelete.usage('dev', { sessions: [] }).reasons.join(), /1 backup file/);
  assert.match(wsDelete.usage('nope').reasons.join(), /not a workspace/);
});

test('the last step needs the name typed back and YES in capitals', () => {
  assert.strictEqual(wsDelete.confirmed('emptyws', { confirmName: 'emptyws', confirmYes: 'YES' }), true);
  assert.strictEqual(wsDelete.confirmed('emptyws', { confirmName: 'emptyws', confirmYes: 'yes' }), false);
  assert.strictEqual(wsDelete.confirmed('emptyws', { confirmName: 'busyws', confirmYes: 'YES' }), false);
  assert.strictEqual(wsDelete.confirmed('emptyws', { confirmYes: 'YES' }), false);
});

test('a workspace in use is refused and left as it is', () => {
  const r = wsDelete.deleteWorkspace('busyws');
  assert.match(r.error, /in use/);
  assert.ok(fs.existsSync(path.join(ROOT, 'busyws', 'project1')));
  assert.ok(fs.existsSync(path.join(CONFIG, 'workspace.busyws.settings.yml')));
});

test('deleting an unused one removes its line, settings file and folder, and nothing else', () => {
  const r = wsDelete.deleteWorkspace('emptyws');
  assert.ok(!r.error, r.error);
  assert.strictEqual(fs.readFileSync(path.join(CONFIG, 'settings.yml'), 'utf8'),
    '# kept\nworkspaces:\n  - dev\n  - busyws\n  - docs\nother: 1\n');
  assert.ok(!fs.existsSync(path.join(CONFIG, 'workspace.emptyws.settings.yml')));
  assert.ok(!fs.existsSync(path.join(ROOT, 'emptyws')));
  assert.ok(fs.existsSync(path.join(ROOT, 'dev')));
});

test('the steps ask for the name, then YES', () => {
  const use = { reasons: [], tooling: ['cmd-a.sh'] };
  const two = wsDelete.stepHtml('demo-x', 'name', use);
  assert.match(two, /Step 2 of 3/);
  assert.match(two, /name="confirmName"/);
  assert.match(two, /"step":"yes"/);
  const three = wsDelete.stepHtml('demo-x', 'yes', use, 'Type YES');
  assert.match(three, /Step 3 of 3/);
  assert.match(three, /name="confirmYes"/);
  assert.match(three, /"step":"delete","confirmName":"demo-x"/);
  assert.match(wsDelete.rowControlHtml('demo-x', use), /arm-step[\s\S]*hx-trigger="confirmed-remove"/);
  assert.match(wsDelete.rowControlHtml('dev', { reasons: ['2 items'], tooling: [] }), /in use/);
});
