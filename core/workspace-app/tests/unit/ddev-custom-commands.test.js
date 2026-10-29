'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { customCommands, menuGroupsHtml } = require('../../ddev-custom-commands');
const composerSrc = fs.readFileSync(path.join(__dirname, '../../actions/composer.js'), 'utf8');

function project({ type = 'drupal', lock = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ddev-cmds-'));
  fs.mkdirSync(path.join(dir, '.ddev', 'commands', 'web', 'libs'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.ddev', 'commands', 'host'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.ddev', 'config.yaml'), `name: x\ntype: ${type}\n`);
  const cmd = (where, name, body, mode = 0o755) => fs.writeFileSync(path.join(dir, '.ddev', 'commands', where, name), body, { mode });
  cmd('web', 'add-testing-users', '#!/bin/bash\n## Description: Add testing users\n## Usage: add-testing-users\n## Aliases: webship:add-testing-users\n');
  cmd('web', 'helper.sh', 'echo sourced\n', 0o644);
  cmd('web', 'README.txt', 'docs\n');
  cmd('web', 'solrtail.example', '#!/bin/bash\n## Description: example\n');
  cmd('web', 'wp-only', '#!/bin/bash\n## Description: WordPress only\n## ProjectTypes: wordpress\n');
  cmd('host', 'open-ide', '#!/bin/bash\n## Description: Open the IDE\n');
  fs.writeFileSync(path.join(dir, 'composer.json'), JSON.stringify({ scripts: { 'post-install-cmd': 'x', lint: 'phpcs' }, 'scripts-aliases': { lint: ['cs'] } }));
  if (lock) fs.writeFileSync(path.join(dir, 'composer.lock'), '{}');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { build: 'vite build', postinstall: 'x' } }));
  return dir;
}

test('every service folder is read, helpers and examples are not commands, ProjectTypes is honoured', () => {
  const list = customCommands(project());
  assert.deepStrictEqual(list.map((c) => `${c.service}/${c.name}`), ['web/add-testing-users', 'host/open-ide']);
  assert.deepStrictEqual(list[0].aliases, ['webship:add-testing-users']);
  assert.strictEqual(customCommands(project({ type: 'wordpress' })).length, 3);
});

test('the DDEV menu gets three folding groups: custom commands, composer.json and package.json scripts', () => {
  const html = menuGroupsHtml({ key: 'dev', project: 'p', projectPath: project(), running: true });
  for (const h of ['custom commands', 'composer.json scripts', 'package.json scripts']) assert.match(html, new RegExp(`class="uk-nav-header" data-group="${h}"`));
  assert.match(html, /hx-post="\/actions\/ddev-project-command"[^>]*"command":"add-testing-users"/);
  assert.match(html, /title="Add testing users — ddev add-testing-users — aliases: webship:add-testing-users">/);
  assert.match(html, /hx-post="\/actions\/composer-script"[^>]*"script":"lint"/);
  assert.match(html, /lint <span class="uk-text-meta">· cs/);
  assert.match(html, /hx-post="\/actions\/node-script"[^>]*"script":"build"/);
  assert.ok(!/post-install-cmd|postinstall/.test(html), 'hooks run on their own');
});

test('a stopped project offers host commands and says container ones need a start', () => {
  const html = menuGroupsHtml({ key: 'dev', project: 'p', projectPath: project(), running: false });
  assert.match(html, /"command":"open-ide"/);
  assert.match(html, /ddev add-testing-users · start first/);
});

test('composer.json scripts are listed only once composer.lock is there, and the route allows them for a DDEV folder', () => {
  assert.ok(!/composer\.json scripts/.test(menuGroupsHtml({ key: 'dev', project: 'p', projectPath: project({ lock: false }), running: true })));
  assert.match(composerSrc, /const installedDdev = \(dir\) => isDdevProject\(dir\) && fs\.existsSync\(path\.join\(dir, 'composer\.lock'\)\);/);
});
