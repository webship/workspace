/**
 * What a plugin for one platform (WordPress, Odoo, …) gets from the core: its AI items placed in the
 * AI folders, its accounts created its own way, its step pack wired into the testing setup, and the
 * example builder of a folder put back when the plugin goes.
 *
 * Against a temporary tree, the way plugin-system.test.js does: each check runs plugin-install.js
 * or bash with WORKSPACE_ROOT / WORKSPACE_CONFIG / WORKSPACE_PLUGINS_DIR pointing at it.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const APP = path.join(__dirname, '..', '..');
const SCRIPTS = path.join(APP, '..', 'scripts');

function tree({ aiFolders = ['ai-agents', 'ai-skills'] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-platform-'));
  const config = path.join(root, 'core', 'config');
  fs.mkdirSync(config, { recursive: true });
  fs.mkdirSync(path.join(root, 'core', 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(root, 'core', 'workspace-app', '.ddev'), { recursive: true });
  fs.mkdirSync(path.join(root, 'dev'), { recursive: true });
  for (const f of aiFolders) fs.mkdirSync(path.join(root, f), { recursive: true });
  fs.writeFileSync(path.join(config, 'settings.yml'), ['workspaces:', '  - dev', ...aiFolders.map((f) => `  - ${f}`),
    'plugins:', '  x-cms:', '    enabled: true', '  x-dev:', '    enabled: true', '  google-drive-sync:', '    enabled: false', ''].join('\n'));
  fs.writeFileSync(path.join(config, 'workspace.dev.settings.yml'), 'doc:\n  name: dev\ntype: sites\n');
  for (const f of aiFolders) fs.writeFileSync(path.join(config, `workspace.${f}.settings.yml`), `doc:\n  name: ${f}\ntype: ai-items\n`);
  const plugins = path.join(root, 'plugins');
  // The platform plugin: a builder, an agent, a skill (a folder), a command for a folder that is not here.
  const cms = path.join(plugins, 'x-cms');
  for (const d of ['commands', 'agents', 'skills/x-cms-content/reference', 'ai-commands', 'features']) fs.mkdirSync(path.join(cms, d), { recursive: true });
  fs.writeFileSync(path.join(cms, 'package.json'), JSON.stringify({ name: '@webship.co/workspace-x-cms', version: '0.1.0', main: 'index.js',
    workspacePlugin: { name: 'x-cms', label: 'X CMS', commands: { types: ['sites'], files: ['commands/cmd-x-cms-project.sh'] },
      features: ['features/x-cms.feature'],
      ai: { agents: ['agents/x-cms-builder.md'], skills: ['skills/x-cms-content'], commands: ['ai-commands/x-cms-new.md'] } } }));
  fs.writeFileSync(path.join(cms, 'features', 'x-cms.feature'), 'Feature: x\n');
  fs.writeFileSync(path.join(cms, 'index.js'), 'module.exports.register = () => {};\n');
  fs.writeFileSync(path.join(cms, 'commands', 'cmd-x-cms-project.sh'), '#!/usr/bin/env bash\n# the platform builder\n');
  fs.writeFileSync(path.join(cms, 'agents', 'x-cms-builder.md'), '---\nname: x-cms-builder\ndescription: Builds X CMS sites.\n---\n\nv1\n');
  fs.writeFileSync(path.join(cms, 'skills', 'x-cms-content', 'SKILL.md'), '---\nname: x-cms-content\n---\n');
  fs.writeFileSync(path.join(cms, 'skills', 'x-cms-content', 'reference', 'blocks.md'), '# Blocks\n');
  fs.writeFileSync(path.join(cms, 'ai-commands', 'x-cms-new.md'), 'New site: $ARGUMENTS\n');
  // A workspace-folder plugin whose folder ships an example builder of the same name.
  const dev = path.join(plugins, 'x-dev');
  fs.mkdirSync(path.join(dev, 'commands'), { recursive: true });
  fs.writeFileSync(path.join(dev, 'package.json'), JSON.stringify({ name: '@webship.co/workspace-x-dev', version: '0.1.0', main: 'index.js',
    workspacePlugin: { name: 'x-dev', workspace: { key: 'dev', files: ['commands/cmd-x-cms-project.sh'] } } }));
  fs.writeFileSync(path.join(dev, 'index.js'), 'module.exports.register = () => {};\n');
  fs.writeFileSync(path.join(dev, 'commands', 'cmd-x-cms-project.sh'), '#!/usr/bin/env bash\n# the folder example\n');
  return { root, config, plugins, cms };
}

const env = (t) => ({ ...process.env, WORKSPACE_ROOT: t.root, WORKSPACE_CONFIG: t.config, WORKSPACE_PLUGINS_DIR: t.plugins, WORKSPACE_PLUGINS_NO_RESTART: '1' });
const installer = (t, verb, name) => spawnSync(process.execPath, ['plugin-install.js', verb, name], { cwd: APP, env: env(t), encoding: 'utf8' });
const read = (t, p) => fs.readFileSync(path.join(t.root, p), 'utf8');
const has = (t, p) => fs.existsSync(path.join(t.root, p));

test('install places a plugin\'s agents and skills in the AI folders, records their hashes, and skips a kind whose folder is not here', () => {
  const t = tree();
  const r = installer(t, 'install', 'x-cms');
  assert.strictEqual(r.status, 0, r.stderr);
  for (const p of ['ai-agents/x-cms-builder.md', 'ai-skills/x-cms-content/SKILL.md', 'ai-skills/x-cms-content/reference/blocks.md']) {
    assert.match(r.stdout, new RegExp(`  placed ${p}\\n`));
    assert.ok(has(t, p), `${p} exists`);
  }
  assert.match(r.stdout, /skipped 1 commands: there is no ai-commands\/ workspace here/);
  assert.ok(!has(t, 'ai-commands'), 'a folder that is not a workspace here is not made');
  const record = read(t, 'core/config/plugins.installed.yml');
  assert.match(record, /hashes:\n\s+ai-agents\/x-cms-builder\.md: [0-9a-f]{64}/);
  assert.match(read(t, '.gitignore'), /^\/ai-agents\/x-cms-builder\.md$/m, 'a placed agent is not committed by a dev clone');
});

test('an agent that is still the plugin\'s copy is updated; one edited here is kept by install and by uninstall', () => {
  const t = tree();
  assert.strictEqual(installer(t, 'install', 'x-cms').status, 0);
  // The plugin moves on: the untouched copy follows.
  fs.writeFileSync(path.join(t.cms, 'agents', 'x-cms-builder.md'), '---\nname: x-cms-builder\n---\n\nv2\n');
  assert.strictEqual(installer(t, 'install', 'x-cms').status, 0);
  assert.match(read(t, 'ai-agents/x-cms-builder.md'), /v2/);
  // A person edits it: the next install leaves it, and says so.
  fs.writeFileSync(path.join(t.root, 'ai-agents', 'x-cms-builder.md'), 'mine\n');
  fs.writeFileSync(path.join(t.cms, 'agents', 'x-cms-builder.md'), '---\nname: x-cms-builder\n---\n\nv3\n');
  const again = installer(t, 'install', 'x-cms');
  assert.match(again.stdout, /kept ai-agents\/x-cms-builder\.md \(edited here/);
  assert.doesNotMatch(again.stdout, /placed ai-agents\/x-cms-builder\.md/, 'a kept file is not reported placed');
  assert.strictEqual(read(t, 'ai-agents/x-cms-builder.md'), 'mine\n');
  const u = installer(t, 'uninstall', 'x-cms');
  assert.strictEqual(u.status, 0, u.stderr);
  assert.match(u.stdout, /kept ai-agents\/x-cms-builder\.md \(edited here, so it stays\)/);
  assert.strictEqual(read(t, 'ai-agents/x-cms-builder.md'), 'mine\n');
  assert.ok(!has(t, 'ai-skills/x-cms-content'), 'the untouched skill is gone, folder and all');
  assert.ok(has(t, 'ai-skills'), 'the workspace folder stays');
});

test('an agent a person already had under that name is never written over, and never removed', () => {
  const t = tree();
  fs.writeFileSync(path.join(t.root, 'ai-agents', 'x-cms-builder.md'), 'my own agent\n');
  const r = installer(t, 'install', 'x-cms');
  assert.match(r.stdout, /kept ai-agents\/x-cms-builder\.md \(a file of that name was already here\)/);
  assert.doesNotMatch(r.stdout, /placed ai-agents\/x-cms-builder\.md/);
  assert.strictEqual(installer(t, 'uninstall', 'x-cms').status, 0);
  assert.strictEqual(read(t, 'ai-agents/x-cms-builder.md'), 'my own agent\n');
});

test('uninstall leaves nothing of an untouched plugin, and puts back the builder a folder ships under the same name', () => {
  const t = tree();
  assert.strictEqual(installer(t, 'install', 'x-dev').status, 0);
  assert.match(read(t, 'dev/cmd-x-cms-project.sh'), /the folder example/);
  assert.strictEqual(installer(t, 'install', 'x-cms').status, 0);
  assert.match(read(t, 'dev/cmd-x-cms-project.sh'), /the platform builder/, 'the platform\'s builder replaces the example');
  const u = installer(t, 'uninstall', 'x-cms');
  assert.strictEqual(u.status, 0, u.stderr);
  assert.match(u.stdout, /restored dev\/cmd-x-cms-project\.sh \(x-dev places it too\)/);
  assert.match(read(t, 'dev/cmd-x-cms-project.sh'), /the folder example/);
  for (const p of ['ai-agents/x-cms-builder.md', 'ai-skills/x-cms-content']) assert.ok(!has(t, p), `${p} is gone`);
  assert.ok(!has(t, 'core/workspace-app/tests/features/plugins/x-cms'), 'the folder its feature was in is gone with it');
  assert.ok(has(t, 'dev') && has(t, 'ai-agents'), 'a workspace folder is never removed');
  assert.doesNotMatch(read(t, 'core/config/plugins.installed.yml'), /^x-cms:/m);
  assert.doesNotMatch(read(t, '.gitignore'), /x-cms-builder/);
});

/** Run bash with the core's functions and a fake plugin's on top, the way bootstrap sources them. */
function bash(script) {
  return spawnSync('bash', ['-c', `ddev() { echo "ddev $*" ; }\nadd_drush() { echo add_drush ; }\n${script}`], { encoding: 'utf8' });
}

test('testing_configure calls every testing_configure_<plugin>, in the project folder, and goes on when one fails', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-project-'));
  const r = bash(`
source ${SCRIPTS}/functions/fun-testing.sh
testing_configure_b_cms() { echo "b_cms in $(pwd) with $1" ; }
testing_configure_a_cms() { echo "a_cms" ; return 1 ; }
testing_configure_plugins "${project}"
echo "back in $(pwd)"`);
  assert.strictEqual(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split('\n');
  assert.strictEqual(lines[0], 'a_cms');
  assert.match(lines[1], /testing_configure_a_cms could not finish/);
  assert.strictEqual(lines[2], `b_cms in ${fs.realpathSync(project)} with ${project}`);
  assert.doesNotMatch(lines[3], new RegExp(project), 'the caller stays where it was');
  const src = fs.readFileSync(path.join(SCRIPTS, 'functions', 'fun-testing.sh'), 'utf8');
  assert.ok(src.indexOf('testing_configure_plugins "${project_path}"') < src.indexOf('ddev ${runner} install'), 'the hooks run before the dependencies are installed');
});

test('add_users and cancel_users hand a platform that is not Drupal to its own functions', () => {
  const r = bash(`
WORKSPACE_ROOT=/nowhere; WORKSPACE_SCRIPTS=${SCRIPTS}; doc_name=dev; PROJECT_NAME=site1
source ${SCRIPTS}/functions/fun-users.sh
set_x_cms_users() { users=(editor) ; }
add_x_cms_users() { echo "add \${users[*]}" ; }
cancel_x_cms_users() { echo "cancel \${users[*]}" ; }
distribution_name=x_cms
add_users ; cancel_users`);
  assert.strictEqual(r.stdout.trim(), 'add editor\ncancel editor');
  assert.doesNotMatch(r.stdout, /drush/, 'drush is not asked about a project that is not Drupal');
});

test('the platform of a project is its DDEV project type, and Drupal or bare PHP is none', () => {
  const { platformOfProject } = require('../../project-platform');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-type-'));
  fs.mkdirSync(path.join(dir, '.ddev'));
  const typed = (type) => { fs.writeFileSync(path.join(dir, '.ddev', 'config.yaml'), `name: site1\n${type}\ndocroot: ""\n`); return platformOfProject(dir); };
  assert.strictEqual(typed('type: wordpress'), 'wordpress');
  assert.strictEqual(typed('type: "magento2"'), 'magento2');
  for (const t of ['type: drupal11', 'type: drupal', 'type: php', 'type: generic', '']) assert.strictEqual(typed(t), '', t);
  assert.strictEqual(platformOfProject(path.join(dir, 'missing')), '');
});

test('the Build form reads a plugin builder\'s arguments from the args file the installer placed', () => {
  const { parseBuilderArgs } = require('../../builder-args');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-args-'));
  fs.mkdirSync(path.join(root, 'dev'));
  fs.mkdirSync(path.join(root, 'core', 'scripts', 'plugins', 'x-cms', 'args'), { recursive: true });
  fs.writeFileSync(path.join(root, 'core', 'scripts', 'plugins', 'x-cms', 'args', 'arg-x-cms.sh'),
    "argparse \"$@\" <<ARGEOF || exit 1\nparser.add_argument('PROJECT_NAME', help='The name.')\nparser.add_argument('-i', '--install', action='store_true', default=False, help='Install it.')\nparser.add_argument('--version', default=\"${site_version}\", help='Which release.')\nARGEOF\n");
  fs.writeFileSync(path.join(root, 'dev', 'cmd-x-cms-project.sh'),
    '#!/usr/bin/env bash\nsite_version="latest";\nsource ${WORKSPACE_SCRIPTS}/plugins/x-cms/args/arg-x-cms.sh || exit 1 ;\n');
  const args = parseBuilderArgs(path.join(root, 'dev'), 'cmd-x-cms-project.sh', root);
  assert.deepStrictEqual(args.map((a) => [a.flag, a.bool, a.def]), [['--install', true, false], ['--version', false, 'latest']]);
});
