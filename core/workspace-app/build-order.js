/**
 * The order of the builders in **Build a new project**.
 *
 * The list used to be alphabetical, which is an order about filenames rather than about work: eleven
 * `cmd-automated-testing-…` builds sat at the top of the test workspace, and `cmd-drupalcms2-x-educare…`
 * above Drupal and Varbase everywhere else, so the first entry was never the thing most people came to
 * build. A shipped order fixed that for the builders we happen to ship. It cannot answer for a machine
 * that builds something else all day, which is what this is: the order is a setting.
 *
 * Two scopes, the same shape the navigation uses — a global order for every workspace, and a workspace's
 * own applied BEFORE it, because a workspace that says anything about its order is saying something more
 * specific than the machine-wide default. `test` can put its automated-testing builds first without
 * changing `dev`.
 *
 * Three ranks, in this order, and a builder is placed by the first one that knows it:
 *
 *   1. the workspace's own order, then the global order (the two concatenated, deduplicated);
 *   2. DEFAULT_ORDER, what the dashboard ships — still a default, not a competitor, so it keeps
 *      arranging everything nobody has said anything about;
 *   3. alphabetical, which is where a builder nobody has ever mentioned goes.
 *
 * So a global order of three entries does not scatter the other thirty-six: it moves three and leaves
 * the rest exactly as they were.
 *
 * Nothing here HIDES a builder. A missing builder and a builder you have to scroll to are different
 * problems, and only the second one was asked about; `hidden:` can be added to the same file later
 * without changing a line of what it writes today.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const { CONFIG_DIR } = require('./workspaces');

// Overridable so a test can arrange an order without touching the machine's own, the way navigation.js
// and row-layout.js are. Read through the function, never captured at require time.
const orderFile = () => process.env.BUILD_ORDER_FILE || path.join(CONFIG_DIR, 'build-order.yml');

// A builder is named by its own file, because that is the one name that cannot drift: a
// `# workspace-name:` header is prose somebody will improve, and an order keyed on prose forgets itself
// the moment the prose changes. The pattern is findBuilderScripts' own, so nothing can be written here
// that is not a builder.
const BUILDER_RE = /^cmd-(?!tools?-)[a-z0-9][a-z0-9._-]*-project\.sh$/i;
const COMMAND_RE = /^cmd-[a-z0-9][a-z0-9._-]*\.sh$/i;
const isBuilder = (v) => BUILDER_RE.test(String(v || ''));
/**
 * A tool is every other command in the folder — `cmd-tools-backup-dev.sh`, `cmd-tools-clone.sh`,
 * `cmd-all-front-end-build-themes.sh`. Defined as the REMAINDER rather than by a pattern of its own, so
 * a command shaped like nothing anyone anticipated is still arrangeable instead of silently missing.
 */
const isTool = (v) => COMMAND_RE.test(String(v || '')) && !isBuilder(v);
const isCommand = (v) => COMMAND_RE.test(String(v || ''));

// The two lists a scope can hold. They are separate, and not one list of everything, because the two
// answer different questions: a builder starts a project and a tool acts on one, and the places that
// list them — Build a new project, Run a tool — mostly show one kind or the other.
const KINDS = ['builders', 'tools'];
const KIND_OF = (v) => (isBuilder(v) ? 'builders' : 'tools');

/**
 * The order the dashboard ships: the three bases first — the current Drupal core, the one after it,
 * Drupal CMS — then the site templates, grouped by the base they are built on.
 *
 * Grouped by BASE and not by template, because the base is the thing you decide first: "a Drupal CMS
 * site" is a different day's work from "a Varbase site", and the four templates repeat identically
 * under each. Alphabetically the two sets interleave — `cmd-drupalcms2-x-educare…` lands nowhere near
 * `cmd-educare1-…` — so the same template appeared twice in the list with twenty rows between them and
 * nothing saying which base either was.
 *
 * Patterns rather than names, so a builder keeps its place across a version bump: `cmd-varbase11-0-x`
 * and `cmd-varbase11-0-0` are one entry here, and neither has to be re-listed when 11.0.1 arrives.
 *
 * `cmd-drupalcms2-x-project.sh` is anchored exactly — it is Drupal CMS itself, and the pattern that
 * groups its templates (`^cmd-drupalcms2-x-`) would otherwise swallow it and put the base last.
 */
const DEFAULT_ORDER = [
  // The bases.
  /^cmd-drupal11-recommended-project\.sh$/,
  /^cmd-drupal12-recommended-project\.sh$/,
  /^cmd-drupalcms2-x-project\.sh$/,
  /^cmd-varbase11-/,
  // The site templates on Varbase, in the order they were built.
  /^cmd-varbase_starter1-/,
  /^cmd-educare1-/,
  /^cmd-horizonaid1-/,
  /^cmd-rightup1-/,
  // The same four on Drupal CMS, in the same order, together.
  /^cmd-drupalcms2-x-varbase_starter1-/,
  /^cmd-drupalcms2-x-educare1-/,
  /^cmd-drupalcms2-x-horizonaid1-/,
  /^cmd-drupalcms2-x-rightup1-/,
  // Anything else on Drupal CMS keeps with its own kind rather than falling to the alphabet.
  /^cmd-drupalcms2-x-/,
];

// The examples that are not Drupal go after everything else, WordPress before Odoo.
const LAST_ORDER = [/^cmd-wordpress-/, /^cmd-wpbedrock/, /^cmd-odoo/];

/** Where a builder sits in the shipped order, or past the end of it. */
function defaultRank(file) {
  const i = DEFAULT_ORDER.findIndex((re) => re.test(file));
  if (i !== -1) return i;
  const last = LAST_ORDER.findIndex((re) => re.test(file));
  return last === -1 ? DEFAULT_ORDER.length : DEFAULT_ORDER.length + 1 + last;
}

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

function readYaml() {
  try {
    return yaml.load(fs.readFileSync(orderFile(), 'utf8')) || {};
  } catch (_) {
    return {};
  }
}

let memo = { at: 0, mtime: 0, raw: null };

function loadOrder() {
  const now = Date.now();
  let mtime = 0;
  try { mtime = fs.statSync(orderFile()).mtimeMs; } catch (_) { mtime = 0; }
  // Re-read when the file moved, and at most every 2s otherwise: this is on the path of every workspace
  // page, and workspaces.js memoises its own config exactly this way.
  if (!memo.raw || mtime !== memo.mtime || now - memo.at > 2000) {
    memo = { at: now, mtime, raw: readYaml() };
  }
  return { raw: memo.raw, mtime: memo.mtime };
}

/** One scope's settings, with every key present so callers never test for undefined. */
function scopeOrder(raw, scope) {
  const src = (scope === 'global' ? raw.global : ((raw.workspaces || {})[scope])) || {};
  const read = (key, ok) => {
    const list = Array.isArray(src[key]) ? src[key] : [];
    // Deduplicated as well as filtered: the same name twice would give one of the two a rank it can
    // never reach, which reads as a drag that did not save.
    return [...new Set(list.map(String).filter(ok))];
  };
  return { builders: read('builders', isBuilder), tools: read('tools', isTool) };
}

/**
 * The names that decide the order on a page of `scope`: the workspace's own first, then the global ones
 * it did not mention.
 *
 * The workspace comes FIRST, which is the opposite of how the navigation layers its two scopes, and
 * deliberately: the navigation applies a workspace's settings after the global ones so a workspace can
 * override individual entries, while here the whole point of a workspace saying anything is that its own
 * answer is the more specific one.
 */
function orderFor(scope, kind = 'builders', { without = false } = {}) {
  const { raw } = loadOrder();
  const global = without && scope === 'global' ? [] : scopeOrder(raw, 'global')[kind];
  if (scope === 'global') return global;
  const own = without ? [] : scopeOrder(raw, scope)[kind];
  return [...own, ...global.filter((f) => !own.includes(f))];
}

/**
 * Sort a list of builder filenames for one scope.
 *
 * `localeCompare` for the tail, which is what findBuilderScripts has always used — the same order you
 * would get from `sort` in the shell, near enough, and stable across the list being rebuilt.
 *
 * `{ without: true }` sorts as if THIS scope had said nothing, which is how the writer works out which
 * of the names it was posted are decisions and which are just where things already were.
 */
function sortBuilders(files, scope, opts) {
  return sortWith(files, orderFor(scope, 'builders', opts));
}

/**
 * The same for a workspace's TOOLS. No shipped default under it: what a folder's tools should be called
 * in what order is not something this dashboard can have an opinion about — `cmd-tools-backup-dev.sh`
 * before `cmd-tools-clone.sh` is alphabetical and arbitrary, and arbitrary is exactly what somebody
 * arranging this page is fixing.
 */
function sortTools(files, scope, opts) {
  const named = orderFor(scope, 'tools', opts);
  const rank = (f) => {
    const i = named.indexOf(f);
    return i === -1 ? named.length : i;
  };
  return [...files].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/**
 * A mixed list — everything a workspace folder holds — as builders first, then tools.
 *
 * Builders first because a list of a workspace's commands is read to find something to DO, and the
 * thing that makes a project is the one people are most often after. The two never interleave: the
 * alphabet used to put `cmd-tools-backup-dev.sh` between two builders, which reads as a mistake.
 */
function sortCommands(files, scope, opts) {
  const builders = sortBuilders(files.filter(isBuilder), scope, opts);
  const tools = sortTools(files.filter((f) => !isBuilder(f)), scope, opts);
  return [...builders, ...tools];
}

/** The same sort against an explicit list of names — what a caller weighing a candidate order needs. */
function sortWith(files, named) {
  const rank = (f) => {
    const i = named.indexOf(f);
    return i === -1 ? named.length + defaultRank(f) : i;
  };
  return [...files].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/**
 * The names that would decide the order for `scope` if its own list were `own`.
 *
 * Same rule as orderFor, against a list that has not been written yet — which is how the writer can ask
 * "would saving this much be enough?" without touching the file.
 */
function namedWith(scope, kind, own) {
  if (scope === 'global') return [...own];
  const global = scopeOrder(loadOrder().raw, 'global')[kind];
  return [...own, ...global.filter((f) => !own.includes(f))];
}

/**
 * The SHORTEST list that reproduces `posted`.
 *
 * Not the posted list: forty names written down would freeze the order of thirty-nine builders nobody
 * has an opinion about, so a builder added next month would land at the bottom instead of in its
 * shipped place — and the file would assert decisions nobody made.
 *
 * It cannot be found by comparing positions, which is what this did first and got wrong: moving one
 * builder from the bottom to the top shifts every other row down by one, so NOTHING sits where the
 * defaults would have put it and all forty names look like decisions. One move wrote twenty-five lines.
 *
 * So ask the question that is actually being asked. Try the shortest prefix first: if naming just the
 * first builder already produces the arrangement in front of you — because the defaults do the rest —
 * that one name is the whole decision. Forty sorts of forty items in the worst case, on a keystroke
 * nobody makes twice a minute.
 */
function minimalOrder(posted, scope, kind = 'builders') {
  const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  // Tools have no shipped order under them, so their sort is by the named list then the alphabet.
  const sorted = (named) => (kind === 'builders'
    ? sortWith(posted, named)
    : [...posted].sort((a, b) => {
      const r = (f) => (named.indexOf(f) === -1 ? named.length : named.indexOf(f));
      return r(a) - r(b) || a.localeCompare(b);
    }));
  for (let k = 0; k < posted.length; k += 1) {
    const candidate = posted.slice(0, k);
    if (same(sorted(namedWith(scope, kind, candidate)), posted)) return candidate;
  }
  return [...posted];
}

/* ------------------------------------------------------------------ *
 * Writing
 * ------------------------------------------------------------------ */

function saveOrder(raw) {
  const body = '# The order of a workspace\'s commands, per scope: its builders and its tools.\n'
    + '# Written by Settings → Command order. Only what you changed is here; deleting this file is a full reset.\n'
    + '# A command nobody names keeps its shipped place, and then its alphabetical one.\n'
    + '# Never synced: sync-tooling.sh copies only workspace.*.settings.yml into core/config.\n'
    + yaml.dump(raw, { lineWidth: 100 });
  fs.mkdirSync(path.dirname(orderFile()), { recursive: true });
  fs.writeFileSync(orderFile(), body);
  memo = { at: 0, mtime: 0, raw: null };
  return fs.statSync(orderFile()).mtimeMs;
}

/** The whole file, for a writer that is about to change one scope in it. */
function rawOrder() {
  const { raw, mtime } = loadOrder();
  return { raw: JSON.parse(JSON.stringify(raw || {})), mtime };
}

/** Put one scope's order back into the whole file, dropping what is empty so the file stays readable. */
function withScope(raw, scope, settings) {
  const clean = {};
  for (const kind of KINDS) {
    // Only what this save was given: saving the builders must not erase the tools.
    const list = settings[kind];
    if (list && list.length) clean[kind] = list;
    else if (list === undefined) {
      const had = scopeOrder(raw, scope)[kind];
      if (had.length) clean[kind] = had;
    }
  }
  const out = { ...raw };
  if (scope === 'global') {
    if (Object.keys(clean).length) out.global = clean; else delete out.global;
  } else {
    const ws = { ...(out.workspaces || {}) };
    if (Object.keys(clean).length) ws[scope] = clean; else delete ws[scope];
    if (Object.keys(ws).length) out.workspaces = ws; else delete out.workspaces;
  }
  return out;
}

/** Has this scope said anything of its own? Used to dot its tab. */
function scopeHasOrder(scope) {
  const { raw } = loadOrder();
  const own = scopeOrder(raw, scope);
  return KINDS.some((k) => own[k].length > 0);
}

module.exports = {
  orderFile, isBuilder, isTool, isCommand, KINDS, KIND_OF, BUILDER_RE, COMMAND_RE, DEFAULT_ORDER, defaultRank,
  loadOrder, scopeOrder, orderFor, sortBuilders, sortTools, sortCommands, sortWith, namedWith, minimalOrder,
  rawOrder, withScope, saveOrder, scopeHasOrder,
};
