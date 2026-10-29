/**
 * Putting a database back: the other half of Export the database.
 *
 * The row could dump a database into the workspace's backups folder and never put one back, so every
 * dump it wrote was a one-way trip. Two things make a naive version of this dangerous, and both are
 * why the module exists: that folder also holds whole-project tarballs, which `ddev import-db` would
 * accept as if they were SQL; and importing replaces every table in a database that is often the only
 * copy of an afternoon's work.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const imp = require('../../ddev-import');

const APP = path.join(__dirname, '../..');
const actions = fs.readFileSync(path.join(APP, 'actions/ddev.js'), 'utf8');

function backups(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-dump-'));
  for (const f of files) fs.writeFileSync(path.join(dir, f), 'x');
  return dir;
}

test('a dump is listed; a whole-project archive is not', () => {
  // `ddev import-db` accepts .tar.gz, .tgz and .zip — and in this folder those are archives of an
  // entire project. Offering one would hand a tarball of a site to the database.
  const dir = backups([
    'ruverify1--db--2026-09-23-10-12.sql.gz',
    'dev---vp1107lock--2026-09-09_01-02-41-db.sql.gz',
    'dev---vp1107lock--2026-09-09_01-02-41.tar.gz',
    'dev---v11x00b1canvasicon--2026-09-13_17-45-34.tar.gz',
    'notes.txt',
    '.hidden.sql',
  ]);
  const names = imp.listDumps(dir).map((d) => d.name);
  assert.deepEqual(names.sort(), [
    'dev---vp1107lock--2026-09-09_01-02-41-db.sql.gz',
    'ruverify1--db--2026-09-23-10-12.sql.gz',
  ]);
  for (const ext of ['a.sql', 'b.sql.gz', 'c.sql.bz2', 'd.sql.xz', 'e.mysql', 'f.mysql.gz']) {
    assert.ok(imp.DUMP_RE.test(ext), ext);
  }
  for (const no of ['x.tar.gz', 'x.tgz', 'x.zip', 'x.txt', 'x.sql.zip']) {
    assert.equal(imp.DUMP_RE.test(no), false, no);
  }
});

test('the dump is named by basename, and matched against what is there', () => {
  const dir = backups(['real--db--2026.sql.gz']);
  assert.ok(imp.findDump(dir, 'real--db--2026.sql.gz'));
  assert.equal(imp.findDump(dir, 'invented.sql.gz'), null);
  // A name carrying a directory is refused before anything is compared, let alone joined.
  for (const bad of ['../../../etc/passwd', 'sub/real--db--2026.sql.gz', '/etc/passwd', '']) {
    assert.equal(imp.findDump(dir, bad), null, bad);
  }
});

test('a snapshot is taken first, in the same line', () => {
  // `&&`, not `;` — nothing is imported if the snapshot fails. The same shape `drush sql:drop`
  // already uses before it drops. Verified live: the import left `before-import-2026-09-23-10-12`
  // behind, and said so.
  const fn = actions.slice(actions.indexOf('async function ddev_import_db'));
  assert.match(fn, /ddev snapshot --name before-import-\$\{stamp\}`\s*\n\s*\+ ` && ddev import-db --file/);
  assert.match(fn, /The database as it was is the snapshot before-import-/);
  assert.match(fn, /if \(form\.confirm !== 'yes'\)/, 'and it is confirmed');
  assert.match(fn, /ddevImport\.findDump\(backupsDir, form\.dump\)/, 'against the workspace\'s own folder');
});

test('the panel says what importing costs, and what it will not offer', () => {
  const html = imp.importPanelHtml({
    workspace: 'test', project: 'demo', backupsDir: backups(['a--db--1.sql.gz']), backupsLabel: '~/workspace/backups/test',
  });
  assert.match(html, /Importing <strong>replaces<\/strong>/);
  assert.match(html, /A snapshot is taken first/);
  assert.match(html, /Whole-project archives/);
  assert.match(html, /hx-trigger="confirmed-remove"/);
  assert.match(html, /~\/workspace\/backups\/test/, 'and where it is looking');
});
