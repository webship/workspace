/**
 * Making images in the images workspace: upload, a screenshot of a web page, and an edit saved as a new
 * file. Everything runs in the dashboard container, which has ImageMagick and chromium.
 */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const { esc } = require('./html');
const { workspaceDir } = require('./workspaces');
const images = require('./images');

const MAX_UPLOAD = 25 * 1024 * 1024;
const WIDTHS = ['1280', '1440', '1600', '1920'];
const FORMATS = ['png', 'jpg', 'webp'];
const CROPS = { '1:1': [1, 1], '16:9': [16, 9], '4:3': [4, 3], '3:2': [3, 2], '9:16': [9, 16] };
const URL_RE = /^https?:\/\/[a-zA-Z0-9.:\/_~%?#&=+-]+$/;

/** The images folder a request names, made if missing, or null when it leads out. */
function targetDir(rel) {
  const root = workspaceDir('images');
  const clean = String(rel || '').replace(/^\/+|\/+$/g, '');
  if (clean && !/^[A-Za-z0-9._ -]+(\/[A-Za-z0-9._ -]+)*$/.test(clean)) return null;
  if (clean.split('/').some((s) => s === '..' || s.startsWith('.'))) return null;
  fs.mkdirSync(path.join(root, clean), { recursive: true });
  const where = images.safeIn(root, clean);
  return where ? where.abs : null;
}

/** What the first bytes say a file is, so an upload is an image whatever it is called. */
function sniff(buf) {
  if (buf.length >= 8 && buf.readUInt32BE(0) === 0x89504e47) return 'png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length >= 6 && buf.toString('ascii', 0, 3) === 'GIF') return 'gif';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buf.length >= 12 && buf.toString('ascii', 4, 8) === 'ftyp' && /^avi[fs]/.test(buf.toString('ascii', 8, 12))) return 'avif';
  if (/^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg\b/i.test(buf.toString('utf8', 0, Math.min(buf.length, 4096)))) return 'svg';
  return '';
}

/** POST /actions/image-upload: one file per request, its bytes as the body. */
function upload(req, res) {
  const q = new URL(req.url, 'http://localhost').searchParams;
  const reply = (status, html) => { res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); };
  const dir = targetDir(q.get('path'));
  if (!dir) return reply(400, '<div class="msg error">That folder is not in the images workspace.</div>');
  const declared = Number(req.headers['content-length'] || 0);
  if (declared > MAX_UPLOAD) return reply(413, '<div class="msg error">An image can be 25 MB at most.</div>');
  const chunks = [];
  let size = 0;
  let tooBig = false;
  req.on('data', (d) => { size += d.length; if (size > MAX_UPLOAD) { tooBig = true; req.destroy(); } else chunks.push(d); });
  req.on('end', () => {
    if (tooBig) return reply(413, '<div class="msg error">An image can be 25 MB at most.</div>');
    const buf = Buffer.concat(chunks);
    const type = sniff(buf);
    if (!type) return reply(415, '<div class="msg error">That is not a PNG, JPEG, GIF, WebP, AVIF or SVG image.</div>');
    const stem = images.safeName(q.get('name') || 'image').replace(/\.[^.]*$/, '') || 'image';
    const name = images.freeName(dir, stem, type);
    fs.writeFileSync(path.join(dir, name), buf);
    images.forgetScan();
    return reply(200, `<div class="msg assistant">Uploaded <strong>${esc(name)}</strong>.</div>`);
  });
  return undefined;
}

/** A screenshot of a web page into images/, with the container's chromium. */
async function screenshot(form) {
  const url = String(form.url || '').trim();
  if (!URL_RE.test(url)) return { ok: false, status: 400, error: 'Give a full http or https address.' };
  const width = WIDTHS.includes(String(form.width)) ? Number(form.width) : 1600;
  const height = width === 1600 ? 1000 : Math.round(width * 9 / 16);
  const dir = targetDir(form.folder || 'screenshots');
  if (!dir) return { ok: false, status: 400, error: 'That folder is not in the images workspace.' };
  const stem = images.safeName(form.name || '') || `${new URL(url).hostname.replace(/[^a-z0-9]+/gi, '-')}-${new Date().toISOString().slice(0, 10)}`;
  const name = images.freeName(dir, stem, 'png');
  const { chromium } = require('playwright');
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
    const page = await browser.newPage({ viewport: { width, height }, colorScheme: form.scheme === 'dark' ? 'dark' : 'light', ignoreHTTPSErrors: true });
    await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => page.waitForTimeout(3000));
    await page.screenshot({ path: path.join(dir, name), fullPage: form.full === '1' });
  } catch (e) {
    return { ok: false, status: 502, error: `The page could not be captured: ${String(e.message || e).split('\n')[0].slice(0, 200)}` };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
  images.forgetScan();
  const rel = path.relative(fs.realpathSync(workspaceDir('images')), path.join(dir, name)).split(path.sep).join('/');
  return { ok: true, rel, name };
}

/**
 * The ImageMagick arguments for an edit, from fixed lists and checked numbers only, and the new file's name.
 * `dims` is the source's { width, height }, which a crop needs.
 */
function editArgs(src, dir, form, dims) {
  const ext = images.typeOf(src);
  const format = FORMATS.includes(form.format) ? form.format : (FORMATS.includes(ext) ? ext : 'png');
  const args = [`${src}[0]`, '-auto-orient'];
  const crop = CROPS[form.crop];
  if (crop && dims && dims.width && dims.height) {
    const [rw, rh] = crop;
    let w = dims.width;
    let h = Math.round(w * rh / rw);
    if (h > dims.height) { h = dims.height; w = Math.round(h * rw / rh); }
    args.push('-gravity', 'center', '-crop', `${w}x${h}+0+0`, '+repage');
  }
  const width = parseInt(form.width, 10);
  if (Number.isInteger(width) && width >= 16 && width <= 8000) args.push('-resize', `${width}x`);
  if (format !== 'png') {
    const quality = parseInt(form.quality, 10);
    args.push('-quality', String(Number.isInteger(quality) && quality >= 1 && quality <= 100 ? quality : 85));
  }
  const name = images.versionName(dir, path.basename(src), format);
  args.push(`${format}:${path.join(dir, name)}`);
  return { args, name, changed: !!crop || (Number.isInteger(width) && width >= 16 && width <= 8000) || format !== ext };
}

/** Run an edit; never touches the original. */
function edit(form) {
  return new Promise((resolve) => {
    const root = workspaceDir('images');
    const where = images.safeIn(root, String(form.file || ''));
    if (!where || !images.IMAGE_RE.test(where.abs)) return resolve({ ok: false, status: 404, error: 'That image is not in the images workspace.' });
    const dims = images.dimensions(where.abs);
    const { args, name, changed } = editArgs(where.abs, path.dirname(where.abs), form, dims);
    if (!changed) return resolve({ ok: false, status: 400, error: 'Choose a width, a crop or another format.' });
    execFile('convert', args, { timeout: 60000 }, (err, _o, stderr) => {
      if (err) return resolve({ ok: false, status: 500, error: `ImageMagick refused it: ${String(stderr || err.message).slice(0, 200)}` });
      images.forgetScan();
      const rel = path.posix.join(path.posix.dirname(where.rel) === '.' ? '' : path.posix.dirname(where.rel), name);
      return resolve({ ok: true, rel, name });
    });
    return undefined;
  });
}

// ------------------------------------------------------------------- forms --

const folderOptions = (current) => {
  const root = workspaceDir('images');
  const out = [''];
  const walk = (dir, rel, depth) => {
    if (depth > 3) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      out.push(r);
      walk(path.join(dir, e.name), r, depth + 1);
    }
  };
  walk(root, '', 0);
  return out.sort().map((r) => `<option value="${esc(r)}"${r === current ? ' selected' : ''}>${esc(r ? `images/${r}` : 'images/ (the top)')}</option>`).join('');
};

function uploadFormHtml(rel) {
  return `
    <div class="editor-card img-upload" data-img-upload>
      <h3 class="uk-margin-small-bottom">Upload images</h3>
      <label class="uk-form-label" for="img-up-folder">Into</label>
      <select class="uk-select uk-form-small uk-margin-small-bottom" id="img-up-folder" name="path" data-img-upload-folder>${folderOptions(rel)}</select>
      <label class="img-drop" data-img-drop>
        <input type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/avif,image/svg+xml" multiple hidden data-img-upload-input>
        <span class="img-drop-text">Drop images here, or <u>choose files</u></span>
        <span class="uk-text-meta">PNG, JPEG, GIF, WebP, AVIF or SVG, 25 MB each. A name that is taken gets a number.</span>
      </label>
      <ul class="uk-list img-upload-log" data-img-upload-log></ul>
    </div>`;
}

function screenshotFormHtml() {
  return `
    <div class="editor-card">
      <h3 class="uk-margin-small-bottom">Screenshot a page</h3>
      <form hx-post="/actions/image-screenshot" hx-target="#editor-modal-body" hx-swap="innerHTML">
        <input type="hidden" name="workspace" value="images">
        <label class="uk-form-label" for="img-shot-url">Address</label>
        <input class="uk-input uk-margin-small-bottom" id="img-shot-url" name="url" type="url" required>
        <div class="uk-grid-small uk-child-width-1-2@s" uk-grid>
          <div><label class="uk-form-label" for="img-shot-name">File name</label>
            <input class="uk-input uk-form-small" id="img-shot-name" name="name" maxlength="80"></div>
          <div><label class="uk-form-label" for="img-shot-folder">Into</label>
            <select class="uk-select uk-form-small" id="img-shot-folder" name="folder">${folderOptions('screenshots')}${
              fs.existsSync(path.join(workspaceDir('images'), 'screenshots')) ? '' : '<option value="screenshots" selected>images/screenshots</option>'}</select></div>
          <div><label class="uk-form-label" for="img-shot-width">Window width</label>
            <select class="uk-select uk-form-small" id="img-shot-width" name="width">${WIDTHS.map((w) => `<option value="${w}"${w === '1600' ? ' selected' : ''}>${w} px</option>`).join('')}</select></div>
          <div><label class="uk-form-label" for="img-shot-scheme">Colour scheme</label>
            <select class="uk-select uk-form-small" id="img-shot-scheme" name="scheme"><option value="light">Light</option><option value="dark">Dark</option></select></div>
        </div>
        <label class="uk-display-block uk-margin-small-top"><input class="uk-checkbox" type="checkbox" name="full" value="1"> The whole page, not only the window</label>
        <p class="uk-margin-small-top"><button class="uk-button uk-button-primary" type="submit">Take the screenshot</button></p>
      </form>
    </div>`;
}

/** The edit form, under an image in the viewer. */
function editFormHtml(rel) {
  return `
    <details class="img-edit">
      <summary>Edit as a new file</summary>
      <form hx-post="/actions/image-edit" hx-target="#editor-modal-body" hx-swap="innerHTML">
        <input type="hidden" name="workspace" value="images">
        <input type="hidden" name="file" value="${esc(rel)}">
        <div class="uk-grid-small uk-child-width-1-4@s" uk-grid>
          <div><label class="uk-form-label" for="img-ed-width">Width (px)</label>
            <input class="uk-input uk-form-small" id="img-ed-width" name="width" type="number" min="16" max="8000"></div>
          <div><label class="uk-form-label" for="img-ed-crop">Crop</label>
            <select class="uk-select uk-form-small" id="img-ed-crop" name="crop"><option value="">No crop</option>${Object.keys(CROPS).map((c) => `<option value="${c}">${c}, centred</option>`).join('')}</select></div>
          <div><label class="uk-form-label" for="img-ed-format">Format</label>
            <select class="uk-select uk-form-small" id="img-ed-format" name="format"><option value="">Keep it</option>${FORMATS.map((f) => `<option value="${f}">${f.toUpperCase()}</option>`).join('')}</select></div>
          <div><label class="uk-form-label" for="img-ed-quality">Quality (JPEG, WebP)</label>
            <input class="uk-input uk-form-small" id="img-ed-quality" name="quality" type="number" min="1" max="100" value="85"></div>
        </div>
        <p class="uk-margin-small-top"><button class="uk-button uk-button-primary uk-button-small" type="submit">Save as a new file</button>
          <span class="uk-text-meta">The original stays as it is; the new one is named <code>…-v2</code>.</span></p>
      </form>
    </details>`;
}

module.exports = { MAX_UPLOAD, WIDTHS, FORMATS, CROPS, targetDir, sniff, upload, screenshot, editArgs, edit,
  uploadFormHtml, screenshotFormHtml, editFormHtml };
