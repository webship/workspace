/**
 * Deleting a workspace that holds nothing: the reverse of addWorkspace in server.js.
 *
 * Only a workspace with no content can go. Its folder may hold the tooling a workspace ships
 * (cmd-*.sh, README.md, AGENTS.md, CLAUDE.md, *.code-workspace) and nothing else; it has no backups
 * and no screen session running. The dashboard asks three times before it deletes one.
 */

const fs = require('fs');
const path = require('path');

const { esc } = require('./html');
const { ROOT, CONFIG_DIR, loadWorkspaces } = require('./workspaces');
const { readListBlock, writeListBlock } = require('./settings-file');

const TOOLING_RE = /^(cmd-.+\.sh|README\.md|AGENTS\.md|CLAUDE\.md|.+\.code-workspace)$/;
const NAME_RE = /^[a-z][a-z0-9-]*$/;
const DDEV_CONFIG = path.join(__dirname, '.ddev', 'config.yaml');

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function liveSessionNames() {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(ROOT, '.screens', 'host-sessions.json'), 'utf8'));
    return (j.sessions || []).map((s) => String(s.session || ''));
  } catch (_) { return []; }
}

function filesIn(dir) {
  try { return fs.readdirSync(dir); } catch (_) { return []; }
}

/** What keeps a workspace in use. Deletable when `reasons` is empty; `tooling` is what deleting removes. */
function usage(name, { sessions = liveSessionNames() } = {}) {
  const meta = loadWorkspaces()[name];
  if (!meta) return { reasons: ['not a workspace'], tooling: [] };
  const reasons = [];
  const dir = path.join(ROOT, name);
  if (path.resolve(meta.dir) !== dir) reasons.push('its folder is set outside the tree');
  const entries = filesIn(dir);
  const content = entries.filter((f) => !TOOLING_RE.test(f));
  if (content.length) {
    reasons.push(`${plural(content.length, 'item')} in its folder (${content.slice(0, 3).join(', ')}${content.length > 3 ? ', …' : ''})`);
  }
  const backups = filesIn(meta.backupsDir);
  if (backups.length) reasons.push(plural(backups.length, 'backup file'));
  const live = sessions.filter((s) => s.startsWith(`${name}--`));
  if (live.length) reasons.push(`${plural(live.length, 'screen session')} running`);
  const list = readListBlock('settings.yml', 'workspaces');
  if (list && list.items.length < 2) reasons.push('it is the only workspace');
  return { reasons, tooling: entries.filter((f) => TOOLING_RE.test(f)), dir, backupsDir: meta.backupsDir };
}

/** The three answers the last step must carry: the dialog's Yes, the name typed back, and YES. */
function confirmed(name, form) {
  return String(form.confirmName || '').trim() === name && String(form.confirmYes || '').trim() === 'YES';
}

/** Remove the list entry, the settings file, the folder and the hostname. Checked again here, not trusted from the page. */
function deleteWorkspace(name) {
  if (!NAME_RE.test(name)) return { error: 'Not a workspace name.' };
  const use = usage(name);
  if (use.reasons.length) return { error: `${name} is in use: ${use.reasons.join('; ')}.` };

  const notes = [];
  const list = readListBlock('settings.yml', 'workspaces');
  writeListBlock('settings.yml', 'workspaces', list.items.filter((k) => k !== name));
  notes.push('took it out of <code>workspaces:</code>');

  const settingsFile = path.join(CONFIG_DIR, `workspace.${name}.settings.yml`);
  if (fs.existsSync(settingsFile)) {
    fs.unlinkSync(settingsFile);
    notes.push(`deleted <code>core/config/workspace.${esc(name)}.settings.yml</code>`);
  }
  if (fs.existsSync(use.dir)) {
    use.tooling.forEach((f) => fs.unlinkSync(path.join(use.dir, f)));
    fs.rmdirSync(use.dir);
    notes.push(`deleted the <code>${esc(name)}/</code> folder${use.tooling.length ? ` and its ${plural(use.tooling.length, 'command file')}` : ''}`);
  }
  try { fs.rmdirSync(use.backupsDir); } catch (_) { /* none, or not empty */ }

  try {
    const cfg = fs.readFileSync(DDEV_CONFIG, 'utf8');
    const next = cfg.split('\n').filter((l) => l.trim() !== `- "*.${name}.workspace"`).join('\n');
    if (next !== cfg) {
      fs.writeFileSync(DDEV_CONFIG, next);
      notes.push(`removed <code>*.${esc(name)}.workspace</code> from the dashboard's DDEV hostnames`);
    }
  } catch (_) { /* no DDEV config here */ }
  return { notes };
}

/** The row's delete control: a button for an unused workspace, a quiet "in use" with the reasons otherwise. */
function rowControlHtml(name, use) {
  if (use.reasons.length) {
    return `<span class="ws-in-use uk-text-meta" title="Cannot be deleted: ${esc(use.reasons.join('; '))}">in use</span>`;
  }
  return `<button type="button" form="ws-delete-form" class="uk-button uk-button-default uk-button-small ws-delete arm-step"
      hx-post="/actions/workspace-delete" hx-trigger="confirmed-remove"
      hx-vals='{"workspace":"${esc(name)}","step":"name"}' hx-target="#list-editor" hx-swap="outerHTML"
      title="Delete the ${esc(name)} workspace"><span uk-icon="icon: trash; ratio: .7"></span></button>`;
}

/** Steps 2 and 3, shown under the row: type the name, then type YES. The buttons post through the empty
 *  #ws-delete-form, so the settings form they sit in is not sent with them. */
function stepHtml(name, step, use, error) {
  const vals = (s, extra = '') => `hx-post="/actions/workspace-delete" hx-target="#list-editor" hx-swap="outerHTML"
      hx-vals='{"workspace":"${esc(name)}","step":"${s}"${extra}}'`;
  const id = `ws-del-${esc(name)}`;
  const removes = [
    `the <code>${esc(name)}/</code> folder${use.tooling.length ? ` (${plural(use.tooling.length, 'command file')})` : ''}`,
    `<code>core/config/workspace.${esc(name)}.settings.yml</code>`,
    `its line in <code>workspaces:</code>`,
    `the <code>*.${esc(name)}.workspace</code> hostname`,
  ];
  const cancel = `<button type="button" form="ws-delete-form" class="uk-button uk-button-default uk-button-small" ${vals('cancel')}>Cancel</button>`;
  const body = step === 'yes'
    ? `<p><strong>Step 3 of 3.</strong> Type <code>YES</code> to delete the <strong>${esc(name)}</strong> workspace. This cannot be undone.</p>
      <div class="ws-delete-fields">
        <input class="uk-input uk-form-small" id="${id}-yes" name="confirmYes" autocomplete="off" spellcheck="false"
               placeholder="YES" aria-label="Type YES to delete ${esc(name)}">
        <button type="button" form="ws-delete-form" class="uk-button uk-button-danger uk-button-small ws-delete-go"
                ${vals('delete', `,"confirmName":"${esc(name)}"`)} hx-include="#${id}-yes">Delete workspace</button>
        ${cancel}
      </div>`
    : `<p><strong>Step 2 of 3.</strong> Type the workspace name, <code>${esc(name)}</code>, to continue.</p>
      <p class="uk-text-meta">Deleting it removes ${removes.join(', ')}.</p>
      <div class="ws-delete-fields">
        <input class="uk-input uk-form-small" id="${id}-name" name="confirmName" autocomplete="off" spellcheck="false"
               placeholder="${esc(name)}" aria-label="Type the workspace name">
        <button type="button" form="ws-delete-form" class="uk-button uk-button-primary uk-button-small ws-delete-go"
                ${vals('yes')} hx-include="#${id}-name">Continue</button>
        ${cancel}
      </div>`;
  return `<div class="ws-delete-step" role="group" aria-label="Delete the ${esc(name)} workspace">
      ${error ? `<p class="ws-delete-error" role="alert">${esc(error)}</p>` : ''}${body}</div>`;
}

module.exports = { usage, confirmed, deleteWorkspace, rowControlHtml, stepHtml, TOOLING_RE };
