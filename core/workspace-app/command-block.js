/**
 * A command the dashboard shows rather than runs, with a copy button on each line.
 *
 * `claude mcp add` writes ~/.claude.json — the CLI configuration of the person at the keyboard, not
 * of this web request. The Upsun pulls need cloud credentials this container does not have, and
 * they replace local data. Both are worth reading before they happen.
 */

const { esc } = require('./html');

const commandBlock = (title, lines, note) => `<div class="msg assistant">
    <strong>${esc(title)}</strong>
    ${lines.map((l) => `<div class="uk-margin-small-top uk-flex uk-flex-middle" style="gap:.5rem">
      <code style="flex:1;overflow-x:auto;white-space:pre">${esc(l)}</code>
      <button class="uk-button uk-button-default uk-button-small copy-cmd" data-copy="${esc(l)}"><span uk-icon="icon: copy; ratio: .7"></span> Copy</button>
    </div>`).join('')}
    <p class="uk-text-meta uk-margin-small-top">${note}</p>
  </div>`;

module.exports = { commandBlock };
