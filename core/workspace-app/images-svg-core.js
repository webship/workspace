/**
 * The pure half of the SVG generator: the prompt, reading a reply, the substance check, the transform repair and
 * the draw-in motion. No dependencies beyond the sanitiser, so the dashboard and the host-side finish step of a
 * Claude Code drawing run the same checks.
 */

const { sanitizeSvg, removedSummary, tokens, parseTag, DRAWABLE } = require('./images-svg-sanitize');

const STYLES = { still: 'Still', draw: 'Draw the strokes', css: 'CSS keyframes', smil: 'SMIL' };
const SHAPES = { wide: [960, 400], landscape: [960, 640], square: [800, 800] };
const SHAPE_LABELS = { wide: 'Wide, 960×400', landscape: 'Landscape, 960×640', square: 'Square, 800×800' };
const MOTION = { animation: 'draw-rise', duration: 1100, stagger: 110, replay: true, threshold: 0.25 };
const MIN_DRAWABLE = 4;
const MIN_PARTS = 4;
const STROKED = new Set(['path', 'line', 'polyline', 'polygon', 'circle', 'ellipse', 'rect']);

const STYLE_RULES = {
  still: 'A still drawing: no animation of any kind.',
  draw: 'Stroke only: every shape has fill="none" and an explicit stroke colour and stroke-width, with round line caps. '
    + 'No filled shapes and no animation: the drawing is animated for you, part by part, by tracing its strokes.',
  css: 'Animate it with ONE <style> element holding @keyframes, on classed elements, wrapped in '
    + '@media (prefers-reduced-motion: no-preference) so a reader who asks for less motion sees the finished drawing. '
    + 'Animations run once and end on the finished drawing (animation-fill-mode: both). Never put a transform attribute on '
    + 'an element you animate with CSS: put it on a wrapping <g> instead.',
  smil: 'Animate it with SMIL (<animate>, <animateTransform>), begin times staggered part by part, fill="freeze", '
    + 'ending on the finished drawing. Never animate href, style, class or an event attribute.',
};

/** The palette as words a model can follow. */
function paletteLine(palette) {
  return Object.entries(palette).map(([k, v]) => `${k} ${v}`).join(', ');
}

/**
 * The system and user prompt. `files` asks for two files (Claude Code) instead of a JSON reply.
 */
function buildPrompt({ prompt, style, palette, brief, shape, files = null }) {
  const [w, h] = SHAPES[shape] || SHAPES.wide;
  const out = files
    ? `Write exactly two files in the current folder and nothing else:\n1. ${files.svg}: the SVG.\n2. ${files.words}: {"summary": "one or two plain sentences on what it shows", "alt": "alt text, at most 125 characters"}.\nDo not run any commands. When both files are written, stop.`
    : 'Answer with JSON only: {"svg": "the whole SVG", "summary": "one or two plain sentences on what it shows", "alt": "alt text, at most 125 characters"}.';
  const system = `You draw illustrations as SVG code for a website.
${brief ? `The brief: ${brief}\n` : ''}
Rules:
- One <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"> root, with no width or height attribute.
- 5 to 9 top-level parts, each a <g class="part"> in reading order, and every shape inside a part. At least ${MIN_DRAWABLE} drawable elements in all.
- Only these colours: ${paletteLine(palette)}. Tints by opacity are fine.
- No <script>, <foreignObject>, <image>, event handlers or external links; url() and href may point only at an id in this file.
- No text unless the request asks for it, and never a logo or a brand name.
- ${STYLE_RULES[style] || STYLE_RULES.still}

${out}`;
  return { system, user: `Draw: ${prompt}` };
}

/** The SVG, summary and alt text out of a reply: JSON, JSON in a fence, or bare markup. */
function parseReply(text) {
  const t = String(text || '');
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a >= 0 && b > a) {
    try {
      const j = JSON.parse(t.slice(a, b + 1));
      if (j && typeof j.svg === 'string') return { svg: j.svg, summary: String(j.summary || '').trim().slice(0, 600), alt: String(j.alt || '').trim().slice(0, 125) };
    } catch (_) { /* not JSON, try the markup */ }
  }
  const m = t.match(/<svg[\s>][\s\S]*<\/svg>/i);
  return { svg: m ? m[0] : '', summary: '', alt: '' };
}

/** The root <svg> tag's attributes, as a map. */
function rootAttrs(svg) {
  const m = svg.match(/<svg\b[^>]*>/i);
  const tag = m && parseTag(m[0].replace(/\/>$/, '>'));
  return tag ? Object.fromEntries(tag.attrs) : null;
}

/** Fix the root: a viewBox from width and height when it has none, then no width or height. */
function fixRoot(svg) {
  const attrs = rootAttrs(svg);
  if (!attrs) return svg;
  let tag = svg.match(/<svg\b[^>]*>/i)[0];
  const num = (v) => parseFloat(String(v || '').replace(/px$/, ''));
  if (!attrs.viewBox && num(attrs.width) > 0 && num(attrs.height) > 0) {
    tag = tag.replace(/<svg\b/i, `<svg viewBox="0 0 ${num(attrs.width)} ${num(attrs.height)}"`);
  }
  tag = tag.replace(/\s(width|height)="[^"]*"/g, '');
  return svg.replace(/<svg\b[^>]*>/i, tag);
}

/** Whether a drawing has enough in it, or why not, in words a model can act on. */
function substance(svg) {
  const attrs = rootAttrs(svg);
  if (!attrs) return { ok: false, why: 'There is no <svg> root.', drawable: 0, parts: 0 };
  const drawable = (svg.match(new RegExp(`<(${[...DRAWABLE].join('|')})\\b`, 'g')) || []).length;
  const parts = (svg.match(/\bclass="[^"]*\bpart\b[^"]*"/g) || []).length;
  const whys = [];
  if (!attrs.viewBox) whys.push('the root has no viewBox');
  if (attrs.width || attrs.height) whys.push('the root has a width or height');
  if (drawable < MIN_DRAWABLE) whys.push(`it has ${drawable} drawable element${drawable === 1 ? '' : 's'}, and it needs at least ${MIN_DRAWABLE}`);
  if (parts < MIN_PARTS) whys.push(`it has ${parts} <g class="part"> group${parts === 1 ? '' : 's'}, and it needs at least ${MIN_PARTS}`);
  return { ok: !whys.length, why: whys.length ? `The drawing was not used: ${whys.join('; ')}.` : '', drawable, parts };
}

/** The classes a <style> animates. */
function animatedClasses(svg) {
  const out = new Set();
  for (const m of svg.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
    for (const r of m[1].matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/animation/i.test(r[2])) continue;
      for (const c of r[1].matchAll(/\.([A-Za-z_][\w-]*)/g)) out.add(c[1]);
    }
  }
  return out;
}

/**
 * A CSS animation that sets transform overrides the element's own transform attribute, so a drawing that is
 * placed with one jumps when it animates. Move such a transform onto a wrapping <g>. Returns { svg, moved }.
 */
function repairTransforms(svg, extra = []) {
  const classes = animatedClasses(svg);
  for (const c of extra) classes.add(c);
  if (!classes.size) return { svg, moved: 0 };
  const out = [];
  const wraps = [];
  let moved = 0;
  for (const t of tokens(svg)) {
    const tag = t.startsWith('<') && !t.startsWith('<!') && !t.startsWith('<?') ? parseTag(t) : null;
    if (!tag) { out.push(t); continue; }
    if (tag.close) {
      out.push(t);
      const w = wraps.pop();
      if (w) out.push('</g>');
      continue;
    }
    const cls = (tag.attrs.find(([k]) => k === 'class') || [])[1] || '';
    const tf = tag.attrs.find(([k]) => k === 'transform');
    const hit = tag.name !== 'svg' && tf && cls.split(/\s+/).some((c) => classes.has(c));
    if (hit) {
      moved += 1;
      const rest = t.replace(/\stransform\s*=\s*("[^"]*"|'[^']*')/, '');
      out.push(`<g transform="${tf[1].replace(/"/g, '&quot;')}">`, rest);
      if (tag.self) out.push('</g>'); else wraps.push(true);
    } else {
      out.push(t);
      if (!tag.self) wraps.push(false);
    }
  }
  return { svg: out.join(''), moved };
}

/**
 * The draw-in motion, written into the file so it plays anywhere: each part rises into place in turn, and its
 * strokes are traced by length (pathLength="1", so no script has to measure them). Reduced motion gets the finished drawing.
 */
function addDrawMotion(svg, motion = MOTION) {
  const out = [];
  let depth = 0;
  let part = -1;
  let inPart = 0;
  for (const t of tokens(svg)) {
    const tag = t.startsWith('<') && !t.startsWith('<!') && !t.startsWith('<?') ? parseTag(t) : null;
    if (!tag) { out.push(t); continue; }
    if (tag.close) {
      depth -= 1;
      if (inPart && depth < inPart) inPart = 0;
      out.push(t);
      continue;
    }
    let s = t;
    const cls = (tag.attrs.find(([k]) => k === 'class') || [])[1] || '';
    if (!inPart && /\bpart\b/.test(cls)) {
      part += 1;
      const style = (tag.attrs.find(([k]) => k === 'style') || [])[1];
      s = style !== undefined ? s.replace(/\sstyle="[^"]*"/, ` style="--i:${part};${style.replace(/"/g, '&quot;')}"`) : s.replace(/^<([\w:-]+)/, `<$1 style="--i:${part}"`);
      if (!tag.self) inPart = depth + 1;
    } else if (inPart && STROKED.has(tag.name) && !tag.attrs.some(([k]) => k === 'pathLength')) {
      s = s.replace(/^<([\w:-]+)/, '<$1 pathLength="1"');
    }
    if (!tag.self) depth += 1;
    out.push(s);
  }
  const d = Number(motion.duration) || MOTION.duration;
  const st = Number(motion.stagger) || MOTION.stagger;
  const css = `<style>@media (prefers-reduced-motion: no-preference){`
    + `.part{animation:part-rise ${d}ms cubic-bezier(.2,.7,.2,1) both;animation-delay:calc(var(--i,0)*${st}ms)}`
    + `.part [pathLength]{stroke-dasharray:1;stroke-dashoffset:1;animation:part-draw ${d}ms ease-out forwards;animation-delay:calc(var(--i,0)*${st}ms)}`
    + `@keyframes part-draw{to{stroke-dashoffset:0}}`
    + `@keyframes part-rise{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}}</style>`;
  return out.join('').replace(/(<svg\b[^>]*>)/i, `$1${css}`);
}

/**
 * Everything a drawing goes through after the model: sanitise, fix the root, repair transforms, check it, and
 * add the draw-in motion for that style. Returns { ok, svg, why, note, drawable, parts, moved }.
 */
function finish(raw, { style, motion = MOTION } = {}) {
  const clean = sanitizeSvg(raw);
  const note = removedSummary(clean);
  if (!clean.svg) return { ok: false, why: 'The answer held no <svg> drawing. Answer with the whole SVG.', note };
  if (clean.drawableLost) {
    return { ok: false, note, why: `The drawing used markup that is not allowed (${note}), and ${clean.drawableLost} drawable element${clean.drawableLost === 1 ? ' was' : 's were'} lost with it. Draw it again with plain SVG shapes only.` };
  }
  const rooted = fixRoot(clean.svg);
  const rep = repairTransforms(rooted, style === 'draw' ? ['part'] : []);
  const chk = substance(rep.svg);
  if (!chk.ok) return { ok: false, why: chk.why, note, drawable: chk.drawable, parts: chk.parts };
  const svg = style === 'draw' ? addDrawMotion(rep.svg, motion) : rep.svg;
  return { ok: true, svg, note, drawable: chk.drawable, parts: chk.parts, moved: rep.moved };
}

module.exports = { STYLES, SHAPES, SHAPE_LABELS, MOTION, MIN_DRAWABLE, MIN_PARTS, buildPrompt, parseReply, paletteLine,
  substance, fixRoot, repairTransforms, animatedClasses, addDrawMotion, finish };
