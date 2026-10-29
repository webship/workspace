/**
 * Putting a database back: the other half of Export the database.
 *
 * The row could dump a database into the workspace's backups folder and never put one back. So the
 * dumps this dashboard writes were a one-way trip — restoring one meant finding the file, working out
 * the flag, and typing `ddev import-db` in a terminal.
 *
 * Three decisions, each for a reason:
 *
 *   - **Only files this workspace already holds.** The list is the workspace's own backups folder,
 *     so nothing is typed in and no path from a browser reaches a command line. A dump somewhere else
 *     is a `ddev import-db` in a terminal, and that is a fair place for it.
 *   - **Only things that ARE dumps.** That folder also holds whole-project tarballs from
 *     `cmd-tools-backup-*.sh`, and `ddev import-db` accepts a `.tar.gz` — so an archive of a whole
 *     project would be handed over as if it were SQL. They are excluded by name.
 *   - **A snapshot first, always.** Importing replaces every table, and the database it replaces is
 *     often the only copy of an afternoon's work. The snapshot is taken in the same line with `&&`,
 *     so nothing is imported if it fails — the same shape `drush sql:drop` already uses.
 */

const fs = require('fs');
const path = require('path');

const { esc } = require('./html');
const { humanSize, humanTime } = require('./format');

// What `ddev import-db` reads AND what is unambiguously a database dump. `.zip`, `.tgz` and `.tar.gz`
// are left out on purpose: DDEV accepts them, and in this folder they are whole-project archives.
const DUMP_RE = /\.(sql|mysql)(\.(gz|bz2|xz))?$/i;

/** The dumps a workspace holds, newest first. */
function listDumps(backupsDir) {
  let names = [];
  try {
    names = fs.readdirSync(backupsDir, { withFileTypes: true })
      .filter((e) => e.isFile() && !e.name.startsWith('.') && DUMP_RE.test(e.name))
      .map((e) => e.name);
  } catch (_) {
    return [];
  }
  return names.map((name) => {
    let st;
    try { st = fs.statSync(path.join(backupsDir, name)); } catch (_) { return null; }
    return { name, size: st.size, mtime: st.mtime };
  }).filter(Boolean).sort((a, b) => b.mtime - a.mtime);
}

/**
 * The dump a request named, or null.
 *
 * A basename, matched against what the folder actually holds — never joined from a browser value and
 * hoped about. `path.basename` first, so a name carrying a directory cannot even be compared.
 */
function findDump(backupsDir, name) {
  const wanted = path.basename(String(name || ''));
  if (!wanted || wanted !== String(name || '')) return null;
  return listDumps(backupsDir).find((d) => d.name === wanted) || null;
}

/** The panel: what there is to import, and what importing one will do. */
function importPanelHtml({ workspace, project, backupsDir, backupsLabel }) {
  const dumps = listDumps(backupsDir);
  const vals = (extra) => esc(JSON.stringify({ workspace, projectName: project, ...extra }));
  const rows = dumps.map((d) => `
    <li>
      <div class="import-line">
        <span class="import-name">${esc(d.name)}</span>
        <span class="uk-text-meta import-meta">${esc(humanTime(d.mtime))} · ${esc(humanSize(d.size))}</span>
        <span class="import-actions">
          <button class="uk-button uk-button-primary uk-button-small arm-step" hx-post="/actions/ddev-import-db"
            hx-vals='${vals({ dump: d.name, confirm: 'yes' })}' hx-target="#webship-workspace-output" hx-swap="innerHTML"
            hx-trigger="confirmed-remove" title="Replace this project's database with ${esc(d.name)}">Import</button>
        </span>
      </div>
    </li>`).join('');

  return `
    <div class="editor-card">
      <h3 class="uk-margin-small-bottom">Import a database into ${esc(project)}</h3>
      <p class="uk-text-meta">Importing <strong>replaces</strong> every table in this project's database.
        A snapshot is taken first, in the same command — so if the snapshot fails nothing is imported, and
        if the import is wrong the snapshot is one click away under <em>Snapshots</em>.</p>
      ${dumps.length
    ? `<ul class="uk-list uk-list-divider import-list">${rows}</ul>`
    : '<p class="uk-text-meta">No database dumps in this workspace yet. <em>Export the database</em> writes one here, and so does a project backup.</p>'}
      <p class="uk-text-meta">These are the dumps in <code>${esc(backupsLabel)}</code>. Whole-project archives
        from a backup are not listed: <code>ddev import-db</code> would accept one and hand a tarball of a
        project to the database. A dump from anywhere else is
        <code>ddev import-db --file &lt;path&gt;</code> in a terminal.</p>
    </div>`;
}

module.exports = { DUMP_RE, listDumps, findDump, importPanelHtml };
