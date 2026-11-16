/**
 * Restore imports the dump beside a project's archive — but never an empty one.
 *
 * A site that runs without a database (Astro, Gatsby: `omit_containers: [db]`) was backed up with an
 * archive and a 0-byte `-db.sql.gz`: `ddev export-db` opens its file before it finds there is no
 * database. Restore then ran `ddev import-db --file=<that file>`, which ends with "failed to extract
 * provided file: EOF" and the command's help, so a restore that had put every file back read as a
 * failure (#354, round 4 of the testing rounds, on a Gatsby site).
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { dumpBeside } = require('../../restore-dump');

const ARCHIVE = 'dev---site1--2026-11-16_16-29-36.tar.gz';

function backups(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-restore-'));
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body);
  return dir;
}

test('a dump with something in it is the one imported', () => {
  const dir = backups({ [ARCHIVE]: 'x', 'dev---site1--2026-11-16_16-29-36-db.sql.gz': 'gz' });
  assert.deepStrictEqual(dumpBeside(dir, ARCHIVE), { file: path.join(dir, 'dev---site1--2026-11-16_16-29-36-db.sql.gz'), empty: null });
});

test('an uncompressed dump is taken when there is no .sql.gz', () => {
  const dir = backups({ [ARCHIVE]: 'x', 'dev---site1--2026-11-16_16-29-36-db.sql': '-- sql' });
  assert.strictEqual(dumpBeside(dir, ARCHIVE).file, path.join(dir, 'dev---site1--2026-11-16_16-29-36-db.sql'));
});

test('an empty dump is not imported, and is named', () => {
  const dir = backups({ [ARCHIVE]: 'x', 'dev---site1--2026-11-16_16-29-36-db.sql.gz': '' });
  assert.deepStrictEqual(dumpBeside(dir, ARCHIVE), { file: null, empty: 'dev---site1--2026-11-16_16-29-36-db.sql.gz' });
});

test('an empty .sql.gz does not hide a .sql that has the database', () => {
  const dir = backups({ [ARCHIVE]: 'x', 'dev---site1--2026-11-16_16-29-36-db.sql.gz': '', 'dev---site1--2026-11-16_16-29-36-db.sql': '-- sql' });
  assert.strictEqual(dumpBeside(dir, ARCHIVE).file, path.join(dir, 'dev---site1--2026-11-16_16-29-36-db.sql'));
});

test('no dump at all: nothing to import and nothing to say', () => {
  const dir = backups({ [ARCHIVE]: 'x' });
  assert.deepStrictEqual(dumpBeside(dir, ARCHIVE), { file: null, empty: null });
});

test('the restore action takes its dump from dumpBeside and says when the dump is empty', () => {
  const server = fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8');
  const restore = server.slice(server.indexOf("pathname === '/actions/restore'"), server.indexOf("pathname === '/actions/backup-delete'"));
  assert.match(restore, /require\('\.\/restore-dump'\)\.dumpBeside\(meta\.backupsDir, file\)/);
  assert.doesNotMatch(restore, /fs\.existsSync\(f\)\)/, 'a dump is no longer taken because it merely exists');
  assert.match(restore, /is empty: the project had no database to export when it was backed up/);
});

test('a restored DDEV project with no database to import is still started, as one with a dump is', () => {
  const server = fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8');
  const restore = server.slice(server.indexOf("pathname === '/actions/restore'"), server.indexOf("pathname === '/actions/backup-delete'"));
  const noDump = restore.slice(restore.indexOf('} else {'), restore.indexOf('return screenAction'));
  assert.match(noDump, /if \[ -f '\$\{targetDir\}\/\.ddev\/config\.yaml' \]; then cd '\$\{targetDir\}' && ddev start -y; fi/);
  assert.doesNotMatch(noDump, /import-db/, 'nothing is imported without a dump');
});
