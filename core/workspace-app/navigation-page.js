/**
 * Commands → Rail: the actions rail, arranged.
 *
 * One page per scope — the global rail, then each workspace — showing the groups that scope has actually
 * drawn, with their entries. Drag an entry to another group, or into Hidden; drag a group to move the
 * whole group; add a link or a button of your own. It is the same shape as Commands → Buttons, because it
 * is the same question asked about a different strip of the screen.
 *
 * What it can list is what the rail has SEEN (rail-layout.js): the rail differs per page — a files
 * workspace has Sync, a project workspace has Screens and Run — so the entries offered for a scope are
 * the ones its pages have rendered. Open a workspace once and its rail is arrangeable.
 */

const { esc } = require('./html');
const { loadWorkspaces } = require('./workspaces');
const rail = require('./navigation');
const cc = require('./commands');

const icon = (name, ratio = 0.7) => `<span uk-icon="icon: ${name}; ratio: ${ratio}"></span>`;

/** The scope picker: global first, then every workspace, each saying whether it has anything of its own. */
function scopeTabsHtml(scope) {
  const raw = rail.loadLayout().raw || {};
  const has = (s) => {
    const l = rail.scopeLayout(raw, s);
    return l.hidden.length || l.groups.length || l.items.length || Object.keys(l.order).length;
  };
  const tab = (s, label) => `<a class="uk-button uk-button-${scope === s ? 'primary' : 'default'} uk-button-small settings-tab"
       href="/settings/navigation?scope=${encodeURIComponent(s)}"${scope === s ? ' aria-current="page"' : ''}
       title="${esc(s === 'global' ? 'The rail on every page' : `The rail on the ${label} pages, applied after the global one`)}">${esc(label)}${has(s) ? ' •' : ''}</a>`;
  const workspaces = Object.values(loadWorkspaces());
  return `<p class="settings-tabs nav-scopes">
    ${tab('global', 'Every page')}
    ${workspaces.map((w) => tab(w.key, w.label)).join('')}
  </p>`;
}

/** One entry, as a card that can be dragged between groups. */
function entryCard(id, label, group, custom, shownAs) {
  return `<li class="nav-entry" data-id="${esc(id)}">
    <input type="hidden" name="item" value="${esc(`${group}:${id}`)}">
    <span class="nav-handle" title="Drag to move it, or into Hidden">${icon('table')}</span>
    <span class="nav-entry-label">${esc(label)}</span>
    <!-- How much of the entry is shown, in whichever place it sits: that is about how much room the
         entry is worth, not about which strip of the screen it is on. Both halves stay in the markup
         whichever is picked, so a screen reader still reads the name — this is presentation only. -->
    <select class="nav-entry-show" name="show" title="How much of ${esc(label)} is shown"
            aria-label="How much of ${esc(label)} is shown">
      <option value="${esc(id)}:both"${shownAs === 'both' ? ' selected' : ''}>icon + text</option>
      <option value="${esc(id)}:icon"${shownAs === 'icon' ? ' selected' : ''}>icon only</option>
      <option value="${esc(id)}:text"${shownAs === 'text' ? ' selected' : ''}>text only</option>
    </select>
    ${custom ? `<span class="uk-label nav-yours" title="An entry you added">yours</span>
      <button type="button" class="uk-button uk-button-link nav-remove arm-step" title="Remove ${esc(label)}"
              hx-post="/actions/nav-remove" hx-vals='${esc(JSON.stringify({ id, scope: custom.scope }))}'
              hx-include="#nav-form" hx-target="#nav-editor" hx-swap="outerHTML"
              hx-on::before:request="window.navSyncGroups && window.navSyncGroups()"
              hx-trigger="confirmed-remove">${icon('trash')}</button>` : ''}
  </li>`;
}

/**
 * The editor for one scope. Everything is in one form: dragging is not saved until Save, and the two
 * add forms post the arrangement with them, so a drag is never lost by adding something.
 */
function navEditorHtml(scope, message) {
  const { raw, mtime } = rail.loadLayout();
  const own = rail.scopeLayout(raw, scope);
  const seen = rail.seenFor(scope);
  const hidden = new Set(own.hidden);
  const customById = new Map(own.items.map((it) => [it.id, it]));

  // The groups this scope has drawn, in the order it has them, then anything the layout names that the
  // rail has not drawn lately — kept, so a hidden entry survives a page that has not been opened yet.
  // What each region holds: what the layout put there, then what the navigation has actually DRAWN
  // there. Without the second half a placement the dashboard ships — the assistant, the version, the
  // screens count — is invisible here, so saving wrote it into a sidebar group and the default it was
  // sitting on stopped applying. The editor has to be able to see what it is arranging.
  const regionIds = Object.fromEntries(rail.REGIONS.map((r) => {
    const drawn = Object.keys(((seen[`topbar-${r}`]) || {}).items || {});
    return [r, [...new Set([...own.topbar[r], ...drawn])].filter((id) => !hidden.has(id))];
  }));
  const inTopbar = new Set(rail.REGIONS.flatMap((r) => regionIds[r]));
  // The sidebar's own groups. The topbar regions are recorded in the same registry so their entries keep
  // their labels, but they are drawn as their own lists below, not as sidebar groups.
  const groupIds = [...new Set([...own.groups, ...Object.keys(seen)])]
    .filter((g) => !rail.TOPBAR_GROUPS.includes(g))
    .filter((g) => seen[g] || own.order[g]);
  const groups = groupIds.map((g) => {
    const label = (seen[g] && seen[g].label) || g;
    const ids = [...new Set([...(own.order[g] || []), ...Object.keys((seen[g] || {}).items || {})])]
      .filter((id) => !hidden.has(id) && !inTopbar.has(id));
    return { id: g, label, ids };
  });
  // An entry you added shows in the group it joins, the same rule the rail applies — without this it
  // renders on the rail but not here, so it could be neither moved nor removed.
  const byId = new Map(groups.map((g) => [g.id, g]));
  for (const item of own.items) {
    if (hidden.has(item.id) || inTopbar.has(item.id)) continue;
    const asked = rail.regionOf(item.group);
    if (asked) { regionIds[asked].push(item.id); inTopbar.add(item.id); continue; }
    const wanted = rail.isId(item.group) ? item.group : 'yours';
    const g = byId.get(wanted);
    if (g) { if (!g.ids.includes(item.id)) g.ids.push(item.id); continue; }
    const made = { id: wanted, label: wanted === 'yours' ? 'Yours' : item.group, ids: [item.id] };
    groups.push(made);
    byId.set(wanted, made);
  }

  const seenItem = (id) => {
    for (const g of Object.values(seen)) if (g.items && g.items[id] !== undefined) return g.items[id];
    return undefined;
  };
  const labelOf = (id) => {
    const v = seenItem(id);
    if (v !== undefined) return rail.seenLabel(v);
    const c = customById.get(id);
    return c ? c.label : id;
  };
  // What this entry ships as, so the control can offer to put back what the dashboard left out.
  const shipsAs = (id) => rail.seenShips(seenItem(id));

  // What it is right now: the layout's answer if there is one, otherwise the way the entry ships.
  const shownAs = (id) => {
    const asked = own.show[id];
    if (asked) return asked === 'both' ? 'both' : asked;
    return shipsAs(id) || 'both';
  };
  const hiddenCards = own.hidden.map((id) => entryCard(id, labelOf(id), 'hidden',
    customById.has(id) ? { scope } : null, shownAs(id))).join('');

  const commands = cc.loadCatalog().commands
    .filter((c) => c.on === 'workspace' || c.on === 'project')
    .map((c) => `<option value="${esc(c.id)}">${esc(c.label)} — ${esc(cc.ON[c.on] || c.on)}</option>`).join('');

  return `<div id="nav-editor">
    ${message || ''}
    ${scopeTabsHtml(scope)}
    <p class="uk-text-meta">${scope === 'global'
      ? 'The navigation on every page. A workspace can add to this, or hide something from it, on its own tab.'
      : `The navigation on the ${esc((loadWorkspaces()[scope] || {}).label || scope)} pages. Applied after the global one.`}
      Drag an entry between the sidebar groups, up into a region of the top bar, or into Hidden; drag a
      group by its handle to move the whole group. Each entry says how much of itself is shown — the icon,
      the text, or both — wherever it sits. Hiding is presentation only: what an entry opened still answers.</p>

    <!-- The group each entry posts is rewritten from the list it sits in, just before the request:
         dragging moves the element, not the value it was rendered with. -->
    <form id="nav-form" hx-post="/actions/nav-save" hx-target="#nav-editor" hx-swap="outerHTML"
          hx-on::before:request="window.navSyncGroups && window.navSyncGroups()">
      <input type="hidden" name="scope" value="${esc(scope)}">
      <input type="hidden" name="mtime" value="${mtime}">
      <section class="nav-place nav-place-topbar">
        <header class="nav-place-head"><strong>Navigation topbar</strong>
          <span class="uk-text-meta">· across the top of every page, in three regions</span></header>
        <div class="nav-regions">
          ${rail.REGIONS.map((r) => `<div class="nav-region" data-region="${r}">
            <span class="nav-region-label">${esc(rail.TOPBAR_LABELS[r].replace('Topbar ', ''))}</span>
            <ol class="nav-entries" data-group="topbar-${r}" uk-sortable="group: nav-entries; handle: .nav-handle">
              ${regionIds[r]
                .map((id) => entryCard(id, labelOf(id), `topbar-${r}`, customById.has(id) ? { scope } : null, shownAs(id))).join('')}
            </ol>
          </div>`).join('')}
        </div>
      </section>

      <header class="nav-place-head"><strong>Navigation sidebar</strong>
        <span class="uk-text-meta">· the rail down the right of every page</span></header>
      <ol class="nav-groups" uk-sortable="handle: .nav-handle-group">
        ${groups.map((g) => `<li class="nav-group" data-group="${esc(g.id)}">
          <input type="hidden" name="group" value="${esc(g.id)}">
          <header class="nav-group-head">
            <span class="nav-handle nav-handle-group" title="Drag to move this group">${icon('table')}</span>
            <strong>${esc(g.label)}</strong>
          </header>
          <ol class="nav-entries" data-group="${esc(g.id)}" uk-sortable="group: nav-entries; handle: .nav-handle">
            ${g.ids.map((id) => entryCard(id, labelOf(id), g.id, customById.has(id) ? { scope } : null, shownAs(id))).join('')}
          </ol>
        </li>`).join('')}
      </ol>

      <section class="nav-group nav-group-hidden">
        <header class="nav-group-head"><strong>Hidden</strong> <span class="uk-text-meta">· not shown on these pages</span></header>
        <ol class="nav-entries" data-group="hidden" uk-sortable="group: nav-entries; handle: .nav-handle">${hiddenCards}</ol>
      </section>

      <p class="nav-save">
        <button class="uk-button uk-button-primary" type="submit">${icon('check')} Save the navigation</button>
        <!-- Adding opens in the editor modal, like every other form on a long page here: the add card
             sat under a list of groups that can run past the fold, so the way to put something IN the
             navigation was the one thing you had to scroll to find. The form still posts the whole
             arrangement with it (hx-include), so a drag that has not been saved is not lost by adding. -->
        <button class="uk-button uk-button-default" type="button" title="Add a link or a command button"
                hx-get="/fragments/nav-add?scope=${encodeURIComponent(scope)}"
                hx-target="#editor-modal-body" hx-swap="innerHTML"
                hx-on::after:request="event.stopPropagation()">${icon('plus')} Add to this navigation</button>
        <button class="uk-button uk-button-default arm-step" type="button" title="Reset this scope"
                hx-post="/actions/nav-reset" hx-vals='${esc(JSON.stringify({ scope }))}'
                hx-target="#nav-editor" hx-swap="outerHTML" hx-trigger="confirmed-remove">${icon('refresh')} Reset</button>
      </p>
    </form>

  </div>`;
}


/**
 * The Add form, drawn into the editor modal.
 *
 * It posts the whole arrangement with it (`hx-include="#nav-form"`, which is still on the page behind
 * the modal), so a drag that has not been saved yet is not lost by adding something. The answer is the
 * editor, which is what the modal is covering — so the modal closes on the way out, success or not: a
 * refusal comes back as the editor with the reason at the top of it.
 */
function navAddFormHtml(scope) {
  const { raw } = rail.loadLayout();
  const seen = rail.seenFor(scope);
  const own = rail.scopeLayout(raw, scope);
  const groups = [...new Set([...own.groups, ...Object.keys(seen)])]
    .filter((g) => !rail.TOPBAR_GROUPS.includes(g))
    .map((g) => ({ id: g, label: (seen[g] && seen[g].label) || g }));
  const commands = cc.loadCatalog().commands
    .filter((c) => c.on === 'workspace' || c.on === 'project')
    .map((c) => `<option value="${esc(c.id)}">${esc(c.label)} — ${esc(cc.ON[c.on] || c.on)}</option>`).join('');

  return `<div class="editor-card nav-add">
    <h3 class="uk-margin-small-bottom">Add to this navigation</h3>
    <p class="uk-text-meta">A link goes somewhere; a button runs a command from the catalog, with the same
      confirm dialog and the same history a row action has. An address outside this dashboard opens in a new tab.</p>
    <form class="nav-add-form" hx-post="/actions/nav-add" hx-include="#nav-form"
          hx-target="#nav-editor" hx-swap="outerHTML"
          hx-on::before:request="window.navSyncGroups && window.navSyncGroups()"
          hx-on::after:request="window.UIkit && UIkit.modal('#editor-modal').hide()">
      <div class="uk-grid-small uk-child-width-1-2@s" uk-grid>
        <div><label class="uk-form-label" for="nav-add-label">Label</label>
          <input class="uk-input uk-form-small" id="nav-add-label" name="new_label" required placeholder="Jira" maxlength="40"></div>
        <div><label class="uk-form-label" for="nav-add-icon">Icon</label>
          <input class="uk-input uk-form-small" id="nav-add-icon" name="new_icon" placeholder="link" maxlength="40"
                 title="A UIKit icon name, or tabler:<name>"></div>
        <div><label class="uk-form-label" for="nav-add-group">Where it goes</label>
          <select class="uk-select uk-form-small" id="nav-add-group" name="new_group">
            <optgroup label="The navigation topbar">
              ${rail.REGIONS.map((r) => `<option value="topbar-${r}">${esc(rail.TOPBAR_LABELS[r])}</option>`).join('')}
            </optgroup>
            <optgroup label="The navigation sidebar">
              <option value="yours" selected>Yours — a group of its own, at the end</option>
              ${groups.map((g) => `<option value="${esc(g.id)}">${esc(g.label)}</option>`).join('')}
            </optgroup>
          </select></div>
        <div><label class="uk-form-label" for="nav-add-href">The address it opens</label>
          <input class="uk-input uk-form-small" id="nav-add-href" name="new_href" placeholder="https://vardot.atlassian.net"></div>
        <div><label class="uk-form-label" for="nav-add-use">…or the command it runs</label>
          <select class="uk-select uk-form-small" id="nav-add-use" name="new_use">
            <option value="">— a link, not a command —</option>
            ${commands}
          </select></div>
        <div><label class="uk-form-label uk-margin-small-top">
          <input class="uk-checkbox" type="checkbox" name="new_confirm" value="1"> Ask before it runs</label></div>
      </div>
      <p><button class="uk-button uk-button-primary" type="submit">${icon('plus')} Add it</button></p>
    </form>
  </div>`;
}

module.exports = { navEditorHtml, navAddFormHtml, scopeTabsHtml };
