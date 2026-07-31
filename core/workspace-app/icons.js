/**
 * Two icon sets, one function — shared by the pages that draw icons and the settings form that
 * chooses them.
 */

const fs = require('fs');
const path = require('path');

const { esc } = require('./html');

const PUBLIC_DIR = path.join(__dirname, 'public');

// Two icon sets, one function. A bare name is UIKit's — every icon named before Tabler existed
// keeps working — and `tabler:<name>` comes from the vendored sprite, which is 4,736 icons against
// UIKit's few dozen. An unknown name falls back to a folder rather than rendering nothing, because
// a workspace with no card icon looks broken and a wrong icon does not.
let _tablerIcons = null;
function tablerIcons() {
  if (_tablerIcons) return _tablerIcons;
  try {
    const src = fs.readFileSync(path.join(PUBLIC_DIR, 'vendor', 'tabler-sprite.svg'), 'utf8');
    _tablerIcons = new Set([...src.matchAll(/<symbol id="([a-z0-9-]+)"/g)].map((m) => m[1]));
  } catch (_) {
    // No sprite is survivable: every tabler: name falls back to the folder icon.
    _tablerIcons = new Set();
  }
  return _tablerIcons;
}

function iconHtml(name, ratio = 1) {
  const n = String(name || 'folder');
  if (!n.startsWith('tabler:')) return `<span uk-icon="icon: ${esc(n)}; ratio: ${ratio}"></span>`;
  const id = n.slice(7);
  if (!tablerIcons().has(id)) return `<span uk-icon="icon: folder; ratio: ${ratio}"></span>`;
  const px = Math.round(20 * ratio);
  // A <use> into the sprite: the browser fetches the file once for the whole page.
  return `<svg class="tabler-icon" width="${px}" height="${px}" aria-hidden="true">`
    + `<use href="/vendor/tabler-sprite.svg#${esc(id)}"></use></svg>`;
}

module.exports = { iconHtml, tablerIcons };
