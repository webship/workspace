/**
 * The theme system: which palette the dashboard wears.
 *
 * A theme is one file — `public/themes/<name>/theme.css` — that sets the tokens every component
 * asks for, in both halves (light and dark). Nothing else has to know which theme is loaded,
 * because no component names a colour: they all say `var(--brand-primary)` rather than `#0074e0`.
 *
 * `/style.css` is assembled here rather than being a file on disk: the base layer, then every
 * component, then the chosen theme last so it wins. One request, and a component is a file rather
 * than another block appended to a 2,800-line stylesheet — which is also why two branches adding
 * features stop conflicting over the same tail.
 *
 * Adopted from the tooling this dashboard grew from (its issue #64).
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const yamlLoad = (text) => (typeof yaml.safeLoad === 'function' ? yaml.safeLoad(text) : yaml.load(text));

const PUBLIC_DIR = path.join(__dirname, 'public');
// Where a theme's YAML overrides live, beside the rest of the config people edit.
const CONFIG_DIR = process.env.WORKSPACE_CONFIG
  || path.join(process.env.WORKSPACE_ROOT || path.resolve(__dirname, '..', '..'), 'core', 'config');
const CSS_DIR = path.join(PUBLIC_DIR, 'css');
const THEMES_DIR = path.join(PUBLIC_DIR, 'themes');

/**
 * Every style on this machine: the ones that ship as a directory with a `theme.css`, and the ones
 * that are nothing but a `core/config/theme.<name>.yml`.
 *
 * A YAML-only style is how somebody adds one without writing into the app's own directory — which
 * is the difference between a style being something a developer creates and a style being something
 * only a release can add. It works because a theme is a palette: with every token in the YAML there
 * is nothing left for a stylesheet to say.
 */
const THEME_NAME_RE = /^[a-z][a-z0-9-]*$/;

function listThemes() {
  const names = new Set();
  try {
    for (const e of fs.readdirSync(THEMES_DIR, { withFileTypes: true })) {
      if (e.isDirectory() && fs.existsSync(path.join(THEMES_DIR, e.name, 'theme.css'))) names.add(e.name);
    }
  } catch (_) { /* no themes directory */ }
  try {
    for (const f of fs.readdirSync(CONFIG_DIR)) {
      const m = f.match(/^theme\.([a-z][a-z0-9-]*)\.yml$/);
      // A YAML with no tokens in it is a file somebody started, not a style you can wear.
      if (m && Object.keys(readThemeOverrides(m[1]).tokens).length) names.add(m[1]);
    }
  } catch (_) { /* no config directory */ }
  return [...names].sort();
}

/** Does this style exist only as YAML? Then its tokens are all there is. */
function isYamlOnlyTheme(name) {
  return Boolean(name) && !fs.existsSync(path.join(THEMES_DIR, name, 'theme.css'));
}

/**
 * Was this style made on this machine, or did it come with the workspace?
 *
 * Not the same question as `isYamlOnlyTheme`, though the Styles page asked that one for a while and
 * labelled the answer "made here". Five styles that ship in the repository — Dispatch, UPSUN,
 * GitHub, GitLab and Drupal — are YAML and nothing else, because a style is a set of tokens and a
 * stylesheet would be a second place to keep them. They were being credited to whoever opened the
 * page.
 *
 * `createTheme` stamps what it writes, so the marker is on the file rather than inferred from its
 * shape, and a style that ships needs nothing said about it.
 */
function isMadeHere(name) {
  if (!name) return false;
  try {
    const doc = yamlLoad(fs.readFileSync(themeOverridesFile(name), 'utf8'));
    return Boolean(doc && doc.made_here);
  } catch (_) {
    return false;
  }
}

// What a theme calls itself, for the settings form. One line at the top of the file, so naming a
// theme does not need a second file to parse.
function themeLabel(name) {
  try {
    const head = fs.readFileSync(path.join(THEMES_DIR, name, 'theme.css'), 'utf8').slice(0, 600);
    const m = head.match(/^\s*\*\s*@name\s+(.+)$/m);
    if (m) return m[1].trim();
  } catch (_) { /* no CSS: a YAML-only style names itself in its own file */ }
  try {
    const doc = yamlLoad(fs.readFileSync(path.join(CONFIG_DIR, `theme.${name}.yml`), 'utf8'));
    if (doc && typeof doc.name === 'string' && doc.name.trim()) return doc.name.trim();
  } catch (_) { /* fall through to the file name */ }
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
// last. Sorting by name would change which wins. Anything not listed goes last, alphabetically,
// which is where a newly added component belongs anyway.
const COMPONENT_ORDER = [
  'hero',
  'workspace-cards',
  'ai-assistant',
  'deep-chat',
  'project-rows',
  'floating-assistant-workspace-pages',
  'working-indicators',
  'top-toolbar-logo-breadcrumb',
  'layout-rhythm-and-spacing-polish',
  'full-height-left-assistant-sidebar-all-pages',
  'full-height-right-actions-rail-pages-that-have-actions',
  // After the sidebar's own rules, because it is what re-sizes and re-places that sidebar.
  'assistant-views',
  // After the layout components, since it re-caps the container they lay out.
  'page-width',
  'mic-on-any-field-that-wants-typing',
  'settings-editor-core-config-yml',
  'responsive-home-and-the-workspace-pages',
  'running-commands-as-toasts',
  'short-results-as-a-toast-at-the-top',
  'reordering-the-workspace-cards',
  // After the card and row components, since it re-lays out what they draw.
  'grid-and-list',
  'test-report-media-one-file-per-row-paged',
];

function listComponents() {
  let files = [];
  try {
    files = fs.readdirSync(path.join(CSS_DIR, 'components'))
      .filter((f) => f.endsWith('.css'))
      .map((f) => f.replace(/\.css$/, ''));
  } catch (_) {
    return [];
  }
  const known = COMPONENT_ORDER.filter((n) => files.includes(n));
  const rest = files.filter((n) => !COMPONENT_ORDER.includes(n)).sort();
  return [...known, ...rest];
}

const readOrEmpty = (file) => {
  try { return fs.readFileSync(file, 'utf8'); } catch (_) { return ''; }
};


/* ---------------- tokens as YAML ---------------- */

/**
 * A theme's tokens, overridable from `core/config/theme.<name>.yml`.
 *
 * A theme file is a palette: it declares custom properties and selects nothing. That makes every
 * value in it a candidate for configuration, and CSS is the wrong place to ask somebody to change
 * one — it means editing a stylesheet in the app's own directory, which is not where this workspace
 * keeps anything else people set.
 *
 * So the same tokens can be written in YAML, in the config directory with `settings.yml` and the
 * workspace files, where the dashboard's own settings editor can reach them:
 *
 *     # core/config/theme.press.yml
 *     tokens:
 *       size-h1: 2.25rem
 *       brand-primary: "#0074e0"
 *     dark:
 *       surface-card: "#1c2136"
 *
 * Names are written without the leading `--`; one is added if it is missing, so either spelling
 * works. `tokens:` applies to both halves; `dark:` applies to the dark half only, exactly like the
 * `html.dark` block in a theme file.
 *
 * The YAML is emitted AFTER the theme's CSS, so it wins — an override is an override. A file that
 * does not exist, or one that is unreadable, leaves the theme exactly as it shipped: appearance is
 * configuration, and a typo in configuration should not cost you a styled dashboard.
 */
function themeOverridesFile(name) {
  return path.join(CONFIG_DIR, `theme.${name}.yml`);
}

function readThemeOverrides(name) {
  if (!name) return { tokens: {}, dark: {} };
  let doc;
  try {
    doc = yamlLoad(fs.readFileSync(themeOverridesFile(name), 'utf8'));
  } catch (_) {
    return { tokens: {}, dark: {} };
  }
  const clean = (block) => {
    const out = {};
    if (!block || typeof block !== 'object') return out;
    for (const [rawKey, rawValue] of Object.entries(block)) {
      // A token name, and nothing that could close the block and start a rule of its own.
      const key = String(rawKey).trim().replace(/^--/, '');
      if (!/^[a-zA-Z][a-zA-Z0-9-]*$/.test(key)) continue;
      if (rawValue === null || rawValue === undefined) continue;
      const value = String(rawValue).trim();
      if (!value || /[{};]/.test(value)) continue;
      out[`--${key}`] = value;
    }
    return out;
  };
  return { tokens: clean(doc && doc.tokens), dark: clean(doc && doc.dark) };
}

/** The override blocks as CSS, or '' when a theme has no YAML of its own. */
function themeOverridesCss(name) {
  const { tokens, dark } = readThemeOverrides(name);
  const block = (selector, map) => {
    const keys = Object.keys(map);
    if (!keys.length) return '';
    return `${selector} {\n${keys.map((k) => `  ${k}: ${map[k]};`).join('\n')}\n}\n`;
  };
  return [block(':root', tokens), block('html.dark', dark)].filter(Boolean).join('\n');
}

// Base, then components, then the theme. Each part is labelled, so "which file is this rule in"
// is answerable from the browser's own view-source rather than by grepping.
function assembleCss(wanted) {
  const theme = resolveTheme(wanted);
  const parts = [`/* base */\n${readOrEmpty(path.join(CSS_DIR, 'base.css'))}`];
  for (const name of listComponents()) {
    parts.push(`/* component: ${name} */\n${readOrEmpty(path.join(CSS_DIR, 'components', `${name}.css`))}`);
  }
  // What activated plugins add, after the components: a plugin stylesheet may only add rules.
  for (const f of require('./plugin-loader').pluginCssFiles()) {
    parts.push(`/* plugin: ${path.basename(f)} */\n${readOrEmpty(f)}`);
  }
  // A style that exists only as YAML has no stylesheet to read — its tokens are the whole palette,
  // and they are appended below like any other override.
  if (theme && !isYamlOnlyTheme(theme)) {
    parts.push(`/* theme: ${theme} */\n${readOrEmpty(path.join(THEMES_DIR, theme, 'theme.css'))}`);
  }
  // Last, so a token set in YAML beats the same token in the theme file.
  const overrides = themeOverridesCss(theme);
  if (overrides) parts.push(`/* theme overrides: core/config/theme.${theme}.yml */\n${overrides}`);
  return parts.join('\n\n');
}


/**
 * Create a style from an existing one, as YAML.
 *
 * Every token is copied rather than referenced, so the new style is complete on its own and editing
 * the one it came from cannot change it later. A style that inherited would be a style that moved
 * under somebody, which is not what "based on" means when you are about to change fifteen values.
 */
function createTheme({ name, label, from }) {
  const clean = String(name || '').trim().toLowerCase();
  if (!THEME_NAME_RE.test(clean)) {
    return { ok: false, error: 'A style name is lowercase letters, digits and hyphens, starting with a letter.' };
  }
  if (listThemes().includes(clean) || fs.existsSync(path.join(THEMES_DIR, clean))) {
    return { ok: false, error: `A style called ${clean} already exists.` };
  }
  const source = resolveTheme(from);
  if (!source) return { ok: false, error: 'There is no style to base it on.' };

  // Whatever the source actually renders with: its YAML if it has one, else its stylesheet.
  const fromYaml = readThemeOverrides(source);
  let tokens = fromYaml.tokens;
  let dark = fromYaml.dark;
  if (!Object.keys(tokens).length) {
    const css = readOrEmpty(path.join(THEMES_DIR, source, 'theme.css')).replace(/\/\*[\s\S]*?\*\//g, '');
    const grab = (selector) => {
      const out = {};
      const re = new RegExp(`${selector}\\s*\\{([^}]*)\\}`, 'g');
      let m;
      while ((m = re.exec(css))) {
        for (const d of m[1].matchAll(/(--[a-zA-Z0-9-]+)\s*:\s*([^;]+);/g)) out[d[1]] = d[2].trim();
      }
      return out;
    };
    tokens = grab(':root');
    dark = grab('html\\.dark');
  }
  if (!Object.keys(tokens).length) return { ok: false, error: `${source} has no tokens to copy.` };

  const title = String(label || '').trim() || clean.charAt(0).toUpperCase() + clean.slice(1).replace(/-/g, ' ');
  // Quoted unless it is plainly safe, so a value with a colon or a hash survives the round trip.
  const q = (v) => (/^[A-Za-z0-9._/-]+$/.test(v) ? v : `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
  const rows = (map) => Object.entries(map).map(([k, v]) => `  ${k.replace(/^--/, '')}: ${q(v)}`);
  const lines = [
    `# ${title} — core/config/theme.${clean}.yml`,
    '#',
    `# A style, created from ${source}. Every token was copied, so this file is complete on its own:`,
    '# editing the style it came from will not change it.',
    '#',
    '# Change any value and reload — there is no stylesheet to edit and nothing to restart. Names go',
    '# without the leading dashes; `tokens:` applies to both halves and `dark:` to the dark half only.',
    '',
    `name: ${q(title)}`,
    '',
    '# Made on this machine rather than shipped with the workspace. It is what the Styles page reads',
    '# to tell the two apart — the format cannot, because the styles that ship are YAML too.',
    'made_here: true',
    '',
    'tokens:',
    ...rows(tokens),
  ];
  if (Object.keys(dark).length) lines.push('', '# The dark half.', 'dark:', ...rows(dark));

  const file = themeOverridesFile(clean);
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
  return { ok: true, name: clean, label: title, from: source, file, tokens: Object.keys(tokens).length };
}


/**
 * The handful of values that let a style be RECOGNISED without wearing it.
 *
 * Choosing a style from a list of names is guessing. A swatch of its own brand colour, its surface,
 * its line and its text — painted in those actual values — is the difference between picking one and
 * finding out what you picked. One level of `var(--x)` is resolved, because a theme's semantic
 * tokens are usually aliases onto its brand primitives and an unresolved alias swatches as nothing.
 */
function themePreview(name) {
  const theme = resolveTheme(name);
  if (!theme) return null;
  const from = readThemeOverrides(theme);
  let map = new Map(Object.entries(from.tokens));
  if (!map.size) {
    const css = readOrEmpty(path.join(THEMES_DIR, theme, 'theme.css')).replace(/\/\*[\s\S]*?\*\//g, '');
    const m = /:root\s*\{([^}]*)\}/.exec(css);
    if (m) for (const d of m[1].matchAll(/(--[a-zA-Z0-9-]+)\s*:\s*([^;]+);/g)) map.set(d[1], d[2].trim());
  }
  const raw = (k) => map.get(k.startsWith('--') ? k : `--${k}`) || '';
  const value = (k) => {
    const v = raw(k);
    const alias = /^var\(\s*(--[a-zA-Z0-9-]+)\s*\)$/.exec(v);
    return alias ? (raw(alias[1]) || '') : v;
  };
  return {
    name: theme,
    label: themeLabel(theme),
    yamlOnly: isYamlOnlyTheme(theme),
    madeHere: isMadeHere(theme),
    tokens: map.size,
    brand: value('brand-primary'),
    secondary: value('brand-secondary'),
    accent: value('brand-accent'),
    surface: value('surface-card') || value('surface'),
    line: value('line'),
    text: value('text-default'),
    // What its type actually does, so a style with a different scale reads as one in the list.
    fontPrimary: value('font-primary'),
    fontSecondary: value('font-secondary'),
    sizeBody: value('size-body'),
    sizeH2: value('size-h2'),
    trackingH2: value('tracking-h2') || 'normal',
  };
}

// A cache key that changes when any part does. The browser is told to cache `/style.css`, so
// editing a component with no version change would show yesterday's stylesheet.
function cssVersion(wanted) {
  const files = [path.join(CSS_DIR, 'base.css'),
    ...listComponents().map((n) => path.join(CSS_DIR, 'components', `${n}.css`)),
    ...require('./plugin-loader').pluginCssFiles()];
  const theme = resolveTheme(wanted);
  if (theme) files.push(path.join(THEMES_DIR, theme, 'theme.css'), themeOverridesFile(theme));
  let stamp = 0;
  for (const f of files) {
    try { stamp = Math.max(stamp, fs.statSync(f).mtimeMs); } catch (_) { /* skip */ }
  }
  return `${theme || 'none'}-${Math.round(stamp)}`;
}

module.exports = {
  listThemes, themeLabel, resolveTheme, listComponents, assembleCss, cssVersion,
  themeOverridesFile, readThemeOverrides, themeOverridesCss,
  isYamlOnlyTheme, isMadeHere, createTheme, themePreview, THEME_NAME_RE,
};
