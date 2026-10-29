/**
 * Generate SVG: a drawing, still or animated, written by a text model as SVG code, sanitised, checked for
 * substance and kept on brand from the `svg:` block of workspace.images.settings.yml. A thin or unsafe answer is
 * retried with the reason, within max_attempts and the time budget. Saved into images/svg/ with its records.
 * A paid call goes out only with confirm=yes, which only the confirm dialog's Yes sends.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const { esc } = require('./html');
const { CONFIG_DIR, workspaceDir } = require('./workspaces');
const images = require('./images');
const providers = require('./images-providers');
const core = require('./images-svg-core');
const { writeRecords } = require('./images-records');

const PALETTE_KEYS = ['primary', 'secondary', 'accent', 'dark', 'light'];
const HEX = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i;
const DEFAULTS = { brief: '', palette: 'brand-tokens', max_attempts: 3, request_timeout: 180, time_budget: 240, motion: core.MOTION, examples: [] };
const MIN_ATTEMPT_MS = 30000;

/** The brand tokens' five colours. */
function brandPalette() {
  let t = {};
  try { t = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'brand-tokens.json'), 'utf8')).tokens || {}; } catch (_) { /* fall back */ }
  const fallback = { primary: '#0074e0', secondary: '#2b447c', accent: '#e4dcff', dark: '#000000', light: '#ebe8e5' };
  return Object.fromEntries(PALETTE_KEYS.map((k) => [k, HEX.test(t[`brand-${k}`] || '') ? t[`brand-${k}`] : fallback[k]]));
}

/** The `svg:` settings, with defaults for anything missing or out of range. */
function config() {
  let raw = {};
  try { raw = (yaml.load(fs.readFileSync(path.join(CONFIG_DIR, 'workspace.images.settings.yml'), 'utf8')) || {}).svg || {}; } catch (_) { /* defaults */ }
  const num = (v, d, lo, hi) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : d);
  const palette = brandPalette();
  if (raw.palette && typeof raw.palette === 'object') for (const k of PALETTE_KEYS) if (HEX.test(String(raw.palette[k] || ''))) palette[k] = String(raw.palette[k]);
  const m = raw.motion && typeof raw.motion === 'object' ? raw.motion : {};
  return {
    brief: String(raw.brief || DEFAULTS.brief).trim().slice(0, 1000),
    palette,
    max_attempts: num(raw.max_attempts, DEFAULTS.max_attempts, 1, 5),
    request_timeout: num(raw.request_timeout, DEFAULTS.request_timeout, 30, 600),
    time_budget: num(raw.time_budget, DEFAULTS.time_budget, 30, 1200),
    motion: { ...core.MOTION, duration: num(m.duration, core.MOTION.duration, 200, 5000), stagger: num(m.stagger, core.MOTION.stagger, 0, 1000),
      threshold: num(m.threshold, core.MOTION.threshold, 0, 1), replay: m.replay !== false },
    examples: (Array.isArray(raw.examples) ? raw.examples : []).filter((e) => e && e.title && e.prompt).slice(0, 20)
      .map((e) => ({ title: String(e.title).slice(0, 80), prompt: String(e.prompt).slice(0, 2000), style: core.STYLES[e.style] ? e.style : 'draw' })),
  };
}

/** The palette for one run: the configured one, with any colour the form changed. */
function paletteFor(form, cfg) {
  const p = { ...cfg.palette };
  for (const k of PALETTE_KEYS) if (HEX.test(String(form[`palette_${k}`] || ''))) p[k] = String(form[`palette_${k}`]).toLowerCase();
  return p;
}

/** A request, checked, or why not. */
function plan(form) {
  const cfg = config();
  const prompt = String(form.prompt || '').trim();
  if (!prompt) return { ok: false, error: 'Say what the drawing should show.' };
  if (prompt.length > 2000) return { ok: false, error: 'The prompt can be 2000 characters at most.' };
  const prov = providers.pick(form.provider, 'svg');
  const model = prov.svgModels[form.model] ? String(form.model) : prov.defaultSvgModel;
  const style = core.STYLES[form.style] ? String(form.style) : 'draw';
  const shape = core.SHAPES[form.shape] ? String(form.shape) : 'wide';
  const name = images.safeName(form.name || '').replace(/\.[^.]*$/, '')
    || prompt.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'drawing';
  const per = prov.svgEstimate({ model });
  return { ok: true, provider: prov.id, prompt, model, style, shape, name, palette: paletteFor(form, cfg), png: form.png === 'yes',
    attempts: cfg.max_attempts, estimate: per === null ? null : per, cfg };
}

/** The folder drawings go into. */
const svgDir = () => path.join(workspaceDir('images'), 'svg');

/** Save a finished drawing with its records, and its PNG preview when asked. */
function save(dir, p, done, extra) {
  fs.mkdirSync(dir, { recursive: true });
  const file = images.freeName(dir, p.name, 'svg');
  const abs = path.join(dir, file);
  fs.writeFileSync(abs, done.svg);
  let png = '';
  if (p.png) {
    const pngPath = abs.replace(/\.svg$/, '.png');
    if (require('./images-render').renderPng(abs, pngPath, core.SHAPES[p.shape])) png = path.basename(pngPath);
  }
  writeRecords(abs, { prompt: p.prompt, style: core.STYLES[p.style], palette: core.paletteLine(p.palette), size: core.SHAPES[p.shape].join('x'),
    created: new Date().toISOString(), png: png || undefined, motion: p.style === 'draw' ? p.cfg.motion : undefined,
    sanitised: done.note || undefined, ...extra });
  images.forgetScan();
  return file;
}

/** Generate a drawing. Only with confirm=yes. Returns { ok, rel, cost, attempts } or a Claude Code session. */
async function generateSvg(form, opts = {}) {
  if (form.confirm !== 'yes') return { ok: false, status: 400, error: 'Generating needs confirming first.' };
  const p = plan(form);
  if (!p.ok) return { ok: false, status: 400, error: p.error };
  const prov = providers.get(p.provider);
  const dir = opts.dir || svgDir();
  if (prov.async) {
    if (!prov.available().ok) return { ok: false, status: 503, error: `Claude Code is not available: ${prov.available().why}.` };
    const name = images.freeName(dir, p.name, 'svg').replace(/\.svg$/, '');
    const { system, user } = core.buildPrompt({ ...p, brief: p.cfg.brief, files: { svg: `${name}.svg`, words: `${name}.claude.json` } });
    const start = opts.start || require('./jobs').hostRunnerRequest;
    const r = await prov.startSession({ kind: 'svg', name, dir, prompt: p.prompt, fullPrompt: `${system}\n\n${user}`, style: p.style,
      palette: core.paletteLine(p.palette), motion: p.cfg.motion, attempts: p.attempts, shape: p.shape, pixels: core.SHAPES[p.shape],
      png: p.png, created: new Date().toISOString() }, start);
    if (!r.ok) return { ok: false, status: 503, error: r.error };
    return { ok: true, async: true, session: r.session };
  }
  const key = opts.key || prov.key();
  if (!key) return { ok: false, status: 503, error: `Set ai_providers.${prov.keyName}.api_key in core/config/settings.yml first.` };
  const { system, user } = core.buildPrompt({ ...p, brief: p.cfg.brief });
  const messages = [{ role: 'user', content: user }];
  const started = Date.now();
  const budget = p.cfg.time_budget * 1000;
  let cost = 0;
  let priced = true;
  const tries = [];
  for (let n = 1; n <= p.attempts; n += 1) {
    const left = budget - (Date.now() - started);
    if (n > 1 && left < MIN_ATTEMPT_MS) break;
    let res;
    try {
      res = await prov.svg({ system, messages, model: p.model }, key, { timeoutMs: Math.min(p.cfg.request_timeout * 1000, Math.max(MIN_ATTEMPT_MS, left)) });
    } catch (e) {
      return { ok: false, status: 502, error: `${prov.label} refused it: ${e.message}`, attempts: tries };
    }
    if (res.cost === null || res.cost === undefined) priced = false; else cost += res.cost;
    const reply = core.parseReply(res.text);
    const done = core.finish(reply.svg, { style: p.style, motion: p.cfg.motion });
    tries.push(done.ok ? 'ok' : done.why);
    if (done.ok) {
      const file = save(dir, p, done, { provider: prov.label, model: res.model, attempts: n, summary: reply.summary, alt: reply.alt,
        described_by: reply.summary || reply.alt ? `${res.model}, in the same answer` : undefined,
        cost: priced ? `about $${cost.toFixed(4)}` : undefined });
      const root = fs.realpathSync(workspaceDir('images'));
      const rel = path.relative(root, fs.realpathSync(path.join(dir, file))).split(path.sep).join('/');
      return { ok: true, rel, file, cost: priced ? cost : null, attempts: n };
    }
    messages.push({ role: 'assistant', content: String(res.text || '').slice(0, 20000) }, { role: 'user', content: `${done.why} Answer again with the whole JSON.` });
  }
  return { ok: false, status: 502, error: `No usable drawing after ${tries.length} attempt${tries.length === 1 ? '' : 's'}: ${tries[tries.length - 1] || 'out of time'}`,
    cost: priced ? cost : null, attempts: tries };
}

// ------------------------------------------------------------------- forms --

const opt = (o, chosen) => Object.entries(o).map(([v, l]) => `<option value="${esc(v)}"${v === chosen ? ' selected' : ''}>${esc(l)}</option>`).join('');

/** The provider's own fields: its models, and what it costs. */
function providerFieldsHtml(id) {
  const prov = providers.pick(id, 'svg');
  const note = prov.async
    ? 'Claude Code writes the SVG under your own Claude Code login, with no API charge. It runs as a screen session you can watch on Screens.'
    : prov.svgEstimate({}) === null ? `${esc(prov.label)} publishes no per-drawing figure on the page this was built from; the real cost is not reported back.`
      : `About $${prov.svgEstimate({}).toFixed(3)} an attempt; the real cost is shown after.`;
  return `<label class="uk-form-label" for="svg-model">Model</label>
    <select class="uk-select uk-form-small" id="svg-model" name="model">${opt(prov.svgModels, prov.defaultSvgModel)}</select>
    <p class="uk-text-meta uk-margin-small-top">${note}</p>`;
}

function formHtml() {
  const cfg = config();
  const list = providers.list('svg');
  const ready = list.find((p) => p.available().ok);
  const sel = list.map((p) => {
    const a = p.available();
    return `<option value="${esc(p.id)}"${ready && p.id === ready.id ? ' selected' : ''}${a.ok ? '' : ' disabled'}>${esc(p.label)}${a.ok ? '' : ` (${esc(a.why)})`}</option>`;
  }).join('');
  const examples = cfg.examples.map((e, i) => `<option value="${i}" data-prompt="${esc(e.prompt)}" data-style="${esc(e.style)}">${esc(e.title)}</option>`).join('');
  const colours = PALETTE_KEYS.map((k) => `<label class="svg-swatch"><input type="color" name="palette_${k}" value="${esc(cfg.palette[k])}"> ${k}</label>`).join('');
  return `
    <div class="editor-card img-ai img-svg">
      <h3 class="uk-margin-small-bottom">Generate SVG</h3>
      ${ready ? '' : '<div class="msg error">No SVG provider is set up on this machine: set an <code>ai_providers.&lt;provider&gt;.api_key</code> in <code>core/config/settings.yml</code>, or install the claude CLI.</div>'}
      <form hx-post="/actions/image-svg" hx-target="#editor-modal-body" hx-swap="innerHTML">
        <input type="hidden" name="workspace" value="images">
        <div class="uk-grid-small uk-child-width-1-2@s" uk-grid>
          <div><label class="uk-form-label" for="svg-provider">Provider</label>
            <select class="uk-select uk-form-small" id="svg-provider" name="provider"
              hx-get="/fragments/images/svg-provider-fields" hx-trigger="change" hx-target="#svg-fields" hx-swap="innerHTML" hx-include="this">${sel}</select></div>
          <div id="svg-fields">${providerFieldsHtml(ready ? ready.id : '')}</div>
        </div>
        ${examples ? `<label class="uk-form-label uk-margin-small-top" for="svg-example">Start from an example</label>
        <select class="uk-select uk-form-small" id="svg-example" data-svg-example><option value="">Choose an example…</option>${examples}</select>` : ''}
        <label class="uk-form-label uk-margin-small-top" for="svg-prompt">What should it show?</label>
        <textarea class="uk-textarea" id="svg-prompt" name="prompt" rows="4" maxlength="2000" required data-ace="markdown"></textarea>
        <div class="uk-grid-small uk-child-width-1-3@s uk-margin-small-top" uk-grid>
          <div><label class="uk-form-label" for="svg-style">Style</label>
            <select class="uk-select uk-form-small" id="svg-style" name="style">${opt(core.STYLES, 'draw')}</select></div>
          <div><label class="uk-form-label" for="svg-shape">Shape</label>
            <select class="uk-select uk-form-small" id="svg-shape" name="shape">${opt(core.SHAPE_LABELS, 'wide')}</select></div>
          <div><label class="uk-form-label" for="svg-name">File name</label>
            <input class="uk-input uk-form-small" id="svg-name" name="name" maxlength="80"></div>
        </div>
        <fieldset class="svg-palette uk-margin-small-top"><legend class="uk-form-label">Palette, for this drawing (from the brand tokens)</legend>${colours}</fieldset>
        <label class="uk-margin-small-top uk-display-block"><input class="uk-checkbox" type="checkbox" name="png" value="yes"> Also save a PNG preview</label>
        <p class="uk-margin-small-top"><button class="uk-button uk-button-primary" type="submit"${ready ? '' : ' disabled'}>See the plan</button>
          <span class="uk-text-meta">Saved into <code>images/svg/</code>. Nothing is sent until you confirm the plan.</span></p>
      </form>
    </div>`;
}

function planHtml(p) {
  const prov = providers.get(p.provider);
  const vals = esc(JSON.stringify({ workspace: 'images', prompt: p.prompt, provider: p.provider, model: p.model, style: p.style, shape: p.shape,
    name: p.name, png: p.png ? 'yes' : '', confirm: 'yes', ...Object.fromEntries(Object.entries(p.palette).map(([k, v]) => [`palette_${k}`, v])) }));
  const cost = prov.async ? 'No API charge: it uses your own Claude Code login.'
    : p.estimate === null ? `${esc(prov.label)} publishes no per-drawing figure on the page this was built from; check its pricing page.`
      : `About $${p.estimate.toFixed(3)} an attempt, at most ${p.attempts} attempts (about $${(p.estimate * p.attempts).toFixed(3)}); the real cost is shown after.`;
  const swatches = Object.entries(p.palette).map(([k, v]) => `<span class="svg-chip" style="background:${esc(v)}" title="${esc(k)} ${esc(v)}"></span>`).join('');
  return `
    <div class="editor-card img-ai-plan">
      <h3 class="uk-margin-small-bottom">The plan: generate an SVG</h3>
      <dl class="img-info">
        <dt>Provider</dt><dd>${esc(prov.label)}, ${esc(prov.svgModels[p.model] || p.model)}</dd>
        <dt>Style</dt><dd>${esc(core.STYLES[p.style])}${p.style === 'draw' ? `: parts rise in turn and their strokes are traced (${p.cfg.motion.duration} ms, ${p.cfg.motion.stagger} ms apart)` : ''}; reduced motion shows the finished drawing</dd>
        <dt>Size</dt><dd>${esc(core.SHAPE_LABELS[p.shape])}</dd>
        <dt>Palette</dt><dd>${swatches} <code>${esc(core.paletteLine(p.palette))}</code></dd>
        <dt>Saved as</dt><dd><code>images/svg/${esc(p.name)}.svg</code>${p.png ? ' and a PNG preview' : ''}, with its prompt, summary and alt text</dd>
        <dt>Prompt</dt><dd>${esc(p.prompt)}</dd>
        <dt>Checks</dt><dd>Sanitised (no scripts, handlers or outside links), at least ${core.MIN_DRAWABLE} shapes in ${core.MIN_PARTS} parts; a thin or unsafe answer is retried with the reason, up to ${p.attempts} attempts${prov.async ? '' : ` within ${p.cfg.time_budget} s`}</dd>
        <dt>Cost</dt><dd>${cost}</dd>
        ${prov.async ? '<dt>Where</dt><dd>A screen session: watch it on Screens. The drawing appears in <code>images/svg/</code> when it is done.</dd>' : ''}
      </dl>
      <p>
        <button type="button" class="uk-button uk-button-primary arm-step" title="${prov.async ? 'Start a Claude Code session to draw it' : `Generate an SVG with ${esc(prov.label)} (paid)`}"
          hx-post="/actions/image-svg" hx-trigger="confirmed-remove" hx-vals="${vals}"
          hx-target="#editor-modal-body" hx-swap="innerHTML">${prov.async ? 'Start drawing' : 'Generate'}</button>
        <button type="button" class="uk-button uk-button-default" hx-get="/fragments/images/svg-form" hx-target="#editor-modal-body" hx-swap="innerHTML">Change it</button>
      </p>
    </div>`;
}

module.exports = { PALETTE_KEYS, config, brandPalette, paletteFor, plan, generateSvg, formHtml, planHtml, providerFieldsHtml, svgDir };
