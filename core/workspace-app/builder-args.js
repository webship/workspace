/**
 * A builder's arguments, read from the file that actually parses them.
 *
 * The dashboard's Arguments panel and the /actions/build endpoint both take their
 * schema from here, so what the form offers is exactly what the script accepts.
 *
 * It used to guess. A script without an inline argparse heredoc was assumed to
 * load `args/arg-<distribution_name>.sh`, which is true only for the builders
 * that source that file through the variable. Measured across the tree it was
 * wrong for 96 builders:
 *
 *   - the Drupal CMS site-template builders declare no distribution_name, so they
 *     got NO panel at all — no way to pass --install or --site-template-version;
 *   - the Webship site-template builders declare distribution_name="webship" but
 *     source arg-webship-site-template.sh, so the panel offered --enable and the
 *     --skip-* flags, which that parser REFUSES ("unrecognized arguments", the
 *     build exits before it starts), and omitted --site-template-version and
 *     --php-version;
 *   - the free Drupal CMS site-template builders were shown arg-drupal_cms.sh.
 *
 * So the order is the order the script itself runs: an inline heredoc if it has
 * one, otherwise the first `source ${WORKSPACE_SCRIPTS}/args/…` line — a literal
 * file name, or `arg-${distribution_name}.sh` resolved from the script.
 */

const fs = require('fs');
const path = require('path');

/** Every `name="value"` assignment a script makes at the top level, last one wins. */
function scriptAssignments(src) {
  const out = {};
  for (const m of src.matchAll(/^[ \t]*([A-Za-z_][A-Za-z0-9_]*)="([^"$`]*)";?[ \t]*(?:#.*)?$/gm)) {
    out[m[1]] = m[2];
  }
  return out;
}

/**
 * Expand `${var}` and `${var:-fallback}` the way the builder's unquoted heredoc
 * would, from the builder's own assignments. Without this the panel showed the
 * literal text `${site_template_version_default:-1.0.x-dev}` as a default.
 */
function expandDefaults(text, vars) {
  return text.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g,
    (_, name, fallback) => (vars[name] !== undefined && vars[name] !== '' ? vars[name] : (fallback ?? '')));
}

function parseArgparseText(argSrc) {
  const out = [];
  for (const block of argSrc.split('parser.add_argument(').slice(1)) {
    const flags = [...block.matchAll(/'(--?[a-zA-Z0-9_\-]+)'/g)].map((m) => m[1]);
    const long = flags.find((f) => f.startsWith('--'));
    if (!long) continue; // positional (PROJECT_NAME etc.)
    const bool = /action='store_true'/.test(block.split('parser.add_argument')[0]);
    const dm2 = block.match(/default=(?:"([^"]*)"|'([^']*)'|(False|True))/);
    let def = dm2 ? (dm2[1] ?? dm2[2] ?? dm2[3]) : '';
    if (def === 'False') def = false; else if (def === 'True') def = true;
    if (def === '_none_') def = '';
    const hm = block.match(/help='((?:[^'\\]|\\.)*)'/);
    // What the parser will ACCEPT, when it says so. argparse refuses anything else by name, so an
    // argument with choices is a list to pick from rather than a box to type a typo into — and the
    // Build form can draw the control the argument's own shape asks for.
    const cm = block.match(/choices=\[([^\]]*)\]/);
    const choices = cm
      ? [...cm[1].matchAll(/'([^']*)'|"([^"]*)"/g)].map((m) => m[1] ?? m[2]).filter((v) => v !== undefined)
      : [];
    out.push({ flag: long, bool, def, choices, help: hm ? hm[1].replace(/\\'/g, "'") : '' });
  }
  return out;
}

/**
 * Where a builder's arguments come from:
 *   { kind: 'inline' } | { kind: 'file', file } | null
 */
function argSourceOf(src, root) {
  if (/argparse "\$@"/.test(src) && src.includes('parser.add_argument(')) return { kind: 'inline' };
  const m = src.match(/^[ \t]*source[ \t]+\$\{?WORKSPACE_SCRIPTS\}?\/args\/(arg-[A-Za-z0-9_${}.-]+\.sh)/m);
  if (!m) return null;
  let name = m[1];
  if (name.includes('$')) {
    const vars = scriptAssignments(src);
    name = expandDefaults(name, vars);
    if (name.includes('$') || /arg-\.sh$/.test(name)) return null;
  }
  return { kind: 'file', file: path.join(root, 'core', 'scripts', 'args', name) };
}

/**
 * The schema for one builder: [{ flag, bool, def, help }].
 *
 * `def` is the EFFECTIVE default: the arg file's own, expanded from the builder's
 * assignments, and — when that is empty — the value the builder falls back to for
 * that flag (`--site-template-version` → site_template_version), because the Drupal
 * CMS builders pin their line that way: `SITE_TEMPLATE_VERSION="${SITE_TEMPLATE_VERSION:-${site_template_version}}"`.
 * Showing an empty default there would tell the user the builder takes the latest
 * release when it actually builds 1.0.x-dev.
 */
function parseBuilderArgs(dir, script, root) {
  try {
    const src = fs.readFileSync(path.join(dir, script), 'utf8');
    const where = argSourceOf(src, root);
    if (!where) return [];
    const vars = scriptAssignments(src);
    const text = where.kind === 'inline' ? src : fs.readFileSync(where.file, 'utf8');
    return parseArgparseText(expandDefaults(text, vars)).map((a) => {
      if (a.bool || a.def) return a;
      const dest = a.flag.replace(/^--/, '').replace(/-/g, '_');
      const own = vars[dest] ?? vars[`${dest}_default`];
      return own ? { ...a, def: own } : a;
    });
  } catch (_) {
    return [];
  }
}

module.exports = { parseBuilderArgs, parseArgparseText, argSourceOf, expandDefaults, scriptAssignments };
