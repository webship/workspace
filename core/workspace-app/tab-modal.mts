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
 *
 * On a phone the filter and the list fold behind a button that says the tab you are on (#669): the list
 * took the top of the screen and the tab's content what was left. The button is drawn always and shown
 * only below 640px (tab-modal.css), so wider screens are as they were.
 */

import { esc } from './html.mts';
import { iconHtml } from './icons.mts';

/** One tab: its fragment URL is loaded into the pane when it is chosen. */
export interface Tab { id: string; label: string; url: string; icon?: string; hint?: string; badge?: string; badgeTone?: string }

/** A group of tabs, with a label for the eye. */
export interface TabGroup { id: string; label: string; tabs: Tab[] }

/** What a tabbed modal is made from. */
export interface TabModalOptions {
  /** Names the modal in the address: #<id>/<tab>. */
  id: string;
  /** The heading of the left column. */
  title: string;
  subtitle?: string;
  /** A way out above the tabs, loaded into the whole modal. */
  back?: { label: string; url: string } | null;
  /** A filter box above the tabs, for a long list. */
  filter?: boolean;
  /** Keep #<id>/<tab> in the address, so the place can be linked to and reopened. */
  hash?: boolean;
  groups: TabGroup[];
  /** The tab to open on; the first one when it is not found. */
  active?: string;
}

/** The modal (see TabModalOptions). */
export function tabModalHtml({ id, title, subtitle = '', back = null, filter = false, hash = false, groups, active = '' }: TabModalOptions): string {
  const all = groups.flatMap((g) => g.tabs);
  const current = all.find((t) => t.id === active) || all[0];
  if (!current) return '<div class="msg error">Nothing to show here.</div>';
  const pane = `tm-${id}-pane`;
  // A tab says its name, then (after a pause a screen reader can hear) what it wants and which group it
  // is in. The group's printed label is for the eye only: inside a tablist a label is not a tab, so it is
  // hidden from assistive technology and the group goes into each tab's name instead.
  const tab = (t: Tab, group = ''): string => {
    const on = t === current;
    return `<button type="button" role="tab" class="tabmodal-tab${on ? ' is-selected' : ''}"
        id="tm-${esc(id)}-${esc(t.id)}" data-tab="${esc(t.id)}" data-label="${esc(t.label)}"
        data-hint="${esc(t.hint || '')}" aria-selected="${on ? 'true' : 'false'}" aria-controls="${esc(pane)}"
        tabindex="${on ? '0' : '-1'}" hx-get="${esc(t.url)}" hx-target="#${esc(pane)}" hx-swap="innerHTML" hx-sync="closest [role=tablist]:replace">
        ${iconHtml(t.icon || 'tabler:point', 0.9)}<span class="tabmodal-tab-label">${esc(t.label)}</span>${t.badge ? `<span class="uk-hidden-visually">, </span><span class="tabmodal-badge${t.badgeTone ? ` is-${esc(t.badgeTone)}` : ''}">${esc(t.badge)}</span>` : ''}${group ? `<span class="uk-hidden-visually">, ${esc(group)}</span>` : ''}
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
    <button type="button" class="tabmodal-toggle" aria-expanded="false" aria-controls="tm-${esc(id)}-list">
      ${iconHtml(current.icon || 'tabler:point', 0.9)}<span class="tabmodal-toggle-label">${esc(current.label)}</span><span class="uk-hidden-visually">: choose another tab</span>${iconHtml('tabler:chevron-down', 0.8)}
    </button>
    <div class="tabmodal-list" id="tm-${esc(id)}-list">
    ${filter ? `<input type="search" class="tabmodal-filter uk-input uk-form-small" placeholder="Filter" aria-label="Filter ${esc(title)}" aria-describedby="tm-${esc(id)}-filter-status" autocomplete="off">
    <p class="tabmodal-filter-status" id="tm-${esc(id)}-filter-status" role="status" data-total="${all.length}"></p>` : ''}
    <div class="tabmodal-tabs" role="tablist" aria-orientation="vertical" aria-label="${esc(title)}">
      ${groups.map((g) => `
      <div class="tabmodal-group" role="presentation" data-group="${esc(g.id)}">
        ${g.label ? `<p class="tabmodal-group-label" aria-hidden="true">${esc(g.label)}</p>` : ''}
        ${g.tabs.map((t) => tab(t, g.label)).join('')}
      </div>`).join('')}
    </div>
    </div>
  </nav>
  <section class="tabmodal-main">
    <header class="tabmodal-head">
      <h2 class="tabmodal-heading">${esc(current.label)}</h2>
      <span class="tabmodal-sub uk-text-meta">${esc(current.hint || '')}</span>
      <p class="tabmodal-status uk-hidden-visually" role="status"></p>
    </header>
    <div class="tabmodal-pane" id="${esc(pane)}" role="tabpanel" aria-labelledby="tm-${esc(id)}-${esc(current.id)}"
         tabindex="0" aria-busy="true">
      <div class="tabmodal-loading" hx-get="${esc(current.url)}" hx-trigger="load" hx-target="#${esc(pane)}" hx-swap="innerHTML">
        <span class="uk-text-meta">Loading…</span>
      </div>
    </div>
  </section>
</div>`;
}
