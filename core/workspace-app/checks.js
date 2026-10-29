/**
 * What the Checks button knows before you press it.
 *
 * Two questions, both answered without running anything: how many checks this project actually
 * declares, and how the last run went. The first comes from the SAME resolver the command uses
 * (core/scripts/libs/checks_plan.js), so the caption and the command can never disagree about what a
 * package offers. The second comes from the marker the command writes outside the package.
 *
 * Memoised for two seconds: a workspace page renders thirty rows, and each one would otherwise read
 * a package.json and stat a directory.
 */

const fs = require('fs');
const path = require('path');

const { ROOT } = require('./workspaces');

// The resolver lives with the shell tooling, not with the dashboard — it is the shell verb's own
// library, and the dashboard is the second caller rather than the owner.
const { resolvePlan } = require(path.join(ROOT, 'core', 'scripts', 'libs', 'checks_plan'));

const STATE_DIR = path.join(ROOT, 'core', 'state', 'checks');

let _cache = new Map();
let _cacheAt = 0;

const fresh = () => {
  const now = Date.now();
  if (now - _cacheAt > 2000) { _cache = new Map(); _cacheAt = now; }
  return _cache;
};

/**
 * How many checks a project declares, and how many of those are runnable right now. A package with
 * six declared checks and no node_modules is worth saying out loud: the button is not broken, the
 * dependencies are missing.
 */
function checksDeclaredOf(dir, project) {
  const cache = fresh();
  const key = `d:${dir}/${project}`;
  if (cache.has(key)) return cache.get(key);
  let out = { declared: 0, ready: 0, blocked: 0, hasPackageJson: false };
  try {
    const plan = resolvePlan(path.join(dir, project));
    const counted = plan.rows.filter((r) => r.status !== 'none');
    out = {
      declared: counted.length,
      ready: counted.filter((r) => r.status === 'ready').length,
      blocked: counted.filter((r) => ['deps-missing', 'unresolved-runner'].includes(r.status)).length,
      hasPackageJson: plan.hasPackageJson,
    };
  } catch (_) { /* an unreadable package.json is a project with nothing to run */ }
  cache.set(key, out);
  return out;
}

/**
 * The rows themselves, for the menu that lists them: which canonical check, which script the package
 * declared for it, and whether it can run right now. The menu shows the ALIAS beside the real script
 * name — `js → lint:js` — because the whole point of the verb is that a package's own vocabulary is
 * what runs, and seeing the pair is how you know the mapping is right.
 */
function checksRowsOf(dir, project) {
  const cache = fresh();
  const key = `r:${dir}/${project}`;
  if (cache.has(key)) return cache.get(key);
  let rows = [];
  try {
    rows = resolvePlan(path.join(dir, project)).rows.filter((r) => r.status !== 'none');
  } catch (_) { /* nothing declared */ }
  cache.set(key, rows);
  return rows;
}

/** The last run, from the marker the command wrote. Null when it has never been run. */
function checksStateOf(workspace, project) {
  const cache = fresh();
  const key = `s:${workspace}/${project}`;
  if (cache.has(key)) return cache.get(key);
  let out = null;
  try {
    out = JSON.parse(fs.readFileSync(path.join(STATE_DIR, workspace, `${project}.json`), 'utf8'));
  } catch (_) { /* never run */ }
  cache.set(key, out);
  return out;
}

/**
 * The word under the button. It answers "is there anything to look at yet" in one glance:
 * a failure count when there is one, "passed" when the last run was clean, how many checks are
 * declared when it has never run, and why nothing can run when that is the answer.
 */
function checksCaption(workspace, dir, project) {
  const state = checksStateOf(workspace, project);
  if (state) {
    if (state.failed) return `${state.failed} failed`;
    if (state.ran) return `${state.ran} passed`;
  }
  const d = checksDeclaredOf(dir, project);
  if (!d.declared) return 'none';
  if (d.blocked && !d.ready) return 'deps missing';
  return `${d.declared} declared`;
}

module.exports = { checksDeclaredOf, checksRowsOf, checksStateOf, checksCaption };
