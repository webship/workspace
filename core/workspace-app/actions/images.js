/**
 * Renaming and deleting an image in the images workspace. Images shown from other workspaces are
 * read-only here, so both refuse any source but images/.
 */

const fs = require('fs');
const path = require('path');

const { esc } = require('../html');
const { workspaceDir, isValidWorkspace } = require('../workspaces');
const images = require('../images');

function ownImage(form) {
  if (!isValidWorkspace('images')) return null;
  const where = images.safeIn(workspaceDir('images'), String(form.file || ''));
  if (!where || !images.IMAGE_RE.test(where.abs)) return null;
  try { if (!fs.statSync(where.abs).isFile()) return null; } catch (_) { return null; }
  return where;
}

function refreshed(res) {
  images.forgetScan();
  try { res.setHeader('HX-Trigger', 'refresh-projects'); } catch (_) { /* headers already sent */ }
}

async function image_rename({ form, send, res }) {
  const where = ownImage(form);
  if (!where) return send('<div class="msg error">That image is not in the images workspace.</div>', 404);
  const ext = path.extname(where.abs).toLowerCase();
  let name = images.safeName(form.name);
  if (!name) return send('<div class="msg error">Give it a name: letters, digits, dot, dash and underscore.</div>', 400);
  // The extension is the file's own; a rename never changes what kind of image it is.
  if (path.extname(name).toLowerCase() !== ext) name = `${name.replace(/\.[^.]*$/, '')}${ext}`;
  const dest = path.join(path.dirname(where.abs), name);
  if (dest === where.abs) return send('<div class="msg assistant">The name is unchanged.</div>');
  if (fs.existsSync(dest)) return send(`<div class="msg error"><code>${esc(name)}</code> already exists in that folder.</div>`, 409);
  fs.renameSync(where.abs, dest);
  // A sidecar travels with its image.
  if (fs.existsSync(`${where.abs}.json`)) fs.renameSync(`${where.abs}.json`, `${dest}.json`);
  refreshed(res);
  const rel = path.relative(fs.realpathSync(workspaceDir('images')), dest).split(path.sep).join('/');
  return send(`<div class="msg assistant">Renamed to <strong>${esc(name)}</strong>.</div>${
    require('../images-page').viewerHtml({ q: '', sort: 'newest', kind: '', scope: 'here' }, path.posix.dirname(rel) === '.' ? '' : path.posix.dirname(rel), 'images', rel) || ''}`);
}

async function image_delete({ form, send, res }) {
  if (form.confirm !== 'yes') return send('<div class="msg error">Deleting needs confirmation.</div>', 400);
  const where = ownImage(form);
  if (!where) return send('<div class="msg error">That image is not in the images workspace.</div>', 404);
  fs.unlinkSync(where.abs);
  try { fs.unlinkSync(`${where.abs}.json`); } catch (_) { /* no sidecar */ }
  refreshed(res);
  return send(`<div class="msg assistant">Deleted <strong>${esc(where.rel)}</strong>.</div>`);
}

const viewerOf = (rel) => require('../images-page').viewerHtml({ q: '', sort: 'newest', kind: '', scope: 'here' },
  path.posix.dirname(rel) === '.' ? '' : path.posix.dirname(rel), 'images', rel) || '';

async function image_screenshot({ form, send, res }) {
  const r = await require('../images-create').screenshot(form);
  if (!r.ok) return send(`<div class="msg error">${esc(r.error)}</div>`, r.status);
  refreshed(res);
  return send(`<div class="msg assistant">Saved <strong>${esc(r.rel)}</strong>.</div>${viewerOf(r.rel)}`);
}

async function image_edit({ form, send, res }) {
  const r = await require('../images-create').edit(form);
  if (!r.ok) return send(`<div class="msg error">${esc(r.error)}</div>`, r.status);
  refreshed(res);
  return send(`<div class="msg assistant">Saved as <strong>${esc(r.name)}</strong>; the original is unchanged.</div>${viewerOf(r.rel)}`);
}

/** Why a provider cannot run here, as HTML, or '' when it can. */
function notReady(id) {
  const prov = require('../images-providers').get(id);
  if (!prov) return 'Unknown provider.';
  const a = prov.available();
  if (a.ok) return '';
  return prov.keyName ? `Set <code>ai_providers.${esc(prov.keyName)}.api_key</code> in <code>core/config/settings.yml</code> first.` : `${esc(prov.label)}: ${esc(a.why)}.`;
}

/** A Claude Code session has started: where to watch it and where the result lands. */
function startedHtml(session, where) {
  return `<div class="msg assistant">Claude Code is drawing it in the screen session <strong>${esc(session)}</strong>: <a href="/screens">watch it on Screens</a>. The SVG, its PNG and the records appear in <strong>${where}</strong> when it is done.</div>`;
}

// Without confirm=yes this only answers with the plan; the paid request needs the confirm dialog's Yes.
async function image_generate({ form, send, res }) {
  const ai = require('../images-ai');
  if (form.confirm !== 'yes') {
    const p = ai.plan(form);
    if (!p.ok) return send(`<div class="msg error">${esc(p.error)}</div>${ai.formHtml()}`, 400);
    const why = notReady(p.provider);
    if (why) return send(`<div class="msg error">${why}</div>`, 503);
    return send(ai.planHtml(p));
  }
  const r = await ai.generate(form);
  if (!r.ok) return send(`<div class="msg error">${esc(r.error)}</div>`, r.status);
  if (r.async) return send(startedHtml(r.session, 'images/generated/'));
  refreshed(res);
  const page = require('../images-page');
  const thumbs = r.made.map((rel) => `<button type="button" class="img-thumb img-made-thumb"
      hx-get="/fragments/images/view?src=images&file=${encodeURIComponent(rel)}&path=generated" hx-target="#editor-modal-body" hx-swap="innerHTML">
      <img src="${esc(page.fileUrl('images', rel))}" alt="${esc(rel)}"></button>`).join('');
  const missing = (r.undescribed || []).length
    ? `<div class="msg error">The description was not written for ${r.undescribed.map((n) => `<code>${esc(n)}</code>`).join(', ')}; open it and use <strong>Describe it</strong>.</div>` : '';
  return send(`<div class="msg assistant">Made ${r.made.length} image${r.made.length === 1 ? '' : 's'} in <strong>images/generated/</strong>, each with its prompt, a description and an alt text${
    r.cost === null ? '' : `, for about $${r.cost.toFixed(4)} in all`}. Open one to see it full size.</div>${missing}<div class="img-made-grid">${thumbs}</div>`);
}

// Edit with AI: a plan first, and the paid request only with the confirm dialog's Yes.
async function image_ai_edit({ form, send, res }) {
  const ai = require('../images-ai');
  if (form.confirm !== 'yes') {
    const p = ai.editPlan(form);
    if (!p.ok) return send(`<div class="msg error">${esc(p.error)}</div>`, 400);
    const why = notReady(p.provider);
    if (why) return send(`<div class="msg error">${why}</div>`, 503);
    return send(ai.editPlanHtml(p));
  }
  const r = await ai.editImage(form);
  if (!r.ok) return send(`<div class="msg error">${esc(r.error)}</div>`, r.status);
  if (r.async) return send(startedHtml(r.session, `the source's folder as ${esc(r.name)}`));
  refreshed(res);
  return send(`<div class="msg assistant">Saved as <strong>images/${esc(r.rel)}</strong>; the source is unchanged${
    r.cost === null ? '' : `. It cost about $${r.cost.toFixed(4)}`}.${r.described ? '' : ' The description was not written: use <strong>Describe it</strong>.'}</div>${viewerOf(r.rel)}`);
}

// Describe an image: a small paid call, so only with the confirm dialog's Yes.
async function image_describe({ form, send, res }) {
  const r = await require('../images-ai').describeExisting(form);
  if (!r.ok) return send(`<div class="msg error">${esc(r.error)}</div>`, r.status);
  refreshed(res);
  return send(`<div class="msg assistant">Described, for about $${r.cost.toFixed(4)}.</div>${viewerOf(r.rel)}`);
}

module.exports = {
  '/actions/image-generate': image_generate,
  '/actions/image-ai-edit': image_ai_edit,
  '/actions/image-describe': image_describe,
  '/actions/image-screenshot': image_screenshot,
  '/actions/image-edit': image_edit,
  '/actions/image-rename': image_rename,
  '/actions/image-delete': image_delete,
};
