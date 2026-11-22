/**
 * Which database dump a restore imports, beside a project's archive in the backups folder.
 *
 * A backup writes `<ws>---<project>--<stamp>.tar.gz` and, for a project with a database, the dump
 * `<same name>-db.sql.gz` (or `-db.sql`) beside it. A project that runs without a database (an Astro
 * or Gatsby site) has none — and an older backup command left an EMPTY dump there, because
 * `ddev export-db` opens its file before it finds out there is no database. Importing that file ends
 * the restore with `failed to extract provided file: EOF`, so an empty file is named, not imported.
 */

import { statSync, type Stats } from 'node:fs';
import { join } from 'node:path';

/** The dump to import (`file`), or the name of an empty one that is not imported (`empty`). */
export interface DumpChoice { file: string | null; empty: string | null }

/** The dump beside `archive` (a file name in `backupsDir`): `{ file }` to import, or `{ file: null, empty }`. */
export function dumpBeside(backupsDir: string, archive: string): DumpChoice {
  const base = String(archive).replace(/\.tar\.gz$/, '');
  let empty: string | null = null;
  for (const name of [`${base}-db.sql.gz`, `${base}-db.sql`]) {
    const full = join(backupsDir, name);
    let st: Stats;
    try { st = statSync(full); } catch { continue; }
    if (!st.isFile()) continue;
    if (st.size > 0) return { file: full, empty: null };
    if (!empty) empty = name;
  }
  return { file: null, empty };
}
