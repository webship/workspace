/**
 * A modal with its sections as tabs down the left, and the chosen one's content on the right.
 *
 * The editor modal used to be one scroll of everything, with its sections as links inside the page or
 * as a back button and a list. A set of related views (all the settings, everything about a workitem)
 * reads better as a set: the names stay in view, the one you are on is marked, and a link to it survives
 * as `#<id>/<tab>`. Each tab is a fragment URL; the pane loads it into itself, so a tab nobody opens is
 * never rendered.
 *
 * Tabs are real buttons in a tablist. Selection, the arrow keys, the filter and the address live in
 * public/ui.js; this renders the markup and nothing else.
 */

const { esc } = require('./html');
const { iconHtml } = require('./icons');

/**
 * @param {object} o
 * @param {string} o.id        names the modal in the address: #<id>/<tab>
 * @param {string} o.title     heading of the left column
 * @param {string} [o.subtitle]
 * @param {{label: string, url: string}} [o.back]  a way out above the tabs, loaded into the whole modal
 * @param {boolean} [o.filter] a filter box above the tabs, for a long list
 * @param {boolean} [o.hash]   keep #<id>/<tab> in the address, so the place can be linked to and reopened
 * @param {{id: string, label: string, tabs: {id: string, label: string, url: string, icon?: string, hint?: string, badge?: string}[]}[]} o.groups
 * @param {string} [o.active]  the tab to open on; the first one when it is not found
 */
function tabModalHtml({ id, title, subtitle = '', back = null, filter = false, hash = false, groups, active = '' }) {
  const all = groups.flatMap((g) => g.tabs);
  if (!all.length) return '<div class="msg error">Nothing to show here.</div>';
  const current = all.find((t) => t.id === active) || all[0];
  const pane = `tm-${id}-pane`;
  const tab = (t) => {
    const on = t === current;
    return `<button type="button" role="tab" class="tabmodal-tab${on ? ' is-selected' : ''}"
        id="tm-${esc(id)}-${esc(t.id)}" data-tab="${esc(t.id)}" data-label="${esc(t.label)}"
        data-hint="${esc(t.hint || '')}" aria-selected="${on ? 'true' : 'false'}" aria-controls="${esc(pane)}"
        tabindex="${on ? '0' : '-1'}" hx-get="${esc(t.url)}" hx-target="#${esc(pane)}" hx-swap="innerHTML">
        ${iconHtml(t.icon || 'tabler:point', 0.9)}<span class="tabmodal-tab-label">${esc(t.label)}</span>${t.badge ? `<span class="tabmodal-badge">${esc(t.badge)}</span>` : ''}
      </button>`;
  };
  return `
<div class="tabmodal" data-tabmodal="${esc(id)}"${hash ? ' data-hash' : ''}>
  <nav class="tabmodal-nav" aria-label="${esc(title)}">
    ${back ? `<button type="button" class="tabmodal-back" hx-get="${esc(back.url)}" hx-target="#editor-modal-body" hx-swap="innerHTML">
      <span uk-icon="icon: arrow-left; ratio: .8"></span> ${esc(back.label)}</button>` : ''}
    <div class="tabmodal-title">
      <h2>${esc(title)}</h2>
      ${subtitle ? `<span class="uk-text-meta">${esc(subtitle)}</span>` : ''}
    </div>
    ${filter ? `<input type="search" class="tabmodal-filter uk-input uk-form-small" placeholder="Filter" aria-label="Filter ${esc(title)}" autocomplete="off">` : ''}
    <div class="tabmodal-tabs" role="tablist" aria-orientation="vertical" aria-label="${esc(title)}">
      ${groups.map((g) => `
      <div class="tabmodal-group" role="presentation" data-group="${esc(g.id)}">
        ${g.label ? `<p class="tabmodal-group-label" role="presentation">${esc(g.label)}</p>` : ''}
        ${g.tabs.map(tab).join('')}
      </div>`).join('')}
    </div>
  </nav>
  <section class="tabmodal-main">
    <header class="tabmodal-head">
      <h3 class="tabmodal-heading">${esc(current.label)}</h3>
      <span class="tabmodal-sub uk-text-meta">${esc(current.hint || '')}</span>
    </header>
    <div class="tabmodal-pane" id="${esc(pane)}" role="tabpanel" aria-labelledby="tm-${esc(id)}-${esc(current.id)}"
         tabindex="0" aria-live="polite">
      <div class="tabmodal-loading" hx-get="${esc(current.url)}" hx-trigger="load" hx-target="#${esc(pane)}" hx-swap="innerHTML">
        <span class="uk-text-meta">Loading…</span>
      </div>
    </div>
  </section>
</div>`;
}

module.exports = { tabModalHtml };
