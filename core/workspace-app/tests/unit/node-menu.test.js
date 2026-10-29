/**
 * The NODE menu on a project row.
 *
 * What must never drift: it appears only where there is a package.json; it offers yarn and npm as tabs
 * that say whether each lock file is there, opening on the manager the project uses; Yarn 1 and Yarn 2+
 * get their own command forms, read from the folder; every command runs in a screen session through
 * DDEV, never a host npm or yarn; the handler runs only its tables, a real package name and a script
 * package.json declares; and NODE sits right after COMPOSER.
 */

const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const node = require('../../actions/node');
const { MANAGERS, NODE_GROUPS, NODE_RUN_ACTIONS, NODE_PACKAGE_ACTIONS, NODE_SCRIPT_ROUTE, hasPackageJson, nodeInfo,
  nodeArgsFor, nodePackageRefusal, nodeScripts, nodeScreenCommand } = node;
const { LINGER_MARK } = require('../../actions/git');

function folder(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodemenu-'));
  for (const [name, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), typeof body === 'string' ? body : JSON.stringify(body));
  }
  return dir;
}

test('every entry has a group, a handler and shell-safe forms for npm, Yarn 1 and Yarn 2+', () => {
  assert.deepStrictEqual(MANAGERS, ['yarn', 'npm']);
  const order = Object.values(NODE_RUN_ACTIONS).map((a) => NODE_GROUPS.indexOf(a.group));
  assert.ok(order.every((g) => g >= 0));
  assert.deepStrictEqual(order, [...order].sort((x, y) => x - y), 'listed group by group, Daily first');
  for (const [route, act] of [...Object.entries(NODE_RUN_ACTIONS), ...Object.entries(NODE_PACKAGE_ACTIONS)]) {
    assert.match(route, /^\/actions\/node-[a-z-]+$/);
    assert.strictEqual(typeof node[route], 'function', `${route} has no handler exported`);
    for (const form of ['npm', 'yarn1', 'yarn']) {
      if (act[form] === null) continue;
      assert.ok(Array.isArray(act[form]) && act[form].length, `${route} ${form}`);
      // The manager and these args become the session's closing echo.
      assert.match(act[form].join(' '), /^[\w .=-]+$/, `${route} ${form} is not shell-safe`);
    }
  }
  assert.strictEqual(typeof node[NODE_SCRIPT_ROUTE], 'function');
});

test('the folder decides the manager and which Yarn; the lock files are reported', () => {
  const dirs = [];
  try {
    const yarn1 = folder({ 'package.json': { name: 'a' }, 'yarn.lock': '' }); dirs.push(yarn1);
    let i = nodeInfo(yarn1);
    assert.deepStrictEqual([i.valid, i.preferred, i.yarnBerry, i.locks.yarn, i.locks.npm], [true, 'yarn', false, true, false]);
    assert.deepStrictEqual(nodeArgsFor(NODE_RUN_ACTIONS['/actions/node-ci'], 'yarn', i), ['install', '--frozen-lockfile']);

    const berry = folder({ 'package.json': { packageManager: 'yarn@4.18.0+sha512.abc' }, 'yarn.lock': '' }); dirs.push(berry);
    i = nodeInfo(berry);
    assert.deepStrictEqual([i.preferred, i.yarnBerry, i.pinned.spec], ['yarn', true, 'yarn@4.18.0']);
    assert.deepStrictEqual(nodeArgsFor(NODE_RUN_ACTIONS['/actions/node-ci'], 'yarn', i), ['install', '--immutable']);
    assert.deepStrictEqual(nodeArgsFor(NODE_RUN_ACTIONS['/actions/node-outdated'], 'yarn', i), ['upgrade-interactive']);
    assert.strictEqual(nodeArgsFor(NODE_RUN_ACTIONS['/actions/node-update'], 'yarn', i), null, 'Yarn 2+ has no bare upgrade');

    const rc = folder({ 'package.json': {}, '.yarnrc.yml': 'yarnPath: x\n' }); dirs.push(rc);
    assert.strictEqual(nodeInfo(rc).yarnBerry, true, '.yarnrc.yml alone means Yarn 2+');

    const npm = folder({ 'package.json': {}, 'package-lock.json': '{}' }); dirs.push(npm);
    i = nodeInfo(npm);
    assert.deepStrictEqual([i.preferred, i.locks.npm, i.locks.yarn], ['npm', true, false]);
    assert.deepStrictEqual(nodeArgsFor(NODE_RUN_ACTIONS['/actions/node-ci'], 'npm', i), ['ci']);

    // The pin wins over a stray lock file.
    const pinned = folder({ 'package.json': { packageManager: 'yarn@4.1.0' }, 'package-lock.json': '{}' }); dirs.push(pinned);
    assert.strictEqual(nodeInfo(pinned).preferred, 'yarn');

    const bad = folder({ 'package.json': '{ not json' }); dirs.push(bad);
    assert.strictEqual(nodeInfo(bad).valid, false);
    assert.strictEqual(hasPackageJson(bad), true);
    assert.strictEqual(hasPackageJson(path.join(bad, 'missing')), false);
  } finally { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); }
});

test('a package must be an npm package name; only add takes a version', () => {
  const add = NODE_PACKAGE_ACTIONS['/actions/node-add'];
  const rm = NODE_PACKAGE_ACTIONS['/actions/node-remove'];
  for (const ok of ['react', 'lodash.merge', '@storybook/react', '@storybook/react@^8.0', 'lodash@latest', 'sass@>=1.70 <2']) {
    assert.strictEqual(nodePackageRefusal(ok, add), '', `should pass: ${ok}`);
  }
  assert.strictEqual(nodePackageRefusal('@storybook/react', rm), '');
  assert.notStrictEqual(nodePackageRefusal('react@^18', rm), '', 'remove takes no version');
  for (const bad of ['', 'React', "react'; id; '", 'react@$(id)', 'react@`id`', 'react;id', 'github:user/repo',
    'file:../x', 'https://x.test/a.tgz', 'react@git+ssh://x', 'react@1\\2', '../etc']) {
    assert.notStrictEqual(nodePackageRefusal(bad, add), '', `must be refused: ${bad}`);
  }
});

test('scripts come from package.json; lifecycle hooks and unsafe names do not', () => {
  const found = nodeScripts({ scripts: {
    'storybook:dev': 'storybook dev -p 6006',
    build: 'webpack', prebuild: 'rimraf dist', postbuild: 'echo done',
    prettier: 'prettier --write .', postcss: 'postcss src',
    postinstall: 'patch-package', prepare: 'husky',
    'bad name; id': 'x',
  } });
  assert.deepStrictEqual(found.map((s) => s.name), ['storybook:dev', 'build', 'prettier', 'postcss']);
  assert.strictEqual(found[0].command, 'storybook dev -p 6006');
  assert.deepStrictEqual(nodeScripts(null), []);
});

test('a command runs through DDEV, never a host npm or yarn, and stays open to be read', () => {
  const ddev = nodeScreenCommand('yarn install', 'yarn', ['install'], { isDdev: true, projectDir: '/home/u/workspace/dev/site1' });
  assert.ok(ddev.startsWith('ddev yarn install;'), ddev);
  const npm = nodeScreenCommand('npm ci', 'npm', ['ci'], { isDdev: false, projectDir: '/home/u/workspace/products/lib' });
  assert.match(npm, /^cd '[^']+\/core\/workspace-app' && ddev exec -d '\/home\/u\/workspace\/products\/lib' npm ci;/, npm);
  const pinned = nodeScreenCommand('yarn install', 'yarn', ['install'],
    { isDdev: false, projectDir: '/home/u/workspace/products/theme', pinned: { name: 'yarn', major: 4, spec: 'yarn@4.18.0' } });
  assert.match(pinned, /ddev exec -d '\/home\/u\/workspace\/products\/theme' env COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack yarn install;/, pinned);
  for (const line of [ddev, npm, pinned]) {
    assert.ok(!/(^|[;&|]\s*)(npm|yarn)\b/.test(line), `a bare host npm or yarn: ${line}`);
    assert.ok(line.includes(LINGER_MARK), 'the session must wait to be read');
    assert.ok(!line.includes('$'), `a $ would be expanded by the runner's outer shell: ${line}`);
  }
});

test('the handler refuses anything outside its tables and bad input, before touching the folder', async () => {
  const call = async (pathname, form) => {
    const out = {};
    await node[NODE_SCRIPT_ROUTE]({ form, send: (html, code = 200) => { out.html = html; out.code = code; }, workspace: 'test', pathname });
    return out;
  };
  let r = await call('/actions/node-exec', { projectName: 'anything', manager: 'npm' });
  assert.strictEqual(r.code, 404);
  r = await call('/actions/node-install', { projectName: '../etc', manager: 'npm' });
  assert.strictEqual(r.code, 400);
  r = await call('/actions/node-install', { projectName: 'anything', manager: 'pnpm; id' });
  assert.strictEqual(r.code, 400);
  assert.match(r.html, /Pick npm or yarn/);
  r = await call('/actions/node-add', { projectName: 'anything', manager: 'yarn', package: 'github:evil/repo' });
  assert.strictEqual(r.code, 400);
  assert.match(r.html, /not a package name/);
  r = await call(NODE_SCRIPT_ROUTE, { projectName: 'anything', manager: 'yarn', script: 'x; id' });
  assert.strictEqual(r.code, 400);
  r = await call('/actions/node-install', { projectName: 'no-such-project-for-node-menu-test', manager: 'yarn' });
  assert.strictEqual(r.code, 400);
  assert.match(r.html, /has no package\.json/);
});

test('the row shows NODE right after COMPOSER, only where there is a package.json, with a tab per manager', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');
  assert.match(src, /\.\.\.require\('\.\/actions\/node'\)/, 'the node routes are not merged');
  // Where the buttons sit is Commands → Buttons now (row-layout.js); by default NODE comes right after COMPOSER.
  const { DEFAULT_LINES } = require('../../row-layout');
  assert.strictEqual(DEFAULT_LINES[1][DEFAULT_LINES[1].indexOf('composer') + 1], 'node', 'NODE must come right after COMPOSER by default');
  assert.strictEqual((src.match(/\bnode: nodeMenu\b/g) || []).length, 1, 'handed to the layout once per row');
  const fn = src.slice(src.indexOf('function nodeMenuHtml'), src.indexOf('function openWithMenuHtml'));
  assert.match(fn, /if \(!hasPackageJson\(projectPath\)\) return '';/, 'no package.json, no button');
  assert.match(fn, /uk-tab="active: \$\{Math\.max\(0, MANAGERS\.indexOf\(info\.preferred\)\)\}"/, 'opens on the manager the project uses');
  assert.match(fn, /info\.locks\[m\] \? 'lock ✓' : 'no lock'/, 'each tab says whether its lock file is there');
  assert.match(fn, /hx-include="closest \.node-package"/);
  assert.match(fn, /NODE_SCRIPT_ROUTE/, 'the scripts from package.json must be offered');
});
