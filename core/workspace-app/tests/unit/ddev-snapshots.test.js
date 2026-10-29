/**
 * Database snapshots: taking one was all the row could do.
 *
 * There was a "Take a snapshot" item and nothing else — no list, no restore, no way to remove one. A
 * backup nobody can restore is a file, and restoring is the whole point of a snapshot: it is a
 * physical copy of the database's own files, so it goes back in seconds where a SQL dump is replayed
 * statement by statement. Measured through the dashboard on a real project: restored in 41s.
 *
 * Two facts shape the whole feature, both from DDEV's own behaviour:
 *   - a snapshot belongs to a database engine AND version, and will not restore into another;
 *   - restoring REPLACES the database — no merge, no undo.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const snaps = require('../../ddev-snapshots');

const APP = path.join(__dirname, '../..');
const server = fs.readFileSync(path.join(APP, 'server.js'), 'utf8');
const actions = fs.readFileSync(path.join(APP, 'actions/ddev.js'), 'utf8');
const ddev = fs.readFileSync(path.join(APP, 'ddev.js'), 'utf8');

/** A project with snapshots of the shape DDEV writes: `<name>-<engine>_<version>.<ext>`. */
function project({ dbType = 'mariadb', dbVersion = '11.8' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-snap-'));
  fs.mkdirSync(path.join(dir, '.ddev', 'db_snapshots'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.ddev', 'config.yaml'),
    `name: demo\ntype: drupal\ndatabase:\n  type: ${dbType}\n  version: "${dbVersion}"\nwebserver_type: nginx-fpm\n`);
  return dir;
}
const put = (dir, file, bytes = 10) =>
  fs.writeFileSync(path.join(dir, '.ddev', 'db_snapshots', file), Buffer.alloc(bytes));

test('a snapshot is read off disk, engine and version and all', () => {
  // From a real one taken on a real project: `zz-claude-probe-mariadb_11.8.zst`.
  const dir = project();
  put(dir, 'before-updb-mariadb_11.8.zst', 1024);
  const [one] = snaps.listSnapshots(dir);
  assert.equal(one.name, 'before-updb');
  assert.equal(one.dbVersion, 'mariadb_11.8');
  assert.equal(one.compression, 'zstd');
  assert.equal(one.size, 1024);
  assert.ok(one.mtime instanceof Date);
});

test('a name with dashes in it survives the parse', () => {
  // The engine and version are the LAST two pieces, so a name that has its own dashes — which is most
  // of them — must not be cut at the first one.
  const dir = project();
  put(dir, 'before-the-2026-09-22-config-import-mariadb_11.8.zst');
  assert.equal(snaps.listSnapshots(dir)[0].name, 'before-the-2026-09-22-config-import');
});

test('an uncompressed snapshot is a folder, and it is still a snapshot', () => {
  const dir = project();
  const folder = path.join(dir, '.ddev', 'db_snapshots', 'plain-mariadb_11.8');
  fs.mkdirSync(folder);
  fs.writeFileSync(path.join(folder, 'ibdata1'), Buffer.alloc(2048));
  const [one] = snaps.listSnapshots(dir);
  assert.equal(one.name, 'plain');
  assert.equal(one.compression, 'none');
  assert.equal(one.size, 2048, 'its size is what is inside it');
});

test('newest first, and nothing that is not a snapshot', () => {
  const dir = project();
  put(dir, 'old-mariadb_11.8.zst');
  put(dir, 'new-mariadb_11.8.zst');
  fs.utimesSync(path.join(dir, '.ddev', 'db_snapshots', 'old-mariadb_11.8.zst'), new Date(0), new Date(0));
  put(dir, 'README.txt');
  put(dir, '.keep');
  assert.deepEqual(snaps.listSnapshots(dir).map((s) => s.name), ['new', 'old']);
  assert.deepEqual(snaps.listSnapshots(project()).map((s) => s.name), [], 'a project with none says none');
});

test('a snapshot from another engine or version cannot restore here, and says both', () => {
  // DDEV refuses it; the row says so first, because its refusal otherwise arrives inside a screen
  // session somebody has to open to read.
  const dir = project({ dbVersion: '11.8' });
  put(dir, 'ours-mariadb_11.8.zst');
  put(dir, 'theirs-mariadb_10.11.zst');
  put(dir, 'postgres-postgres_16.zst');
  const version = snaps.projectDbVersion(dir);
  assert.equal(version, 'mariadb_11.8');
  assert.equal(snaps.restorable(snaps.findSnapshot(dir, 'ours'), version).ok, true);
  const no = snaps.restorable(snaps.findSnapshot(dir, 'theirs'), version);
  assert.equal(no.ok, false);
  assert.match(no.why, /mariadb_10\.11/);
  assert.match(no.why, /mariadb_11\.8/, 'and what the project actually runs');
  assert.equal(snaps.restorable(snaps.findSnapshot(dir, 'postgres'), version).ok, false);
  // An unknown project version is not a reason to refuse: DDEV is the judge then.
  assert.equal(snaps.restorable(snaps.findSnapshot(dir, 'theirs'), '').ok, true);
});

test('a name from the browser is checked against what is on disk', () => {
  const dir = project();
  put(dir, 'real-mariadb_11.8.zst');
  assert.ok(snaps.findSnapshot(dir, 'real'));
  assert.equal(snaps.findSnapshot(dir, 'invented'), null);
  // And the pattern refuses a path before the lookup ever runs.
  for (const bad of ['../../etc/passwd', 'a/b', '.hidden', '']) {
    assert.equal(snaps.SNAPSHOT_NAME_RE.test(bad), false, bad);
  }
  for (const good of ['before-updb', 'v11.8_check', 'X']) assert.ok(snaps.SNAPSHOT_NAME_RE.test(good), good);
});

test('restore takes the name positionally; taking and cleaning take --name', () => {
  // Given `--name`, `ddev snapshot restore` prints its help and the screen log reads like a crash.
  // Found by running it.
  const named = actions.slice(actions.indexOf('if (act.named)'), actions.indexOf('const removed', actions.indexOf('if (act.named)')) || undefined);
  assert.match(named, /args = \[\.\.\.args, raw\];/);
  assert.match(named, /args = \[\.\.\.args, '--name', raw\];/);
  assert.match(ddev, /'\/actions\/ddev-snapshot-restore':[^\n]*args: \['snapshot', 'restore'\]/);
  assert.match(ddev, /'\/actions\/ddev-snapshot-delete':[^\n]*args: \['snapshot', '--cleanup', '-y'\]/);
});

test('restoring and deleting are destructive, and are treated as such', () => {
  // The guard is in the handler, not only in the markup: the dashboard is not the only door.
  assert.match(ddev, /'\/actions\/ddev-snapshot-restore':[^\n]*destructive: true/);
  assert.match(ddev, /'\/actions\/ddev-snapshot-delete':[^\n]*destructive: true/);
  // A restore of a large database takes minutes, so it runs in a screen and can be watched.
  assert.match(ddev, /'\/actions\/ddev-snapshot-restore':[^\n]*inScreen: true/);
  // And the buttons go through the confirm dialog. The rows are built above the heading, so the
  // slice starts where the fragment does.
  const frag = server.slice(server.indexOf("const sn = pathname.match(/^\\/fragments\\/projects\\/snapshots"));
  const rows = frag.slice(0, frag.indexOf('Snapshots of'));
  assert.equal((rows.match(/hx-trigger="confirmed-remove"/g) || []).length, 2, 'restore and delete both ask');
  assert.match(rows, /arm-step/);
});

test('the modal says what a snapshot is, and what restoring costs', () => {
  const modal = server.slice(server.indexOf('<h3 class="uk-margin-small-bottom">Snapshots of'), server.indexOf('} }', server.indexOf('Snapshots of')));
  assert.match(modal, /physical copy of the database's own files/);
  assert.match(modal, /Restoring <strong>replaces<\/strong>/);
  assert.match(modal, /will not restore into it/, 'the engine-and-version rule, before it bites');
  assert.match(modal, /\.ddev\/db_snapshots\//, 'and where they live');
  assert.match(modal, /Taking one of a stopped\n                project starts it first/, 'observed, and worth not springing on anyone');
});
