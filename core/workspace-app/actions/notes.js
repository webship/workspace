/**
 * Writing the note on a folder or a project.
 *
 * The note is a file INSIDE the folder it is about, so the only thing this has to be careful about is
 * which folder: the workspace and the project name come from the browser, and a path built from them
 * without checking would write `.workspace-note` anywhere on the machine that `..` can reach.
 */

const fs = require('fs');
const path = require('path');

const { esc } = require('../html');
const { isValidWorkspace, workspaceDir } = require('../workspaces');
const notes = require('../notes');

/**
 * The folder a request names, or null.
 *
 * Three checks, and each one is the one that matters: the workspace has to be a workspace this
 * dashboard knows, the project name has to be a plain name rather than a path, and the resolved
 * directory has to still be inside the workspace — the same containment check the command editor makes
 * before it writes a script.
 */
function folderOf(form) {
  const ws = String(form.workspace || '');
  const project = String(form.projectName || '');
  if (!isValidWorkspace(ws)) return null;
  const root = workspaceDir(ws);
  if (project && !/^[a-zA-Z0-9_-]+$/.test(project)) return null;
  const dir = project ? path.join(root, project) : root;
  const resolved = fs.realpathSync.native ? safeReal(dir) : dir;
  if (!resolved || !(resolved === safeReal(root) || resolved.startsWith(`${safeReal(root)}${path.sep}`))) return null;
  return fs.existsSync(resolved) ? resolved : null;
}

function safeReal(p) {
  try { return fs.realpathSync(p); } catch (_) { return ''; }
}

async function note_save({ form, send, res }) {
  const dir = folderOf(form);
  if (!dir) return send('<div class="msg error">No such folder.</div>', 400);
  const r = notes.writeNote(dir, { title: form.title, body: form.body });
  if (!r.ok) return send(`<div class="msg error">The note could not be written: ${esc(r.error)}</div>`, 500);
  const what = form.projectName ? `${form.workspace}/${form.projectName}` : `${form.workspace}/`;
  // The rows carry the note as their tooltip and their heading, so the page behind this has to redraw
  // — otherwise the note is saved and nothing on screen says so until the next navigation. Set the way
  // every other action here asks for a refresh, on the response rather than through send().
  try { res.setHeader('HX-Trigger', 'refresh-projects'); } catch (_) { /* headers already sent */ }
  return send(`<div class="msg assistant">${r.title || r.body
    ? `Noted on <strong>${esc(what)}</strong>${r.title ? ` — it is called <strong>${esc(r.title)}</strong> here now.` : '.'}`
    : `The note on <strong>${esc(what)}</strong> was removed.`}</div>`);
}

module.exports = { '/actions/note-save': note_save, folderOf };
