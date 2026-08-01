/**
 * The theme system: which palette the dashboard wears.
 *
 * A theme is one file — `public/themes/<name>/theme.css` — that sets the tokens every component
 * asks for, in both halves (light and dark). Nothing else has to know which theme is loaded,
 * because no component names a colour: they all say `var(--surface-raised)` rather than `#fff`.
 *
 * `/style.css` is assembled here rather than being a file on disk: the base layer, then every
 * component, then the chosen theme last so it wins. One request, and a component is a file rather
 * than another block appended to a 1,600-line stylesheet — which is also why two branches adding
 * features stopped conflicting over the same tail.
 */

const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, 'public');
const CSS_DIR = path.join(PUBLIC_DIR, 'css');
const THEMES_DIR = path.join(PUBLIC_DIR, 'themes');

// A theme directory carrying a theme.css. The name is the directory's.
function listThemes() {
  try {
    return fs.readdirSync(THEMES_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory() && fs.existsSync(path.join(THEMES_DIR, e.name, 'theme.css')))
      .map((e) => e.name)
      .sort();
  } catch (_) {
    return [];
  }
}

// What a theme calls itself, for the settings form. One line at the top of the file, so naming a
// theme does not need a second file to parse.
function themeLabel(name) {
  try {
    const head = fs.readFileSync(path.join(THEMES_DIR, name, 'theme.css'), 'utf8').slice(0, 600);
    const m = head.match(/^\s*\*\s*@name\s+(.+)$/m);
    if (m) return m[1].trim();
  } catch (_) { /* fall through to the directory name */ }
  return name.charAt(0).toUpperCase() + name.slice(1).replace(/-/g, ' ');
}

// A name that is not a theme falls back to the default, so a typo in settings.yml is a dashboard
// that looks ordinary rather than one with no styling at all.
function resolveTheme(wanted) {
  const themes = listThemes();
  if (wanted && themes.includes(wanted)) return wanted;
  return themes.includes('default') ? 'default' : themes[0] || null;
}

// The order components are concatenated in, which is the order they had when they were one file.
//
// Not alphabetical: CSS is a cascade, and two rules of equal specificity are decided by which came
// last. Sorting by name changed which won — a card's radius and the rail buttons both moved — so
// the order is stated rather than inferred. Anything not listed goes last, alphabetically, which
// is where a newly added component belongs anyway.
const COMPONENT_ORDER = [
  'hero',
  'workspace-cards',
  'ai-assistant',
  'project-rows',
  'floating-assistant',
  'working-indicators',
  'top-toolbar',
  'layout-rhythm-spacing-polish',
  'full-height-left-assistant-sidebar',
  'full-height-right-actions-rail',
  'reordering-the-workspace-cards',
  'list-controls-search-sort-filter-pager',
  'code-editor',
  'result-toasts',
  'brand-mark',
  'one-modal',
  'reviewing-a-file-in-the-dialog',
  'searching-a-rag-index',
];

function orderedComponents(files) {
  const rank = (f) => {
    const i = COMPONENT_ORDER.indexOf(f.replace(/\.css$/, ''));
    return i === -1 ? COMPONENT_ORDER.length : i;
  };
  return files.slice().sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

function readIfPresent(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch (_) { return ''; }
}

/**
 * The whole stylesheet, in cascade order: structure first, then the theme.
 *
 * The theme comes LAST on purpose. A component may state a fallback of its own, and a theme has to
 * be able to overrule it without every component having to anticipate being themed.
 */
function assembleCss(themeName) {
  const theme = resolveTheme(themeName);
  const parts = [`/* base */\n${readIfPresent(path.join(CSS_DIR, 'base.css'))}`];
  let components = [];
  try {
    components = orderedComponents(fs.readdirSync(path.join(CSS_DIR, 'components')).filter((f) => f.endsWith('.css')));
  } catch (_) { /* no components: the base and the theme still render something */ }
  for (const f of components) {
    parts.push(`/* component: ${f.replace(/\.css$/, '')} */\n${readIfPresent(path.join(CSS_DIR, 'components', f))}`);
  }
  if (theme) parts.push(`/* theme: ${theme} */\n${readIfPresent(path.join(THEMES_DIR, theme, 'theme.css'))}`);
  return parts.join('\n\n');
}

// The newest mtime across everything that goes into the answer. The page links /style.css with
// this as a version, so an edit to one component busts the cache and nothing else does.
function cssVersion(themeName) {
  const theme = resolveTheme(themeName);
  const files = [path.join(CSS_DIR, 'base.css')];
  try {
    for (const f of fs.readdirSync(path.join(CSS_DIR, 'components'))) files.push(path.join(CSS_DIR, 'components', f));
  } catch (_) { /* none */ }
  if (theme) files.push(path.join(THEMES_DIR, theme, 'theme.css'));
  let newest = 0;
  for (const f of files) {
    try { newest = Math.max(newest, fs.statSync(f).mtimeMs); } catch (_) { /* gone */ }
  }
  return Math.floor(newest);
}

/**
 * The brand mark a theme carries, if it carries one.
 *
 * A palette and a logo are the same decision: a mark drawn for a purple dashboard is wrong on an
 * amber one. So a theme may ship its own — `themes/<name>/logo.svg`, `logo-dark.svg`, `favicon.*` —
 * and the settings keys stay as the override for a workspace that wants its own mark whatever the
 * theme says.
 *
 * Resolution, in order: what settings.yml names, then what the theme ships, then what is in
 * public/. Each step falls through only when the file is not there, so naming a file that does not
 * exist shows the theme's mark rather than a broken image.
 */
function themeAsset(themeName, names) {
  const theme = resolveTheme(themeName);
  if (!theme) return null;
  for (const n of names) {
    if (fs.existsSync(path.join(THEMES_DIR, theme, n))) return `/themes/${theme}/${n}`;
  }
  return null;
}

// The three marks a page needs, each resolved the same way.
function themeLogos(themeName, style) {
  const shipped = (names) => themeAsset(themeName, names);
  const set = (configured, names) => {
    // A configured name wins, but only if the file is really in public/ — otherwise it is a
    // broken image where a mark should be.
    if (configured && fs.existsSync(path.join(PUBLIC_DIR, configured))) return `/${configured}`;
    return shipped(names) || (configured ? `/${configured}` : null);
  };
  // What ships, when neither the settings nor the theme names a mark: the Webship logo, in the
  // variant that suits the background.
  const shippedLogo = fs.existsSync(path.join(PUBLIC_DIR, 'logo.svg')) ? '/logo.svg' : '/logo.png';
  const shippedDark = fs.existsSync(path.join(PUBLIC_DIR, 'logo-dark.svg')) ? '/logo-dark.svg' : shippedLogo;
  const shippedIcon = fs.existsSync(path.join(PUBLIC_DIR, 'favicon.ico')) ? '/favicon.ico' : shippedLogo;
  const logo = set(style.logo, ['logo.svg', 'logo.png']) || shippedLogo;
  return {
    logo,
    logoOnDark: set(style.logoOnDark, ['logo-dark.svg', 'logo-dark.png'])
      || (logo === shippedLogo ? shippedDark : logo),
    favicon: set(style.favicon, ['favicon.svg', 'favicon.png', 'favicon.ico'])
      || (logo === shippedLogo ? shippedIcon : logo),
  };
}

module.exports = { listThemes, themeLabel, resolveTheme, assembleCss, cssVersion, themeLogos, THEMES_DIR };
