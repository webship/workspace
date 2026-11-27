/**
 * Putting a database back: the other half of Export the database.
 *
 * The row could dump a database into the workspace's backups folder and never put one back, so every
 * dump it wrote was a one-way trip. Two things make a naive version of this dangerous, and both are
 * why the module exists: that folder also holds whole-project tarballs, which `ddev import-db` would
 * accept as if they were SQL; and importing replaces every table in a database that is often the only
 * copy of an afternoon's work.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as imp from '../../ddev-import.mts';
import { createRequire } from 'node:module';

const APP = path.join(import.meta.dirname, '../..');
const actions = fs.readFileSync(path.join(APP, 'actions/ddev.js'), 'utf8');

function backups(files: readonly string[]): string {
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
  assert.match(fn, /ddev snapshot --name before-import-\$\{stamp\}`\s*\n\s*\+ ` && \$\{dbImport\}`/);
  // The import is the core's (#968): project-db.sh import, in the project's folder, the dump's path quoted.
  assert.match(fn, /const dbImport = projectDb\.importLine\(shq\(file\)\);/);
  assert.doesNotMatch(fn, /` && ddev import-db --file/, 'no ddev import-db built here any more');
  assert.match(fn, /The database as it was is the snapshot before-import-/);
  assert.match(fn, /if \(form\.confirm !== 'yes'\)/, 'and it is confirmed');
  assert.match(fn, /ddevImport\.findDump\(backupsDir, form\.dump(, own)?\)/, 'against the workspace\'s own folder');
});

// A platform whose plugin keeps the project's database (webship/workspace#937): its own dumps, of this project, in its
// own format or as SQL; never another project's, never an archive.
test('a platform that keeps its database: the panel lists its own dumps of the project, and says who keeps it', () => {
  const dir = backups([
    'dev---fapp--2026-11-26_10-00-00-db.dump',
    'fapp--db--2026-11-26-10-05.dump',
    'fapp--db--before-import-2026-11-26-10-06-00.sql.gz',
    'dev---fapp--2026-11-26_10-00-00.tar.gz',
    'dev---other--2026-11-26_10-00-00-db.dump',
    'other--db--2026-11-26-10-05.sql.gz',
    'fapp-notes.dump.txt',
  ]);
  const own = { project: 'fapp', extension: '.dump' };
  assert.deepEqual(imp.listDumps(dir, own).map((d) => d.name).sort(), [
    'dev---fapp--2026-11-26_10-00-00-db.dump',
    'fapp--db--2026-11-26-10-05.dump',
    'fapp--db--before-import-2026-11-26-10-06-00.sql.gz',
  ]);
  assert.equal(imp.findDump(dir, 'dev---other--2026-11-26_10-00-00-db.dump', own), null, 'another project\'s dump');
  assert.equal(imp.findDump(dir, 'dev---fapp--2026-11-26_10-00-00.tar.gz', own), null, 'an archive');
  assert.ok(imp.findDump(dir, 'fapp--db--2026-11-26-10-05.dump', own));
  // Without a platform the list is as it was: every SQL dump of the workspace, no .dump.
  assert.deepEqual(imp.listDumps(dir).map((d) => d.name).sort(), [
    'fapp--db--before-import-2026-11-26-10-06-00.sql.gz',
    'other--db--2026-11-26-10-05.sql.gz',
  ]);
  const html = imp.importPanelHtml({ workspace: 'dev', project: 'fapp', backupsDir: dir, backupsLabel: '~/backups/dev', platform: 'fastapi', extension: '.dump' });
  assert.match(html, /kept by the <strong>fastapi<\/strong> plugin, which checks that a dump is whole/);
  assert.match(html, /exported into this list first/);
  assert.match(html, /hx-post="\/actions\/ddev-import-db"/);
  assert.match(html, /fapp--db--2026-11-26-10-05\.dump/);
  assert.doesNotMatch(html, /other--db--/);
  assert.match(html, /These are the dumps of fapp in/);
});

test('a platform that keeps its database: the import exports first and imports through its plugin, by the runtime layer', () => {
  const fn = actions.slice(actions.indexOf('async function ddev_import_db'));
  assert.match(fn, /if \(!db\.database\) return send\(/, 'a project with no database is told so');
  assert.match(fn, /if \(db\.platform\) \{[\s\S]*?verbLine\(\['export-db', shq\(`--file=\$\{before\}`\)\]\)[\s\S]*?verbLine\(\['import-db', shq\(`--file=\$\{file\}`\)\]\)/);
  assert.match(fn, /`echo "Exporting the database first \(the \$\{db\.platform\} plugin keeps it\)…" && \$\{exportLine\}`\s*\n\s*\+ ` && echo "Importing/, '&&: nothing is imported unless the export worked');
  // The DDEV path without a platform is the one it was.
  assert.match(fn, /let cmdLine = `echo "Taking a snapshot first…" && ddev snapshot --name before-import-\$\{stamp\}`/);
});

test('the row\'s Import line is the core\'s import script, with the dump\'s path quoted (#968)', () => {
  const projectDb = createRequire(import.meta.url)('../../project-db.js');
  const prev = process.env.WORKSPACE_PROJECT_DB_SCRIPT;
  try {
    process.env.WORKSPACE_PROJECT_DB_SCRIPT = '/ws/core/scripts/project-db.sh';
    assert.equal(projectDb.importLine("'/ws/backups/dev/a b.sql.gz'"), "bash '/ws/core/scripts/project-db.sh' import '/ws/backups/dev/a b.sql.gz'");
    process.env.WORKSPACE_PROJECT_DB_SCRIPT = '/ws/my scripts/project-db.sh';
    assert.equal(projectDb.importLine("'x.sql.gz'"), '', 'a path a shell line cannot carry safely: no line');
  } finally {
    if (prev === undefined) delete process.env.WORKSPACE_PROJECT_DB_SCRIPT; else process.env.WORKSPACE_PROJECT_DB_SCRIPT = prev;
  }
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
