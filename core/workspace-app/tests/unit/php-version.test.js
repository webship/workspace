/**
 * `--php-version` on every builder that runs `ddev config`, as a list rather than a free-text box.
 *
 * The versions are the seven most recent DDEV supports, and DDEV is the authority on that: asked of it
 * rather than remembered, it answers `[5.6 7.0 7.1 7.2 7.3 7.4 8.0 8.1 8.2 8.3 8.4 8.5]`. A version
 * outside the list is refused by argparse BY NAME, which is why offering it as a list matters — a
 * typo in a text box becomes a build that dies on its first line.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { ROOT } = require('../../workspaces');
const { parseArgparseText, parseBuilderArgs } = require('../../builder-args');

const VERSIONS = ['8.5', '8.4', '8.3', '8.2', '8.1', '8.0', '7.4'];
const ARGS = path.join(ROOT, 'core/scripts/args');
const read = (f) => fs.readFileSync(f, 'utf8');

// Every argparse file a site-building builder sources. Not the site-template ones: a site-template
// build takes a name and nothing else, so the PHP version there is the one DDEV picks.
const BUILDER_ARGS = [
  'arg-drupal.sh', 'arg-drupal_cms.sh',
  'arg-webship.sh', 'arg-webships.sh', 'arg-cucumber.sh',
  'arg-website.sh', 'arg-webships-project.sh',
];

test('every builder argparse offers the seven versions', () => {
  for (const f of BUILDER_ARGS) {
    const src = read(path.join(ARGS, f));
    const opt = parseArgparseText(src).find((a) => a.flag === '--php-version');
    assert.ok(opt, `${f} has --php-version`);
    assert.deepEqual(opt.choices, VERSIONS, `${f} offers exactly the seven`);
  }
});

test('the automated-testing builders take it too, instead of hardcoding one', () => {
  const dir = path.join(ROOT, 'test');
  if (!fs.existsSync(dir)) return;                     // a clone without the workspaces built
  const builders = fs.readdirSync(dir).filter((f) => /^cmd-automated-testing-.*-project\.sh$/.test(f));
  assert.ok(builders.length, 'there are automated-testing builders');
  for (const f of builders) {
    const src = read(path.join(dir, f));
    assert.match(src, /'-p', '--php-version'/, `${f} takes the flag`);
    // Either the script configures DDEV itself and passes the flag through, or it delegates the whole
    // build to a build function, which reads PHP_VERSION on its own.
    assert.ok(/--php-version=\$\{PHP_VERSION\}/.test(src) || !/ddev config/.test(src), `${f} passes what it was given`);
    assert.doesNotMatch(src, /--php-version=8\.4\b/, `${f} no longer hardcodes a version`);
  }
});

test('the flag wins over the version a builder declares it needs', () => {
  // A builder says what its core NEEDS (Drupal 12: php >= 8.5.0); somebody passing --php-version is
  // saying what they want to build on. A version the core cannot take fails in composer with a
  // platform requirement that names it — a better answer than silently ignoring what was asked for.
  const fn = read(path.join(ROOT, 'core/scripts/functions/fun-build-distribution.sh'));
  assert.match(fn, /php_version="\$\{PHP_VERSION:-\$\{site_php_version:-\}\}"/);
  assert.match(fn, /\$\{php_version:\+--php-version=\$\{php_version\}\}/);
});

test('nothing asked for means nothing passed, and DDEV keeps its own default', () => {
  const fn = read(path.join(ROOT, 'core/scripts/functions/fun-build-distribution.sh'));
  // `${x:+--php-version=$x}` expands to NOTHING when x is empty — the flag is absent rather than
  // present and blank, which ddev config would refuse.
  assert.match(fn, /\$\{php_version:\+/);
});

test('an argument with choices is drawn as a list, not a text box', () => {
  const server = read(path.join(__dirname, '../../server.js'));
  assert.match(server, /if \(a\.choices && a\.choices\.length\) \{/);
  assert.match(server, /<select class="uk-select uk-form-small arg-value"/);
  // An empty default keeps "leave it alone" reachable; a builder that defaults to a real version does
  // not get an empty option, because it has an answer already.
  assert.match(server, /— leave it to the builder —/);
  assert.match(server, /String\(a\.def \|\| ''\) === '' \? \[/);
});

test('the Build form offers the dropdown on a real builder', () => {
  const dir = path.join(ROOT, 'dev');
  if (!fs.existsSync(dir)) return;
  for (const b of ['cmd-webship11-0-x-project.sh', 'cmd-drupal12-recommended-project.sh']) {
    if (!fs.existsSync(path.join(dir, b))) continue;
    const opt = parseBuilderArgs(dir, b, ROOT).find((a) => a.flag === '--php-version');
    assert.ok(opt, `${b} exposes it to the form`);
    assert.deepEqual(opt.choices, VERSIONS);
    assert.equal(opt.def, '', 'and leaves the builder in charge unless asked');
  }
});
