/**
 * Which database dump a restore imports, beside a project's archive in the backups folder.
 *
 * A backup writes `<ws>---<project>--<stamp>.tar.gz` and, for a project with a database, the dump
 * `<same name>-db.sql.gz` (or `-db.sql`) beside it. A project that runs without a database (an Astro
 * or Gatsby site) has none — and an older backup command left an EMPTY dump there, because
 * `ddev export-db` opens its file before it finds out there is no database. Importing that file ends
 * the restore with `failed to extract provided file: EOF`, so an empty file is named, not imported.
 */

const fs = require('fs');
const path = require('path');

/** The dump beside `archive` (a file name in `backupsDir`): `{ file }` to import, or `{ file: null, empty }`. */
function dumpBeside(backupsDir, archive) {
  const base = String(archive).replace(/\.tar\.gz$/, '');
  let empty = null;
  for (const name of [`${base}-db.sql.gz`, `${base}-db.sql`]) {
    const full = path.join(backupsDir, name);
    let st;
    try { st = fs.statSync(full); } catch { continue; }
    if (!st.isFile()) continue;
    if (st.size > 0) return { file: full, empty: null };
    if (!empty) empty = name;
  }
  return { file: null, empty };
}

module.exports = { dumpBeside };
