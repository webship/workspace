/**
 * webship-workspace update removes what an earlier release shipped and this one does not (#407): from the
 * record of the last copy (core/.shipped-files), and, for a workspace made before that record, from
 * core/bin/dropped-files.json. Only a file still exactly as shipped goes; a changed one stays and is named;
 * a file a plugin's install record claims, or one the package ships again, is never touched.
 */
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const BIN = path.join(__dirname, '..', '..', '..', 'bin', 'workspace.js');
const DROPPED = require('../../../bin/dropped-files.json');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const cli = (args) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8',
  env: { ...process.env, WEBSHIP_WORKSPACE_SKIP_NPM: '1', WEBSHIP_WORKSPACE_SKIP_DDEV: '1', WORKSPACE_PLUGINS_NO_RESTART: '1' } });

function workspace() {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ws-dropped-')), 'workspace');
  assert.strictEqual(cli(['init', dir]).status, 0);
  return dir;
}
const put = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };

test('init records what it shipped, with the hash of each file', () => {
  const dir = workspace();
  const lines = fs.readFileSync(path.join(dir, 'core', '.shipped-files'), 'utf8').trim().split('\n');
  const rec = Object.fromEntries(lines.map((l) => l.split('  ').reverse()));
  assert.ok(rec['core/workspace-app/server.js'], 'the dashboard is in it');
  assert.ok(rec['commands/cmd-tools-commands.sh'], 'so are the base\'s commands');
  assert.strictEqual(rec['core/workspace-app/server.js'], sha(fs.readFileSync(path.join(dir, 'core', 'workspace-app', 'server.js'))));
  assert.ok(!rec['core/config/settings.yml'], 'never a settings file');
});

test('a file the last release shipped and this one does not goes while it is as shipped; a changed one stays', () => {
  const dir = workspace();
  // As if the release before this one had also shipped two components.
  const recFile = path.join(dir, 'core', '.shipped-files');
  put(dir, 'core/workspace-app/public/css/components/old-one.css', '.old { color: red; }\n');
  put(dir, 'core/workspace-app/public/css/components/old-two.css', '.two { color: red; }\n');
  fs.appendFileSync(recFile, `${sha('.old { color: red; }\n')}  core/workspace-app/public/css/components/old-one.css\n${sha('.two { color: red; }\n')}  core/workspace-app/public/css/components/old-two.css\n`);
  fs.appendFileSync(path.join(dir, 'core/workspace-app/public/css/components/old-two.css'), '/* mine */\n');
  const u = cli(['update', dir]);
  assert.strictEqual(u.status, 0, u.stderr);
  assert.ok(!fs.existsSync(path.join(dir, 'core/workspace-app/public/css/components/old-one.css')));
  assert.match(fs.readFileSync(path.join(dir, 'core/workspace-app/public/css/components/old-two.css'), 'utf8'), /mine/);
  assert.match(u.stdout, /removed 1 file\(s\) an earlier release shipped and this one does not: core\/workspace-app\/public\/css\/components\/old-one\.css/);
  assert.match(u.stdout, /kept core\/workspace-app\/public\/css\/components\/old-two\.css: this release no longer ships it, and it was changed here/);
  assert.ok(fs.existsSync(path.join(dir, 'core/workspace-app/public/css/components')), 'the folder the package ships stays');
  assert.doesNotMatch(fs.readFileSync(recFile, 'utf8'), /old-one\.css/, 'the new record is this release\'s');
  // What an update keeps or merges instead of copying is still the package's: never taken for dropped.
  const again = cli(['update', dir]);
  assert.strictEqual(again.status, 0, again.stderr);
  assert.doesNotMatch(again.stdout, /removed \d+ file/);
  for (const f of ['core/config/style.yml', 'core/workspace-app/package.json', 'core/config/settings.yml']) assert.ok(fs.existsSync(path.join(dir, f)), `${f} is there`);
});

test('a workspace made before the record: the files 1.0.0 to 1.0.8 shipped by mistake go, unless a plugin claims them', () => {
  const dir = workspace();
  fs.rmSync(path.join(dir, 'core', '.shipped-files'));
  const mounts = 'core/scripts/plugins/jira/host-mounts.txt';
  assert.ok(DROPPED[mounts], 'the list names it');
  put(dir, mounts, '~/.config/twg\n~/.local/bin\n');
  assert.ok(DROPPED[mounts].sha256.includes(sha('~/.config/twg\n~/.local/bin\n')), 'as 1.0.0 to 1.0.8 shipped it');
  put(dir, 'core/config/theme.upsun.yml', 'label: my upsun\n');
  let u = cli(['update', dir]);
  assert.strictEqual(u.status, 0, u.stderr);
  assert.ok(!fs.existsSync(path.join(dir, mounts)));
  assert.ok(!fs.existsSync(path.join(dir, 'core/scripts/plugins/jira')), 'and its folder, now empty');
  assert.ok(fs.existsSync(path.join(dir, 'core/config/theme.upsun.yml')), 'a style a person changed stays');
  assert.match(u.stdout, /kept core\/config\/theme\.upsun\.yml: this release no longer ships it, and it was changed here/);
  // The same file, placed by the jira plugin of this workspace: its install record claims it.
  put(dir, mounts, '~/.config/twg\n~/.local/bin\n');
  put(dir, 'core/config/plugins.installed.yml', `jira:\n  module: '@webship.co/workspace-jira'\n  placed:\n    - ${mounts}\n`);
  u = cli(['update', dir]);
  assert.strictEqual(u.status, 0, u.stderr);
  assert.ok(fs.existsSync(path.join(dir, mounts)), 'a plugin\'s file is the plugin\'s');
});

test('a file the package ships again is never removed', () => {
  const dir = workspace();
  const recFile = path.join(dir, 'core', '.shipped-files');
  const server = fs.readFileSync(path.join(dir, 'core/workspace-app/server.js'));
  fs.writeFileSync(recFile, `${sha(server)}  core/workspace-app/server.js\n`);
  assert.strictEqual(cli(['update', dir]).status, 0);
  assert.ok(fs.existsSync(path.join(dir, 'core/workspace-app/server.js')));
});
