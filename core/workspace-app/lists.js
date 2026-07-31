/**
 * Search, sort, filter and paging for the dashboard's lists.
 *
 * Every list in the dashboard — projects, items, backups — is the contents of a directory, and a
 * directory grows. The workspaces that hold builds pass a hundred rows on a working machine, and a
 * page that renders all of them is both slow to build and useless to read.
 *
 * One state object covers all of it: what was searched for, how it is ordered, which page, how many
 * rows, and (for projects) which status. The lists differ in what they hold, not in how they are
 * narrowed, so they share this and pass their own accessor for the searchable text.
 */

const path = require('path');
const { esc } = require('./html');
const { loadYaml, CONFIG_DIR, hubDomain } = require('./workspaces');
const { fieldConfig } = require('./settings');

// The sizes a pager offers, and the only values a `per` is accepted as.
//
// Read from the same `settings-fields.yml` enum the settings form builds its dropdown from, rather
// than written out here as well. Two lists meant two answers: the form offered 20 and 200, this
// accepted neither, and choosing one in Settings did nothing and said nothing.
//
// 'all' is a real choice, not a nicety: several workspaces hold a handful of rows and a pager on a
// list of six is furniture.
const FALLBACK_PAGE_SIZES = [10, 25, 50, 100, 'all'];
function pageSizes() {
  const listed = (fieldConfig().enums['style.page_size'] || []).map(([value]) => value);
  if (!listed.length) return FALLBACK_PAGE_SIZES;   // no fields file: the pager still works
  return listed.map((v) => (v === 'all' ? 'all' : Number(v))).filter((v) => v === 'all' || Number.isFinite(v));
}

const SORTS = {
  newest:   { label: 'Newest first', cmp: (a, b) => b.mtime - a.mtime || a.name.localeCompare(b.name) },
  oldest:   { label: 'Oldest first', cmp: (a, b) => a.mtime - b.mtime || a.name.localeCompare(b.name) },
  name:     { label: 'Name (A–Z)',   cmp: (a, b) => a.name.localeCompare(b.name) },
  nameDesc: { label: 'Name (Z–A)',   cmp: (a, b) => b.name.localeCompare(a.name) },
};

// What a project list can be narrowed to. Keyed, so an unknown value falls back to 'all' rather
// than silently showing nothing.
//
// `empty` is written out per filter rather than composed from the label: "No projects are no DDEV
// config" is what composing gets you, and only two of these five read as an adjective.
const PROJECT_FILTERS = {
  all:     { label: 'All',               empty: (n) => `No ${n} here.` },
  running: { label: 'Running',           empty: (n) => `No ${n} are running.` },
  stopped: { label: 'Stopped',           empty: (n) => `Every DDEV ${n.replace(/s$/, '')} here is running.` },
  noddev:  { label: 'No DDEV config',    empty: (n) => `Every ${n.replace(/s$/, '')} here is a DDEV project.` },
  tested:  { label: 'Has a test report', empty: (n) => `No ${n} have a test report yet.` },
};

function styleSettings() {
  return loadYaml(path.join(CONFIG_DIR, 'settings.yml')).style || {};
}

// settings.yml sets the starting point for every list; the pager overrides it for this browser.
// An unusable value falls back to a size the pager actually offers — falling back to one that is
// not in the dropdown leaves the pager showing a selection nothing is selected on.
function defaultPageSize() {
  const sizes = pageSizes();
  const raw = styleSettings().page_size;
  if (sizes.map(String).includes(String(raw))) return raw === 'all' ? 'all' : Number(raw);
  const numeric = sizes.filter((s) => s !== 'all');
  return numeric.length ? numeric[Math.min(1, numeric.length - 1)] : 'all';
}

function defaultSort() {
  const raw = styleSettings().page_sort;
  return SORTS[raw] ? raw : 'newest';
}

/**
 * A state with nothing chosen: what settings.yml says, no search, page one.
 *
 * Every list renderer starts from this rather than from a bare `state` parameter. A caller that
 * forgets to pass one would otherwise reach `state.sort` on undefined and throw mid-render — and a
 * handler that throws after its response has started is what took the whole dashboard down once
 * already. A default costs nothing and there is no state a list cannot be drawn in.
 */
function defaultListState() {
  return {
    per: defaultPageSize(),
    page: 1,
    perFromQuery: false,
    q: '',
    sort: defaultSort(),
    status: 'all',
    auto: true,
    autoFromQuery: false,
  };
}

/**
 * The list state for one request: the query string first, then the remembered preference.
 *
 * Size and auto-search stick in a COOKIE rather than localStorage. The dashboard spans
 * <workspace>.<hub> subdomains and localStorage is per-origin, so a choice made on the hub would be
 * forgotten the moment you followed a rail link. Scoping the cookie to the hub domain makes every
 * workspace subdomain read the one value.
 */
function readListState(req) {
  const url = new URL(req.url, 'http://localhost');
  const cookies = Object.fromEntries((req.headers.cookie || '').split(';')
    .map((c) => c.trim().split('='))
    .filter((p) => p.length === 2));
  const rawPer = url.searchParams.get('per') ?? cookies['ws-per'];
  const validPer = pageSizes().map(String).includes(String(rawPer));
  const sort = url.searchParams.get('sort') || '';
  const status = url.searchParams.get('status') || '';
  return {
    per: validPer ? (rawPer === 'all' ? 'all' : Number(rawPer)) : defaultPageSize(),
    page: Math.max(1, Number(url.searchParams.get('page')) || 1),
    perFromQuery: url.searchParams.has('per'),
    q: (url.searchParams.get('q') || '').trim().slice(0, 200),
    sort: SORTS[sort] ? sort : defaultSort(),
    status: PROJECT_FILTERS[status] ? status : 'all',
    // Search as you type, or only when asked. Remembered per browser like the page size. getAll,
    // not get: the checkbox posts its name twice (a hidden 0, then the box itself) and get()
    // returns the FIRST, which would read a ticked box as off. The box is emitted second, so the
    // last value is the answer — and that pair is what makes an unticked box mean "off" rather
    // than "unspecified", since an unticked checkbox sends nothing at all.
    auto: url.searchParams.has('auto')
      ? url.searchParams.getAll('auto').slice(-1)[0] === '1'
      : (cookies['ws-autosearch'] ?? '1') === '1',
    autoFromQuery: url.searchParams.has('auto'),
  };
}

// Remember an explicit choice for the next request — only when it was explicit. A plain page-2
// click must not rewrite the preference.
function setListCookies(res, state) {
  const cookies = [];
  const attrs = `Path=/; Domain=.${hubDomain()}; Max-Age=31536000; SameSite=Lax`;
  if (state.perFromQuery) cookies.push(`ws-per=${state.per}; ${attrs}`);
  if (state.autoFromQuery) cookies.push(`ws-autosearch=${state.auto ? '1' : '0'}; ${attrs}`);
  if (cookies.length) res.setHeader('Set-Cookie', cookies);
}

/**
 * Clamps the page rather than trusting it: ?page=99 on a 3-page list shows the last page, and
 * deleting the only row on page 4 does not leave you staring at an empty one.
 */
function paginate(list, state) {
  const total = list.length;
  if (!state || state.per === 'all') {
    return { slice: list, page: 1, pages: 1, from: total ? 1 : 0, to: total, total };
  }
  const pages = Math.max(1, Math.ceil(total / state.per));
  const page = Math.min(Math.max(1, state.page), pages);
  const start = (page - 1) * state.per;
  const slice = list.slice(start, start + state.per);
  return { slice, page, pages, from: total ? start + 1 : 0, to: start + slice.length, total };
}

/**
 * Search, then sort, then page — in that order, so page 2 is page 2 of the matches rather than the
 * second page of everything with the non-matches removed.
 *
 * `textOf` returns what a row should be searched by. Rows carry `name` and `mtime`; a list whose
 * rows have no timestamp sorts by name whichever order is chosen, which is what a list of names
 * without dates can honestly do.
 */
function searchSortPage(list, state, textOf = (row) => row.name) {
  const st = state || defaultListState();
  const q = (st.q || '').toLowerCase();
  const matched = q ? list.filter((row) => String(textOf(row) || '').toLowerCase().includes(q)) : list.slice();
  const cmp = (SORTS[st.sort] || SORTS.name).cmp;
  matched.sort((a, b) => cmp({ name: a.name, mtime: a.mtime || 0 }, { name: b.name, mtime: b.mtime || 0 }));
  return paginate(matched, st);
}

/**
 * The search box, the sort, and any list-specific control.
 *
 * `url` is the fragment the list came from, so every control refetches exactly the list on screen
 * and leaves the rest of the page alone. Each control sends the others' values, so changing one
 * keeps the rest.
 */
function listControlsHtml(url, target, state, noun, extra) {
  const opts = Object.entries(SORTS)
    .map(([k, v]) => `<option value="${k}"${k === state.sort ? ' selected' : ''}>${esc(v.label)}</option>`)
    .join('');
  const auto = state.auto !== false;
  // 700ms rather than the couple of hundred a search box usually gets: a query here is several
  // words, and firing per keystroke made the list re-page under the cursor. With auto off nothing
  // is requested until Enter or the Search button, which is the calmer default for a long list.
  const trigger = auto ? "keyup changed delay:700ms, search" : "keyup[key=='Enter'], search";
  const get = `hx-get="${esc(url)}" hx-target="${esc(target)}" hx-swap="innerHTML"`;
  return `
    <div class="list-controls">
      <div class="lc-group lc-find">
        <input class="uk-input uk-form-small list-search" type="search" name="q" value="${esc(state.q)}"
               placeholder="Search ${esc(noun)}…" aria-label="Search ${esc(noun)}"
               ${get} hx-trigger="${trigger}"
               hx-include="closest .list-controls" hx-vals='{"page":"1"}'>
        <button class="uk-button uk-button-primary uk-button-small" type="button" ${get}
                hx-include="closest .list-controls" hx-vals='{"page":"1"}'
                title="Search now"><span uk-icon="icon: search; ratio: .7"></span> Search</button>
        <button class="uk-button uk-button-default uk-button-small list-reset" type="button"
                hx-get="${esc(url)}?page=1&amp;q=" hx-target="${esc(target)}" hx-swap="innerHTML"
                title="Clear the search and the filters"><span uk-icon="icon: close; ratio: .7"></span> Reset</button>
      </div>
      <div class="lc-rest">
        <div class="lc-group">
          <label class="uk-text-meta">Sort
            <select class="uk-select uk-form-small" name="sort" aria-label="Sort ${esc(noun)}"
                    ${get} hx-trigger="change" hx-include="closest .list-controls"
                    hx-vals='{"page":"1"}'>${opts}</select>
          </label>
        </div>
        ${extra ? `<div class="lc-group">${extra}</div>` : ''}
        <div class="lc-group">
          <label class="list-auto uk-text-meta" title="Search while you type, after a short pause. Off means Enter or the Search button.">
            <input type="hidden" name="auto" value="0">
            <input class="uk-checkbox" type="checkbox" name="auto" value="1" ${auto ? 'checked' : ''}
                   ${get} hx-trigger="change" hx-include="closest .list-controls" hx-vals='{"page":"1"}'>
            Auto-search
          </label>
        </div>
      </div>
    </div>`;
}

// The status filter, for the lists whose rows are projects.
function statusFilterHtml(url, target, state) {
  const opts = Object.entries(PROJECT_FILTERS)
    .map(([k, f]) => `<option value="${k}"${k === state.status ? ' selected' : ''}>${esc(f.label)}</option>`)
    .join('');
  return `
    <label class="uk-text-meta">Show
      <select class="uk-select uk-form-small" name="status" aria-label="Filter projects by status"
              hx-get="${esc(url)}" hx-target="${esc(target)}" hx-swap="innerHTML"
              hx-trigger="change" hx-include="closest .list-controls"
              hx-vals='{"page":"1"}'>${opts}</select>
    </label>`;
}

/**
 * The pager and the size chooser for one list.
 *
 * Both carry the current search and sort, so paging through a search stays inside it.
 */
function listPagerHtml(url, target, p, state, noun) {
  if (!p.total) return '';
  const per = state ? state.per : 'all';
  const keep = state
    ? `&q=${encodeURIComponent(state.q || '')}&sort=${encodeURIComponent(state.sort)}&status=${encodeURIComponent(state.status || 'all')}`
    : '';
  const step = (n, glyph, disabled, title) => (disabled
    ? `<span class="uk-button uk-button-default uk-button-small" aria-hidden="true" disabled>${glyph}</span>`
    : `<button class="uk-button uk-button-default uk-button-small" type="button" title="${esc(title)}"
        hx-get="${esc(url)}${url.includes('?') ? '&' : '?'}page=${n}&per=${per}${keep}"
        hx-target="${esc(target)}" hx-swap="innerHTML">${glyph}</button>`);
  // The select carries name="per", so HTMX sends its value; hx-vals adds page=1 — landing on page 7
  // of a list that now has two pages would otherwise show nothing.
  const sizer = `
    <label class="list-pager-size uk-text-meta">Show
      <select class="uk-select uk-form-small" name="per" aria-label="How many rows per page"
              hx-get="${esc(url)}${url.includes('?') ? '&' : '?'}${keep.slice(1)}" hx-target="${esc(target)}"
              hx-swap="innerHTML" hx-trigger="change"
              hx-vals='{"page":"1"}'>${pageSizes().map((s) => `<option value="${s}"${String(s) === String(per) ? ' selected' : ''}>${s === 'all' ? 'All' : s}</option>`).join('')}</select>
    </label>`;
  if (p.pages === 1) {
    return `<div class="list-pager">${sizer}<span class="uk-text-meta">${p.total} ${esc(noun)}</span></div>`;
  }
  return `
    <div class="list-pager">
      ${sizer}
      ${step(1, '«', p.page === 1, 'First page')}
      ${step(p.page - 1, '‹', p.page === 1, 'Previous page')}
      <span class="uk-text-meta">${p.from}–${p.to} of ${p.total} ${esc(noun)} · page ${p.page} of ${p.pages}</span>
      ${step(p.page + 1, '›', p.page === p.pages, 'Next page')}
      ${step(p.pages, '»', p.page === p.pages, 'Last page')}
    </div>`;
}

// What to say when a search matches nothing, as opposed to when there is nothing at all.
function emptyListHtml(state, noun, nothingYet) {
  if (state && state.q) {
    return `<p class="uk-text-meta">No ${esc(noun)} match “${esc(state.q)}”.</p>`;
  }
  const filter = state && PROJECT_FILTERS[state.status];
  if (filter && state.status !== 'all') {
    return `<p class="uk-text-meta">${esc(filter.empty(noun))}</p>`;
  }
  return `<p class="uk-text-meta">${nothingYet}</p>`;
}

module.exports = {
  pageSizes,
  defaultListState,
  PROJECT_FILTERS,
  SORTS,
  defaultPageSize,
  defaultSort,
  readListState,
  setListCookies,
  paginate,
  searchSortPage,
  listControlsHtml,
  statusFilterHtml,
  listPagerHtml,
  emptyListHtml,
};
