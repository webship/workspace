/**
 * Generate SVG: without confirm=yes this answers with the plan; the request goes out only with the confirm dialog's Yes.
 */

const { esc } = require('../html');
const images = require('../images');

async function image_svg({ form, send, res }) {
  const svg = require('../images-svg');
  if (form.confirm !== 'yes') {
    const p = svg.plan(form);
    if (!p.ok) return send(`<div class="msg error">${esc(p.error)}</div>${svg.formHtml()}`, 400);
    const prov = require('../images-providers').get(p.provider);
    const a = prov.available();
    if (!a.ok) return send(`<div class="msg error">${prov.keyName ? `Set <code>ai_providers.${esc(prov.keyName)}.api_key</code> in <code>core/config/settings.yml</code> first.` : `${esc(prov.label)}: ${esc(a.why)}.`}</div>`, 503);
    return send(svg.planHtml(p));
  }
  const r = await svg.generateSvg(form);
  if (!r.ok) {
    const spent = r.cost ? ` It cost about $${r.cost.toFixed(4)}.` : '';
    return send(`<div class="msg error">${esc(r.error)}${spent}</div>`, r.status);
  }
  if (r.async) {
    return send(`<div class="msg assistant">Claude Code is drawing it in the screen session <strong>${esc(r.session)}</strong>: <a href="/screens">watch it on Screens</a>. The SVG and its records appear in <strong>images/svg/</strong> when it is done.</div>`);
  }
  images.forgetScan();
  try { res.setHeader('HX-Trigger', 'refresh-projects'); } catch (_) { /* headers already sent */ }
  const viewer = require('../images-page').viewerHtml({ q: '', sort: 'newest', kind: '', scope: 'here' }, 'svg', 'images', r.rel) || '';
  return send(`<div class="msg assistant">Saved <strong>images/${esc(r.rel)}</strong> after ${r.attempts} attempt${r.attempts === 1 ? '' : 's'}${
    r.cost === null ? '' : `, for about $${r.cost.toFixed(4)}`}.</div>${viewer}`);
}

module.exports = { '/actions/image-svg': image_svg };
