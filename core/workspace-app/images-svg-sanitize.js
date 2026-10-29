/**
 * An allow-list SVG sanitiser, for markup an AI wrote. It keeps drawing, text, gradients, styles and
 * animation; it drops scripts, foreignObject, embedded images, event handlers and every reference that leaves
 * the file. It says what it removed, so a caller can tell a harmless clean-up from a drawing that lost its parts.
 * No dependencies: the host-side finish step of a Claude Code drawing runs it too.
 */

const DRAWABLE = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'use']);

const ELEMENTS = new Set([
  'svg', 'g', 'defs', 'symbol', 'use', 'title', 'desc', 'metadata', 'style',
  'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'textPath',
  'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask', 'pattern', 'marker',
  'filter', 'feGaussianBlur', 'feOffset', 'feBlend', 'feColorMatrix', 'feComposite', 'feFlood', 'feMerge',
  'feMergeNode', 'feDropShadow', 'feMorphology', 'feTurbulence', 'feDisplacementMap',
  'animate', 'animateTransform', 'animateMotion', 'set', 'mpath',
]);

// Removed with everything inside them.
const DROP = new Set(['script', 'foreignObject', 'image', 'iframe', 'object', 'embed', 'audio', 'video', 'canvas', 'handler', 'listener']);
// Removed, their children kept.
const UNWRAP = new Set(['a', 'switch']);

const ATTRS = new Set([
  'id', 'class', 'style', 'viewBox', 'preserveAspectRatio', 'xmlns', 'xmlns:xlink', 'version', 'role', 'aria-label',
  'aria-hidden', 'aria-labelledby', 'aria-describedby', 'focusable', 'lang', 'xml:space', 'href', 'xlink:href',
  'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'fx', 'fy', 'fr', 'd', 'points', 'width', 'height',
  'dx', 'dy', 'rotate', 'textLength', 'lengthAdjust', 'pathLength', 'startOffset', 'method', 'spacing', 'side',
  'transform', 'transform-origin', 'opacity', 'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width',
  'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-opacity',
  'vector-effect', 'paint-order', 'color', 'display', 'visibility', 'overflow', 'clip-path', 'clip-rule', 'mask', 'filter',
  'marker-start', 'marker-mid', 'marker-end', 'font-family', 'font-size', 'font-weight', 'font-style', 'letter-spacing',
  'word-spacing', 'text-anchor', 'dominant-baseline', 'alignment-baseline', 'text-decoration',
  'offset', 'stop-color', 'stop-opacity', 'gradientUnits', 'gradientTransform', 'spreadMethod',
  'patternUnits', 'patternContentUnits', 'patternTransform', 'clipPathUnits', 'maskUnits', 'maskContentUnits',
  'markerWidth', 'markerHeight', 'markerUnits', 'refX', 'refY', 'orient',
  'filterUnits', 'primitiveUnits', 'in', 'in2', 'result', 'stdDeviation', 'mode', 'values', 'type', 'operator',
  'k1', 'k2', 'k3', 'k4', 'flood-color', 'flood-opacity', 'radius', 'baseFrequency', 'numOctaves', 'seed',
  'stitchTiles', 'scale', 'xChannelSelector', 'yChannelSelector',
  'attributeName', 'attributeType', 'from', 'to', 'by', 'begin', 'dur', 'end', 'repeatCount', 'repeatDur', 'fill',
  'calcMode', 'keyTimes', 'keySplines', 'keyPoints', 'additive', 'accumulate', 'restart', 'min', 'max', 'path',
]);

// An animation may not change these: a link or a handler set by SMIL is a script by another route.
const UNANIMATABLE = /^(href|xlink:href|on.*|style|class)$/i;

const escAttr = (v) => String(v).replace(/&(?!(#\d+|#x[0-9a-f]+|[a-z]+);)/gi, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** CSS with every way out of the file removed. Returns [css, changed]. */
function cleanCss(css) {
  const before = css;
  const out = css
    .replace(/@import[^;]*;?/gi, '')
    .replace(/url\(\s*(['"]?)(?!#)[^)]*\1\s*\)/gi, 'none')
    .replace(/expression\s*\(/gi, '(')
    .replace(/-moz-binding|behavior\s*:/gi, '')
    .replace(/javascript:/gi, '');
  return [out, out !== before];
}

/** An attribute value that refers to something: only a fragment in this file is allowed. */
function localRef(v) {
  return /^\s*#[A-Za-z_][\w.:-]*\s*$/.test(v);
}

/** Every tag and the text between them, in order. */
function tokens(src) {
  const out = [];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\?[\s\S]*?\?>|<\/?[A-Za-z][^>]*>|[^<]+|</g;
  let m;
  while ((m = re.exec(src))) out.push(m[0]);
  return out;
}

function parseTag(t) {
  const m = t.match(/^<(\/?)([A-Za-z][\w:.-]*)([\s\S]*?)(\/?)>$/);
  if (!m) return null;
  const attrs = [];
  const re = /([^\s=/>]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g;
  let a;
  while ((a = re.exec(m[3]))) attrs.push([a[1], a[2] === undefined ? '' : a[2].replace(/^["']|["']$/g, '')]);
  return { close: !!m[1], name: m[2], attrs, self: !!m[4] };
}

/**
 * Sanitise SVG markup. Returns { svg, removed: { elements: {name: n}, attributes: n, css: n }, drawableLost, drawable }.
 * `svg` is '' when there is no <svg> root at all.
 */
function sanitizeSvg(input) {
  const src = String(input || '');
  const start = src.search(/<svg[\s>]/i);
  const end = src.lastIndexOf('</svg>');
  const removed = { elements: {}, attributes: 0, css: 0 };
  if (start < 0 || end < start) return { svg: '', removed, drawableLost: 0, drawable: 0 };
  const parts = [];
  const stack = []; // the open elements: { name, keep }
  let dropDepth = 0;
  let drawable = 0;
  let drawableLost = 0;
  const note = (n) => { removed.elements[n] = (removed.elements[n] || 0) + 1; };
  const inStyle = () => stack.length && stack[stack.length - 1].name === 'style' && stack[stack.length - 1].keep;
  for (const t of tokens(src.slice(start, end + 6))) {
    if (t.startsWith('<!--') || t.startsWith('<?') || (t.startsWith('<!') && !t.startsWith('<![CDATA['))) continue;
    if (!t.startsWith('<') || t.startsWith('<![CDATA[') || t === '<') {
      if (dropDepth) continue;
      if (t === '<') { parts.push('&lt;'); continue; }
      if (inStyle()) {
        const [css, changed] = cleanCss(t);
        if (changed) removed.css += 1;
        parts.push(css);
      } else if (t.startsWith('<![CDATA[')) {
        parts.push(t.slice(9, -3).replace(/&/g, '&amp;').replace(/</g, '&lt;'));
      } else {
        parts.push(t);
      }
      continue;
    }
    const tag = parseTag(t);
    if (!tag) continue;
    if (tag.close) {
      const open = stack.pop();
      if (!open) continue;
      if (open.drop) { dropDepth -= 1; continue; }
      if (!dropDepth && open.keep) parts.push(`</${open.name}>`);
      continue;
    }
    const name = tag.name;
    const known = ELEMENTS.has(name);
    const drop = dropDepth > 0 || DROP.has(name) || (!known && !UNWRAP.has(name));
    if (drop) {
      if (DRAWABLE.has(name)) drawableLost += 1;
      if (!dropDepth) note(name);
      if (!tag.self) { stack.push({ name, drop: true }); dropDepth += 1; }
      continue;
    }
    if (UNWRAP.has(name)) {
      note(name);
      if (!tag.self) stack.push({ name, keep: false });
      continue;
    }
    // An animation that would set a link, a handler or a style is dropped whole.
    const target = (tag.attrs.find(([k]) => k === 'attributeName') || [])[1];
    if (/^(animate|set|animateTransform|animateMotion)$/.test(name) && target && UNANIMATABLE.test(target)) {
      note(name);
      if (!tag.self) { stack.push({ name, drop: true }); dropDepth += 1; }
      continue;
    }
    const kept = [];
    for (const [k, raw] of tag.attrs) {
      const v = raw;
      if (!ATTRS.has(k) && !/^data-[\w-]+$/.test(k)) { removed.attributes += 1; continue; }
      if ((k === 'href' || k === 'xlink:href') && !localRef(v)) { removed.attributes += 1; continue; }
      if (/javascript:|vbscript:|data:/i.test(v) && k !== 'd') { removed.attributes += 1; continue; }
      if (/url\(/i.test(v)) {
        const urls = v.match(/url\(\s*(['"]?)([^)'"]*)\1\s*\)/gi) || [];
        if (urls.some((u) => !/url\(\s*['"]?#/i.test(u))) { removed.attributes += 1; continue; }
      }
      let value = v;
      if (k === 'style') {
        const [css, changed] = cleanCss(v);
        if (changed) removed.css += 1;
        value = css;
      }
      kept.push(`${k}="${escAttr(value)}"`);
    }
    if (name === 'svg' && !kept.some((a) => a.startsWith('xmlns='))) kept.unshift('xmlns="http://www.w3.org/2000/svg"');
    if (DRAWABLE.has(name)) drawable += 1;
    parts.push(`<${name}${kept.length ? ` ${kept.join(' ')}` : ''}${tag.self ? '/>' : '>'}`);
    if (!tag.self) stack.push({ name, keep: true });
  }
  while (stack.length) {
    const open = stack.pop();
    if (open.keep) parts.push(`</${open.name}>`);
  }
  return { svg: parts.join(''), removed, drawableLost, drawable };
}

/** A one-line account of what was removed, or '' when nothing was. */
function removedSummary(r) {
  const els = Object.entries(r.removed.elements).map(([k, n]) => `${n} ${k}`);
  const bits = [];
  if (els.length) bits.push(`elements: ${els.join(', ')}`);
  if (r.removed.attributes) bits.push(`${r.removed.attributes} attribute${r.removed.attributes === 1 ? '' : 's'}`);
  if (r.removed.css) bits.push(`${r.removed.css} unsafe style rule${r.removed.css === 1 ? '' : 's'}`);
  return bits.join('; ');
}

module.exports = { sanitizeSvg, removedSummary, cleanCss, tokens, parseTag, DRAWABLE, ELEMENTS };
