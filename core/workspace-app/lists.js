/**
 * Search, sort, filter and page — the controls every list on the dashboard shares.
 *
 * State travels in the query string and is remembered in a cookie per workspace, so a list you
 * left filtered is still filtered when you come back to it, and a link you paste carries what you
 * were looking at.
 */

const { esc } = require('./html');
// hubDomain as well as styleSettings: setPageCookie writes its cookies against the hub domain so a
// preference set on workspace.ddev.site is still in force on dev.workspace.ddev.site. It was used
// there without being imported, which made every list 500 the moment `auto` appeared in the query —
// that is, on the first click of the auto-search checkbox, on every list in the app.
const { styleSettings, hubDomain } = require('./workspaces');

// ---------------------------------------------------------------------------
// Paging, shared by every list in the dashboard.
//
// The lists outgrew the page: 111 videos, 165 commands, 112 modules. Every row was
// rendered on every request, which is a large page whose actions sit a screenful
// below the fold. Paging is server-side because the rows are server-rendered —
// hiding them with CSS would still send all of them.
//
// `all` stays one of the choices on purpose: it is what every one of these lists did
// before, and it is the right answer when you want the browser's own find across the
// whole set. It must remain reachable rather than be replaced by paging.
// Overridable with `style: page_size:`. Read per call, not captured, so a settings edit
// applies without a restart.
// The page size a list starts at: the settings file's value, or the shipped default. A size picked
// from a pager wins over it, because that choice is in a cookie — a default is not an override.
const defaultPageSize = () => {
  const v = styleSettings().pageSize;
  return v === 'all' ? 'all' : Number(v);
};

const PAGE_SIZES = [20, 50, 100, 200, 'all'];

// What a project list can be narrowed to. Keyed so an unknown value falls back to 'all'
// rather than showing nothing.
const PROJECT_FILTERS = {
  all:     'All',
  running: 'Running',
  stopped: 'Stopped',
  nodddev: 'No DDEV config',
  tested:  'Has a test report',
  failing: 'Has failing tests',
  // What is RUNNING in the project, not what the project is: a screen session, and the narrower case
  // of one with Claude Code inside it. Both read the same sources the row's SCREENS and agent badges
  // read, so a project that passes the filter is a project whose row says so.
  screens: 'Screens running',
  agents:  'Agent running',
};

const SORTS = {
  newest:  { label: 'Newest first', cmp: (a, b) => b.mtime - a.mtime || a.name.localeCompare(b.name) },
  oldest:  { label: 'Oldest first', cmp: (a, b) => a.mtime - b.mtime || a.name.localeCompare(b.name) },
  name:    { label: 'Name (A–Z)',   cmp: (a, b) => a.name.localeCompare(b.name) },
  nameDesc:{ label: 'Name (Z–A)',   cmp: (a, b) => b.name.localeCompare(a.name) },
  // File lists only: a project row has no size.
  size:    { label: 'Largest first', filesOnly: true, cmp: (a, b) => (b.size || 0) - (a.size || 0) || a.name.localeCompare(b.name) },
  // Agents, then screens, then the newest — the projects somebody is working in come first. It reads
  // fields only a PROJECT row carries, so it is offered on project lists alone (`projectsOnly`) and
  // treats a missing count as none, which keeps a hand-typed `?sort=active` on any other list harmless.
  active:  { label: 'Active first', projectsOnly: true,
    cmp: (a, b) => (b.agents || 0) - (a.agents || 0) || (b.screens || 0) - (a.screens || 0)
      || b.mtime - a.mtime || a.name.localeCompare(b.name) },
};

const defaultSort = () => styleSettings().pageSort;

// The chosen size sticks in a COOKIE, not localStorage. The dashboard spans
// <workspace>.<hub> subdomains and localStorage is per-origin, so a choice made on
// the hub would be forgotten the moment you follow a rail link — the same limitation
// the theme and rail-collapsed preferences already have. Scoping the cookie to the
// hub domain makes every workspace subdomain read the one value.
//
// `list` names a list whose search, sort and filter STICK ("dev/projects", "ai-agents/items"): what
// was last chosen on it is read from a cookie when the request does not say, so a workspace opens the
// way it was left. A request that does say — any of q, sort, status, kind — wins and is remembered; a
// request carrying `reset` clears it. Without `list` nothing sticks, which is every other list.
function readPageState(req, list) {
  const url = new URL(req.url, 'http://localhost');
  const cookies = Object.fromEntries((req.headers.cookie || '').split(';')
    .map((c) => c.trim().split('=')).filter((p) => p.length === 2));
  const raw = url.searchParams.get('per') ?? cookies['ws-per'];
  const valid = PAGE_SIZES.map(String).includes(String(raw));
  const params = url.searchParams;
  const views = readViews(cookies);
  const saved = list ? (views[list] || {}) : {};
  const reset = params.has('reset');
  // What the request says, else what was last chosen, else nothing. Everything goes through the same
  // checks below whichever way it arrived: a cookie is as untrusted as a query string.
  const field = (k) => (params.has(k) ? params.get(k) : (reset ? '' : String(saved[k] ?? '')));
  const sort = field('sort');
  const status = PROJECT_FILTERS[field('status')] ? field('status') : 'all';
  const state = {
    per: valid ? (raw === 'all' ? 'all' : Number(raw)) : defaultPageSize(),
    page: Math.max(1, Number(url.searchParams.get('page')) || 1),
    fromQuery: url.searchParams.has('per'),
    q: (field('q') || '').trim().slice(0, 200),
    sort: SORTS[sort] ? sort : defaultSort(),
    status,
    // Which workspace folder a list is narrowed to. Sanitised to the shape a folder name can have
    // rather than checked against the real ones — this module does not know what exists, and the
    // page that does simply matches nothing for a name that is not there.
    ws: (url.searchParams.get('ws') || 'all').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || 'all',
    // Which subfolder a file list is showing. Kept to the characters a path can hold and to a
    // sane depth; whether it EXISTS, and whether it is inside the workspace, is decided by the page
    // that has the workspace in hand — this module knows nothing about the filesystem.
    path: (url.searchParams.get('path') || '').replace(/[^a-zA-Z0-9_./ '&()+,@\-]/g, '').slice(0, 400),
    // What a file list is showing: folders first, files first, one or the other alone, or one kind of
    // file. Sanitised to a slug here; which slugs MEAN anything is the file list's business.
    kind: (field('kind') || '').replace(/[^a-z-]/g, '').slice(0, 20),
    // The images gallery: this workspace, or every media image read-only.
    scope: url.searchParams.get('scope') === 'all' ? 'all' : 'here',
    // Search as you type, or only when asked. Remembered per browser like the page size; the
    // hidden companion below is what makes an unchecked box mean "off" rather than "unspecified".
    // getAll, not get: the checkbox posts its name twice (hidden 0, then the box) and get()
    // returns the FIRST — which would read a ticked box as off. The box is emitted second, so
    // the last value is the answer.
    auto: url.searchParams.has('auto')
      ? url.searchParams.getAll('auto').slice(-1)[0] === '1'
      : (cookies['ws-autosearch'] ?? '1') === '1',
    autoFromQuery: url.searchParams.has('auto'),
  };
  // What to write back: only when this request CHOSE something. A poll that carries none of the four
  // must not rewrite the preference, exactly as a plain page-2 click must not.
  const chose = reset || ['q', 'sort', 'status', 'kind'].some((k) => params.has(k));
  state.view = list && chose ? { list, map: nextViews(views, list, state) } : null;
  return state;
}

// The sticky choices of every list, in ONE cookie — a cookie per list would put twenty-odd of them on
// every request to every project site under the hub domain (the cookie is scoped to it), and a request
// header that grows with the number of workspaces is how a proxy ends up refusing it. Only what
// differs from the default is stored, so a list left alone costs nothing.
const VIEW_COOKIE = 'ws-view';
const VIEW_MAX_LISTS = 40;
const VIEW_MAX_BYTES = 3000;

function readViews(cookies) {
  try {
    const v = JSON.parse(decodeURIComponent(cookies[VIEW_COOKIE] || ''));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch (_) { return {}; }
}

function nextViews(views, list, state) {
  const entry = {};
  if (state.q) entry.q = state.q;
  if (state.sort !== defaultSort()) entry.sort = state.sort;
  if (state.status && state.status !== 'all') entry.status = state.status;
  if (state.kind) entry.kind = state.kind;
  const next = { ...views };
  delete next[list];                                   // re-added last, so it is the newest entry
  if (Object.keys(entry).length) next[list] = entry;
  // Bounded: the oldest lists go first.
  const keys = Object.keys(next);
  while (keys.length > 1 && (keys.length > VIEW_MAX_LISTS
    || encodeURIComponent(JSON.stringify(next)).length > VIEW_MAX_BYTES)) delete next[keys.shift()];
  return next;
}

// Remember an explicit choice for the next request. Only when it was explicit: a
// plain page-2 click must not rewrite the preference.
function setPageCookie(res, state) {
  const cookies = [];
  if (state.fromQuery) {
    cookies.push(`ws-per=${state.per}; Path=/; Domain=.${hubDomain()}; Max-Age=31536000; SameSite=Lax`);
  }
  if (state.autoFromQuery) {
    cookies.push(`ws-autosearch=${state.auto ? '1' : '0'}; Path=/; Domain=.${hubDomain()}; Max-Age=31536000; SameSite=Lax`);
  }
  if (state.view) {
    const domain = `Path=/; Domain=.${hubDomain()}; SameSite=Lax`;
    cookies.push(Object.keys(state.view.map).length
      ? `${VIEW_COOKIE}=${encodeURIComponent(JSON.stringify(state.view.map))}; ${domain}; Max-Age=31536000`
      : `${VIEW_COOKIE}=; ${domain}; Max-Age=0`);
  }
  if (cookies.length) res.setHeader('Set-Cookie', cookies);
}

// Clamps the page rather than trusting it: ?page=99 on a 3-page list shows the last
// page, and deleting the only row on page 4 does not leave you staring at an empty one.
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

// Search and sort for one list. Typing re-fetches on a 220ms debounce; both controls
// send the other's value, so changing one keeps the other.
function listControlsHtml(url, target, state, noun, extra, hidden, opts) {
  // Values this list carries that are not search or sort — today, the folder a file list is showing.
  // They ride as hidden inputs (so `hx-include` sends them with every control) and are rebuilt into
  // Reset's URL, because Reset builds its own link and would otherwise land you at the top of the
  // workspace rather than clearing the search where you stand.
  const carried = Object.entries(hidden || {}).filter(([, v]) => v !== undefined && v !== null && v !== '');
  const carriedInputs = carried.map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('');
  // `reset` is what clears a list that sticks: leaving the sort and the filter out of this link used to
  // mean "back to the defaults", and with a remembered choice it would mean "back to what was saved".
  const resetQs = new URLSearchParams([['page', '1'], ['q', ''], ['reset', '1'], ...carried.map(([k, v]) => [k, String(v)])]);
  // A sort that reads fields only a project row has is offered on project lists alone (`projectSorts`).
  const sortOpts = Object.entries(SORTS)
    .filter(([, v]) => !v.projectsOnly || (opts && opts.projectSorts))
    .filter(([, v]) => !v.filesOnly || (opts && opts.fileSorts))
    .map(([k, v]) => `<option value="${k}"${k === state.sort ? ' selected' : ''}>${esc(v.label)}</option>`).join('');
  const auto = state.auto !== false;
  // With auto on the wait is 700ms, not the 220ms this started at: a query is several words and
  // firing per keystroke made the list flicker and re-page under the cursor. With auto off
  // nothing is requested until Enter or the Search button, which is the calmer default for a
  // long list on a slow tree.
  const trigger = auto ? "keyup changed delay:700ms, search" : "keyup[key=='Enter'], search";
  return `
    <div class="list-controls">
      ${carriedInputs}
      <div class="lc-group lc-find">
      <input class="uk-input uk-form-small list-search" type="search" name="q" value="${esc(state.q)}"
             placeholder="Search ${esc(noun)}…" aria-label="Search ${esc(noun)}"
             hx-get="${esc(url)}" hx-target="${esc(target)}" hx-swap="innerHTML"
             hx-trigger="${trigger}"
             hx-include="closest .list-controls" hx-vals='{"page":"1"}'>
      <button class="uk-button uk-button-primary uk-button-small" type="button"
              hx-get="${esc(url)}" hx-target="${esc(target)}" hx-swap="innerHTML"
              hx-include="closest .list-controls" hx-vals='{"page":"1"}'
              title="Search now"><span uk-icon="icon: search; ratio: .7"></span> Search</button>
      <button class="uk-button uk-button-default uk-button-small list-reset" type="button"
              hx-get="${esc(url)}?${esc(resetQs.toString())}" hx-target="${esc(target)}" hx-swap="innerHTML"
              title="Clear the search and the filters"><span uk-icon="icon: close; ratio: .7"></span> Reset</button>
      </div>
      <div class="lc-rest">
        <div class="lc-group">
          <label class="uk-text-meta">Sort
            <select class="uk-select uk-form-small" name="sort" aria-label="Sort ${esc(noun)}"
                    hx-get="${esc(url)}" hx-target="${esc(target)}" hx-swap="innerHTML"
                    hx-trigger="change" hx-include="closest .list-controls" hx-vals='{"page":"1"}'>${sortOpts}</select>
          </label>
        </div>
        ${(Array.isArray(extra) ? extra : [extra]).filter(Boolean).map((x) => `<div class="lc-group">${x}</div>`).join('')}
        <div class="lc-group">
          <label class="list-auto uk-text-meta" title="Search while you type, after a short pause. Off means Enter or the Search button.">
            <input type="hidden" name="auto" value="0">
            <input class="uk-checkbox" type="checkbox" name="auto" value="1" ${auto ? 'checked' : ''}
                   hx-get="${esc(url)}" hx-target="${esc(target)}" hx-swap="innerHTML"
                   hx-trigger="change" hx-include="closest .list-controls" hx-vals='{"page":"1"}'>
            Auto-search
          </label>
        </div>
      </div>
    </div>`;
}

// The pager and the size chooser for one list. `url` is the fragment the list came
// from, so paging refetches exactly the list on screen and leaves the rest of the
// page alone.
function listPagerHtml(url, target, p, state, noun) {
  if (!p.total) return '';
  const per = state ? state.per : 'all';
  const step = (n, glyph, disabled, title) => disabled
    ? `<span class="uk-button uk-button-default uk-button-small" aria-hidden="true" disabled>${glyph}</span>`
    : `<button class="uk-button uk-button-default uk-button-small" title="${esc(title)}"
        hx-get="${esc(url)}${url.includes('?') ? '&' : '?'}page=${n}&per=${per}"
        hx-target="${esc(target)}" hx-swap="innerHTML">${glyph}</button>`;
  // The select carries name="per", so HTMX sends its value; hx-vals adds page=1 —
  // landing on page 7 of a list that now has 2 pages would otherwise show nothing.
  const sizer = `
    <label class="list-pager-size uk-text-meta">Per page
      <select class="uk-select uk-form-small" name="per" aria-label="How many rows per page"
              hx-get="${esc(url)}" hx-target="${esc(target)}" hx-swap="innerHTML"
              hx-trigger="change" hx-vals='{"page":"1"}'>${PAGE_SIZES.map((s) => `<option value="${s}"${String(s) === String(per) ? ' selected' : ''}>${s === 'all' ? 'All' : s}</option>`).join('')}</select>
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

module.exports = { PAGE_SIZES, defaultPageSize, PROJECT_FILTERS, SORTS, defaultSort, readPageState, setPageCookie, paginate, listControlsHtml, listPagerHtml };
