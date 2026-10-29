/**
 * The images workspace page: a gallery of thumbnails, the viewer in the editor modal, and the thumbnail
 * and dashboard-screenshot files they show.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const { esc } = require('./html');
const { humanSize, humanTime } = require('./format');
const { iconHtml } = require('./icons');
const { ROOT, hubDomain, workspaceDir } = require('./workspaces');
const lists = require('./lists');
const images = require('./images');

const TARGET = '#webship-workspace-projects';
const encodePath = (rel) => String(rel).split('/').map(encodeURIComponent).join('/');

/** Where the browser loads an image of a source from. */
function fileUrl(src, rel) {
  return src === images.APP_SHOTS
    ? `/fragments/images/app-file/${encodePath(rel)}`
    : `/files/${encodeURIComponent(src)}/${encodePath(rel)}`;
}
const thumbUrl = (src, rel) => `/fragments/images/thumb?v=2&src=${encodeURIComponent(src)}&path=${encodeURIComponent(rel)}`;
const sourceLabel = (src) => (src === images.APP_SHOTS ? 'dashboard screenshots' : src);

/** The list the state asks for, in order: the same one the gallery draws and the viewer steps through. */
function currentList(st, rel) {
  const all = st.scope === 'all';
  const base = all
    ? images.scanEverywhere()
    : images.listFolder(workspaceDir('images'), rel).images.map((im) => ({ ...im, src: 'images' }));
  const q = (st.q || '').toLowerCase();
  const kind = images.TYPES.includes(st.kind) ? st.kind : '';
  const cmp = (lists.SORTS[st.sort] || lists.SORTS.newest).cmp;
  return base
    .filter((im) => (!kind || im.type === kind) && (!q || `${im.src}/${im.rel}`.toLowerCase().includes(q)))
    .sort(cmp);
}

function query(st, rel, extra = {}) {
  const qs = new URLSearchParams();
  if (st.q) qs.set('q', st.q);
  if (st.sort && st.sort !== lists.defaultSort()) qs.set('sort', st.sort);
  if (images.TYPES.includes(st.kind)) qs.set('kind', st.kind);
  if (st.scope === 'all') qs.set('scope', 'all');
  else if (rel) qs.set('path', rel);
  for (const [k, v] of Object.entries(extra)) qs.set(k, v);
  return qs.toString();
}

/** One image as a card in the shared file list: the same row the docs and videos lists draw. */
function cardHtml(im, st, rel) {
  const view = `/fragments/images/view?${query(st, rel, { src: im.src, file: im.rel })}`;
  const url = fileUrl(im.src, im.rel);
  const dims = im.width && im.height ? `${im.width}×${im.height}` : '';
  const open = `hx-get="${esc(view)}" hx-target="#editor-modal-body" hx-swap="innerHTML"`;
  const where = st.scope === 'all'
    ? `<span class="fx-source" title="${esc(`${sourceLabel(im.src)}/${im.rel}`)}">${esc(sourceLabel(im.src))}${im.rel.includes('/') ? ` › ${esc(im.rel.split('/').slice(0, -1).join('/'))}` : ''}</span>`
    : '';
  const own = im.src === 'images';
  const menu = `<div class="uk-inline fx-menu">
      <button class="uk-button uk-button-link fx-more" type="button" title="More for ${esc(im.name)}"
        aria-label="More actions for ${esc(im.name)}">${iconHtml('tabler:dots', 0.8)}</button>
      <div uk-dropdown="mode: click; pos: bottom-right"><ul class="uk-nav uk-dropdown-nav">
        <li><a href="${esc(url)}" target="_blank" rel="noopener"><span uk-icon="icon: link-external; ratio: .7"></span> Open in a new tab</a></li>
        <li><a href="${esc(url)}${url.includes('?') ? '&' : '?'}download=1"><span uk-icon="icon: download; ratio: .7"></span> Download ${esc(im.type.toUpperCase())} · ${esc(humanSize(im.size))}</a></li>
        ${own ? `<li class="uk-nav-divider"></li>
        <li><a href class="uk-text-danger arm-step" hx-post="/actions/image-delete" hx-trigger="confirmed-remove"
            hx-vals="${esc(JSON.stringify({ workspace: 'images', file: im.rel, confirm: 'yes' }))}"
            hx-target="#webship-workspace-output" hx-swap="innerHTML" title="Delete ${esc(im.rel)}"><span uk-icon="icon: trash; ratio: .7"></span> Delete</a></li>` : ''}
      </ul></div>
    </div>`;
  return `
      <div class="fx-row fx-file has-thumb img-row">
        <span class="fx-thumb is-image${im.type === 'svg' ? ' is-vector' : ''}" role="button" tabindex="0" title="View ${esc(im.name)}"
              ${open} hx-trigger="click, keyup[key=='Enter']"><img src="${esc(thumbUrl(im.src, im.rel))}" alt="" loading="lazy" decoding="async">${
          dims ? `<span class="fx-duration fx-dims">${esc(dims)}</span>` : ''}</span>
        <span class="fx-icon">${iconHtml('tabler:photo', 0.85)}</span>
        <span class="fx-name" title="${esc(im.name)}">${esc(im.name)}${where}</span>
        <span class="fx-size">${esc(humanSize(im.size))}${dims ? ` · ${esc(dims)}` : ''}</span>
        <span class="fx-date">${esc(humanTime(im.mtime))}</span>
        <span class="fx-actions"><button class="uk-button uk-button-default uk-button-small fx-open" title="View ${esc(im.name)}" ${open}><span uk-icon="icon: search; ratio: .7"></span> ${esc(im.type.toUpperCase())}</button>${menu}</span>
      </div>`;
}

/** A folder as the docs and videos lists draw one: the whole row opens it, and it says how many images are inside. */
function folderHtml(f) {
  const go = `/fragments/images/items?path=${encodeURIComponent(f.rel)}`;
  const push = `/images?path=${encodePath(f.rel)}`;
  return `
      <a class="fx-row fx-folder" href="${esc(push)}" hx-get="${esc(go)}" hx-target="${TARGET}" hx-swap="innerHTML" hx-push-url="${esc(push)}"
         title="Open ${esc(f.rel)}">
        <span class="fx-icon">${iconHtml('tabler:folder', 0.9)}</span>
        <span class="fx-name">${esc(f.name)}</span>
        <span class="fx-size">${esc([f.count ? `${f.count} image${f.count === 1 ? '' : 's'}` : '',
          f.folders ? `${f.folders} folder${f.folders === 1 ? '' : 's'}` : ''].filter(Boolean).join(', ') || 'empty')}</span>
        <span class="fx-date">${f.mtime ? esc(humanTime(f.mtime)) : ''}</span>
        <span class="fx-actions"><span class="fx-go">${iconHtml('tabler:chevron-right', 0.8)}</span></span>
      </a>`;
}

/** The whole gallery, as the items fragment and the page both draw it, in the shared file-list shape. */
function galleryHtml(st, sub, { folderDocs = '', openWith = '', viewSwitcher = '' } = {}) {
  const all = st.scope === 'all';
  const folder = all ? { folders: [], rel: '' } : images.listFolder(workspaceDir('images'), sub);
  const rel = all ? '' : folder.rel || '';
  const list = currentList(st, rel);
  const folders = all || st.q ? [] : folder.folders.slice().sort((a, b) => a.name.localeCompare(b.name));
  const p = lists.paginate(list, st);
  const url = '/fragments/images/items';
  const qs = query(st, rel);
  const noun = all ? 'media images' : 'images';
  const pager = lists.listPagerHtml(`${url}${qs ? `?${qs}` : ''}`, TARGET, p, st, noun);
  const filters = `<label class="uk-text-meta">Show
      <select class="uk-select uk-form-small" name="scope" aria-label="Which images"
              hx-get="${url}" hx-target="${TARGET}" hx-swap="innerHTML"
              hx-trigger="change" hx-include="closest .list-controls" hx-vals='{"page":"1","path":""}'>
        <option value="here"${all ? '' : ' selected'}>This workspace</option>
        <option value="all"${all ? ' selected' : ''}>All media images</option>
      </select></label>
    <label class="uk-text-meta">Type
      <select class="uk-select uk-form-small" name="kind" aria-label="Image type"
              hx-get="${url}" hx-target="${TARGET}" hx-swap="innerHTML"
              hx-trigger="change" hx-include="closest .list-controls" hx-vals='{"page":"1"}'>
        <option value="all">All</option>${images.TYPES.map((t) => `<option value="${t}"${st.kind === t ? ' selected' : ''}>${t.toUpperCase()}</option>`).join('')}
      </select></label>`;
  const trail = !all && rel
    ? `<nav class="folder-crumbs" aria-label="Folder">${[{ name: 'Images', rel: '' }, ...rel.split('/').map((s, i, a) => ({ name: s, rel: a.slice(0, i + 1).join('/') }))]
      .map((c, i, a) => (i === a.length - 1
        ? `<span class="crumb is-here" aria-current="page">${esc(c.name)}</span>`
        : `<a class="crumb" href="/images${c.rel ? `?path=${esc(encodePath(c.rel))}` : ''}" hx-get="${url}${c.rel ? `?path=${encodeURIComponent(c.rel)}` : ''}"
             hx-target="${TARGET}" hx-swap="innerHTML" hx-push-url="/images${c.rel ? `?path=${esc(encodePath(c.rel))}` : ''}">${esc(c.name)}</a>`)).join('<span class="crumb-sep" aria-hidden="true">›</span>')}</nav>`
    : '';
  const total = list.reduce((n, im) => n + im.size, 0);
  const heading = all ? 'All media images' : (rel ? rel.split('/').pop() : 'Images');
  const capped = all ? (images.scanEverywhere().capped || []) : [];
  const summary = `<p class="uk-text-meta fx-summary">${[
    folders.length ? `${folders.length} folder${folders.length === 1 ? '' : 's'}` : '',
    list.length ? `${list.length} image${list.length === 1 ? '' : 's'}` : '',
    total ? humanSize(total) : '',
  ].filter(Boolean).map(esc).join(' · ') || 'This folder is empty.'}${
    all ? ' · read-only, from docs, videos, audio, specs, designs and the dashboard screenshots' : ''}${
    capped.length ? ` · the first ${images.SCAN_MAX} of ${esc(capped.map(sourceLabel).join(', '))}` : ''}</p>`;
  // Folders lead the first page only; paging is over the images.
  const rows = [...(p.page === 1 || !p.page ? folders.map(folderHtml) : []), ...p.slice.map((im) => cardHtml(im, st, rel))];
  return `
    ${trail}
    <div class="cards-head fx-head">
      <div>
        <h3 class="uk-margin-remove">${esc(heading)} <span class="uk-badge">${list.length + folders.length}</span></h3>
        ${summary}
      </div>
      ${viewSwitcher}
    </div>
    ${all ? '' : `<div class="uk-margin-small-bottom items-open-with">${openWith}</div>`}
    ${lists.listControlsHtml(url, TARGET, st, noun, filters, { ...(rel ? { path: rel } : {}) }, { fileSorts: true })}
    ${st.q ? `<p class="uk-text-meta">${p.total} of ${list.length} ${esc(noun)} match “${esc(st.q)}”.</p>` : ''}
    ${pager}
    ${rows.length ? `<div class="file-list img-list">${rows.join('')}</div>`
      : `<p class="uk-text-meta">${st.q || images.TYPES.includes(st.kind) ? `No ${esc(noun)} match.` : `No images here yet. Put them in <code>${esc(path.join(workspaceDir('images'), rel).replace(process.env.HOME || '', '~'))}</code> and they appear here.`}</p>`}
    ${pager}
    ${all ? '' : folderDocs}`;
}

// ------------------------------------------------------------------ viewer --

function infoRow(label, value) {
  return value ? `<dt>${esc(label)}</dt><dd>${value}</dd>` : '';
}

/** The viewer for one image, with its neighbours in the list it was opened from. */
/** An SVG's markup to copy: the file as it is, up to 1 MB. */
function svgMarkup(abs) {
  try { return fs.statSync(abs).size <= 1024 * 1024 ? fs.readFileSync(abs, 'utf8') : ''; } catch (_) { return ''; }
}

/**
 * The picture in the viewer. An SVG is shown as an image, so it animates but runs nothing; it starts when a quarter
 * of it is in view, and Replay starts it again. Its PNG preview stands in for it when the reader asks for less motion.
 */
function svgStage(im, url, made, abs) {
  if (im.type !== 'svg') return `<img src="${esc(url)}" alt="${esc(im.name)}">`;
  const alt = (made && made.alt) || im.name;
  const threshold = made && made.motion && Number.isFinite(Number(made.motion.threshold)) ? Number(made.motion.threshold) : 0.25;
  const png = made && made.png && fs.existsSync(path.join(path.dirname(abs), made.png)) ? url.replace(/[^/?]+\.svg(\?|$)/, `${encodeURIComponent(made.png)}$1`) : '';
  return `<picture>${png ? `<source media="(prefers-reduced-motion: reduce)" srcset="${esc(png)}">` : ''}<img data-svg-motion data-threshold="${threshold}" data-src="${esc(url)}" src="${esc(url)}" alt="${esc(alt)}"></picture>`;
}

function viewerHtml(st, rel, src, file) {
  const root = images.sourceRoot(src);
  const where = root ? images.safeIn(root, file) : null;
  if (!where || !images.IMAGE_RE.test(where.abs)) return null;
  const im = { ...images.describe(where.abs, where.rel), src };
  const list = currentList(st, rel);
  const i = list.findIndex((x) => x.src === src && x.rel === where.rel);
  const step = (d) => (i < 0 || !list.length ? null : list[(i + d + list.length) % list.length]);
  const prev = step(-1);
  const next = step(1);
  const navBtn = (n, label, glyph, attr) => (n && list.length > 1
    ? `<button type="button" class="uk-button uk-button-default uk-button-small" ${attr}
        hx-get="/fragments/images/view?${esc(query(st, rel, { src: n.src, file: n.rel }))}" hx-target="#editor-modal-body" hx-swap="innerHTML"
        title="${esc(label)}: ${esc(n.name)}" aria-label="${esc(label)}">${glyph}</button>`
    : '');
  const url = fileUrl(src, im.rel);
  const abs = `https://${hubDomain()}${url}`;
  const made = images.sidecarOf(where.abs);
  const own = src === 'images';
  const vals = (o) => esc(JSON.stringify({ workspace: 'images', file: im.rel, ...o }));
  return `
    <div class="editor-card img-viewer" data-img-viewer>
      <div class="img-viewer-head">
        <h3 class="uk-margin-remove" title="${esc(im.name)}">${esc(im.name)}</h3>
        <span class="uk-text-meta">${i >= 0 ? `${i + 1} of ${list.length}` : ''}</span>
      </div>
      <div class="img-stage is-fit" data-img-stage>
        ${svgStage(im, url, made, where.abs)}
      </div>
      <div class="img-nav">
        ${navBtn(prev, 'Previous', '‹ Previous', 'data-img-prev')}
        <button type="button" class="uk-button uk-button-default uk-button-small" data-img-zoom title="Switch between fit and actual size">Actual size</button>
        ${navBtn(next, 'Next', 'Next ›', 'data-img-next')}
      </div>
      <dl class="img-info">
        ${infoRow('Dimensions', im.width ? `${im.width} × ${im.height} px` : '')}
        ${infoRow('Size', esc(humanSize(im.size)))}
        ${infoRow('Type', esc(im.type.toUpperCase()))}
        ${infoRow('Modified', esc(humanTime(im.mtime)))}
        ${infoRow('Where', `<code>${esc(`${sourceLabel(src)}/${im.rel}`)}</code>`)}
      </dl>
      ${made ? `<div class="img-made">
        <h4 class="uk-h6 uk-margin-small-bottom">How it was made</h4>
        <dl class="img-info">
          ${infoRow('Summary', esc(String(made.summary || '')))}
          ${infoRow('Alt text', esc(String(made.alt || '')))}
          ${made.source && typeof made.source === 'object' ? infoRow('Edited from', `<a href="#" hx-get="/fragments/images/view?src=${esc(encodeURIComponent(made.source.workspace))}&file=${esc(encodeURIComponent(made.source.path))}" hx-target="#editor-modal-body" hx-swap="innerHTML"><code>${esc(`${sourceLabel(made.source.workspace)}/${made.source.path}`)}</code></a>`) : ''}
          ${typeof made.source === 'string' ? infoRow('Source', esc(made.source)) : ''}
          ${infoRow('Edit prompt', esc(String(made.edit_prompt || '')))}
          ${infoRow('Prompt', esc(String(made.prompt || '')))}
          ${infoRow('Provider', esc(String(made.provider || '')))}
          ${infoRow('Model', esc(String(made.model || '')))}
          ${infoRow('Style', esc(String(made.style || '')))}
          ${infoRow('Attempts', esc(String(made.attempts || '')))}
          ${infoRow('Palette', esc(String(made.palette || '')))}
          ${infoRow('Size', esc(String(made.size || '')))}
          ${infoRow('Quality', esc(String(made.quality || '')))}
          ${infoRow('Made', esc(String(made.created || '')))}
          ${infoRow('Cost', esc(String(made.cost || '')))}
          ${infoRow('Description', esc(made.described_by ? `${made.described_by}${made.description_cost ? `, ${made.description_cost}` : ''}` : String(made.description || '')))}
        </dl></div>` : ''}
      ${own && !(made && made.summary) ? `<p class="img-describe">
        <button type="button" class="uk-button uk-button-default uk-button-small arm-step" title="Describe ${esc(im.name)} with AI: a summary and an alt text (paid, about $0.001)"
          hx-post="/actions/image-describe" hx-trigger="confirmed-remove" hx-vals="${vals({ confirm: 'yes' })}"
          hx-target="#editor-modal-body" hx-swap="innerHTML">${iconHtml('tabler:sparkles', 0.7)} Describe it</button>
        <span class="uk-text-meta">${made && made.description === 'not written' ? 'The description was not written.' : 'No description yet.'}</span></p>` : ''}
      <div class="img-actions">
        <a class="uk-button uk-button-primary uk-button-small" href="${esc(url)}${url.includes('?') ? '&' : '?'}download=1">${iconHtml('download', 0.7)} Download</a>
        <a class="uk-button uk-button-default uk-button-small" href="${esc(url)}" target="_blank" rel="noopener">${iconHtml('link-external', 0.7)} Open in a new tab</a>
        <button type="button" class="uk-button uk-button-default uk-button-small copy-cmd" data-copy="${esc(abs)}">${iconHtml('link', 0.7)} Copy link</button>
        ${im.type === 'svg' ? `<button type="button" class="uk-button uk-button-default uk-button-small" data-svg-replay>${iconHtml('refresh', 0.7)} Replay</button>
        <button type="button" class="uk-button uk-button-default uk-button-small copy-cmd" data-copy="${esc(svgMarkup(where.abs))}">${iconHtml('code', 0.7)} Copy SVG markup</button>` : ''}
        <button type="button" class="uk-button uk-button-default uk-button-small copy-cmd" data-copy="${esc(`![${String((made && made.alt) || im.name.replace(/\.[^.]*$/, '')).replace(/[[\]]/g, '')}](${abs})`)}">${iconHtml('code', 0.7)} Copy Markdown</button>
        ${own ? `<button type="button" class="uk-button uk-button-danger uk-button-small arm-step" title="Delete ${esc(im.rel)}"
            hx-post="/actions/image-delete" hx-trigger="confirmed-remove" hx-vals="${vals({ confirm: 'yes' })}"
            hx-target="#editor-modal-body" hx-swap="innerHTML">${iconHtml('trash', 0.7)} Delete</button>` : ''}
      </div>
      ${own ? `<form class="img-rename" hx-post="/actions/image-rename" hx-target="#editor-modal-body" hx-swap="innerHTML">
        <input type="hidden" name="workspace" value="images">
        <input type="hidden" name="file" value="${esc(im.rel)}">
        <label class="uk-form-label" for="img-rename-to">Rename</label>
        <div class="uk-flex uk-flex-middle img-rename-row">
          <input class="uk-input uk-form-small" id="img-rename-to" name="name" value="${esc(im.name)}" maxlength="120" required>
          <button class="uk-button uk-button-default uk-button-small" type="submit">Rename</button>
        </div>
      </form>
      ${require('./images-create').editFormHtml(im.rel)}` : `<p class="uk-text-meta">This image belongs to <strong>${esc(sourceLabel(src))}</strong>; it is shown here read-only. An AI edit is saved into <code>images/edited/</code>.</p>`}
      ${require('./images-ai').editFormHtml(src, im.rel, im.type === 'svg')}
    </div>`;
}

// -------------------------------------------------------------- thumbnails --

const thumbDir = () => path.join(ROOT, 'core', 'workspace-app', '.cache', 'image-thumbs');
const THUMB_W = 640;
const THUMB_H = 480;
let running = 0;
const waiting = [];

function makeThumb(src, out) {
  return new Promise((resolve) => {
    const go = () => {
      running += 1;
      fs.mkdirSync(path.dirname(out), { recursive: true });
      // [0] takes the first frame of a GIF; the size is a bound, never an enlargement.
      // Filled to the card's own 4:3 and cropped from the top, where a screenshot's content starts, so a tall
      // capture is a sharp crop rather than a sliver stretched to fit.
      execFile('convert', [`${src}[0]`, '-auto-orient', '-thumbnail', `${THUMB_W}x${THUMB_H}^`, '-gravity', 'north',
        '-extent', `${THUMB_W}x${THUMB_H}`, '-quality', '80', `webp:${out}`],
        { timeout: 20000 }, (err) => {
          running -= 1;
          if (waiting.length) waiting.shift()();
          resolve(!err && fs.existsSync(out));
        });
    };
    if (running < 3) go(); else waiting.push(go);
  });
}

/** A small webp of an image, made once and kept; the original when it cannot be made or is already small. */
async function thumbFile(src, rel) {
  const root = images.sourceRoot(src);
  const where = root ? images.safeIn(root, rel) : null;
  if (!where || !images.IMAGE_RE.test(where.abs)) return null;
  const st = fs.statSync(where.abs);
  if (images.typeOf(where.abs) === 'svg' || st.size < 60 * 1024) return { file: where.abs, original: true };
  const key = crypto.createHash('sha1').update(`v2|${where.abs}|${st.size}|${st.mtimeMs}`).digest('hex');
  const out = path.join(thumbDir(), `${key}.webp`);
  if (fs.existsSync(out) || await makeThumb(where.abs, out)) return { file: out, original: false };
  return { file: where.abs, original: true };
}

const TYPES_BY_EXT = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.avif': 'image/avif' };

function sendImage(res, file, { cache = false } = {}) {
  const type = TYPES_BY_EXT[path.extname(file).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': type, 'Content-Length': fs.statSync(file).size, 'X-Content-Type-Options': 'nosniff',
    ...(type === 'image/svg+xml' ? { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" } : {}),
    ...(cache ? { 'Cache-Control': 'private, max-age=86400' } : {}),
  });
  fs.createReadStream(file).pipe(res);
}

/**
 * The images workspace's own fragments. Returns true when it answered.
 * `deps` carries what lives in server.js: the page state reader and the folder docs.
 */
async function fragment(req, res, pathname, deps) {
  const q = new URL(req.url, 'http://localhost').searchParams;
  if (pathname === '/fragments/images/items') {
    const st = lists.readPageState(req, 'images/items');
    lists.setPageCookie(res, st);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(galleryHtml(st, st.path, deps.galleryDeps()));
    return true;
  }
  if (pathname === '/fragments/images/view') {
    const st = lists.readPageState(req);
    const html = viewerHtml(st, st.path, q.get('src') || 'images', q.get('file') || '');
    res.writeHead(html ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html || '<div class="msg error">That image is not there any more.</div>');
    return true;
  }
  if (pathname === '/fragments/images/upload') {
    // The folder the page is showing, so an upload lands where the person is looking.
    let rel = q.get('path') || '';
    try { rel = rel || new URL(String(req.headers['hx-current-url'] || ''), 'http://localhost').searchParams.get('path') || ''; } catch (_) { /* no page */ }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(require('./images-create').uploadFormHtml(rel));
    return true;
  }
  if (pathname === '/fragments/images/generate-form') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(require('./images-ai').formHtml());
    return true;
  }
  if (pathname === '/fragments/images/provider-fields') {
    const kind = q.get('kind') === 'edit' ? 'edit' : 'generate';
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(require('./images-ai').providerFieldsHtml(kind, q.get('provider') || '', kind === 'edit' ? { prefix: 'img-ai-edit', edit: true } : {}));
    return true;
  }
  if (pathname === '/fragments/images/svg-form' || pathname === '/fragments/images/svg-provider-fields') {
    const svg = require('./images-svg');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(pathname.endsWith('svg-form') ? svg.formHtml() : svg.providerFieldsHtml(q.get('provider') || ''));
    return true;
  }
  if (pathname === '/fragments/images/screenshot-form') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(require('./images-create').screenshotFormHtml());
    return true;
  }
  if (pathname === '/fragments/images/thumb') {
    const t = await thumbFile(q.get('src') || 'images', q.get('path') || '').catch(() => null);
    if (!t) { res.writeHead(404); res.end('not found'); return true; }
    sendImage(res, t.file, { cache: !t.original });
    return true;
  }
  const app = pathname.match(/^\/fragments\/images\/app-file\/(.+)$/);
  if (app) {
    const where = images.safeIn(images.appShotsDir(), decodeURIComponent(app[1]));
    if (!where || !images.IMAGE_RE.test(where.abs) || !fs.statSync(where.abs).isFile()) { res.writeHead(404); res.end('not found'); return true; }
    if (q.get('download') === '1') {
      res.setHeader('Content-Disposition', `attachment; filename="${path.basename(where.abs).replace(/[^A-Za-z0-9._-]/g, '_')}"`);
    }
    sendImage(res, where.abs);
    return true;
  }
  return false;
}

/** The images workspace's Create actions, for the rail and the create tiles. */
function createButtons(btn, modal) {
  return [
    btn('primary', 'upload', 'Upload images', `hx-get="/fragments/images/upload" ${modal}`, 'Drop or choose images to add to this workspace'),
    btn('default', 'tabler:camera', 'Screenshot a page', `hx-get="/fragments/images/screenshot-form" ${modal}`, 'A picture of any web page, at a chosen width'),
    btn('secondary', 'bolt', 'Generate with AI', `hx-get="/fragments/images/generate-form" ${modal}`, 'Describe a picture and an AI provider draws it; you see the plan and the cost first'),
    btn('default', 'tabler:vector-bezier', 'Generate SVG', `hx-get="/fragments/images/svg-form" ${modal}`, 'A drawing as SVG code, still or animated, on brand; you see the plan and the cost first'),
  ];
}

module.exports = { createButtons, galleryHtml, viewerHtml, currentList, fileUrl, thumbFile, fragment, sendImage, TYPES_BY_EXT };
