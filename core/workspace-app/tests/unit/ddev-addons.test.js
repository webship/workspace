/**
 * DDEV add-ons: what a project has, and what it could.
 *
 * An add-on is a repository DDEV copies into a project — a service (`ddev-redis`), a tool
 * (`ddev-adminer`), a whole development setup (`ddev-drupal-contrib`). There are 287 in the registry
 * and no way to reach any of them from here except a terminal.
 *
 * The one thing this feature must not get wrong: `ddev add-on get` installs from a URL or a local
 * path as happily as from a repository, so it is a download-and-run from anywhere. A name that
 * arrives from a browser is checked against the registry LISTING, not merely against a pattern.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const addons = require('../../ddev-addons');

const APP = path.join(__dirname, '../..');
const server = fs.readFileSync(path.join(APP, 'server.js'), 'utf8');
const page = fs.readFileSync(path.join(APP, 'ddev-addons-page.js'), 'utf8');
const actions = fs.readFileSync(path.join(APP, 'actions/ddev-addons.js'), 'utf8');

/** A project with the metadata DDEV writes when it installs one. */
function project(installed = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-addon-'));
  fs.mkdirSync(path.join(dir, '.ddev', 'addon-metadata'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.ddev', 'config.yaml'), 'name: demo\ntype: drupal\n');
  for (const [name, meta] of Object.entries(installed)) {
    const d = path.join(dir, '.ddev', 'addon-metadata', name);
    fs.mkdirSync(d, { recursive: true });
    // The real shape, copied from an actual install of ddev/ddev-adminer.
    fs.writeFileSync(path.join(d, 'manifest.yaml'),
      `name: ${name}\nrepository: ${meta.repository}\nversion: ${meta.version}\n`
      + `install_date: "${meta.date}"\nproject_files:\n    - docker-compose.${name}.yaml\n    - commands/host/${name}\nglobal_files: []\n`);
  }
  return dir;
}

test('installed add-ons are read from what DDEV recorded', () => {
  // `.ddev/addon-metadata/<name>/manifest.yaml`, so listing them is a readdir and a project row
  // costs no subprocess.
  const dir = project({
    adminer: { repository: 'ddev/ddev-adminer', version: 'v1.4.1', date: '2026-09-23T13:02:17+03:00' },
    redis: { repository: 'ddev/ddev-redis', version: 'v2.2.0', date: '2026-09-23T14:10:00+03:00' },
  });
  const list = addons.installedAddons(dir);
  assert.deepEqual(list.map((a) => a.name), ['redis', 'adminer'], 'newest first');
  assert.equal(list[1].repository, 'ddev/ddev-adminer');
  assert.equal(list[1].version, 'v1.4.1');
  assert.deepEqual(list[1].files, ['docker-compose.adminer.yaml', 'commands/host/adminer'],
    'what it owns, which is what removing it takes away');
  assert.deepEqual(addons.installedAddons(project()), [], 'a project with none says none');
  assert.deepEqual(addons.installedAddons('/no/such/project'), []);
});

test('only an owner/repo shape is even considered', () => {
  // The rest of what `ddev add-on get` accepts is a download-and-run from anywhere.
  for (const bad of ['https://example.com/x.tar.gz', '../../etc', '/tmp/evil', 'no-slash', 'a//b', '']) {
    assert.equal(addons.ADDON_RE.test(bad), false, bad);
  }
  for (const good of ['ddev/ddev-redis', 'Lullabot/ddev-playwright', 'a.b/c_d-e']) {
    assert.ok(addons.ADDON_RE.test(good), good);
  }
});

test('the registry is the allowlist, and an unreadable one installs nothing', async () => {
  // Verified against the live registry too: `evil/not-a-real-addon` is refused by name, and
  // `ddev/ddev-redis` is accepted.
  const fn = actions;
  assert.match(fn, /const known = await addons\.isKnownAddon\(repo\);/);
  assert.match(fn, /if \(!known\.ok\) return send/);
  const mod = fs.readFileSync(path.join(APP, 'ddev-addons.js'), 'utf8');
  assert.match(mod, /if \(!reg\.list \|\| !reg\.list\.length\) \{\s*\n\s*return \{ ok: false/,
    'a registry that could not be read refuses everything');
});

test('the registry comes from the topic, not from the table that truncates', () => {
  // `ddev add-on list` renders a table and truncates 38 of the 294 names with `…`; a truncated name
  // cannot be installed. The registry IS the GitHub topic, so that is what is asked.
  const mod = fs.readFileSync(path.join(APP, 'ddev-addons.js'), 'utf8');
  assert.match(mod, /const REGISTRY_TOPIC = 'ddev-get';/);
  assert.match(mod, /run\('gh', \['search', 'repos', '--topic', REGISTRY_TOPIC/);
  // And when it falls back to the table, a truncated row says so instead of offering a button.
  assert.match(mod, /truncated: m\[1\]\.includes\('…'\)/);
  assert.match(page, /name truncated/);
  assert.match(page, /installButton\(r\.repo, vals, !r\.truncated\)/);
});

test('searching covers the description, the way ddev add-on search does', () => {
  const list = [
    { repo: 'ddev/ddev-solr', description: 'Apache Solr for DDEV' },
    { repo: 'ddev/ddev-redis', description: 'Redis caching' },
    { repo: 'someone/ddev-thing', description: 'Uses Solr under the hood' },
  ];
  assert.deepEqual(addons.searchAddons(list, 'solr').map((r) => r.repo), ['ddev/ddev-solr', 'someone/ddev-thing']);
  assert.deepEqual(addons.searchAddons(list, 'REDIS').map((r) => r.repo), ['ddev/ddev-redis'], 'case does not matter');
  assert.equal(addons.searchAddons(list, '').length, 3, 'an empty search is not a filter');
});

test('removing and updating name something this project actually has', () => {
  assert.match(actions, /const found = installed\.find\(\(a\) => a\.name === name\);/);
  assert.match(actions, /is not installed in this project/);
  // Removing takes files out of the project, so it is confirmed — in the handler, not only in the markup.
  assert.match(actions, /if \(removing && form\.confirm !== 'yes'\)/);
  assert.match(page, /hx-trigger="confirmed-remove"/);
});

test('a recommendation that the registry does not list says THAT, not "truncated"', () => {
  // Found by opening the panel: `ddev/ddev-playwright` does not exist — the maintained one is
  // Lullabot's — and the row said "name truncated", which is a different problem and sent me looking
  // in the wrong place. Two reasons, two messages.
  assert.match(page, /why === 'unknown'/);
  assert.match(page, /not in the registry/);
  assert.match(page, /installButton\(r\.repo, vals, !!known, 'unknown'\)/, 'a recommendation is checked as a name');
  assert.match(page, /installButton\(r\.repo, vals, !r\.truncated\)/, 'a registry row is checked as a truncation');
  // And the name itself is fixed. Every recommendation was checked against the live registry.
  assert.ok(addons.RECOMMENDED.some((r) => r.repo === 'Lullabot/ddev-playwright'));
  assert.ok(!addons.RECOMMENDED.some((r) => r.repo === 'ddev/ddev-playwright'));
});

test('each recommendation says what it is for', () => {
  // A list of eight repository names is a shelf; the reason is what makes it a recommendation.
  assert.ok(addons.RECOMMENDED.length >= 6);
  for (const r of addons.RECOMMENDED) {
    assert.ok(addons.ADDON_RE.test(r.repo), r.repo);
    assert.ok(r.why && r.why.length > 30, `${r.repo} says why`);
  }
  // And one already installed is not offered again.
  assert.match(page, /RECOMMENDED\.filter\(\(r\) => !have\.has\(r\.repo\.toLowerCase\(\)\)\)/);
});

test('the panel is its own module, and the route only resolves the project', () => {
  // One module per area, like the commands and navigation pages: what a panel looks like is one file
  // to open, and server.js stays a router.
  assert.match(server, /const \{ addonsPanelHtml \} = require\('\.\/ddev-addons-page'\);/);
  assert.match(server, /const html = await addonsPanelHtml\(\{/);
  assert.match(server, /\.\.\.require\('\.\/actions\/ddev-addons'\),/);
  assert.match(page, /module\.exports = \{ addonsPanelHtml, PER_PAGE \};/);
  // Installing writes into .ddev and does nothing until a restart — the panel says so.
  assert.match(page, /needs a\s*\n\s*<strong>ddev restart<\/strong>/);
});
