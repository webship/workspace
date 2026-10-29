/**
 * What checks a package already declares, and which of them are safe to run.
 *
 * The workspace is full of packages — 79 products, 16 modules, 5 themes, 3 libraries, plus every
 * Drupal site in dev/test/demos — and nearly all of them already declare their own quality scripts:
 * `lint:js`, `lint:css`, `lint:yaml`, `spellcheck`, `phpcs`, `test:chromium`. They just spell them
 * differently, and nothing ran them from one place. This resolves a package's own vocabulary onto a
 * fixed set of canonical checks, so `cmd-tools-checks.sh <name>` means the same thing everywhere.
 *
 * It NEVER invents a command. Every row points at a script the package itself declared; the runner
 * is what puts node_modules/.bin on PATH, so execution is always `<npm|yarn> run <script>`, never a
 * raw shell exec of the declared text.
 *
 * One module, two callers: the shell verb shells out to it for a plan, and the dashboard requires it
 * for the caption under the Checks button. Neither re-implements the map, so the button and the
 * command can never disagree about what a package offers.
 *
 * No dependencies — Node's own fs and path. It is read by a bash function through a TSV contract and
 * by a Node app through require(), and it must work in both without a package.json around it.
 */

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * The canonical checks, in the order they run: cheap and hermetic first, PHP after the Node ones
 * because it is the one most often skipped, the browser suite last because it needs a running site.
 *
 * `names` is the preference order of DECLARED script names. First match wins; the rest of the row is
 * not considered, so a package that declares both `lint:js` and `lint:eslint` runs one of them.
 */
const ALIASES = [
  { id: 'format',   label: 'Formatting',    names: ['format:check', 'lint:prettier', 'prettier:check'] },
  { id: 'js',       label: 'JavaScript',    names: ['lint:js', 'lint:eslint', 'eslint'] },
  { id: 'css',      label: 'CSS',           names: ['lint:css', 'lint:stylelint', 'stylelint'] },
  { id: 'yaml',     label: 'YAML',          names: ['lint:yaml', 'yamllint'] },
  { id: 'spelling', label: 'Spelling',      names: ['spellcheck', 'lint:cspell', 'cspell'] },
  { id: 'types',    label: 'Types',         names: ['lint:tsc', 'typecheck', 'tsc'] },
  { id: 'php',      label: 'PHP standards', names: ['phpcs'] },
  { id: 'twig',     label: 'Twig',          names: [] },          // add-on only; no package declares one
  { id: 'e2e',      label: 'Browser suite', names: [] },          // resolved separately: test:<browser>
];

const LINT_IDS = ['format', 'js', 'css', 'yaml', 'spelling', 'types'];

/**
 * A script that lies about its exit code. `something || exit 0` reports success whatever happened,
 * so a green summary built on it would be a lie — and one module in this tree does exactly that to
 * three of its lint scripts. Refusing it FAILS the run rather than skipping quietly: the workspace
 * rule is that no check may be masked, and the visible escape is --skip <id>.
 */
const MASK = /\|\|\s*(true|exit\s+0)\b/;

/**
 * Commands that write, watch or serve. Matched on the command TEXT, before the name, and that order
 * matters: a script called `lint-all` whose body ends in `--fix` writes to the tree, and a theme's
 * `theme:build` ends in `stylelint --fix`. Name matching alone lets both through.
 */
const DENY_COMMAND = new RegExp([
  '(^|\\s)--fix(\\s|$)', '(^|\\s)--write(\\s|$)',
  '\\bnodemon\\b', '(^|\\s)--watch(\\s|$)',
  '\\bhugo\\s+server\\b', '\\bhttp-server\\b', '\\bkarma\\s+start\\b',
  '\\bplaywright\\s+install\\b', '\\bHEADLESS=false\\b', '\\blint-staged\\b',
  '\\bnpm-run-all\\b', '\\bconcurrently\\b', '\\bwebpack\\b',
  '\\bnpm\\s+install\\b', '\\byarn\\s+install\\b', '\\brm\\s+-rf\\b',
].join('|'));

/** Script names never dispatched in read-only mode, whatever their body says. */
const DENY_NAMES = new Set([
  'phpcbf', 'format', 'fix', 'lint-all', 'lint-staged', 'watch', 'start', 'dev', 'serve',
  'docs-serve', 'build', 'dist', 'js-test', 'docs-build', 'postinstall', 'prepare', 'prepublish',
  'css:watch', 'css:build', 'css:compile', 'theme:watch', 'theme:build', 'theme:init',
  'theme:full-build', 'components:build', 'storybook', 'storybook:build',
  'test:headed', 'test:playwright',
]);

/** A `test` script is only a browser suite if it actually drives one. */
const E2E_OK = /\bcucumber(-js)?\b|\bcucumber\.js\b|\bplaywright\s+test\b/;

/** With --fix, these three are the only rows, and only these names are allowed to write. */
const FIX_MAP = [
  { id: 'php',    label: 'PHP standards', names: ['phpcbf'] },
  { id: 'format', label: 'Formatting',    names: ['format', 'fix'] },
];

const readJson = (file) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
};

/**
 * Which package manager, and why. The reason is printed, because "it used yarn" is a question
 * somebody asks when a check behaves differently from their terminal.
 */
function resolveRunner(dir, forced) {
  if (forced && forced !== '_none_') return { runner: forced, reason: `--runner ${forced}` };
  const pkg = readJson(path.join(dir, 'package.json')) || {};
  const bothLocks = fs.existsSync(path.join(dir, 'yarn.lock')) && fs.existsSync(path.join(dir, 'package-lock.json'));
  if (typeof pkg.packageManager === 'string' && pkg.packageManager.startsWith('yarn')) {
    return { runner: 'yarn', reason: `packageManager: ${pkg.packageManager}${bothLocks ? ' (both lockfiles present — pass --runner npm to override)' : ''}` };
  }
  if (typeof pkg.packageManager === 'string' && pkg.packageManager.startsWith('npm')) {
    return { runner: 'npm', reason: `packageManager: ${pkg.packageManager}` };
  }
  if (fs.existsSync(path.join(dir, 'yarn.lock'))) {
    return { runner: 'yarn', reason: bothLocks ? 'yarn.lock (both lockfiles present — pass --runner npm to override)' : 'yarn.lock' };
  }
  if (fs.existsSync(path.join(dir, 'package-lock.json'))) return { runner: 'npm', reason: 'package-lock.json' };
  return { runner: null, reason: 'no lockfile and no packageManager field — pass --runner' };
}

/**
 * Are the dependencies there? `.pnp.cjs` as well as `node_modules`: four packages here are Yarn PnP
 * and have no node_modules at all while being perfectly runnable, and a node_modules-only test
 * reports them as broken.
 */
function resolveDeps(dir) {
  if (fs.existsSync(path.join(dir, 'node_modules', '.bin'))) return { installed: true, evidence: 'node_modules/.bin' };
  // Yarn PnP has no node_modules at all and is still runnable — but only when PnP is what the
  // package actually uses. `.pnp.cjs` left behind by an earlier install, beside a `.yarnrc.yml` that
  // now says `nodeLinker: node-modules`, is not an installed package: yarn answers "Couldn't find
  // the node_modules state file" and every check fails for a reason that has nothing to do with the
  // code. Both conditions, or it is not installed.
  if (fs.existsSync(path.join(dir, '.pnp.cjs'))) {
    let rc = '';
    try { rc = fs.readFileSync(path.join(dir, '.yarnrc.yml'), 'utf8'); } catch (_) { /* none is fine */ }
    if (!/nodeLinker:\s*node-modules/.test(rc)) return { installed: true, evidence: '.pnp.cjs (Yarn PnP)' };
    return { installed: false, evidence: '.pnp.cjs is stale — .yarnrc.yml asks for nodeLinker: node-modules' };
  }
  return { installed: false, evidence: 'no node_modules/.bin and no .pnp.cjs' };
}

/** The first declared name in the row's preference order, with the reason it was or was not taken. */
function pick(scripts, names) {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(scripts, name)) return { name, command: String(scripts[name]) };
  }
  return null;
}

/** The safety rule, in order. The first hit wins and the row is never executed. */
function judge(id, name, command, { fix = false } = {}) {
  if (MASK.test(command)) {
    return { status: 'masked', reason: 'the script ends in || exit 0 — a green result from it would be a lie' };
  }
  if (!fix) {
    const denied = DENY_COMMAND.exec(command);
    if (denied) return { status: 'refused', reason: `the command ${denied[0].trim()} writes, watches or serves` };
    if (DENY_NAMES.has(name)) return { status: 'refused', reason: `${name} is not a read-only check` };
  }
  // A stylelint call with a config and no path lints nothing at all, and says so with exit 0.
  if (id === 'css' && /stylelint/.test(command) && !/(^|\s)[^-\s][^\s]*\.(css|scss)|(^|\s)"[^"]+"|(^|\s)'[^']+'|(^|\s)\.(\s|$)/.test(command.replace(/--config[= ]\S+/, ''))) {
    return { status: 'refused', reason: 'stylelint names no files — this script checks nothing' };
  }
  return { status: 'ready', reason: '' };
}

/**
 * The plan for one package.
 *
 * @param {string} dir            absolute path to the package or site
 * @param {object} opts           { only, skip, runner, e2e, browser, fix, assumeInstalled, isSite, hasDevTools }
 * @returns {object}              { dir, hasPackageJson, runner, runnerReason, deps, rows: [...] }
 */
function resolvePlan(dir, opts = {}) {
  const {
    only = null, skip = null, runner: forcedRunner = null, e2e = false,
    browser = 'chromium', fix = false, assumeInstalled = false,
    isSite = fs.existsSync(path.join(dir, '.ddev', 'config.yaml')),
    hasDevTools = fs.existsSync(path.join(dir, '.ddev', 'commands', 'web', 'dev-phpcs')),
  } = opts;

  const pkg = readJson(path.join(dir, 'package.json'));
  const scripts = (pkg && pkg.scripts) || {};
  const { runner, reason: runnerReason } = resolveRunner(dir, forcedRunner);
  const deps = assumeInstalled ? { installed: true, evidence: 'just installed' } : resolveDeps(dir);
  const wanted = (list) => (list && list !== '_none_' ? String(list).split(',').map((s) => s.trim()).filter(Boolean) : null);
  const onlyIds = wanted(only);
  const skipIds = wanted(skip) || [];

  const map = fix ? FIX_MAP : ALIASES;
  const rows = [];
  let anyLintPart = false;

  for (const alias of map) {
    const row = { id: alias.id, label: alias.label, script: '', command: '', status: 'none', reason: 'not declared' };

    // e2e is resolved on the browser rather than on a fixed name.
    if (alias.id === 'e2e') {
      const byBrowser = pick(scripts, [`test:${browser}`]);
      const generic = pick(scripts, ['test']);
      const found = byBrowser || (generic && E2E_OK.test(generic.command) ? generic : null);
      if (found) {
        row.script = found.name;
        row.command = found.command;
        if (!e2e) { row.status = 'none'; row.reason = `${found.name} is declared — add --e2e to run it`; }
        else if (!isSite) { row.status = 'refused'; row.reason = 'a package has no site to test against — build one in dev/ and run cmd-tools-testing.sh there'; }
        else Object.assign(row, judge(alias.id, found.name, found.command));
      } else if (generic) {
        row.reason = 'a test script is declared but it does not drive a browser';
      }
    } else {
      const found = pick(scripts, alias.names);
      if (found) {
        row.script = found.name;
        row.command = found.command;
        Object.assign(row, judge(alias.id, found.name, found.command, { fix }));
      } else if (alias.id === 'php' && hasDevTools) {
        row.script = 'ddev dev-phpcs';
        row.command = 'ddev dev-phpcs --all';
        row.status = 'ready';
        row.reason = 'from the ddev-dev-tools add-on';
      } else if (alias.id === 'twig' && hasDevTools) {
        row.script = 'ddev dev-twigcs';
        row.command = 'ddev dev-twigcs --all';
        row.status = 'ready';
        row.reason = 'from the ddev-dev-tools add-on';
      }
    }

    // What a row needs before it can run.
    //
    // The Node checks need the package manager and its node_modules; phpcs does not — it is a
    // composer binary, and `yarn run phpcs` only puts node_modules/.bin on PATH. Reporting a phpcs
    // row green without vendor/bin/phpcs having existed would be reporting a command that never ran.
    if (row.status === 'ready' && !row.script.startsWith('ddev ')) {
      if (row.id === 'php') {
        if (!fs.existsSync(path.join(dir, 'vendor', 'bin', 'phpcs'))) {
          row.status = 'skipped';
          row.reason = 'phpcs is declared but there is no vendor/bin/phpcs here — run it in a site, or add the ddev-dev-tools add-on there';
        }
      } else if (!runner) {
        row.status = 'unresolved-runner';
        row.reason = runnerReason;
      } else if (!deps.installed) {
        row.status = 'deps-missing';
        row.reason = `${deps.evidence} — pass --install`;
      }
    }

    if (row.status === 'ready' && LINT_IDS.includes(row.id)) anyLintPart = true;
    if (onlyIds && !onlyIds.includes(row.id) && row.status === 'ready') { row.status = 'none'; row.reason = `not in --only ${onlyIds.join(',')}`; }
    if (skipIds.includes(row.id) && row.status !== 'none') { row.status = 'skipped'; row.reason = `--skip ${row.id}`; }
    rows.push(row);
  }

  /**
   * The aggregate rule. A package that declares `lint` AND its parts would otherwise run both — the
   * double work the requirement warns about. The parts win; the aggregate is only used when nothing
   * else resolved, and is then judged like any other row.
   */
  if (!fix && !anyLintPart && Object.prototype.hasOwnProperty.call(scripts, 'lint')) {
    const command = String(scripts.lint);
    const verdict = judge('lint', 'lint', command);
    const at = rows.findIndex((r) => r.id === 'js');
    rows.splice(at, 0, {
      id: 'lint', label: 'All linters (aggregate)', script: 'lint', command, ...verdict,
    });
  }

  return {
    dir,
    hasPackageJson: !!pkg,
    isSite,
    hasDevTools,
    runner,
    runnerReason,
    deps,
    postinstall: ['postinstall', 'prepare', 'prepublish'].filter((n) => scripts[n]).map((n) => `${n}: ${scripts[n]}`),
    rows,
  };
}

/* ---------------------------------------------------------------------------
 * The CLI the shell function talks to. TSV rather than JSON, because bash reads
 * it with `while IFS=$'\t' read` and nothing else has to be installed.
 * ------------------------------------------------------------------------ */

function main(argv) {
  const dir = argv[0];
  if (!dir) { process.stderr.write('usage: checks_plan.js <project-path> [--format=tsv|meta|json] [--only=…] [--skip=…]\n'); return 2; }
  const flag = (name, fallback = null) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
  };
  const has = (name) => argv.includes(`--${name}`);
  const plan = resolvePlan(dir, {
    only: flag('only'), skip: flag('skip'), runner: flag('runner'),
    browser: flag('browser', 'chromium'), e2e: has('e2e'), fix: has('fix'),
    assumeInstalled: has('assume-installed'),
  });
  const format = flag('format', 'tsv');

  if (format === 'json') { process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`); return 0; }
  if (format === 'meta') {
    process.stdout.write([
      plan.runner || '', plan.runnerReason, plan.deps.installed ? 'yes' : 'no', plan.deps.evidence,
      String(plan.postinstall.length), plan.hasPackageJson ? 'yes' : 'no', plan.isSite ? 'yes' : 'no',
    ].join('\t') + '\n');
    for (const line of plan.postinstall) process.stdout.write(`postinstall\t${line}\n`);
    return 0;
  }
  for (const r of plan.rows) {
    process.stdout.write([r.id, r.label, r.status, r.script, r.command.replace(/\s+/g, ' '), r.reason].join('\t') + '\n');
  }
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { resolvePlan, resolveRunner, resolveDeps, judge, ALIASES, DENY_NAMES, DENY_COMMAND, MASK, E2E_OK, LINT_IDS };
