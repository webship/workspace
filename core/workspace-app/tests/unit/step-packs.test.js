/**
 * The webship-js extra-steps packs: listing them, and adding, removing and copying the examples of one.
 *
 * core/scripts/libs/step_packs.js is shared: cmd-tools-testing.sh shells out to it and the dashboard's
 * Extra steps panel requires it, so the rules are tested here once. The projects are written to a temp
 * folder in the shape webship-js's own scaffold gives them (init-webship-js 2.0.16), and the registry is a
 * stand-in fetch: the tests never reach npm or a site.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { ROOT } = require('../../workspaces');
const sp = require(path.join(ROOT, 'core', 'scripts', 'libs', 'step_packs'));

const REPO = path.join(__dirname, '..', '..', '..', '..');

// The cucumber.js init-webship-js writes (2.0.16), trimmed to what the edits read.
const SCAFFOLD = `// A feature file … named on the command line of cucumber-js runs alone.
function commandLinePaths() { return []; }

module.exports = {
  default: {
    timeout: 30000,
    requireModule: ['tsx/cjs'],
    require: [
      'node_modules/webship-js/tests/step-definitions/**/*.js',          // Webship-js core step definitions.
      'tests/step-definitions/**/*.js',                                  // Your custom step definitions.
    ],
    // FEATURES=tests/features/a.feature,tests/features/b.feature runs a subset too.
    paths: process.env.FEATURES ? process.env.FEATURES.split(',') : (commandLinePaths().length ? [] : ['tests/features/**/*.feature']),
    format: [
      '@cucumber/pretty-formatter',
      'json:tests/reports/cucumber_report.json',
    ],
    worldParameters: {
      launchUrl: process.env.LAUNCH_URL || 'http://localhost:8080',
      minWaitTime: { page: 3000, before_scenario: 0 },
      selectors: { css: {}, xpath: {} },
    },
  },
};
`;
const PACKAGE = `{
  "name": "project-name",
  "scripts": {
    "test": "cucumber-js --config cucumber.js"
  },
  "dependencies": {
    "webship-js": "~2.0.0"
  }
}
`;

function project({ cucumber = SCAFFOLD, pkg = PACKAGE } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-steps-'));
  fs.mkdirSync(path.join(dir, 'tests', 'features'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.ddev'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.ddev', 'config.yaml'), 'name: stepsdemo\ntype: wordpress\n');
  if (cucumber !== null) fs.writeFileSync(path.join(dir, 'cucumber.js'), cucumber);
  if (pkg !== null) fs.writeFileSync(path.join(dir, 'package.json'), pkg);
  return dir;
}

/** A pack as npm would install it: package.json, README and the features it ships. */
function install(dir, name, { version = '2.1.0', readme = '', features = {} } = {}) {
  const at = path.join(dir, 'node_modules', ...name.split('/'));
  fs.mkdirSync(path.join(at, 'tests', 'features'), { recursive: true });
  fs.writeFileSync(path.join(at, 'package.json'), JSON.stringify({ name, version }));
  fs.writeFileSync(path.join(at, 'README.md'), readme);
  for (const [rel, body] of Object.entries(features)) {
    fs.mkdirSync(path.dirname(path.join(at, 'tests', 'features', rel)), { recursive: true });
    fs.writeFileSync(path.join(at, 'tests', 'features', rel), body);
  }
}

const known = sp.knownPacks();
const pack = (short) => sp.describePack({ name: sp.packName(short), version: (known.get(sp.packName(short)) || {}).version || '2.0.0' }, known);
const read = (dir, f) => fs.readFileSync(path.join(dir, f), 'utf8');
const loadConfig = (dir) => { const f = path.join(dir, 'cucumber.js'); delete require.cache[f]; return require(f); };

test('a pack is only ever @webship-js/<name>-steps, whatever is typed', () => {
  for (const [typed, name] of [['diffy', '@webship-js/diffy-steps'], ['diffy-steps', '@webship-js/diffy-steps'],
    ['@webship-js/diffy-steps', '@webship-js/diffy-steps'], [' WordPress ', '@webship-js/wordpress-steps'], ['drupal-cms', '@webship-js/drupal-cms-steps']]) {
    assert.strictEqual(sp.packName(typed), name, typed);
  }
  // Nothing that npm or a shell would read as something else: a path, a URL, another scope, an option.
  for (const bad of ['../../etc', '/tmp/x', 'https://example.com/x.tgz', '@other/diffy-steps', '--registry=x', 'a b', 'git+ssh://x', '', 'diffy;rm']) {
    assert.strictEqual(sp.packName(bad), null, bad);
  }
  assert.strictEqual(sp.docsUrl('@webship-js/diffy-steps'), 'https://webship.co/docs/webship-js/2.0.x/diffy-step-definitions');
});

test('the shipped list: real packs, a kind each, extensions on a base it knows', () => {
  const { packs, upcoming } = sp.shippedList();
  assert.ok(packs.length >= 37, 'the 37 packs on npm on 2026-11-21');
  for (const p of [...packs, ...upcoming]) {
    assert.match(p.name, sp.PACK_RE, p.name);
    assert.ok(['platform', 'extension', 'any-site'].includes(p.kind), `${p.name}: ${p.kind}`);
    if (p.kind === 'extension') assert.ok(known.has(p.base), `${p.name} builds on ${p.base}, which the list knows`);
    for (const rule of p.detect || []) for (const re of Object.values(rule)) assert.doesNotThrow(() => new RegExp(re, 'i'), `${p.name}: ${re}`);
  }
  for (const p of packs) assert.match(p.version, /^\d+\.\d+\.\d+$/, `${p.name} carries its last known version`);
  assert.strictEqual(known.get('@webship-js/diffy-steps').kind, 'any-site');
  assert.strictEqual(known.get('@webship-js/drupal-cms-steps').base, '@webship-js/drupal-core-steps');
  // The npm package ships it: a workspace made from npm lists the packs offline too.
  const { files } = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  assert.ok(files.includes('core/config/step-packs.json'), 'package.json files lists core/config/step-packs.json');
});

/** A stand-in fetch: url → JSON body, or an Error to throw. */
function fakeFetch(routes, asked = []) {
  return async (url) => {
    asked.push(url);
    const hit = Object.entries(routes).find(([k]) => url.startsWith(k));
    if (!hit || hit[1] instanceof Error) throw (hit ? hit[1] : new Error(`no route for ${url}`));
    return { ok: true, status: 200, json: async () => hit[1] };
  };
}
const searchBody = (names) => ({ objects: names.map((n) => ({ package: { name: n, version: '2.3.4', description: `about ${n}` } })) });

test('the list: npm search filtered by name, the keyword search when the scope is ignored, the org list for the rest', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-steps-root-'));
  const asked = [];
  const list = await sp.listPacks({ root, fetchImpl: fakeFetch({
    // What npm answered on 2026-11-19 for scope:webship-js: 250 packages, none of the scope.
    'https://registry.npmjs.org/-/v1/search?text=scope:webship-js': searchBody(['isarray', 'once']),
    'https://registry.npmjs.org/-/v1/search?text=keywords:webship-js': searchBody(['@webship-js/diffy-steps', '@webship-js/wordpress-steps', 'webship-js', '@webship-js/not-a-pack']),
    'https://registry.npmjs.org/-/org/webship-js/package': { '@webship-js/diffy-steps': 'write', '@webship-js/jira-steps': 'write', '@webship-js/wordpress-steps': 'write' },
    'https://registry.npmjs.org/@webship-js%2Fjira-steps/latest': { name: '@webship-js/jira-steps', version: '2.0.9', description: 'Jira' },
  }, asked) });
  assert.strictEqual(list.source, 'npm');
  assert.deepStrictEqual(list.packs.map((p) => p.name).sort(), ['@webship-js/diffy-steps', '@webship-js/jira-steps', '@webship-js/wordpress-steps']);
  assert.strictEqual(list.packs.find((p) => p.short === 'jira').version, '2.0.9', 'a pack the search missed is asked for by name');
  assert.strictEqual(list.packs.find((p) => p.short === 'diffy').kind, 'any-site', 'what a pack is comes from the shipped list');
  assert.ok(fs.existsSync(sp.cacheFile(root)), 'kept under the workspace cache folder');
  assert.ok(sp.cacheFile(root).startsWith(path.join(root, 'core', 'workspace-app', '.cache')));

  // Within the day: the cache, and no request.
  const again = await sp.listPacks({ root, fetchImpl: fakeFetch({}, asked) });
  assert.strictEqual(again.source, 'cache');
  const before = asked.length;
  // A day later and offline: the stale cache, said so, and the next try waits ten minutes.
  const later = Date.now() + sp.DAY + 1000;
  const stale = await sp.listPacks({ root, now: later, fetchImpl: fakeFetch({ 'https://': new Error('ENOTFOUND registry.npmjs.org') }, asked) });
  assert.strictEqual(stale.source, 'stale-cache');
  assert.match(stale.error, /ENOTFOUND/);
  assert.ok(asked.length > before);
  const quiet = asked.length;
  await sp.listPacks({ root, now: later + 60 * 1000, fetchImpl: fakeFetch({}, asked) });
  assert.strictEqual(asked.length, quiet, 'no new request within ten minutes of a failed one');
});

test('the list: npm unreachable and nothing cached gives the list shipped with the core', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-steps-root-'));
  const list = await sp.listPacks({ root, fetchImpl: fakeFetch({ 'https://': new Error('offline') }) });
  assert.strictEqual(list.source, 'shipped');
  assert.ok(list.packs.length >= 37);
  assert.ok(list.packs.every((p) => p.docs.startsWith('https://webship.co/docs/webship-js/2.0.x/')));
  const upcoming = sp.shippedList().upcoming.map((p) => p.name);
  assert.ok(!list.packs.some((p) => upcoming.includes(p.name)), 'a pack that is not on npm yet is not offered');
  assert.ok(list.packs.some((p) => p.short === 'filament'), 'Filament is offered since its release on 2026-11-21');
  assert.ok(list.packs.some((p) => p.short === 'nextcloud'), 'Nextcloud is offered since its release on 2026-11-21');
  assert.ok(list.packs.some((p) => p.short === 'spring-boot'), 'Spring Boot is offered since its release on 2026-11-21');
});

test('add: the dev dependency at its release line, the glob after webship-js\'s own, written down for remove', () => {
  const dir = project();
  const r = sp.addPack(dir, pack('diffy'), { readme: "require: ['node_modules/@webship-js/diffy-steps/tests/step-definitions/**/*.js']" });
  assert.ok(r.ok, r.error);
  const pkg = JSON.parse(read(dir, 'package.json'));
  assert.match(pkg.devDependencies['@webship-js/diffy-steps'], /^\^2\.\d+\.0$/);
  assert.strictEqual(pkg.dependencies['webship-js'], '~2.0.0', 'nothing else moves');
  const src = read(dir, 'cucumber.js');
  const lines = src.split('\n');
  const core = lines.findIndex((l) => l.includes("'node_modules/webship-js/tests/step-definitions/**/*.js'"));
  assert.match(lines[core + 1], /^ {6}'node_modules\/@webship-js\/diffy-steps\/tests\/step-definitions\/\*\*\/\*\.js', \/\/ step pack: cmd-tools-testing\.sh --add-steps$/);
  assert.ok(lines[core + 2].includes("'tests/step-definitions/**/*.js'"), 'the project\'s own steps stay last');
  const rec = JSON.parse(read(dir, sp.RECORD));
  assert.deepStrictEqual(Object.keys(rec.packs), ['@webship-js/diffy-steps']);
  assert.ok(rec.packs['@webship-js/diffy-steps'].devDependency && rec.packs['@webship-js/diffy-steps'].require);
  assert.deepStrictEqual(loadConfig(dir).default.require[1], 'node_modules/@webship-js/diffy-steps/tests/step-definitions/**/*.js');
});

test('add is idempotent and never resets what a project already has', () => {
  const dir = project({ pkg: PACKAGE.replace('"webship-js": "~2.0.0"', '"webship-js": "~2.0.0",\n    "@webship-js/wordpress-steps": "2.2.1"') });
  sp.addPack(dir, pack('wordpress'));
  const once = [read(dir, 'package.json'), read(dir, 'cucumber.js')];
  assert.match(once[0], /"@webship-js\/wordpress-steps": "2\.2\.1"/, 'a range the project chose is kept');
  const r = sp.addPack(dir, pack('wordpress'));
  assert.deepStrictEqual(r.changed, []);
  assert.deepStrictEqual([read(dir, 'package.json'), read(dir, 'cucumber.js')], once, 'a second run changes nothing');
  const rec = JSON.parse(read(dir, sp.RECORD));
  assert.ok(!rec.packs['@webship-js/wordpress-steps'].devDependency, 'the dependency was not added here, so remove will not take it');
});

test('the glob comes from the pack\'s README when it names one, else the usual one', () => {
  const readme = "  require: [\n    'node_modules/@webship-js/astro-steps/tests/step-definitions/astro.steps.js',\n  ],";
  assert.strictEqual(sp.globFor('@webship-js/astro-steps', readme), 'node_modules/@webship-js/astro-steps/tests/step-definitions/astro.steps.js');
  assert.strictEqual(sp.globFor('@webship-js/astro-steps', ''), 'node_modules/@webship-js/astro-steps/tests/step-definitions/**/*.js');
  assert.strictEqual(sp.globFor('@webship-js/astro-steps', "'node_modules/@webship-js/astro-steps-extra/x.js'"),
    'node_modules/@webship-js/astro-steps/tests/step-definitions/**/*.js', 'another package\'s glob is not taken');
});

test('a second platform pack gets a profile of its own; any-site and an extension with its base share one', () => {
  const dir = project();
  const original = [read(dir, 'package.json'), read(dir, 'cucumber.js')];
  for (const short of ['wordpress', 'diffy', 'jira', 'drupal-cms', 'drupal-core']) {
    const r = sp.addPack(dir, pack(short));
    assert.ok(r.ok, `${short}: ${r.error}`);
  }
  const cfg = loadConfig(dir);
  assert.deepStrictEqual(Object.keys(cfg).sort(), ['default', 'drupal-core', 'jira']);
  const has = (profile, short) => cfg[profile].require.some((g) => g.includes(`/@webship-js/${short}-steps/`));
  assert.ok(has('default', 'wordpress') && has('default', 'diffy'), 'the first platform and the any-site pack share the default profile');
  assert.ok(!has('default', 'jira') && !has('default', 'drupal-core') && !has('default', 'drupal-cms'), 'no second platform in it');
  assert.ok(has('jira', 'jira') && !has('jira', 'wordpress'));
  assert.ok(has('drupal-core', 'drupal-cms') && has('drupal-core', 'drupal-core'), 'Drupal CMS goes with Drupal core');
  assert.strictEqual(cfg.jira.require[0], sp.CORE_GLOB, 'webship-js\'s own steps come first in a profile too');
  assert.deepStrictEqual(cfg.jira.paths, ['tests/features/jira-steps/**/*.feature']);
  assert.strictEqual(cfg.jira.worldParameters.launchUrl, 'https://jira.example', 'an address to fill in, not the default site\'s');
  assert.deepStrictEqual(cfg.jira.worldParameters.users, {}, 'no account invented');
  assert.strictEqual(cfg.jira.worldParameters.minWaitTime.page, 3000, 'the rest of the settings follow the default profile');
  // The default profile leaves the profiles' folders to them.
  assert.deepStrictEqual(cfg.default.paths[0], 'tests/features/*.feature');
  assert.match(cfg.default.paths[1], /^tests\/features\/!\((.+)\)\/\*\*\/\*\.feature$/);
  for (const f of ['jira-steps', 'drupal-core-steps', 'drupal-cms-steps']) assert.ok(cfg.default.paths[1].includes(f), f);
  // Which profile a feature runs in follows its folder.
  assert.strictEqual(sp.profileFor(dir, 'tests/features/jira-steps/board.feature'), 'jira');
  assert.strictEqual(sp.profileFor(dir, 'tests/features/drupal-cms-steps/canvas.feature'), 'drupal-core');
  assert.strictEqual(sp.profileFor(dir, 'tests/features/wordpress-steps/login.feature'), 'default');
  assert.strictEqual(sp.profileFor(dir, 'tests/features/site.feature'), 'default');

  // Removing every pack, in another order, gives back the files as they were, byte for byte.
  for (const short of ['drupal-core', 'jira', 'wordpress', 'drupal-cms', 'diffy']) sp.removePack(dir, sp.packName(short));
  assert.deepStrictEqual([read(dir, 'package.json'), read(dir, 'cucumber.js')], original);
  assert.ok(!fs.existsSync(path.join(dir, sp.RECORD)), 'the record goes with the last pack');
});

test('the default profile excludes a profile\'s folder in the glob cucumber-js expands', (t) => {
  // cucumber-js 13 expands paths with Node's own fs.glob, cucumber-js 12 with the glob package (13): in both
  // `!(…)` is an extglob, not a negation. Node 20 has no fs.glob; the job on Node 24 runs this.
  const glob = typeof fs.globSync === 'function' ? fs.globSync : null;
  if (!glob) { t.skip('this Node.js has no fs.globSync (Node 22 or later)'); return; }
  const dir = project();
  for (const f of ['site.feature', 'wordpress-steps/login.feature', 'jira-steps/board.feature', 'mine/deep/a.feature']) {
    fs.mkdirSync(path.dirname(path.join(dir, 'tests', 'features', f)), { recursive: true });
    fs.writeFileSync(path.join(dir, 'tests', 'features', f), 'Feature: x\n');
  }
  sp.addPack(dir, pack('wordpress'));
  sp.addPack(dir, pack('jira'));
  const cfg = loadConfig(dir);
  const run = (paths) => paths.flatMap((p) => glob(p, { cwd: dir })).map((f) => f.split(path.sep).join('/')).sort();
  assert.deepStrictEqual(run(cfg.default.paths), ['tests/features/mine/deep/a.feature', 'tests/features/site.feature', 'tests/features/wordpress-steps/login.feature']);
  assert.deepStrictEqual(run(cfg.jira.paths), ['tests/features/jira-steps/board.feature']);
});

test('remove takes out exactly what add put in, and nothing a plugin or a person added', () => {
  // The WordPress plugin's hook writes the same line without the mark.
  const dir = project({
    cucumber: SCAFFOLD.replace("      'tests/step-definitions/**/*.js',", "      'node_modules/@webship-js/wordpress-steps/tests/step-definitions/**/*.js',\n      'tests/step-definitions/**/*.js',"),
    pkg: PACKAGE.replace('"webship-js": "~2.0.0"', '"webship-js": "~2.0.0"').replace('}\n}', '},\n  "devDependencies": {\n    "@webship-js/wordpress-steps": "^2.2.0"\n  }\n}'),
  });
  const before = [read(dir, 'package.json'), read(dir, 'cucumber.js')];
  const r = sp.removePack(dir, '@webship-js/wordpress-steps');
  assert.deepStrictEqual(r.changed, []);
  assert.match(r.notes.join(' '), /did not add/);
  assert.deepStrictEqual([read(dir, 'package.json'), read(dir, 'cucumber.js')], before);
  // A pack added here beside it is taken out, and the plugin's stays.
  sp.addPack(dir, pack('diffy'));
  sp.removePack(dir, '@webship-js/diffy-steps');
  assert.deepStrictEqual([read(dir, 'package.json'), read(dir, 'cucumber.js')], before);
  // Not there at all.
  assert.match(sp.removePack(dir, '@webship-js/ghost-steps').notes.join(' '), /not in this project/);
});

test('examples: copied into tests/features/<pack>/, never over a file, and left behind on remove with the reason', () => {
  const dir = project();
  sp.addPack(dir, pack('diffy'));
  assert.strictEqual(sp.copyExamples(dir, '@webship-js/diffy-steps').code, 4, 'not installed: said so, nothing copied');
  install(dir, '@webship-js/diffy-steps', { features: { '01-demo.feature': 'Feature: demo\n', 'more/02-all.feature': 'Feature: all\n' } });
  fs.mkdirSync(path.join(dir, 'tests', 'features', 'diffy-steps'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'tests', 'features', 'diffy-steps', '01-demo.feature'), 'Feature: mine\n');
  const r = sp.copyExamples(dir, '@webship-js/diffy-steps');
  assert.deepStrictEqual(r.copied, ['more/02-all.feature']);
  assert.deepStrictEqual(r.kept, ['01-demo.feature']);
  assert.strictEqual(read(dir, 'tests/features/diffy-steps/01-demo.feature'), 'Feature: mine\n', 'a file that is there is never overwritten');
  assert.strictEqual(read(dir, 'tests/features/diffy-steps/more/02-all.feature'), 'Feature: all\n');
  const again = sp.copyExamples(dir, '@webship-js/diffy-steps');
  assert.deepStrictEqual(again.copied, [], 'a second run copies nothing');
  const gone = sp.removePack(dir, '@webship-js/diffy-steps');
  assert.match(gone.left.join(' '), /tests\/features\/diffy-steps\/ \(2 features\) stays/);
  assert.ok(fs.existsSync(path.join(dir, 'tests', 'features', 'diffy-steps', 'more', '02-all.feature')), 'features are the person\'s: remove leaves them');
});

test('examples bring the files their features use into tests/assets and tests/fixtures, never over one', () => {
  // wordpress-steps ships tests/assets/ (found by name there), the other packs tests/fixtures/ (named from the root).
  const dir = project();
  sp.addPack(dir, pack('wordpress'));
  install(dir, '@webship-js/wordpress-steps', { features: { 'media.feature': 'Feature: media\n' } });
  const at = path.join(dir, 'node_modules', '@webship-js', 'wordpress-steps');
  fs.mkdirSync(path.join(at, 'tests', 'assets'), { recursive: true });
  fs.writeFileSync(path.join(at, 'tests', 'assets', 'webshipco.png'), 'png');
  fs.mkdirSync(path.join(at, 'tests', 'fixtures', 'images'), { recursive: true });
  fs.writeFileSync(path.join(at, 'tests', 'fixtures', 'pixel.png'), 'pack pixel');
  fs.writeFileSync(path.join(at, 'tests', 'fixtures', 'images', 'b.png'), 'b');
  fs.mkdirSync(path.join(dir, 'tests', 'fixtures'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'tests', 'fixtures', 'pixel.png'), 'mine');
  const r = sp.copyExamples(dir, '@webship-js/wordpress-steps');
  assert.deepStrictEqual(r.copied, ['media.feature']);
  assert.deepStrictEqual(r.files, ['tests/assets/webshipco.png', 'tests/fixtures/images/b.png']);
  assert.deepStrictEqual(r.keptFiles, ['tests/fixtures/pixel.png']);
  assert.strictEqual(read(dir, 'tests/fixtures/pixel.png'), 'mine', 'a file that is there is never overwritten');
  assert.strictEqual(read(dir, 'tests/assets/webshipco.png'), 'png');
  const rec = JSON.parse(read(dir, sp.RECORD)).packs['@webship-js/wordpress-steps'];
  assert.ok(rec.examples.includes('tests/assets/webshipco.png') && !rec.examples.includes('tests/fixtures/pixel.png'), 'only what was copied is written down');
  // Removing the pack names them in what it leaves behind, and deletes none of them.
  const gone = sp.removePack(dir, '@webship-js/wordpress-steps');
  assert.match(gone.left.join(' '), /tests\/assets\/webshipco\.png, tests\/fixtures\/images\/b\.png \(the files its examples use\) stay as well/);
  assert.ok(fs.existsSync(path.join(dir, 'tests', 'assets', 'webshipco.png')));
});

test('settings a pack reads are named for the person to fill in, never invented', () => {
  const readme = "```js\nworldParameters: {\n  launchUrl: process.env.LAUNCH_URL,\n  minWaitTime: { page: 3000 },\n  users: {\n    admin: { username: 'admin', password: process.env.ADMIN_PASS },\n    'content editor': { username: 'editor' },\n  },\n  diffy: { projectId: 0, breakpoints: '640,1200' }, // or DIFFY_*\n  formTimeLimit: 5,\n}\n```";
  const dir = project();
  const r = sp.addPack(dir, pack('drupal-core'), { readme });
  const fill = Object.fromEntries(r.fill.map((f) => [f.key, f]));
  assert.deepStrictEqual(Object.keys(fill).sort(), ['diffy', 'formTimeLimit', 'users'], 'webship-js\'s own settings are not asked for');
  assert.deepStrictEqual(fill.users.missingUsers, ['admin', 'content editor']);
  assert.deepStrictEqual(fill.diffy.nested, ['projectId', 'breakpoints']);
  assert.ok(!/users\s*:/.test(read(dir, 'cucumber.js')), 'no account was written');
  // A project that sets them is not asked again.
  const set = project({ cucumber: SCAFFOLD.replace("      launchUrl:", "      users: { admin: {}, 'content editor': {} },\n      diffy: {},\n      formTimeLimit: 5,\n      launchUrl:") });
  assert.deepStrictEqual(sp.addPack(set, pack('drupal-core'), { readme }).fill, []);
});

test('the settings in the cucumber.js an installed pack ships count too', () => {
  const dir = project();
  install(dir, '@webship-js/joomla-steps', { version: '2.2.3', readme: 'No settings block in this README.' });
  fs.writeFileSync(path.join(dir, 'node_modules', '@webship-js', 'joomla-steps', 'cucumber.js'),
    "module.exports = { default: { worldParameters: { launchUrl: 'x', adminPath: '/administrator', users: { admin: {} } } } };\n");
  const r = sp.addPack(dir, pack('joomla'), { readme: 'No settings block in this README.' });
  assert.deepStrictEqual(r.fill.map((f) => f.key).sort(), ['adminPath', 'users']);
  assert.deepStrictEqual(r.fill.find((f) => f.key === 'users').missingUsers, ['admin']);
});

test('a cucumber.js that cannot take a pack stops with what to do, and changes nothing', () => {
  // One line of step files: nothing to insert a line into.
  const oneLine = project({ cucumber: "module.exports = { default: { require: ['node_modules/webship-js/tests/step-definitions/**/*.js'], paths: [] } };\n" });
  const r = sp.addPack(oneLine, pack('diffy'));
  assert.strictEqual(r.code, 3);
  assert.match(r.error, /Add this line to the require list of its default profile yourself/);
  assert.ok(!/diffy/.test(read(oneLine, 'package.json')), 'package.json is left alone too');
  // A second platform on a config with no default profile to build one on.
  const noDefault = project({ cucumber: "const p = {\n  require: [\n    'node_modules/@webship-js/wordpress-steps/tests/step-definitions/**/*.js',\n  ],\n};\nexport default p;\n" });
  const r2 = sp.addPack(noDefault, pack('jira'));
  assert.strictEqual(r2.code, 3);
  assert.match(r2.error, /needs a profile of its own/);
  assert.match(r2.error, /module\.exports\['jira'\]/, 'it shows the profile to write');
  // No stack at all.
  assert.match(sp.addPack(project({ cucumber: null }), pack('diffy')).error, /set testing up first/);
});

test('a suggestion: what the front page shows, the packs that fit, and nothing installed', async () => {
  const all = [...known.values()].map((m) => sp.describePack({ name: m.name }, known));
  const hits = (html, headers = {}) => sp.detectPacks({ html, headers }, all).map((h) => h.pack.short);
  assert.deepStrictEqual(hits('<meta name="generator" content="WordPress 6.8.3" />'), ['wordpress']);
  assert.deepStrictEqual(hits('<meta content="Drupal 11 (https://www.drupal.org)" name="Generator">'), ['drupal-core']);
  assert.deepStrictEqual(hits('<link rel="stylesheet" href="/vendor/bootstrap/css/bootstrap.min.css">'), ['bootstrap']);
  assert.deepStrictEqual(hits('<script src="/js/bootstrap.bundle.min.js?v=5"></script>'), ['bootstrap']);
  assert.deepStrictEqual(hits('<html></html>', { 'x-powered-by': 'Craft CMS' }), ['craft-cms']);
  assert.deepStrictEqual(hits('<html><body>Hello</body></html>'), []);

  const dir = project();
  const before = [read(dir, 'package.json'), read(dir, 'cucumber.js')];
  const list = all.filter((p) => p.short !== 'bootstrap');   // a pack missing from the list (not on npm) is never offered
  let asked = '';
  const s = await sp.suggestFor(dir, { list, fetchPage: async (u) => { asked = u; return { status: 200, headers: {}, html: '<meta name="generator" content="WordPress 6.8"><link href="/bootstrap.min.css" rel="stylesheet">' }; } });
  assert.strictEqual(asked, 'https://stepsdemo.ddev.site/');
  assert.deepStrictEqual(s.hits.map((h) => h.pack.short), ['wordpress']);
  assert.match(s.hits[0].evidence, /generator meta tag says "WordPress 6\.8"/);
  assert.deepStrictEqual([read(dir, 'package.json'), read(dir, 'cucumber.js')], before, 'a suggestion changes nothing');
  // A pack the project has is not suggested again; a site that cannot be reached suggests nothing.
  sp.addPack(dir, pack('wordpress'));
  assert.deepStrictEqual((await sp.suggestFor(dir, { list, fetchPage: async () => ({ status: 200, headers: {}, html: '<meta name="generator" content="WordPress 6.8">' }) })).hits, []);
  assert.deepStrictEqual((await sp.suggestFor(dir, { list, fetchPage: async () => { throw new Error('ECONNREFUSED'); } })).hits, []);
});

test('a project with its platform pack is offered no other platform pack, but extensions and any-site packs still (#526)', async () => {
  const all = [...known.values()].map((m) => sp.describePack({ name: m.name }, known));
  const shorts = (s) => s.hits.map((h) => h.pack.short).sort();
  const nextApp = async () => ({ status: 200, headers: {}, html: '<script src="/_next/static/chunks/main.js"></script><link href="/bootstrap.min.css" rel="stylesheet">' });
  // A Next.js app with no pack yet: the Next.js pack and Bootstrap fit.
  assert.deepStrictEqual(shorts(await sp.suggestFor(project(), { list: all, fetchPage: nextApp })), ['bootstrap', 'nextjs']);
  // An app built on Next.js whose platform plugin added its own pack from a tarball, before the pack is listed.
  const app = project({ pkg: PACKAGE.replace('"webship-js": "~2.0.0"', '"webship-js": "~2.0.0",\n    "@webship-js/payload-steps": "file:tests/step-packs/webship-js-payload-steps-2.0.0-1a2b3c.tgz"') });
  assert.deepStrictEqual(shorts(await sp.suggestFor(app, { list: all, fetchPage: nextApp })), ['bootstrap']);
  // A WordPress project with its pack: WooCommerce, an extension of WordPress, is still offered.
  const wp = project(); sp.addPack(wp, pack('wordpress'));
  const shop = async () => ({ status: 200, headers: {}, html: '<meta name="generator" content="WordPress 6.8"><body class="woocommerce-page">' });
  assert.deepStrictEqual(shorts(await sp.suggestFor(wp, { list: all, fetchPage: shop })), ['woocommerce']);
});

test('the project state the panel and --list-steps read', () => {
  const dir = project();
  sp.addPack(dir, pack('wordpress'));
  sp.addPack(dir, pack('jira'));
  install(dir, '@webship-js/wordpress-steps', { version: '2.2.4' });
  const st = sp.projectState(dir);
  assert.strictEqual(st.stack, 'webship-js');
  assert.strictEqual(st.packs['@webship-js/wordpress-steps'].installed, '2.2.4');
  assert.strictEqual(st.packs['@webship-js/wordpress-steps'].profile, 'default');
  assert.strictEqual(st.packs['@webship-js/jira-steps'].profile, 'jira');
  assert.strictEqual(st.packs['@webship-js/jira-steps'].installed, '');
  assert.ok(st.packs['@webship-js/jira-steps'].ours);
  assert.deepStrictEqual(st.profiles.map((p) => p.name), ['jira']);
  assert.deepStrictEqual(sp.notInstalled(dir), ['@webship-js/jira-steps']);
  assert.strictEqual(sp.projectState(project({ cucumber: null, pkg: null })).stack, 'none');
});

test('cmd-tools-testing.sh: the options, and the verbs they reach', () => {
  const args = fs.readFileSync(path.join(REPO, 'core/scripts/args/arg-testing.sh'), 'utf8');
  for (const o of ["'--list-steps'", "'--add-steps'", "'--remove-steps'", "'--examples'", "'--profile'"]) assert.ok(args.includes(o), o);
  const fun = fs.readFileSync(path.join(REPO, 'core/scripts/functions/fun-testing.sh'), 'utf8');
  for (const verb of ['list', 'add', 'remove', 'examples', 'suggest', 'missing', 'profile-for', 'profiles']) {
    assert.match(fun, new RegExp(`node "\\$\\{TESTING_STEP_PACKS_JS\\}" ${verb} `), verb);
  }
  // npm install runs in the project's container, never on this machine.
  assert.match(fun, /ddev \$\{runner\} install ;/);
  assert.ok(!/^\s*npm install/m.test(fun), 'no npm install on the host');
  // A step verb alone does not set the stack up again.
  assert.match(fun, /\[ "\$\{steps\}" == 'no' \]/);
});
