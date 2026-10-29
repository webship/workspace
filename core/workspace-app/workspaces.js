const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { resolveType, typeActions } = require('./workspace-types');
// What the assistant is called on this workspace's page, and what its composer says when empty.
// The rule about which level wins lives in speech.js with the rest of the assistant's settings.
const { assistantIdentity } = require('./speech');

// Locate the workspace from this file — core/workspace-app/workspaces.js — so a
// fresh clone needs no environment setup. The WORKSPACE_* variables still
// win, which is how the dashboard container points at the bind-mounted tree.
const APP_ROOT = path.resolve(__dirname, '..', '..');
const ROOT = process.env.WORKSPACE_ROOT || APP_ROOT;
const CONFIG_DIR = process.env.WORKSPACE_CONFIG || path.join(ROOT, 'core', 'config');

// Presentational-only (icon/subtitle) — everything functional (paths, script names,
// which workspaces exist) is read live from settings.yml / workspace.<name>.settings.yml
// and the filesystem, so a new workspace added there shows up with no code change.
// `icon` is a UIKit icon name (https://getuikit.com/docs/icon), rendered
// with the vendored uikit-icons.min.js.
// `noun` is what one item in the folder is called (only real projects are
// "projects"); `plural` overrides irregular plurals.
const PRESENTATION = {
  products:   { icon: 'tabler:shopping-cart',        subtitle: 'Internal & External Products', noun: 'product' },
  dev:        { icon: 'tabler:code',        subtitle: 'Development Projects', noun: 'project' },
  test:       { icon: 'tabler:checkbox',       subtitle: 'Testing Environment', noun: 'project' },
  demos:      { icon: 'tabler:device-desktop',     subtitle: 'Demo Sites', noun: 'demo' },
  sandboxes:  { icon: 'tabler:flask',      subtitle: 'Experimental Projects', noun: 'sandbox', plural: 'sandboxes' },
  projects:   { icon: 'tabler:folder',      subtitle: 'Client Projects', noun: 'project' },
  profiles:   { icon: 'tabler:world',       subtitle: 'Distros', noun: 'profile' },
  'site-templates': { icon: 'tabler:photo', subtitle: 'Drupal CMS Site Templates', label: 'Site Templates', noun: 'site template' },
  themes:     { icon: 'tabler:paint', subtitle: 'Contrib & Private Themes', noun: 'theme' },
  modules:    { icon: 'tabler:apps',        subtitle: 'Contrib & Private Modules', noun: 'module' },
  libraries:  { icon: 'tabler:library',       subtitle: 'Third-Party Libraries', noun: 'library', plural: 'libraries' },
  designs:    { icon: 'tabler:palette',     subtitle: 'Figma Sources & Exports', noun: 'design', kind: 'files' },
  images:     { icon: 'tabler:photo', subtitle: 'Images, screenshots and generated pictures', noun: 'image', kind: 'files' },
  videos:     { icon: 'tabler:player-play', subtitle: 'Recorded Walkthroughs & Demos', noun: 'video', kind: 'files' },
  audio:      { icon: 'tabler:headphones', subtitle: 'Voices & Sounds', noun: 'sound', kind: 'files' },
  avatars:    { icon: 'tabler:mood-smile', subtitle: 'Talking AI Characters, Their Agents & Voices', noun: 'avatar', kind: 'projects' },
  docs:       { icon: 'tabler:file-text',   subtitle: 'Documentation Projects', noun: 'doc', kind: 'files' },
  worklogs:   { icon: 'tabler:history',     subtitle: 'Session Worklogs', noun: 'worklog', kind: 'files' },
  'ai-agents': { icon: 'tabler:mood-smile',       subtitle: 'AI Automation', label: 'AI Agents', noun: 'agent', kind: 'files' },
  'ai-skills': { icon: 'tabler:star',        subtitle: 'AI Skill Definitions', label: 'AI Skills', noun: 'skill', kind: 'files' },
  'ai-commands': { icon: 'tabler:command',  subtitle: 'Claude Code Slash Commands', label: 'AI Commands', noun: 'command', kind: 'files' },
  'ai-prompts': { icon: 'tabler:pencil',      subtitle: 'Reusable AI Prompts', label: 'AI Prompts', noun: 'prompt', kind: 'files' },
  recipes:    { icon: 'tabler:list-check',        subtitle: 'Development Recipes', noun: 'recipe' },
  components: { icon: 'tabler:layout-grid',  subtitle: 'SDC, React, Canvas Code, HTMX & Web Components', noun: 'component' },
};

function loadYaml(file) {
  try {
    return yaml.load(fs.readFileSync(file, 'utf8')) || {};
  } catch (_) {
    return {};
  }
}

function loadSettings() {
  return loadYaml(path.join(CONFIG_DIR, 'settings.yml'));
}

// The environment, then settings.yml's `sources:`, then the shipped default —
// the same precedence bootstrap.sh gives the shell side. Read per call so a
// settings change needs no restart.
function sourceOf(kind, field, fallback) {
  try {
    const v = (((loadSettings().sources || {})[kind]) || {})[field];
    if (v) return String(v);
  } catch (_) { /* fall through */ }
  return fallback;
}

// The hub's base domain. Locally this is workspace.ddev.site; set
// `hub_domain:` in settings.yml (plus matching additional_fqdns + DNS +
// nginx server_names) to run the whole system as a remote development
// workspace hub on a public domain, e.g. workspace.example.com →
// dev.workspace.example.com → myproject.dev.workspace.example.com.
function hubDomain() {
  return loadSettings().hub_domain || `${process.env.DDEV_PROJECT || 'workspace'}.ddev.site`;
}

// Dashboard styling from settings.yml's `style:` block, with the shipped defaults
// filled in. Read live like everything else, so /settings takes effect on the next
// page load rather than needing a restart.
//
// `mode` is the DEFAULT only: a visitor who has used the theme toggle has their choice
// in localStorage, and that keeps winning — a default is not an override.
/**
 * Everything about how the dashboard LOOKS, read from `core/config/style.yml`.
 *
 * Styling is its own concern and now has its own file, beside `theme.<name>.yml`: which palette,
 * which mode, the logos and favicons, the page width, how the assistant is shown. It sat in
 * `settings.yml` under a `style:` key, in a file that is otherwise about where projects are built,
 * who commits, and which API keys this machine holds — so the one file nobody should open casually
 * was also the file you had to open to change a logo.
 *
 * `settings.yml`'s `style:` block still works and fills in anything `style.yml` does not set, so a
 * machine that has not moved its block keeps the appearance it had. The dedicated file wins where
 * the two overlap, because that is the point of having it.
 */
function loadStyleFile() {
  try {
    const doc = loadYaml(path.join(CONFIG_DIR, 'style.yml'));
    return doc && typeof doc === 'object' ? doc : {};
  } catch (_) {
    return {};
  }
}

function styleSettings() {
  const s = { ...(loadSettings().style || {}), ...loadStyleFile() };
  const one_of = (v, allowed, fallback) => (allowed.includes(String(v)) ? String(v) : fallback);
  return {
    workspaceName: typeof s.workspace_name === 'string' && s.workspace_name.trim() ? s.workspace_name.trim() : 'Workspace',
    mode: one_of(s.mode, ['light', 'dark', 'system'], 'light'),
    editorTheme: one_of(s.editor_theme, ['auto', 'light', 'dark'], 'auto'),
    logoOnLight: s.logo_on_light || 'vardot-logo-on-light.svg',
    logoOnDark: s.logo_on_dark || 'vardot-logo-on-dark.svg',
    faviconSvg: s.favicon_svg || 'vardot-favicon.svg',
    faviconPng: s.favicon_png || 'vardot-favicon.png',
    // A separate, larger file: a home-screen icon is 180px, and the 32px tab icon blown up to that
    // is a blurry tile. Both are rendered from the same SVG, so they cannot drift apart.
    touchIcon: s.touch_icon || 'vardot-touch-icon.png',
    // Rows before a list pages. A default, not an override: a size picked from a pager
    // wins (it is in a cookie), as with `mode`.
    pageSize: one_of(s.page_size, ['20', '50', '100', '200', 'all'], '50'),
    pageSort: one_of(s.page_sort, ['newest', 'oldest', 'name', 'nameDesc'], 'newest'),
    // Which palette the dashboard wears. Resolved in themes.js — a name that is not a theme
    // falls back to the default, so a typo is an ordinary-looking dashboard rather than an
    // unstyled one.
    theme: typeof s.theme === 'string' && s.theme.trim() ? s.theme.trim() : 'default',
    // How the assistant is shown, and whether it starts open. Defaults, never overrides: a view
    // chosen from the panel's own menu is in localStorage and wins, exactly like `mode`.
    //   sidebar — docked left, the width it has always had
    //   wide    — the same, twice as wide, for a long answer
    //   float   — a launcher, with the panel over the page
    //   full    — every page's assistant link goes to /assistant, the whole width
    // How much of the window a page's content may use. comfortable is UIKit's own small container
    // (900px), which is a reading width and the right default; wide and full are offered for the
    // pages that want the room — a command catalog, a settings file, a terminal.
    pageWidth: one_of(s.page_width, ['comfortable', 'wide', 'full'], 'comfortable'),
    assistantView: one_of(s.assistant_view, ['sidebar', 'wide', 'float', 'full'], 'sidebar'),
    // Quoted in the shipped file, because unquoted `yes` is a BOOLEAN in YAML 1.1 and would arrive
    // here as true — which is not in the list and would silently fall back. Both are accepted.
    assistantOpen: one_of(s.assistant_open === true ? 'yes' : s.assistant_open === false ? 'no' : s.assistant_open,
      ['yes', 'no'], 'yes'),
  };
}

// Rebuilt with a 2s TTL memo: still effectively live (a settings.yml edit
// shows up on the next page load) without re-reading ~17 YAML files for the
// many helper calls within a single request.
let _wsCache = null;
let _wsCacheAt = 0;
function loadWorkspaces() {
  const now = Date.now();
  if (_wsCache && now - _wsCacheAt < 2000) return _wsCache;
  const map = _loadWorkspacesFresh();
  _wsCache = map;
  _wsCacheAt = now;
  return map;
}

function _loadWorkspacesFresh() {
  const settings = loadSettings();
  const names = Array.isArray(settings.workspaces) ? settings.workspaces : [];
  const backupsRoot = settings.backups || path.join(ROOT, 'backups');

  const map = {};
  for (const name of names) {
    const wsSettings = loadYaml(path.join(CONFIG_DIR, `workspace.${name}.settings.yml`));
    const doc = wsSettings.doc || {};
    const dir = doc.path || path.join(ROOT, name);
    // The hardcoded table is the default; a workspace's own file overrides it, so a
    // workspace added from the dashboard can carry its icon and description without
    // a code change — which is the only way a new one gets anything but the folder
    // icon.
    const own = wsSettings.presentation || {};
    const pres = { ...(PRESENTATION[name] || { icon: 'tabler:folder', subtitle: name }), ...own };

    const kind = pres.kind || 'projects';
    // What the folder's projects are FOR — the action policy its rows follow. Chosen in
    // this workspace's own settings file (`type:`), defaulting per shipped folder so an
    // unset file behaves as it always did. See workspace-types.js.
    const type = resolveType(name, wsSettings.type, kind);
    map[name] = {
      key: name,
      dir,
      backupsDir: path.join(backupsRoot, doc.name || name),
      icon: pres.icon,
      subtitle: pres.subtitle,
      label: pres.label || name.charAt(0).toUpperCase() + name.slice(1),
      noun: pres.noun || 'item',
      nounPlural: pres.plural || `${pres.noun || 'item'}s`,
      kind,
      type,
      typeActions: typeActions(type),
      // A workspace that both BUILDS things and HOLDS files — designs runs Penpot instances
      // and keeps the Figma exports beside them, so its page needs the project table and the
      // file list. Off everywhere else: on modules or dev a stray file is noise, not an item.
      alsoFiles: pres.also_files === true,
      // What the COMPOSER menu may do here (`composer:` in this workspace's own file). Only `full` runs
      // install, update and scripts — the site workspaces set it. Anything else, unset included, is
      // `manifest`: composer.json is edited and nothing is installed. See actions/composer.js.
      composerMode: wsSettings.composer === 'full' ? 'full' : 'manifest',
      // The assistant's name and composer placeholder ON THIS WORKSPACE'S PAGE. `assistant:` in
      // settings.yml is the default and `assistant:` here overrides it, so a folder can call its
      // assistant what the work in it is called. Resolved once, here, rather than at each of the
      // five places that name the panel — a heading and a button disagreeing about what the thing
      // is called is worse than either name.
      assistant: assistantIdentity(settings, wsSettings),
      // `assistant: suggestions:` from this workspace's file, unvalidated (assistant-suggestions.js cleans it).
      assistantSuggestions: (wsSettings.assistant || {}).suggestions,
    };
  }
  return map;
}

// After a write to settings.yml the 2s memo would serve the OLD order for up to two seconds —
// long enough that a dragged card grid re-renders exactly as it was and the drag looks lost.
function invalidateWorkspaces() {
  _wsCache = null;
  _wsCacheAt = 0;
}

function isValidWorkspace(name) {
  return Object.prototype.hasOwnProperty.call(loadWorkspaces(), name);
}

function workspaceDir(name) {
  const ws = loadWorkspaces()[name];
  return ws ? ws.dir : null;
}

// Discover which of a folder's cmd-*.sh scripts serve a given purpose, by filename
// convention, instead of hand-mapping every workspace to a fixed script name.
function findScript(dir, patterns) {
  let files = [];
  try {
    files = fs.readdirSync(dir);
  } catch (_) {
    return null;
  }
  for (const re of patterns) {
    const hit = files.find((f) => re.test(f));
    if (hit) return hit;
  }
  return null;
}

function findBackupScript(dir) {
  return findScript(dir, [/^cmd-tools?-backup-.*\.sh$/]);
}

function findRemoveScript(dir) {
  return findScript(dir, [/^cmd-tools-remove\.sh$/]);
}

function findGraphifyScript(dir) {
  return findScript(dir, [/^cmd-tools?-graphify\.sh$/]);
}

function findRagifyScript(dir) {
  return findScript(dir, [/^cmd-tools?-ragify\.sh$/]);
}


// Where a builder sits in the list is a SETTING now — `build-order.js`, one order for the machine and
// one per workspace, over the order the dashboard ships. Required lazily and inside the call, because
// build-order.js reads CONFIG_DIR from this module: at require time the cycle would hand it an empty
// object, and the order would silently fall back to alphabetical.
function sortBuilders(files, dir) {
  // The scope is the workspace the folder IS. Derived rather than passed, so the ~40 callers that only
  // ever had a directory keep working unchanged.
  const scope = path.basename(dir || '') || 'global';
  try {
    return require('./build-order').sortBuilders(files, scope);
  } catch (_) {
    // A broken or missing order file must not cost you the Build form.
    return [...files].sort();
  }
}

function findBuilderScripts(dir) {
  let files = [];
  try {
    files = fs.readdirSync(dir);
  } catch (_) {
    return [];
  }
  files = files
    // cmd-tool-/cmd-tools- scripts are per-project tools (backup, graphify, …), not builders, even
    // when they end in -project.sh.
    //
    // `cmd-automated-testing-*-project.sh` USED to be excluded here as well, and that was wrong:
    // they are builders. Each one builds a whole site and scaffolds its testing stack on top —
    // which is the entire reason the `test` workspace exists — and each carries the same
    // `# workspace-name:` header, takes the same project name and the same --install as any other
    // builder. Hiding them meant the test workspace's Build a new project offered nine of its
    // fourteen builders, and the five you would actually go there for were the missing ones.
    .filter((f) => /^cmd-.*-project\.sh$/.test(f) && !/^cmd-tools?-/.test(f))
    // Not alphabetical: alphabetical put eleven `cmd-automated-testing-…` builds at the top of
    // the test workspace and `cmd-drupalcms2-x-educare…` above Drupal and Varbase everywhere
    // else, so the first thing in "Build a new project" was never the thing most people came to
    // build. The order is Settings → Build order, over the one the dashboard ships.
    .sort();
  return sortBuilders(files, dir);
}

// Human-readable label for a builder script: the `# workspace-name: ...`
// header near the top of the cmd-*.sh file, falling back to the filename.
function builderLabel(dir, script) {
  try {
    const head = fs.readFileSync(path.join(dir, script), 'utf8').slice(0, 500);
    const m = head.match(/^# workspace-name:\s*(.+)$/m);
    if (m) return m[1].trim();
  } catch (_) { /* fall through */ }
  return script;
}

/**
 * A short name for a command, for the line above its description.
 *
 * Short is the point. A builder's `# workspace-name:` is already short — "Varbase 11.0.x" — and is
 * used as-is. Everything else gets a name derived from its own file name, which is short by
 * construction and is what the person is looking for in the list anyway:
 *
 *   cmd-tools-reclaim.sh            -> Reclaim
 *   cmd-tools-graphify.sh           -> Graphify
 *   cmd-all-front-end-build-themes  -> All front end build themes
 *
 * The `tool`/`tools` segment is dropped: every one of them has it, so it distinguishes nothing and
 * costs a word in every title. `-project` goes for the same reason — the folder already says these
 * build projects.
 *
 * A long `# workspace-name:` is NOT used. "Sync the workspace tooling from the clone" sitting above
 * "Sync the workspace tooling from the git clone into the live workspace" is the same sentence twice,
 * and the row reads as though it holds two facts when it holds one.
 */
function commandTitle(dir, script) {
  const declared = builderLabel(dir, script);
  if (declared !== script) {
    // A BUILDER's declared name is a product name — "Varbase Starter 1.0.x on Drupal CMS 2 (site
    // template)" — and is the title however long it runs. `cmd-*-project.sh` is what the smoke test
    // enforces that header on, so it is also what identifies one.
    if (/^cmd-.*-project\.sh$/.test(script)) return declared;
    // On anything else the header is being used as a free-text label, and it tends to be a sentence
    // that repeats the description: "Sync the workspace tooling from the clone" above "Sync the
    // workspace tooling from the git clone into the live workspace". Kept only while it stays short.
    if (declared.split(/\s+/).length <= 4) return declared;
  }

  const stem = script.replace(/^cmd-/, '').replace(/\.sh$/, '')
    .replace(/^tools?-/, '')
    .replace(/-project$/, '')
    .replace(/[-_]+/g, ' ')
    .trim();
  if (!stem) return script;
  return stem.charAt(0).toUpperCase() + stem.slice(1);
}

/**
 * What a command says about itself.
 *
 * Read from the script, not from a list kept beside it. Every `cmd-*.sh` already declares this —
 * 218 of the 239 carry an `ARGPARSE_DESCRIPTION`, which is the same sentence `--help` prints — so a
 * separate file of descriptions would be a second copy to forget to update, and it would be wrong
 * the first time somebody edited a command without knowing the file existed.
 *
 * Three sources, in the order they are worth reading:
 *
 *   1. `ARGPARSE_DESCRIPTION` — written to be read by someone running `--help`, so it is already a
 *      sentence aimed at a person.
 *   2. `# workspace-name:` — the human name of a builder, when there is no description.
 *   3. The leading comment block — the first real sentence of it. Longer and more internal, but a
 *      command with neither of the above still has one.
 *
 * `ARGPARSE_DESCRIPTION` often interpolates shell variables the script sets just above it
 * (`Build a ${distribution_title} ${site_version} project`). Those are resolved from the same file
 * rather than shown raw, because `Build a ${distribution_title} project` in a list reads as a bug.
 * Anything still unresolved is dropped along with its surrounding spaces.
 */
// The flags a builder actually accepts, read from the args/arg-*.sh file it
// sources — so the AI context can state the real contract (--install, --launch,
// --dev, ...) instead of guessing. Empty for scripts without an arg file.
function commandFlags(dir, script) {
  let text;
  try {
    text = fs.readFileSync(path.join(dir, script), 'utf8');
  } catch (_) { return []; }
  const m = text.match(/args\/(arg-[a-zA-Z0-9_$"{}-]+\.sh)/);
  if (!m) return [];
  // Builders source args/arg-${distribution_name}.sh — resolve the variable from
  // the script's own plain assignments, the way commandDescription does.
  const argFile = m[1].replace(/\$\{?([a-zA-Z_][a-zA-Z0-9_]*)\}?/g, (whole, name) => {
    const assigned = text.match(new RegExp(`^${name}=["']?([^"'\n;]+)["']?`, 'm'));
    return assigned ? assigned[1].trim() : '';
  });
  if (!/^arg-[a-z0-9_-]+\.sh$/.test(argFile)) return [];
  let argText;
  try {
    argText = fs.readFileSync(path.join(ROOT, 'core', 'scripts', 'args', argFile), 'utf8');
  } catch (_) { return []; }
  const flags = [];
  const re = /add_argument\('(-[a-zA-Z])', '(--[a-z-]+)'[\s\S]*?help='([^']*)'/g;
  let match;
  while ((match = re.exec(argText)) !== null) {
    flags.push({ short: match[1], long: match[2], help: match[3] });
  }
  return flags;
}

function commandDescription(dir, script) {
  let text;
  try {
    text = fs.readFileSync(path.join(dir, script), 'utf8');
  } catch (_) {
    return '';
  }
  const head = text.slice(0, 4000);

  const resolve = (value) => value.replace(/\$\{?([a-zA-Z_][a-zA-Z0-9_]*)\}?/g, (whole, name) => {
    // The script assigns these as plain `name=value` or `name="value"` before using them.
    const assigned = head.match(new RegExp(`^${name}=["']?([^"'\n]+)["']?`, 'm'));
    return assigned ? assigned[1].trim() : '\u0000';
  });

  const argparse = head.match(/^ARGPARSE_DESCRIPTION=["'](.+?)["']\s*;?\s*$/m);
  if (argparse) {
    const out = resolve(argparse[1]).replace(/\s*\u0000\s*/g, ' ').replace(/\s+/g, ' ').trim();
    if (out) return out;
  }

  const name = head.match(/^# workspace-name:\s*(.+)$/m);
  if (name) return `Build a ${name[1].trim()} project`;

  // The leading comment block, minus the shebang and any `# workspace-name:` line. Its first
  // sentence is the one written to say what the command is for.
  const lines = head.split('\n').slice(1);
  const comment = [];
  for (const line of lines) {
    if (/^#\s?/.test(line)) {
      const body = line.replace(/^#\s?/, '').trim();
      if (!body) { if (comment.length) break; continue; }
      if (/^workspace-name:/.test(body)) continue;
      comment.push(body);
    } else if (comment.length) break;
    else if (line.trim()) break;
  }
  const joined = comment.join(' ').trim();
  if (!joined) return '';
  const stop = joined.search(/\.\s|\.$/);
  return (stop > 0 ? joined.slice(0, stop + 1) : joined).trim();
}

// Backup archives for a workspace: ${backups}/<workspace>/*.tar.gz written by the
// cmd-tool*-backup-*.sh scripts, newest first. It lives here rather than in the page that
// renders them because the assistant names them too, and neither should own the other.
function listBackups(key) {
  const meta = loadWorkspaces()[key];
  try {
    return fs.readdirSync(meta.backupsDir)
      .filter((f) => f.endsWith('.tar.gz'))
      .map((f) => {
        const st = fs.statSync(path.join(meta.backupsDir, f));
        return { file: f, size: st.size, mtime: st.mtime };
      })
      .sort((a, b) => b.mtime - a.mtime);
  } catch (_) {
    return [];
  }
}

/**
 * The release this tree is running, and whether that is knowable.
 *
 * Read from core/workspace-app/.app-version, which install.sh, sync-tooling.sh --pull and
 * update.sh all write. Before they did, only the updater wrote it — so a freshly installed
 * machine answered "(untracked)" for ever and was told to update to the version it already
 * had. Across a team that is the support question nobody can answer.
 *
 * package.json is deliberately NOT the source: it says 1.0.0 and has since the first commit,
 * which is worse than no answer because it looks like one.
 *
 * Returns '' when unknown, and callers must render that as unknown rather than as anything
 * else — a wrong version stops the question being asked.
 */
let _appVersion = { at: 0, value: null };
function appVersion() {
  if (_appVersion.value !== null && Date.now() - _appVersion.at < 10000) return _appVersion.value;
  let v = '';
  try {
    v = fs.readFileSync(path.join(__dirname, '.app-version'), 'utf8').trim().split('\n')[0];
  } catch (_) { v = ''; }
  _appVersion = { at: Date.now(), value: v };
  return v;
}

/**
 * Is this workspace reachable from the network, and therefore dangerous?
 *
 * There is no authentication anywhere in this dashboard. It runs shell commands, serves a
 * browser terminal at /terminal/<session>, and a Web IDE with write access to the whole tree
 * and a terminal of its own, in a container holding the Docker socket. That is defensible
 * ONLY because everything binds to loopback.
 *
 * Two settings end that, and both get changed for a good-looking reason: DDEV's
 * router_bind_all_interfaces (documented for Let's Encrypt, and for reaching a project from a
 * phone) and a public hub_domain (the README says the same system runs as a remote hub).
 *
 * The installer warns, but the person who flips the setting a month later is not running the
 * installer — so the dashboard says it too, where they are.
 */
let _exposure = { at: 0, value: null };
function exposureRisk() {
  if (_exposure.value && Date.now() - _exposure.at < 30000) return _exposure.value;
  const reasons = [];
  try {
    const gc = fs.readFileSync(path.join(process.env.HOME || '', '.ddev', 'global_config.yaml'), 'utf8');
    const m = gc.match(/^router_bind_all_interfaces:\s*(\S+)/m);
    if (m && /^(true|yes)$/i.test(m[1])) {
      reasons.push('DDEV\u2019s router is bound to every interface (router_bind_all_interfaces)');
    }
  } catch (_) { /* no global config readable: say nothing rather than guess */ }
  try {
    const hub = hubDomain();
    if (hub && !/\.ddev\.site$|^localhost$|^127\.0\.0\.1$/.test(hub)) {
      reasons.push(`hub_domain is ${hub}, which is not a local address`);
    }
  } catch (_) { /* ignore */ }
  _exposure = { at: Date.now(), value: reasons };
  return reasons;
}

module.exports = {
  appVersion, exposureRisk,
  sourceOf,
  commandDescription,
  commandFlags,
  commandTitle,
  ROOT,
  loadSettings,
  styleSettings,
  hubDomain,
  CONFIG_DIR,
  loadWorkspaces,
  invalidateWorkspaces,
  isValidWorkspace,
  workspaceDir,
  findBackupScript,
  findRemoveScript,
  findGraphifyScript,
  findRagifyScript,
  findBuilderScripts,
  builderLabel,
  listBackups,
};
