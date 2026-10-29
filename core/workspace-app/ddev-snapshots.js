/**
 * A project's database snapshots: what there is, and what can be done with one.
 *
 * The row could already TAKE a snapshot and never do anything else with it — no list, no restore, no
 * way to remove one. A backup you cannot restore is a file, and the whole reason snapshots exist is
 * that restoring one is fast: they are a physical copy of the database's own files (mariabackup /
 * xtrabackup, or pg_basebackup), not a SQL dump replayed statement by statement.
 *
 * Two facts about them shape everything here, and both come from DDEV's own documentation:
 *
 *   - **A snapshot belongs to a database engine and version.** The file is named
 *     `<name>-<engine>_<version>.zst`, and a `mariadb_11.8` snapshot does not restore into a
 *     `mariadb_10.11` project. So the version is listed beside every one: it is the difference
 *     between a restore and an error nobody expected.
 *   - **Restoring replaces the database.** There is no merge and no undo, which is why it is behind
 *     the confirm dialog like the other things here that cannot be taken back.
 *
 * They are read from `.ddev/db_snapshots/` rather than from `ddev snapshot --list`: it is the same
 * answer, and a project row must not cost a subprocess to draw.
 */

const fs = require('fs');
const path = require('path');

// `<name>-<engine>_<version>` plus the compression's extension, which is how DDEV writes them. The
// engine and version are part of the FILE name rather than metadata beside it, which is what makes
// listing them a readdir.
const SNAPSHOT_FILE_RE = /^(.+)-([a-z]+)_([0-9.]+)(\.zst|\.gz|\.tgz)?$/i;

// What may be typed into the name box. DDEV puts the name straight into a filename, so a path
// separator or a leading dot in it is a file somewhere else.
const SNAPSHOT_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,60}$/;

const snapshotDir = (projectDir) => path.join(projectDir, '.ddev', 'db_snapshots');

/**
 * Every snapshot this project holds, newest first.
 *
 * An uncompressed snapshot is a DIRECTORY of the same name shape, so both are listed — the entry
 * type is what says whether it was compressed, since that is exactly what the extension encodes.
 */
function listSnapshots(projectDir) {
  const dir = snapshotDir(projectDir);
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return [];
  }
  const out = [];
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const m = SNAPSHOT_FILE_RE.exec(e.name);
    if (!m) continue;
    const full = path.join(dir, e.name);
    let st;
    try { st = fs.statSync(full); } catch (_) { continue; }
    out.push({
      name: m[1],
      file: e.name,
      engine: m[2].toLowerCase(),
      version: m[3],
      dbVersion: `${m[2].toLowerCase()}_${m[3]}`,
      compression: m[4] === '.zst' ? 'zstd' : m[4] ? m[4].replace('.', '') : 'none',
      size: st.isDirectory() ? dirSize(full) : st.size,
      mtime: st.mtime,
    });
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

/** An uncompressed snapshot is a folder, and its size is what is in it. One level is enough: that is
 *  how the backup tools write them. */
function dirSize(dir) {
  let n = 0;
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isFile()) continue;
      try { n += fs.statSync(path.join(dir, e.name)).size; } catch (_) { /* skip */ }
    }
  } catch (_) { /* unreadable */ }
  return n;
}

/**
 * Does this project have a snapshot by this name, and what is it?
 *
 * The name comes from the browser, so it is matched against what is actually on disk rather than
 * pasted into a command line — a snapshot that is not there is refused here rather than by ddev,
 * three seconds later, in a screen session somebody has to open to read.
 */
const findSnapshot = (projectDir, name) => listSnapshots(projectDir).find((s) => s.name === name) || null;

/**
 * Can this snapshot restore into this project as it stands?
 *
 * The file names the engine and version it was taken from, and the project's own config names the
 * one it runs. When they differ DDEV refuses the restore, so the row says so first — with both
 * versions, because "it did not work" is not the useful half of that sentence.
 */
function restorable(snapshot, projectDbVersion) {
  if (!snapshot) return { ok: false, why: 'No such snapshot.' };
  if (!projectDbVersion) return { ok: true, why: '' };          // unknown: let DDEV be the judge
  if (snapshot.dbVersion === projectDbVersion) return { ok: true, why: '' };
  return { ok: false,
    why: `This snapshot is ${snapshot.dbVersion} and the project runs ${projectDbVersion}.`
      + ' A snapshot restores only into the database engine and version it was taken from.' };
}

/** What the project's `.ddev/config.yaml` says it runs, as `<engine>_<version>`, or ''. */
function projectDbVersion(projectDir) {
  let raw = '';
  try { raw = fs.readFileSync(path.join(projectDir, '.ddev', 'config.yaml'), 'utf8'); } catch (_) { return ''; }
  // database:
  //   type: mariadb
  //   version: "11.8"
  const block = raw.match(/^database:\s*$([\s\S]*?)(?=^\S|\Z)/m);
  if (!block) return '';
  const type = block[1].match(/^\s+type:\s*["']?([a-z]+)["']?\s*$/m);
  const version = block[1].match(/^\s+version:\s*["']?([0-9.]+)["']?\s*$/m);
  return type && version ? `${type[1].toLowerCase()}_${version[1]}` : '';
}

module.exports = {
  SNAPSHOT_NAME_RE, SNAPSHOT_FILE_RE, snapshotDir, listSnapshots, findSnapshot, restorable, projectDbVersion,
};
