/**
 * Edit and Settings on a home page workspace card, as the project and folder cards carry their tools.
 *
 * The corner holds the backups count too, so the three never overlap. It sits beside the card's link, not in it:
 * a card is one <a>, and a button inside a link is not a button.
 */

const { esc } = require('./html');
const { iconHtml } = require('./icons');

const settingsFile = (key) => `workspace.${key}.settings.yml`;

/** The corner of one card: its backups count, Edit (the card's icon and description) and Settings (its own file). */
function cornerHtml(w, { backupCount = 0, backupsUrl = '' } = {}) {
  const file = settingsFile(w.key);
  const backups = backupCount
    ? `<a class="ws-backups" href="${esc(backupsUrl)}" title="View the ${backupCount} backup${backupCount === 1 ? '' : 's'} for ${esc(w.label)}"><span uk-icon="icon: album; ratio: .65"></span> ${backupCount}</a>`
    : '';
  return `<div class="ws-card-corner" role="toolbar" aria-label="${esc(w.label)}">
      ${backups}
      <button type="button" class="ws-card-tool" hx-get="/fragments/workspace-edit/${encodeURIComponent(w.key)}"
              hx-target="#editor-modal-body" hx-swap="innerHTML"
              title="Edit the ${esc(w.label)} card: its icon and description" aria-label="Edit ${esc(w.label)}">${iconHtml('tabler:pencil', 0.75)}</button>
      <a class="ws-card-tool" href="/settings/${encodeURIComponent(file)}"
         data-tabmodal-open="/fragments/settings/modal?tab=${encodeURIComponent(file)}"
         title="${esc(w.label)} settings: ${esc(file)}" aria-label="${esc(w.label)} settings">${iconHtml('tabler:settings', 0.75)}</a>
    </div>`;
}

/** The Edit modal: the same presentation editor the workspace's settings tab shows, on its own. */
function editModalHtml(w, presentationHtml) {
  return `<div class="editor-card ws-card-edit">
      <h3 class="uk-h4 uk-margin-small-bottom">${iconHtml(w.icon, 1)} Edit the ${esc(w.label)} card</h3>
      <p class="uk-text-meta uk-margin-remove-top">The icon and description on its card and in the rail.
        Everything else is in <a href="/settings/${encodeURIComponent(settingsFile(w.key))}"
        data-tabmodal-open="/fragments/settings/modal?tab=${encodeURIComponent(settingsFile(w.key))}">its settings</a>.</p>
      ${presentationHtml}
    </div>`;
}

module.exports = { cornerHtml, editModalHtml, settingsFile };
