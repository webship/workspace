/**
 * Generate and edit images with the providers in images-providers/, into images/, each with a sidecar that says
 * how it was made. A paid call first answers with a plan and goes out only with confirm=yes, which only the
 * confirm dialog's Yes sends. Keys are read from settings.yml, sent in headers, and never printed, logged or put
 * in a URL.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const { esc } = require('./html');
const { workspaceDir } = require('./workspaces');
const images = require('./images');
const { writeRecords, recordPath } = require('./images-records');

const providers = require('./images-providers');
const openai = require('./images-providers/openai');
const http = require('./images-providers/http');

const MODELS = openai.models;
const SIZES = openai.sizes;
const QUALITIES = openai.qualities;
const ESTIMATE = openai.ESTIMATE;
const CHAT_API = () => process.env.OPENAI_CHAT_API || 'https://api.openai.com/v1/chat/completions';
// The description: a small vision model, reading the image at low detail. Prices per token, from OpenAI's pricing page.
const VISION_MODEL = 'gpt-5.4-nano';
const VISION_IN = 0.20 / 1e6;
const VISION_OUT = 1.25 / 1e6;
const DESCRIBE_ESTIMATE = 0.001;
const SHAPES = { square: 'Square', landscape: 'Landscape', portrait: 'Portrait' };
const EDIT_SIZES = { same: 'Same shape as the source', square: 'Square', landscape: 'Landscape', portrait: 'Portrait' };
const EDITABLE = { '.png': 'png', '.jpg': 'jpeg', '.jpeg': 'jpeg', '.webp': 'webp' };

/** The OpenAI key, used for the description call, or '' when it is missing or still a placeholder. */
function apiKey() {
  return http.keyFor('openai');
}

/** The request a form asks for, checked against its provider, or why not. */
function plan(form) {
  const prompt = String(form.prompt || '').trim();
  if (!prompt) return { ok: false, error: 'Say what the image should show.' };
  if (prompt.length > 4000) return { ok: false, error: 'The prompt can be 4000 characters at most.' };
  const prov = providers.pick(form.provider, 'generate');
  const model = prov.models[form.model] ? String(form.model) : prov.defaultModel;
  const shape = prov.sizes[form.shape] ? String(form.shape) : Object.keys(prov.sizes)[0];
  const quality = prov.qualities ? (prov.qualities.includes(form.quality) ? String(form.quality) : prov.qualities[0]) : null;
  const n = Math.min(prov.maxCount || 4, Math.max(1, parseInt(form.count, 10) || 1));
  const name = images.safeName(form.name || '').replace(/\.[^.]*$/, '')
    || prompt.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'generated';
  const per = prov.estimate({ quality, model });
  const describe = prov.async ? 0 : DESCRIBE_ESTIMATE;
  return { ok: true, provider: prov.id, prompt, model, shape, size: prov.sizes[shape], quality, n, name,
    estimate: per === null ? null : (per + describe) * n };
}

/** A temporary copy of an image in another format, made with ImageMagick. */
function convertTo(abs, ext, extra = []) {
  const out = path.join(os.tmpdir(), `images-${crypto.randomBytes(8).toString('hex')}.${ext}`);
  return new Promise((resolve) => {
    execFile('convert', [`${abs}[0]`, '-auto-orient', ...extra, `${ext}:${out}`], { timeout: 60000 },
      (err) => resolve(!err && fs.existsSync(out) ? out : null));
  });
}

const actualCost = openai.actualCost;

/**
 * A one or two sentence summary and an alt text for an image, from a small vision model. The image goes as a
 * data URL, never a public one; anything that is not a small PNG, JPEG, WebP or GIF is made a 1024px JPEG first.
 */
async function describeImage(abs, opts = {}) {
  const key = opts.key || apiKey();
  if (!key) return { ok: false, error: 'No OpenAI key.' };
  const ext = path.extname(abs).toLowerCase();
  const plain = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
  let file = abs;
  let mime = plain[ext];
  let tmp = null;
  if (!mime || fs.statSync(abs).size > 4 * 1024 * 1024) {
    tmp = await convertTo(abs, 'jpeg', ['-resize', '1024x1024>', '-quality', '85']);
    if (!tmp) return { ok: false, error: 'The image could not be read.' };
    file = tmp;
    mime = 'image/jpeg';
  }
  const url = `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
  if (tmp) fs.rmSync(tmp, { force: true });
  let json;
  try {
    json = await http.post(CHAT_API(), { who: 'OpenAI', type: 'application/json', headers: { Authorization: `Bearer ${key}` }, body: JSON.stringify({
      model: VISION_MODEL, reasoning_effort: 'low', max_completion_tokens: 800, response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You describe images for a media library. Answer only with JSON: {"summary": "one or two plain sentences on what the image shows", "alt": "alt text, at most 125 characters"}.' },
        { role: 'user', content: [{ type: 'text', text: 'Describe this image.' }, { type: 'image_url', image_url: { url, detail: 'low' } }] },
      ] }) });
  } catch (e) {
    return { ok: false, error: e.message };
  }
  let out = {};
  try { out = JSON.parse(((json.choices || [])[0] || {}).message.content || '{}'); } catch (_) { /* not JSON */ }
  const summary = String(out.summary || '').trim().slice(0, 600);
  const alt = String(out.alt || '').trim().slice(0, 125);
  if (!summary && !alt) return { ok: false, error: 'The description came back empty.' };
  const u = json.usage || {};
  const cost = Number(u.prompt_tokens || 0) * VISION_IN + Number(u.completion_tokens || 0) * VISION_OUT;
  return { ok: true, summary, alt, cost };
}

/** Describe an image and add the result to its records, keeping what they already hold. */
async function describeAndRecord(abs, base, opts = {}) {
  const d = await describeImage(abs, opts);
  const rec = { ...(base || {}), ...(d.ok ? { summary: d.summary, alt: d.alt, described_by: VISION_MODEL,
    description_cost: `about $${d.cost.toFixed(4)}` } : { description: 'not written' }) };
  writeRecords(abs, rec);
  return { ...d, rec };
}

/** The runner call that starts host screen sessions, unless a test passes its own. */
const runnerStart = (opts) => opts.start || require('./jobs').hostRunnerRequest;

/** The palette a drawing is asked to keep to: the brand tokens, in words. */
function paletteWords() {
  try {
    const t = JSON.parse(fs.readFileSync(path.join(require('./workspaces').CONFIG_DIR, 'brand-tokens.json'), 'utf8')).tokens || {};
    return ['brand-primary', 'brand-secondary', 'brand-accent', 'brand-dark', 'brand-light'].filter((k) => t[k]).map((k) => `${k.replace('brand-', '')} ${t[k]}`).join(', ');
  } catch (_) {
    return 'blue #0074e0, navy #2b447c, lavender #e4dcff, black #000000, warm grey #ebe8e5';
  }
}

/** Make the images. Only with confirm=yes. */
async function generate(form, opts = {}) {
  if (form.confirm !== 'yes') return { ok: false, status: 400, error: 'Generating needs confirming first.' };
  const p = plan(form);
  if (!p.ok) return { ok: false, status: 400, error: p.error };
  const prov = providers.get(p.provider);
  const dir = opts.dir || path.join(workspaceDir('images'), 'generated');
  if (prov.async) {
    if (!prov.available().ok) return { ok: false, status: 503, error: `Claude Code is not available: ${prov.available().why}.` };
    const name = images.freeName(dir, p.name, 'svg').replace(/\.svg$/, '');
    const r = await prov.startSession({ kind: 'generate', name, dir, prompt: p.prompt, pixels: prov.PIXELS[p.shape] || prov.PIXELS.square,
      palette: paletteWords(), provider: prov.id, model: p.model, size: p.size, png: true, created: new Date().toISOString() }, runnerStart(opts));
    if (!r.ok) return { ok: false, status: 503, error: r.error };
    return { ok: true, async: true, session: r.session, made: [], cost: 0, undescribed: [] };
  }
  const key = opts.key || prov.key();
  if (!key) return { ok: false, status: 503, error: `Set ai_providers.${prov.keyName}.api_key in core/config/settings.yml first.` };
  let out;
  try {
    out = await prov.generate(p, key);
  } catch (e) {
    return { ok: false, status: 502, error: `${prov.label} refused it: ${e.message}` };
  }
  fs.mkdirSync(dir, { recursive: true });
  const cost = out.cost;
  const made = [];
  let total = cost || 0;
  const undescribed = [];
  // The description is OpenAI's vision call, whichever provider made the picture.
  const describeKey = prov.id === 'openai' ? key : apiKey();
  for (const item of out.images || []) {
    const name = images.freeName(dir, p.name, item.ext || 'png');
    const abs = path.join(dir, name);
    fs.writeFileSync(abs, item.data);
    const base = { prompt: p.prompt, provider: prov.id === 'openai' ? undefined : prov.label, model: p.model, size: p.size,
      quality: p.quality || undefined, created: new Date().toISOString(), revised_prompt: item.revised || undefined,
      cost: cost === null || cost === undefined ? undefined : `about $${(cost / Math.max(1, out.images.length)).toFixed(4)}` };
    const d = opts.describe === false ? (writeRecords(abs, base), { ok: false }) : await describeAndRecord(abs, base, { key: describeKey });
    if (d.ok) total += d.cost; else if (opts.describe !== false) undescribed.push(name);
    made.push(`generated/${name}`);
  }
  images.forgetScan();
  if (!made.length) return { ok: false, status: 502, error: `${prov.label} answered without an image.` };
  return { ok: true, made, cost: cost === null || cost === undefined ? null : total, undescribed };
}

// --------------------------------------------------------------- AI edits --

/** The nearest supported shape to an image's own. */
function nearestShape(width, height) {
  if (!width || !height) return 'square';
  const r = width / height;
  return r > 1.2 ? 'landscape' : r < 0.83 ? 'portrait' : 'square';
}

/** The nearest OpenAI size to an image's own shape. */
function nearestSize(width, height) {
  return SIZES[nearestShape(width, height)];
}

/** The next free <stem>-ai-v<n>.<ext> in a folder: never the source, never an existing file. */
function aiVersionName(dir, file, ext) {
  const stem = path.basename(file).replace(/\.[^.]*$/, '').replace(/-ai-v\d+$/, '');
  for (let n = 1; n < 10000; n += 1) {
    const name = `${stem}-ai-v${n}.${ext}`;
    if (!fs.existsSync(path.join(dir, name))) return name;
  }
  return `${stem}-ai-v${Date.now()}.${ext}`;
}

/** Who may edit a source: Claude Code edits an SVG's code and nothing else; the image models edit pictures. */
function editProviders(isSvg) {
  return providers.list('edit').filter((p) => (p.id === 'claude_code_cli') === !!isSvg);
}

/** An AI edit a form asks for, checked, or why not. An SVG can be edited only by Claude Code, which edits its code. */
function editPlan(form) {
  const src = String(form.src || 'images');
  const root = images.sourceRoot(src);
  const where = root ? images.safeIn(root, String(form.file || '')) : null;
  if (!where || !images.IMAGE_RE.test(where.abs) || !fs.existsSync(where.abs)) return { ok: false, error: 'That image is not there any more.' };
  const isSvg = images.typeOf(where.abs) === 'svg';
  if (isSvg && form.provider !== 'claude_code_cli') {
    return { ok: false, error: 'An SVG cannot be edited by an image model: it is a drawing, not a picture. Edit it with Claude Code, which changes its code, or export it to PNG first.' };
  }
  const prov = providers.get(editProviders(isSvg).some((p) => p.id === form.provider) ? form.provider : editProviders(isSvg)[0].id);
  const prompt = String(form.prompt || '').trim();
  if (!prompt) return { ok: false, error: 'Say what to change.' };
  if (prompt.length > 4000) return { ok: false, error: 'The prompt can be 4000 characters at most.' };
  const model = prov.models[form.model] ? String(form.model) : prov.defaultModel;
  const quality = prov.qualities ? (prov.qualities.includes(form.quality) ? String(form.quality) : prov.qualities[0]) : null;
  const dims = images.dimensions(where.abs);
  const shape = form.shape && form.shape !== 'same' && prov.sizes[form.shape] ? String(form.shape) : 'same';
  const own = nearestShape(dims && dims.width, dims && dims.height);
  const size = prov.sizes[shape === 'same' ? own : shape] || Object.values(prov.sizes)[0];
  const ext = isSvg ? 'svg' : EDITABLE[path.extname(where.abs).toLowerCase()] ? path.extname(where.abs).toLowerCase().replace('.', '') : 'png';
  const outExt = ext === 'jpeg' ? 'jpg' : ext;
  const dir = src === 'images' ? path.dirname(where.abs) : path.join(workspaceDir('images'), 'edited');
  const per = prov.editEstimate({ quality, model });
  return { ok: true, provider: prov.id, isSvg, src, rel: where.rel, abs: where.abs, prompt, model, quality, shape, size, outExt, dir,
    name: aiVersionName(dir, where.abs, outExt),
    estimate: per === null ? null : per + (prov.async ? 0 : DESCRIBE_ESTIMATE) };
}

/** Edit an image with AI into a new file. Only with confirm=yes. */
async function editImage(form, opts = {}) {
  if (form.confirm !== 'yes') return { ok: false, status: 400, error: 'Editing with AI needs confirming first.' };
  const p = editPlan(form);
  if (!p.ok) return { ok: false, status: 400, error: p.error };
  const prov = providers.get(p.provider);
  const dir = opts.dir || p.dir;
  if (prov.async) {
    if (!prov.available().ok) return { ok: false, status: 503, error: `Claude Code is not available: ${prov.available().why}.` };
    const dims = images.dimensions(p.abs) || { width: 1024, height: 1024 };
    const name = (opts.dir ? aiVersionName(dir, p.abs, 'svg') : p.name).replace(/\.svg$/, '');
    const r = await prov.startSession({ kind: 'edit', name, dir, prompt: p.prompt, pixels: [dims.width || 1024, dims.height || 1024],
      sourceSvg: fs.readFileSync(p.abs, 'utf8').slice(0, 200000), palette: paletteWords(), provider: prov.id, model: p.model,
      source: { workspace: p.src, path: p.rel }, png: false, created: new Date().toISOString() }, runnerStart(opts));
    if (!r.ok) return { ok: false, status: 503, error: r.error };
    return { ok: true, async: true, session: r.session, name: `${name}.svg`, cost: 0, described: true };
  }
  const key = opts.key || prov.key();
  if (!key) return { ok: false, status: 503, error: `Set ai_providers.${prov.keyName}.api_key in core/config/settings.yml first.` };
  // PNG, JPEG and WebP go as they are; anything else is sent as a temporary PNG.
  let upload = p.abs;
  let tmp = null;
  if (!EDITABLE[path.extname(p.abs).toLowerCase()]) {
    tmp = await convertTo(p.abs, 'png');
    if (!tmp) return { ok: false, status: 400, error: 'The image could not be converted for the edit.' };
    upload = tmp;
  }
  const kind = EDITABLE[path.extname(upload).toLowerCase()] || 'png';
  const file = { name: path.basename(upload), type: `image/${kind}`, data: fs.readFileSync(upload) };
  if (tmp) fs.rmSync(tmp, { force: true });
  let out;
  try {
    out = await prov.edit(p, file, key);
  } catch (e) {
    return { ok: false, status: 502, error: `${prov.label} refused it: ${e.message}` };
  }
  if (!out.image) return { ok: false, status: 502, error: `${prov.label} answered without an image.` };
  fs.mkdirSync(dir, { recursive: true });
  const name = opts.dir ? aiVersionName(dir, p.abs, p.outExt) : p.name;
  const abs = path.join(dir, name);
  fs.writeFileSync(abs, out.image);
  const cost = out.cost;
  const base = { edit_prompt: p.prompt, source: { workspace: p.src, path: p.rel }, provider: prov.id === 'openai' ? undefined : prov.label,
    model: p.model, size: p.size, quality: p.quality || undefined, created: new Date().toISOString(),
    cost: cost === null || cost === undefined ? undefined : `about $${cost.toFixed(4)}` };
  const describeKey = prov.id === 'openai' ? key : apiKey();
  const d = opts.describe === false ? (writeRecords(abs, base), { ok: false }) : await describeAndRecord(abs, base, { key: describeKey });
  images.forgetScan();
  const root = fs.realpathSync(workspaceDir('images'));
  const rel = path.relative(root, fs.realpathSync(abs)).split(path.sep).join('/');
  return { ok: true, rel, name, cost: cost === null || cost === undefined ? null : cost + (d.ok ? d.cost : 0), described: !!d.ok };
}

/** Describe an image already in images/ and add it to its records. Only with confirm=yes. */
async function describeExisting(form, opts = {}) {
  if (form.confirm !== 'yes') return { ok: false, status: 400, error: 'Describing spends a little money, so it needs confirming.' };
  const where = images.safeIn(workspaceDir('images'), String(form.file || ''));
  if (!where || !images.IMAGE_RE.test(where.abs) || !fs.existsSync(where.abs)) return { ok: false, status: 404, error: 'That image is not in the images workspace.' };
  if (!(opts.key || apiKey())) return { ok: false, status: 503, error: 'Set ai_providers.openai.api_key in core/config/settings.yml first.' };
  const base = images.sidecarOf(where.abs) || {};
  delete base.description;
  const d = await describeAndRecord(where.abs, base, opts);
  if (!d.ok) return { ok: false, status: 502, error: `The description was not written: ${d.error}` };
  return { ok: true, rel: where.rel, cost: d.cost };
}

// ------------------------------------------------------------------- forms --

const opt = (opts, chosen) => Object.entries(opts).map(([v, l]) => `<option value="${esc(v)}"${v === chosen ? ' selected' : ''}>${esc(l)}</option>`).join('');

/** The provider select: those not set up here are listed, disabled, with what to set. */
function providerSelectHtml(kind, chosen, { only = null } = {}) {
  const list = providers.list(kind).filter((p) => !only || only.includes(p.id));
  const pick = (list.find((p) => p.id === chosen && p.available().ok) || list.find((p) => p.available().ok) || list[0] || {}).id;
  return list.map((p) => {
    const a = p.available();
    return `<option value="${esc(p.id)}"${p.id === pick ? ' selected' : ''}${a.ok ? '' : ' disabled'}>${esc(p.label)}${a.ok ? '' : ` (${esc(a.why)})`}</option>`;
  }).join('');
}

/** The fields that follow the chosen provider: model, size, quality and how many. */
function providerFieldsHtml(kind, id, { prefix = 'img-ai', edit = false } = {}) {
  const prov = providers.pick(id, kind);
  const sizes = edit ? { same: 'Same shape as the source', ...Object.fromEntries(Object.keys(prov.sizes).map((k) => [k, SHAPES[k] || k])) } : prov.sizes;
  const sizeLabels = edit ? sizes : Object.fromEntries(Object.entries(prov.sizes).map(([k, v]) => [k, `${SHAPES[k] || k}, ${String(v).replace('x', '×')}`]));
  const quals = prov.qualities ? Object.fromEntries(prov.qualities.map((q) => [q, (prov.qualityLabels && prov.qualityLabels[q]) || q[0].toUpperCase() + q.slice(1)])) : null;
  const counts = Object.fromEntries(Array.from({ length: prov.maxCount || 1 }, (_, i) => [String(i + 1), String(i + 1)]));
  return `
        <div class="uk-grid-small uk-child-width-1-3@s uk-margin-small-top" uk-grid>
          <div><label class="uk-form-label" for="${prefix}-model">Model</label>
            <select class="uk-select uk-form-small" id="${prefix}-model" name="model">${opt(prov.models, prov.defaultModel)}</select></div>
          <div><label class="uk-form-label" for="${prefix}-shape">${edit ? 'Size' : 'Shape'}</label>
            <select class="uk-select uk-form-small" id="${prefix}-shape" name="shape">${opt(sizeLabels, edit ? 'same' : Object.keys(sizes)[0])}</select></div>
          ${quals ? `<div><label class="uk-form-label" for="${prefix}-quality">Quality</label>
            <select class="uk-select uk-form-small" id="${prefix}-quality" name="quality">${opt(quals, prov.qualities[0])}</select></div>` : ''}
          ${!edit && (prov.maxCount || 1) > 1 ? `<div><label class="uk-form-label" for="${prefix}-count">How many</label>
            <select class="uk-select uk-form-small" id="${prefix}-count" name="count">${opt(counts, '1')}</select></div>` : ''}
        </div>
        ${prov.async ? '<p class="uk-text-meta uk-margin-small-top">Claude Code draws it as an SVG and a PNG under your own Claude Code login, with no API charge. It runs as a screen session you can watch on Screens, and the result appears in <code>images/generated/</code> when it is done.</p>' : ''}`;
}

function editFormHtml(src, rel, isSvg) {
  const list = editProviders(isSvg);
  const only = list.map((p) => p.id);
  const ready = list.some((p) => p.available().ok);
  return `
    <details class="img-edit img-ai-edit">
      <summary>Edit with AI</summary>
      ${isSvg ? '<p class="uk-text-meta">An SVG is a drawing, so only Claude Code can edit it: it changes the code into a new version.</p>' : ''}
      <form hx-post="/actions/image-ai-edit" hx-target="#editor-modal-body" hx-swap="innerHTML">
        <input type="hidden" name="workspace" value="images">
        <input type="hidden" name="src" value="${esc(src)}">
        <input type="hidden" name="file" value="${esc(rel)}">
        <label class="uk-form-label" for="img-ai-edit-provider">Provider</label>
        <select class="uk-select uk-form-small" id="img-ai-edit-provider" name="provider"
          hx-get="/fragments/images/provider-fields?kind=edit" hx-trigger="change" hx-target="#img-ai-edit-fields" hx-swap="innerHTML" hx-include="this">${providerSelectHtml('edit', '', { only })}</select>
        <label class="uk-form-label uk-margin-small-top" for="img-ai-edit-prompt">What should change?</label>
        <textarea class="uk-textarea" id="img-ai-edit-prompt" name="prompt" rows="4" maxlength="4000" required data-ace="markdown"></textarea>
        <div id="img-ai-edit-fields">${providerFieldsHtml('edit', (list.find((p) => p.available().ok) || list[0]).id, { prefix: 'img-ai-edit', edit: true })}</div>
        <p class="uk-margin-small-top"><button class="uk-button uk-button-primary uk-button-small" type="submit"${ready ? '' : ' disabled'}>See the plan</button>
          <span class="uk-text-meta">${ready ? 'Saved as a new file; the original stays. Nothing is sent until you confirm the plan.' : 'Set an image provider key in <code>core/config/settings.yml</code> first, for example <code>ai_providers.openai.api_key</code>.'}</span></p>
      </form>
    </details>`;
}

/** The cost line of a plan, per provider. */
function costLine(prov, estimate, { describe = true } = {}) {
  if (prov.async) return 'No API charge: it uses your own Claude Code login.';
  if (estimate === null || estimate === undefined) return `${esc(prov.label)} publishes no per-image figure on the page this was built from; check its pricing page. The real cost is not reported back.`;
  return `About $${estimate.toFixed(3)}${describe ? ', with the description' : ''}; the real cost is shown after when the provider reports it.`;
}

function editPlanHtml(p) {
  const prov = providers.get(p.provider);
  const vals = esc(JSON.stringify({ workspace: 'images', src: p.src, file: p.rel, prompt: p.prompt, provider: p.provider, model: p.model,
    shape: p.shape, quality: p.quality || '', confirm: 'yes' }));
  const where = p.src === 'images' ? `images/${path.posix.dirname(p.rel) === '.' ? '' : `${path.posix.dirname(p.rel)}/`}${p.name}` : `images/edited/${p.name}`;
  return `
    <div class="editor-card img-ai-plan">
      <h3 class="uk-margin-small-bottom">The plan: edit with AI</h3>
      <dl class="img-info">
        <dt>Source</dt><dd><code>${esc(`${p.src}/${p.rel}`)}</code>, unchanged</dd>
        <dt>Provider</dt><dd>${esc(prov.label)}, ${esc(prov.models[p.model] || p.model)}</dd>
        <dt>Size</dt><dd>${esc(p.size)}${p.quality ? `, ${esc(p.quality)} quality` : ''}</dd>
        <dt>Saved as</dt><dd><code>${esc(where)}</code></dd>
        <dt>Change</dt><dd>${esc(p.prompt)}</dd>
        <dt>Cost</dt><dd>${costLine(prov, p.estimate)}</dd>
        ${prov.async ? '<dt>Where</dt><dd>A screen session: watch it on Screens. The new version appears beside the source when it is done.</dd>' : ''}
      </dl>
      <p>
        <button type="button" class="uk-button uk-button-primary arm-step" title="Edit ${esc(p.rel)} with ${esc(prov.label)} into a new file${prov.async ? ' (starts a Claude Code session)' : ' (paid)'}"
          hx-post="/actions/image-ai-edit" hx-trigger="confirmed-remove" hx-vals="${vals}"
          hx-target="#editor-modal-body" hx-swap="innerHTML">Edit it</button>
        <button type="button" class="uk-button uk-button-default" hx-get="/fragments/images/view?src=${encodeURIComponent(p.src)}&file=${encodeURIComponent(p.rel)}"
          hx-target="#editor-modal-body" hx-swap="innerHTML">Back to the image</button>
      </p>
    </div>`;
}

function formHtml() {
  const ready = providers.list('generate').some((p) => p.available().ok);
  return `
    <div class="editor-card img-ai">
      <h3 class="uk-margin-small-bottom">Generate with AI</h3>
      ${ready ? '' : '<div class="msg error">No image provider is set up on this machine: set an <code>ai_providers.&lt;provider&gt;.api_key</code> in <code>core/config/settings.yml</code>, or install the claude CLI.</div>'}
      <form hx-post="/actions/image-generate" hx-target="#editor-modal-body" hx-swap="innerHTML">
        <input type="hidden" name="workspace" value="images">
        <label class="uk-form-label" for="img-ai-provider">Provider</label>
        <select class="uk-select uk-form-small" id="img-ai-provider" name="provider"
          hx-get="/fragments/images/provider-fields?kind=generate" hx-trigger="change" hx-target="#img-ai-fields" hx-swap="innerHTML" hx-include="this">${providerSelectHtml('generate', '')}</select>
        <label class="uk-form-label uk-margin-small-top" for="img-ai-prompt">What should it show?</label>
        <textarea class="uk-textarea" id="img-ai-prompt" name="prompt" rows="5" maxlength="4000" required data-ace="markdown"></textarea>
        <div id="img-ai-fields">${providerFieldsHtml('generate', (providers.list('generate').find((p) => p.available().ok) || {}).id)}</div>
        <div class="uk-margin-small-top"><label class="uk-form-label" for="img-ai-name">File name</label>
          <input class="uk-input uk-form-small" id="img-ai-name" name="name" maxlength="80"></div>
        <p class="uk-margin-small-top"><button class="uk-button uk-button-primary" type="submit"${ready ? '' : ' disabled'}>See the plan</button>
          <span class="uk-text-meta">Nothing is sent until you confirm the plan.</span></p>
      </form>
    </div>`;
}

function planHtml(p) {
  const prov = providers.get(p.provider);
  const vals = esc(JSON.stringify({ workspace: 'images', prompt: p.prompt, provider: p.provider, model: p.model, shape: p.shape,
    quality: p.quality || '', count: String(p.n), name: p.name, confirm: 'yes' }));
  const ext = prov.async ? 'svg' : 'png';
  return `
    <div class="editor-card img-ai-plan">
      <h3 class="uk-margin-small-bottom">The plan</h3>
      <dl class="img-info">
        <dt>Provider</dt><dd>${esc(prov.label)}, ${esc(prov.models[p.model] || p.model)}</dd>
        <dt>Size</dt><dd>${esc(p.size)}${p.quality ? `, ${esc(p.quality)} quality` : ''}</dd>
        <dt>Images</dt><dd>${p.n}, saved as <code>images/generated/${esc(p.name)}.${ext}</code>${prov.async ? ' and its PNG' : ''}${p.n > 1 ? ' and the next free names' : ''}</dd>
        <dt>Prompt</dt><dd>${esc(p.prompt)}</dd>
        <dt>Cost</dt><dd>${prov.id === 'openai' && p.estimate !== null ? `About $${(ESTIMATE[p.quality] * p.n).toFixed(3)} (OpenAI's published figure per ${esc(p.quality)} image), + about $${(DESCRIBE_ESTIMATE * p.n).toFixed(3)} for the description; the real cost is shown after.` : costLine(prov, p.estimate)}</dd>
        <dt>Also</dt><dd>${prov.async ? 'Claude writes the summary and the alt text itself, and the prompt is kept in a <code>.md</code> file beside the image. It runs as a screen session: watch it on Screens.'
          : `A short description and an alt text are written by ${esc(VISION_MODEL)}, and the prompt is kept in a <code>.md</code> file beside each image.`}</dd>
      </dl>
      <p>
        <button type="button" class="uk-button uk-button-primary arm-step" title="${prov.async ? 'Start a Claude Code session to draw it' : `Generate ${p.n} image${p.n === 1 ? '' : 's'} with ${esc(prov.label)} (paid)`}"
          hx-post="/actions/image-generate" hx-trigger="confirmed-remove" hx-vals="${vals}"
          hx-target="#editor-modal-body" hx-swap="innerHTML">${prov.async ? 'Start drawing' : 'Generate'}</button>
        <button type="button" class="uk-button uk-button-default" hx-get="/fragments/images/generate-form" hx-target="#editor-modal-body" hx-swap="innerHTML">Change it</button>
      </p>
    </div>`;
}

module.exports = { MODELS, SIZES, QUALITIES, ESTIMATE, VISION_MODEL, DESCRIBE_ESTIMATE, EDIT_SIZES, apiKey, plan, generate, actualCost,
  formHtml, planHtml, describeImage, writeRecords, recordPath, nearestSize, nearestShape, aiVersionName, editPlan, editImage,
  describeExisting, editFormHtml, editPlanHtml, providerFieldsHtml, providerSelectHtml, paletteWords, editProviders };
