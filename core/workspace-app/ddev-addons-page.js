/**
 * The add-ons panel for one project: what it has, what it could have, and everything else there is.
 *
 * Rendering lives here rather than in server.js, the way the commands and navigation pages do: the
 * route resolves the project and calls one function, and what a panel looks like is one file to open.
 */

const { esc } = require('./html');
const { humanTime } = require('./format');
const addons = require('./ddev-addons');

const PER_PAGE = 24;

/**
 * @param {object} ctx  workspace, project, projectDir, q (a search), page
 */
async function addonsPanelHtml({ workspace, project, projectDir, q = '', page = 1 }) {
  const installed = addons.installedAddons(projectDir);
  const have = new Set(installed.map((a) => a.repository.toLowerCase()));
  const registry = await addons.availableAddons();
  const vals = (extra) => esc(JSON.stringify({ workspace, projectName: project, ...extra }));
  const panelUrl = `/fragments/projects/addons/${encodeURIComponent(workspace)}/${encodeURIComponent(project)}`;

  const installedRows = installed.map((a) => `
    <li>
      <div class="addon-line">
        <span class="addon-name">${esc(a.name)}
          <span class="uk-text-meta">· ${esc(a.repository)}${a.version ? ` · ${esc(a.version)}` : ''}${
  a.installed ? ` · added ${esc(humanTime(new Date(a.installed)))}` : ''}</span></span>
        <span class="addon-actions">
          <button class="uk-button uk-button-default uk-button-small" hx-post="/actions/ddev-addon-update"
            hx-vals='${vals({ addon: a.name })}' hx-target="#webship-workspace-output" hx-swap="innerHTML"
            title="Take the newest release of ${esc(a.repository)} into this project">Update</button>
          <button class="uk-button uk-button-default uk-button-small arm-step" hx-post="/actions/ddev-addon-remove"
            hx-vals='${vals({ addon: a.name, confirm: 'yes' })}' hx-target="#webship-workspace-output" hx-swap="innerHTML"
            hx-trigger="confirmed-remove" title="Remove ${esc(a.name)} and the ${a.files.length} file(s) it owns">Remove</button>
        </span>
      </div>
    </li>`).join('');

  // A recommendation is a line with a reason on it. Anything already installed drops out of the list
  // rather than being offered again.
  const suggestions = addons.RECOMMENDED.filter((r) => !have.has(r.repo.toLowerCase()));
  const suggestionRows = suggestions.map((r) => {
    const known = (registry.list || []).find((x) => x.repo.toLowerCase() === r.repo.toLowerCase());
    return `
    <li>
      <div class="addon-line">
        <span class="addon-name">${esc(r.repo)}${known && known.stars ? ` <span class="uk-text-meta">⭐ ${known.stars}</span>` : ''}</span>
        <span class="addon-actions">${installButton(r.repo, vals, !!known, 'unknown')}</span>
      </div>
      <p class="uk-text-meta addon-why">${esc(r.why)}</p>
    </li>`;
  }).join('');

  const matches = addons.searchAddons(registry.list || [], q);
  const pages = Math.max(1, Math.ceil(matches.length / PER_PAGE));
  const at = Math.min(Math.max(1, Number(page) || 1), pages);
  const slice = matches.slice((at - 1) * PER_PAGE, at * PER_PAGE);
  const searchRows = slice.map((r) => `
    <li>
      <div class="addon-line">
        <span class="addon-name">${esc(r.repo)}${r.stars ? ` <span class="uk-text-meta">⭐ ${r.stars}</span>` : ''}${
  have.has(r.repo.toLowerCase()) ? ' <span class="uk-label uk-label-success">installed</span>' : ''}</span>
        <span class="addon-actions">${have.has(r.repo.toLowerCase()) ? '' : installButton(r.repo, vals, !r.truncated)}</span>
      </div>
      ${r.description ? `<p class="uk-text-meta addon-why">${esc(r.description)}</p>` : ''}
    </li>`).join('');

  const pager = pages > 1 ? `
    <p class="uk-text-meta addon-pager">
      ${at > 1 ? `<a href hx-get="${panelUrl}?q=${encodeURIComponent(q)}&amp;page=${at - 1}" hx-target="#editor-modal-body" hx-swap="innerHTML">‹ previous</a>` : ''}
      <span>${(at - 1) * PER_PAGE + 1}–${(at - 1) * PER_PAGE + slice.length} of ${matches.length}</span>
      ${at < pages ? `<a href hx-get="${panelUrl}?q=${encodeURIComponent(q)}&amp;page=${at + 1}" hx-target="#editor-modal-body" hx-swap="innerHTML">next ›</a>` : ''}
    </p>` : '';

  return `
    <div class="editor-card">
      <h3 class="uk-margin-small-bottom">Add-ons for ${esc(project)}</h3>
      <p class="uk-text-meta">An add-on is a repository DDEV copies into the project — a service, a tool, or a
        whole development setup. Installing one writes files into <code>.ddev/</code> and needs a
        <strong>ddev restart</strong> before it does anything; removing one takes its files away again.
        ${registry.error ? `<br><strong>The registry could not be read:</strong> ${esc(registry.error)}` : ''}</p>

      <h4 class="uk-margin-small-bottom">Installed <span class="uk-badge">${installed.length}</span></h4>
      ${installed.length
    ? `<ul class="uk-list uk-list-divider addon-list">${installedRows}</ul>`
    : '<p class="uk-text-meta">None yet — DDEV records what it installs in <code>.ddev/addon-metadata/</code>, and this reads that.</p>'}

      ${suggestions.length ? `<h4 class="uk-margin-small-bottom">Worth having here <span class="uk-badge">${suggestions.length}</span></h4>
      <ul class="uk-list uk-list-divider addon-list addon-suggested">${suggestionRows}</ul>` : ''}

      <h4 class="uk-margin-small-bottom">Everything in the registry <span class="uk-badge">${(registry.list || []).length}</span></h4>
      <form class="addon-search uk-margin-small" hx-get="${panelUrl}" hx-target="#editor-modal-body" hx-swap="innerHTML"
            hx-trigger="submit, keyup[key=='Enter'] from:find input">
        <input class="uk-input uk-form-small" type="search" name="q" value="${esc(q)}"
               placeholder="Search the add-on registry — redis, solr, playwright…" aria-label="Search add-ons">
        <button class="uk-button uk-button-default uk-button-small" type="submit">Search</button>
      </form>
      ${matches.length
    ? `<ul class="uk-list uk-list-divider addon-list">${searchRows}</ul>${pager}`
    : `<p class="uk-text-meta">Nothing in the registry matches “${esc(q)}”.</p>`}
    </div>`;
}

/**
 * Install, or say why not.
 *
 * `ddev add-on list` truncates long names with `…`, and a truncated name cannot be installed — so
 * when the registry had to be read from that table, those rows say so rather than offering a button
 * that would fail.
 */
function installButton(repo, vals, installable, why = 'truncated') {
  if (!installable) {
    return why === 'unknown'
      ? `<span class="uk-label uk-label-warning" title="The registry does not list ${esc(repo)} — it may have moved or been renamed.">not in the registry</span>`
      : '<span class="uk-label uk-label-warning" title="The registry listing truncated this name, so it cannot be installed from here. Use: ddev add-on get &lt;owner/repo&gt;">name truncated</span>';
  }
  return `<button class="uk-button uk-button-primary uk-button-small" hx-post="/actions/ddev-addon-get"
    hx-vals='${vals({ addon: repo })}' hx-target="#webship-workspace-output" hx-swap="innerHTML"
    title="Install ${esc(repo)} into this project">Install</button>`;
}

module.exports = { addonsPanelHtml, PER_PAGE };
