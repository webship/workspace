/**
 * The COMPOSER menu on a project row.
 *
 * What must never drift: it appears only where there is a composer.json; every command runs in a
 * screen session through DDEV (`ddev composer`, or the dashboard's DDEV container), never a host
 * composer; the handler runs only its tables, a real package name and a script the folder declares;
 * a second click never stops a run that is still going; and COMPOSER sits right after SCREENS.
 */

const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const composer = require('../../actions/composer');
const { COMPOSER_RUN_ACTIONS, COMPOSER_PACKAGE_ACTIONS, SCRIPT_ROUTE, hasComposerJson, packageRefusal,
  composerScripts, composerScreenCommand, sessionFinished } = composer;
const { gitScreenCommand, LINGER_MARK } = require('../../actions/git');

test('the menu offers install, update and the common commands, each with a handler', () => {
  const labels = Object.values(COMPOSER_RUN_ACTIONS).map((a) => a.label);
  for (const want of ['composer install', 'composer update', 'composer validate', 'composer outdated --direct', 'composer audit']) {
    assert.ok(labels.includes(want), `missing: ${want}`);
  }
  for (const [route, act] of [...Object.entries(COMPOSER_RUN_ACTIONS), ...Object.entries(COMPOSER_PACKAGE_ACTIONS)]) {
    assert.match(route, /^\/actions\/composer-[a-z-]+$/);
    // Labels go into the session's closing echo, so they must stay shell-safe constants.
    assert.match(act.label, /^[\w .()-]+$/, `label is not shell-safe: ${act.label}`);
    assert.strictEqual(typeof composer[route], 'function', `${route} has no handler exported`);
  }
  assert.strictEqual(typeof composer[SCRIPT_ROUTE], 'function');
});

test('the everyday commands come first', () => {
  const { COMPOSER_GROUPS } = composer;
  assert.deepStrictEqual(COMPOSER_GROUPS, ['Daily', 'Inspect', 'Maintenance']);
  const labels = Object.values(COMPOSER_RUN_ACTIONS).map((a) => a.label);
  assert.deepStrictEqual(labels.slice(0, 4), ['composer install', 'composer update', 'composer outdated --direct', 'composer validate']);
  // The groups follow the table's order, so a Daily entry can never sit below an Inspect one.
  const order = Object.values(COMPOSER_RUN_ACTIONS).map((a) => COMPOSER_GROUPS.indexOf(a.group));
  assert.ok(order.every((g) => g >= 0), 'every entry belongs to a shown group');
  assert.deepStrictEqual(order, [...order].sort((x, y) => x - y), 'entries must be listed group by group, Daily first');
  assert.deepStrictEqual(Object.values(COMPOSER_PACKAGE_ACTIONS).slice(0, 3).map((a) => a.button), ['require', 'update -W', 'remove']);
});

test('a command runs through DDEV, never a host composer, and stays open to be read', () => {
  const act = COMPOSER_RUN_ACTIONS['/actions/composer-update'];
  const ddev = composerScreenCommand(act.label, act.args, { isDdev: true, projectDir: '/home/u/workspace/dev/site1' });
  assert.ok(ddev.startsWith('ddev composer --no-interaction --ansi update;'), ddev);
  const plain = composerScreenCommand(act.label, act.args, { isDdev: false, projectDir: '/home/u/workspace/libraries/ace' });
  assert.match(plain, /^cd '[^']+\/core\/workspace-app' && ddev exec -d '\/home\/u\/workspace\/libraries\/ace' composer --no-interaction --ansi update;/, plain);
  for (const line of [ddev, plain]) {
    assert.ok(!/(^|[;&|]\s*)composer\b/.test(line), `a bare host composer: ${line}`);
    assert.ok(line.includes(LINGER_MARK), 'the session must wait to be read');
    // The runner wraps this in an outer `bash -lc "…"`: any $ would be expanded there, too early.
    assert.ok(!line.includes('$'), `a $ would be expanded by the runner's outer shell: ${line}`);
  }
  // The shared tail must not have changed what a git session runs.
  assert.match(gitScreenCommand('git status', ['status']),
    /^GIT_TERMINAL_PROMPT=0 git --no-pager status; echo; echo "git status finished\. Press Enter to close this session, or leave it: it closes by itself in 15 minutes\."; timeout --foreground 900 /);
});

test('a package must look like a package; only require takes a constraint', () => {
  const req = COMPOSER_PACKAGE_ACTIONS['/actions/composer-require'];
  const rm = COMPOSER_PACKAGE_ACTIONS['/actions/composer-remove'];
  assert.strictEqual(packageRefusal('drupal/token', rm), '');
  assert.strictEqual(packageRefusal('drupal/token:^1.15', req), '');
  assert.strictEqual(packageRefusal('drupal/core-recommended:>=11.2 <11.4', req), '');
  assert.notStrictEqual(packageRefusal('drupal/token:^1.15', rm), '', 'remove takes no constraint');
  for (const bad of ['', 'token', 'Drupal/Token', "drupal/token'; rm -rf ~; '", 'drupal/token:$(id)', 'drupal/token:`id`', 'drupal/token;id', 'drupal/token:1\\2', 'drupal/token:"1"']) {
    assert.notStrictEqual(packageRefusal(bad, req), '', `must be refused: ${bad}`);
  }
});

test('custom scripts come from composer.json with their aliases; hooks and unsafe names do not', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'composermenu-'));
  try {
    fs.writeFileSync(path.join(tmp, 'composer.json'), JSON.stringify({
      scripts: {
        'post-update-cmd': ['@php -r "1;"'],
        'pre-install-cmd': 'x',
        'drupal-libraries-sync': 'node sync.js',
        'phpcs:fix': 'phpcbf',
        'bad name; id': 'x',
      },
      'scripts-aliases': { 'drupal-libraries-sync': ['dls', 'bad alias!'] },
      'scripts-descriptions': { 'phpcs:fix': 'Fix coding standards' },
    }));
    assert.strictEqual(hasComposerJson(tmp), true);
    const found = composerScripts(tmp);
    assert.deepStrictEqual(found.map((s) => s.name), ['drupal-libraries-sync', 'phpcs:fix']);
    assert.deepStrictEqual(found[0].aliases, ['dls']);
    assert.strictEqual(found[1].description, 'Fix coding standards');
    fs.writeFileSync(path.join(tmp, 'composer.json'), '{ not json');
    assert.deepStrictEqual(composerScripts(tmp), []);
    assert.strictEqual(hasComposerJson(path.join(tmp, 'missing')), false);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('the handler refuses anything outside its tables, bad input, and a folder without composer.json', async () => {
  const call = async (pathname, form) => {
    const out = {};
    await composer[SCRIPT_ROUTE]({ form, send: (html, code = 200) => { out.html = html; out.code = code; }, workspace: 'test', pathname });
    return out;
  };
  let r = await call('/actions/composer-exec', { projectName: 'anything' });
  assert.strictEqual(r.code, 404, 'a route outside the tables must not run');
  r = await call('/actions/composer-install', { projectName: '../etc' });
  assert.strictEqual(r.code, 400);
  r = await call('/actions/composer-require', { projectName: 'anything', package: 'drupal/x; id' });
  assert.strictEqual(r.code, 400);
  assert.match(r.html, /not a package name/);
  r = await call(SCRIPT_ROUTE, { projectName: 'anything', script: 'x; id' });
  assert.strictEqual(r.code, 400);
  r = await call('/actions/composer-install', { projectName: 'no-such-project-for-composer-menu-test' });
  assert.strictEqual(r.code, 400);
  assert.match(r.html, /has no composer\.json/);
});

test('a second click replaces only a session that has finished', () => {
  assert.strictEqual(sessionFinished(`Installing…\ncomposer install finished. ${LINGER_MARK}, or leave it: it closes by itself in 15 minutes.\n\n`), true);
  assert.strictEqual(sessionFinished('Updating dependencies\n  - Upgrading drupal/core (11.2.0 => 11.2.1)\n'), false, 'a run still going must be left alone');
  assert.strictEqual(sessionFinished(''), false, 'no log is not proof it finished');
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'actions', 'composer.js'), 'utf8');
  assert.match(src, /if \(!sessionFinished\(sessionLogTail\(started\.session\)\)\) return \{ \.\.\.started, stillRunning: true \};\s*\n\s*await hostRunnerRequest\('stop'/,
    'the stop must come only after the finished check');
  assert.ok(!/<pre\b|terminal-pre/.test(src), 'composer output must not be rendered in the page');
});

test('only a full workspace installs; everywhere else composer.json is only added to', () => {
  const full = composer.composerActionsFor('full');
  assert.ok(full.run['/actions/composer-install'] && full.run['/actions/composer-update'] && full.scripts);
  // Manifest is the default: an unset or unknown mode must never install.
  for (const mode of ['manifest', undefined, '', 'Full', 'anything']) {
    const m = composer.composerActionsFor(mode);
    assert.deepStrictEqual(Object.keys(m.run), ['/actions/composer-validate'], `mode ${mode} runs more than validate`);
    assert.strictEqual(m.scripts, false, `mode ${mode} offers scripts`);
    assert.deepStrictEqual(Object.keys(m.packages).sort(),
      ['/actions/composer-remove', '/actions/composer-require', '/actions/composer-require-dev']);
    for (const a of Object.values(m.packages)) {
      assert.ok(a.args.includes('--no-update'), `${a.label} would install: ${a.args.join(' ')}`);
      assert.match(a.label, /^[\w .()-]+$/, `label is not shell-safe: ${a.label}`);
    }
  }
  const { loadWorkspaces } = require('../../workspaces');
  const ws = loadWorkspaces();
  for (const key of ['dev', 'test', 'demos', 'sandboxes', 'projects']) {
    if (ws[key]) assert.strictEqual(ws[key].composerMode, 'full', `${key} is a site workspace and should be full`);
  }
  for (const key of ['products', 'modules', 'themes', 'recipes', 'profiles']) {
    if (ws[key]) assert.strictEqual(ws[key].composerMode, 'manifest', `${key} holds package clones and must not install`);
  }
});

test('the handler refuses install in a manifest workspace before touching the folder', async () => {
  const { loadWorkspaces } = require('../../workspaces');
  const manifestWs = Object.keys(loadWorkspaces()).find((k) => loadWorkspaces()[k].composerMode === 'manifest');
  if (!manifestWs) return; // a tree without one
  for (const route of ['/actions/composer-install', '/actions/composer-update', '/actions/composer-update-package', SCRIPT_ROUTE]) {
    const out = {};
    await composer[route]({ form: { projectName: 'anything', script: 'x', package: 'drupal/token' },
      send: (html, code = 200) => { out.html = html; out.code = code; }, workspace: manifestWs, pathname: route });
    assert.strictEqual(out.code, 403, `${route} must be refused in ${manifestWs}`);
    assert.match(out.html, /only edits composer\.json/);
  }
});

test('the row shows COMPOSER right after SCREENS, only where there is a composer.json', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');
  assert.match(src, /\.\.\.require\('\.\/actions\/composer'\)/, 'the composer routes are not merged');
  // Where the buttons sit is Commands → Buttons now (row-layout.js); by default COMPOSER comes right after SCREENS.
  const { DEFAULT_LINES } = require('../../row-layout');
  assert.strictEqual(DEFAULT_LINES[1][DEFAULT_LINES[1].indexOf('screens') + 1], 'composer', 'COMPOSER must come right after SCREENS by default');
  assert.strictEqual((src.match(/\bcomposer: composerMenu\b/g) || []).length, 1, 'handed to the layout once per row');
  const fn = src.slice(src.indexOf('function composerMenuHtml'), src.indexOf('function openWithMenuHtml'));
  assert.match(fn, /if \(!hasComposerJson\(projectPath\)\) return '';/, 'no composer.json, no button');
  assert.match(fn, /hx-include="closest \.composer-package"/);
  assert.match(fn, /SCRIPT_ROUTE/, 'the scripts from composer.json must be offered');
  // The full menu is too long for one column: commands on the left, a package and the scripts on the right.
  assert.match(fn, /const body = manifest\s*\n(\s*\/\/[^\n]*\n)*\s*\? `<ul class="uk-nav uk-dropdown-nav">\$\{head\}\s*\n\s*<li class="uk-nav-divider"><\/li>\$\{packageBlock\}\$\{groups\}<\/ul>`/,
    'the short manifest menu stays one column, with the package field before validate');
  assert.match(fn, /<div class="composer-columns">\s*\n\s*<ul class="uk-nav uk-dropdown-nav composer-col-commands">\$\{head\}\$\{groups\}<\/ul>\s*\n\s*<ul class="uk-nav uk-dropdown-nav composer-col-inputs">\$\{packageBlock\}\$\{scriptsBlock\}<\/ul>/,
    'the full menu must be two columns');
});
