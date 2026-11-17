/**
 * The install hint of a database client names a package that exists (#437).
 *
 * `mysqldump` and `pg_dump` (the DigitalOcean plugin's database pull) were said to install with
 * "apt install mysqldump", "dnf install pg_dump", "brew install mysqldump": no such packages.
 */
const { test } = require('node:test');
const assert = require('node:assert');

const { hintFor } = require('../../command-check');

test('mysqldump and pg_dump come from the client packages of each system', () => {
  assert.strictEqual(hintFor('mysqldump'), 'Debian/Ubuntu: apt install default-mysql-client · Fedora: dnf install community-mysql · macOS (Homebrew): brew install mysql-client');
  assert.strictEqual(hintFor('pg_dump'), 'Debian/Ubuntu: apt install postgresql-client · Fedora: dnf install postgresql · macOS (Homebrew): brew install libpq');
  // A plugin's own hint still wins, and a command whose package has its name is unchanged.
  assert.strictEqual(hintFor('pg_dump', 'https://www.postgresql.org/download/'), 'see https://www.postgresql.org/download/');
  assert.strictEqual(hintFor('rsync'), 'Debian/Ubuntu: apt install rsync · Fedora: dnf install rsync · macOS (Homebrew): brew install rsync');
});
