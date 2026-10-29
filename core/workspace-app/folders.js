/**
 * A new empty folder in a workspace: a place to run commands, screens or Claude Code that no builder made.
 *
 * It shows up as a row like any project, so everything a folder without DDEV already gets (Screens, IDE,
 * GIT, the folder and project commands, the note) works on it from the moment it exists.
 */

const fs = require('fs');
const path = require('path');

const { esc } = require('./html');

// Lowercase so it can later become a DDEV project or a hostname without a rename.
const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,62}$/;
// A files workspace keeps names people read (Webship-Translation-Demo-Guide), so case, spaces and dots are fine there.
const FILES_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,62}$/;
const RESERVED = new Set(['node_modules', 'backups', 'logs']);

const THEN = {
  none: 'Just make the folder',
  shell: 'Open a terminal in it',
  claude: 'Start Claude Code in it',
};

/** Why a name cannot be used, or ''. */
function nameProblem(name, { files = false } = {}) {
  const n = String(name || '');
  if (!n) return 'Give the folder a name.';
  if (files) {
    if (!FILES_NAME_RE.test(n) || /[ .]$/.test(n)) return 'A folder name is letters, digits, spaces, dots, - and _, starting with a letter or digit (63 max).';
  } else if (!NAME_RE.test(n)) return 'A folder name is lowercase letters, digits, - and _, starting with a letter or digit (63 max).';
  if (RESERVED.has(n)) return `<code>${esc(n)}</code> is reserved in a workspace folder.`;
  return '';
}

/** Make <root>/<name>. Returns { ok, dir } or { ok: false, status, error }. */
function createFolder(root, name, { files = false } = {}) {
  const problem = nameProblem(name, { files });
  if (problem) return { ok: false, status: 400, error: problem };
  let base;
  try { base = fs.realpathSync(root); } catch (_) { return { ok: false, status: 404, error: 'The workspace folder does not exist.' }; }
  const dir = path.join(base, name);
  if (path.dirname(dir) !== base) return { ok: false, status: 400, error: 'That name would leave the workspace.' };
  if (fs.existsSync(dir)) return { ok: false, status: 409, error: `<code>${esc(name)}</code> already exists here.` };
  try {
    fs.mkdirSync(dir, { mode: 0o755 });
  } catch (e) {
    return { ok: false, status: 500, error: `The folder could not be made: ${esc(e.message)}` };
  }
  return { ok: true, dir };
}

/** The form in the editor modal. */
/** The form for a files workspace: a folder inside the one being viewed, with nothing to set up. */
function filesFolderFormHtml(ws, { label = ws, sub = '', suggestion = '' } = {}) {
  return `
    <div class="editor-card">
      <h3 class="uk-margin-small-bottom">New folder in ${esc(label)}${sub ? ` / ${esc(sub)}` : ''}</h3>
      <form class="folder-new-form" hx-post="/actions/folder-new" hx-target="#editor-modal-body" hx-swap="innerHTML">
        <input type="hidden" name="workspace" value="${esc(ws)}">
        <input type="hidden" name="sub" value="${esc(sub)}">
        <label class="uk-form-label" for="folder-name">Folder name</label>
        <input class="uk-input uk-margin-small-bottom" id="folder-name" name="name" required autofocus
               maxlength="63" value="${esc(suggestion)}">
        <label class="uk-form-label" for="folder-note">What is it for? <span class="uk-text-meta">(optional, becomes its note)</span></label>
        <input class="uk-input uk-margin-small-bottom" id="folder-note" name="note" maxlength="200">
        <p class="uk-margin-small-top"><button class="uk-button uk-button-primary" type="submit">Make the folder</button></p>
      </form>
    </div>`;
}

function folderFormHtml(ws, { label = ws, suggestion = '', projectTypes = [], canTest = false, jiraProject = '', canUpsun = false } = {}) {
  const radios = Object.entries(THEN).map(([value, text], i) => `
          <label class="uk-margin-small-right"><input class="uk-radio" type="radio" name="then" value="${value}"${i === 0 ? ' checked' : ''}> ${esc(text)}</label>`).join('');
  return `
    <div class="editor-card">
      <h3 class="uk-margin-small-bottom">New folder in ${esc(label)}</h3>
      <p class="uk-text-meta">An empty folder, listed with the projects. Run commands, screens or Claude Code in it,
        and set up DDEV later if it becomes a site.</p>
      <form class="folder-new-form" hx-post="/actions/folder-new" hx-target="#editor-modal-body" hx-swap="innerHTML">
        <input type="hidden" name="workspace" value="${esc(ws)}">
        <label class="uk-form-label" for="folder-name">Folder name</label>
        <input class="uk-input uk-margin-small-bottom" id="folder-name" name="name" required autofocus
               pattern="[a-z0-9][a-z0-9_\\-]{0,62}" maxlength="63" value="${esc(suggestion)}" placeholder="my-folder"
               title="Lowercase letters, digits, - and _">
        <label class="uk-form-label" for="folder-note">What is it for? <span class="uk-text-meta">(optional, becomes its note)</span></label>
        <input class="uk-input uk-margin-small-bottom" id="folder-note" name="note" maxlength="200"
               placeholder="Trying the new search module">
        <div class="uk-form-label">Set it up <span class="uk-text-meta">(optional, runs as a screen session)</span></div>
        <div class="uk-margin-small-bottom folder-setup">
          <label class="uk-display-block"><input class="uk-checkbox" type="checkbox" name="ddev" value="1"> Configure DDEV, so it can start</label>
          ${canTest ? `<label class="uk-display-block"><input class="uk-checkbox" type="checkbox" name="e2e" value="1"> Set up <code>webship-js</code> testing (Playwright and Cucumber), which configures DDEV too</label>` : ''}
          <div class="folder-ddev-type uk-margin-small-top">${require('./ddev-options').fieldsHtml({ prefix: 'folder' })}
          </div>
        </div>
        ${jiraProject || canUpsun ? `<div class="uk-form-label">Connect it <span class="uk-text-meta">(optional)</span></div>
        <div class="uk-margin-small-bottom folder-services">
          ${jiraProject ? `<label class="uk-display-block"><input class="uk-checkbox" type="checkbox" name="jira" value="1">
            Create a Jira workitem for it with AI, from "What is it for?", in project
            <input class="uk-input uk-form-small uk-form-width-small" name="jira_project" value="${esc(jiraProject)}"
                   pattern="[A-Z][A-Z0-9]+" maxlength="20" aria-label="Jira project key"></label>` : ''}
          ${canUpsun ? `<div class="uk-margin-small-top folder-upsun">
            <span class="uk-text-meta">Upsun:</span>
            <label class="uk-margin-small-right"><input class="uk-radio" type="radio" name="upsun" value="none" checked> Not now</label>
            <label class="uk-margin-small-right"><input class="uk-radio" type="radio" name="upsun" value="link"> Link to an existing project</label>
            <label><input class="uk-radio" type="radio" name="upsun" value="create"> Create a new project and deploy it, with AI (it asks before creating anything billed)</label>
            <div class="folder-upsun-id uk-margin-small-top">
              <label class="uk-form-label" for="folder-upsun-id">Upsun project id</label>
              <input class="uk-input uk-form-small uk-form-width-medium" id="folder-upsun-id" name="upsun_id"
                     pattern="[a-z0-9]{8,20}" maxlength="20" placeholder="eeihb6tksv2ly">
            </div>
          </div>` : ''}
        </div>` : ''}
        <div class="uk-form-label">Then</div>
        <div class="uk-margin-small-bottom folder-then">${radios}
        </div>
        <div class="folder-prompt">
          <label class="uk-form-label" for="folder-prompt">First message to Claude Code <span class="uk-text-meta">(optional)</span></label>
          <textarea class="uk-textarea" id="folder-prompt" name="prompt" rows="3" maxlength="4000"
                    placeholder="Set up a small Node.js app here"></textarea>
        </div>
        <p class="uk-margin-small-top"><button class="uk-button uk-button-primary" type="submit">Make the folder</button></p>
      </form>
    </div>`;
}

/** The first free <prefix><n> in a workspace folder, so the form opens with a name that works. */
function suggestName(root, prefix = 'folder') {
  for (let n = 1; n < 1000; n += 1) {
    if (!fs.existsSync(path.join(root, `${prefix}${n}`))) return `${prefix}${n}`;
  }
  return '';
}

module.exports = { NAME_RE, FILES_NAME_RE, THEN, nameProblem, createFolder, folderFormHtml, filesFolderFormHtml, suggestName };
