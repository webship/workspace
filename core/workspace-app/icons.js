/**
 * The icon libraries a workspace card can draw from.
 *
 * Two of them: UIKit's own set, and Tabler's 4,700 as a vendored sprite. A name is `tabler:x` or a
 * bare UIKit name, and an unknown one falls back rather than rendering an empty box.
 */

const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, 'public');

const { esc } = require('./html');

// Read once: the Tabler sprite is 4,736 icons, and a workspace page renders twenty of them.
let _tablerCache = null;
let _iconCache = null;
// Icon and description for a workspace, stored in its own settings file so a
// workspace added from the dashboard is not stuck with the default folder icon.
//
// The icon list is PARSED OUT OF the vendored uikit-icons.min.js rather than typed
// here, so it cannot drift from what will actually render. That drift was real: the
// commands workspace shipped with `terminal`, which UIKit has no icon for, so its
// card and rail rendered an empty box. Anything not in this set is refused.
// Brand and social marks. They are logos, not interface icons — a workspace card
// showing the Facebook mark says nothing about the workspace — so they are kept out
// of the chooser. UIKit ships about forty of them.
const BRAND_ICONS = new Set([

  '500px', 'android', 'android-robot', 'apple', 'behance', 'bluesky', 'discord', 'dribbble',
  'etsy', 'facebook', 'flickr', 'foursquare', 'github', 'github-alt', 'gitter', 'google',
  'instagram', 'joomla', 'linkedin', 'mastodon', 'microsoft', 'pinterest', 'reddit',
  'soundcloud', 'telegram', 'threads', 'tiktok', 'tripadvisor', 'tumblr', 'twitch',
  'twitter', 'uikit', 'vimeo', 'whatsapp', 'wordpress', 'x', 'xing', 'yelp', 'yootheme',
  'youtube',
]);

function uikitIcons() {
  if (_iconCache) return _iconCache;
  try {
    const src = fs.readFileSync(path.join(PUBLIC_DIR, 'vendor', 'uikit-icons.min.js'), 'utf8');
    const names = [...src.matchAll(/(?:"([a-zA-Z0-9-]+)"|([a-zA-Z0-9-]+))\s*:\s*'<svg/g)]
      .map((m) => m[1] || m[2]);
    _iconCache = [...new Set(names)].filter((n) => !BRAND_ICONS.has(n)).sort();
  } catch (_) {
    _iconCache = ['folder'];
  }
  return _iconCache;
}

function tablerIcons() {
  if (_tablerCache) return _tablerCache;
  try {
    const src = fs.readFileSync(path.join(PUBLIC_DIR, 'vendor', 'tabler-sprite.svg'), 'utf8');
    _tablerCache = [...new Set([...src.matchAll(/<symbol id="([a-z0-9-]+)"/g)].map((m) => m[1]))]
      .filter((n) => !BRAND_ICONS.has(n))
      .sort();
  } catch (_) {
    _tablerCache = [];
  }
  return _tablerCache;
}

// One icon, from either set. A bare name is UIKit, so every icon stored before
// Tabler existed keeps working; `tabler:<name>` comes from the sprite.
function iconHtml(name, ratio = 1) {
  const n = String(name || 'folder');
  if (n.startsWith('tabler:')) {
    const id = n.slice(7);
    if (!tablerIcons().includes(id)) return `<span uk-icon="icon: folder; ratio: ${ratio}"></span>`;
    const px = Math.round(20 * ratio);
    return `<svg class="tabler-icon" width="${px}" height="${px}" aria-hidden="true">`
      + `<use href="/vendor/tabler-sprite.svg#${esc(id)}"></use></svg>`;
  }
  return `<span uk-icon="icon: ${esc(n)}; ratio: ${ratio}"></span>`;
}

function isKnownIcon(name) {
  const n = String(name || '');
  return n.startsWith('tabler:') ? tablerIcons().includes(n.slice(7)) : uikitIcons().includes(n);
}

module.exports = { uikitIcons, tablerIcons, iconHtml, isKnownIcon };
