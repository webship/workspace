/**
 * Extra hostnames for a project.
 *
 * The feature is "the same site at another address", and the whole design rests on
 * ADDING rather than renaming — so what is asserted here is the parsing (which the
 * dashboard and the shell each do separately, and must agree on), the validation,
 * and the collision check, which is the part that prevents a router conflict
 * nobody would be able to see from one project's page.
 */

const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..', '..', '..');
const FUN = path.join(ROOT, 'core', 'scripts', 'functions', 'fun-ddev-hostnames.sh');
const CLI = path.join(ROOT, 'core', 'scripts', 'functions', 'fun-hostnames-cli.sh');
const ARGS = path.join(ROOT, 'core', 'scripts', 'args', 'arg-hostnames.sh');

function sh(snippet) {
  return execFileSync('bash', ['-c', `source ${JSON.stringify(FUN)} ; ${snippet}`], { encoding: 'utf8' }).trim();
}

/** A project directory with the given config.yaml body. */
function project(body) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hn-'));
  fs.mkdirSync(path.join(tmp, '.ddev'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.ddev', 'config.yaml'), body);
  return tmp;
}

test('the shell files are valid', () => {
  for (const f of [FUN, CLI, ARGS]) assert.strictEqual(spawnSync('bash', ['-n', f]).status, 0, f);
});

test('additional_hostnames is read in both legal YAML shapes', () => {
  const block = project('name: p\nadditional_hostnames:\n  - one\n  - "two"\nphp_version: "8.3"\n');
  const inline = project('name: p\nadditional_hostnames: [one, "two"]\n');
  const none = project('name: p\ndocroot: web\n');
  try {
    assert.deepStrictEqual(sh(`ddev_hostnames_list ${JSON.stringify(block)}`).split('\n'), ['one', 'two']);
    assert.deepStrictEqual(sh(`ddev_hostnames_list ${JSON.stringify(inline)}`).split('\n'), ['one', 'two']);
    assert.strictEqual(sh(`ddev_hostnames_list ${JSON.stringify(none)}`), '');
  } finally { [block, inline, none].forEach((d) => fs.rmSync(d, { recursive: true, force: true })); }
});

test('DDEV’s own commented-out examples are not read as real hostnames', () => {
  // config.yaml ships with `# additional_hostnames:` and `#  - somename` in its
  // comments. Reading those would hand every project two hostnames it never had.
  const d = project('name: p\n# additional_hostnames:\n#  - somename\n#  - someothername\n');
  try {
    assert.strictEqual(sh(`ddev_hostnames_list ${JSON.stringify(d)}`), '');
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('a hostname is a LABEL: no dots, no empty, no leading hyphen', () => {
  for (const good of ['staging', 'blog2-dev', 'a', 'x1-2-3']) {
    assert.strictEqual(sh(`ddev_hostname_valid ${JSON.stringify(good)} && echo yes || echo no`), 'yes', good);
  }
  // A dot would silently produce name.example.com.<tld>, which resolves to nothing.
  for (const bad of ['a.b', 'has space', '-lead', 'trail-', '']) {
    assert.strictEqual(sh(`ddev_hostname_valid ${JSON.stringify(bad)} && echo yes || echo no`), 'no', bad);
  }
});

test('the workspace hostname is <project>-<workspace>, with no trailing junk', () => {
  assert.strictEqual(sh('ddev_workspace_hostname test3 dev'), 'test3-dev');
  assert.strictEqual(sh('ddev_workspace_hostname blog2 site-templates'), 'blog2-site-templates');
  // `tr -c` complements the newline as well, which is how ddev_project_name grew a
  // trailing hyphen; the \n is in the kept set here and this asserts it stays.
  assert.ok(!sh('ddev_workspace_hostname test3 dev').endsWith('-'), 'no trailing hyphen');
  assert.strictEqual(sh('ddev_workspace_hostname "" dev'), '');
});

test('the dashboard reads hostnames the same way the shell does', () => {
  // This used to match patterns in server.js, because server.js cannot be required without starting
  // the server. The parsing now lives in ddev-domains.js, so the behaviour is asserted by CALLING it
  // — which is how a missing `additional_fqdns` would have been caught the first time.
  const { ddevHostnames } = require('../../ddev-domains');
  const os = require('os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ddev-hostnames-'));
  fs.mkdirSync(path.join(dir, '.ddev'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.ddev', 'config.yaml'), `name: blog
project_tld: example.test
additional_hostnames: [one, "two"]
additional_fqdns:
  - storybook.blog.ddev.site
`);
  const h = ddevHostnames(dir);
  assert.deepEqual(h.list, ['one', 'two'], 'the inline [a, b] shape must be handled');
  assert.deepEqual(h.fqdns, ['storybook.blog.ddev.site']);
  assert.strictEqual(h.tld, 'example.test');

  // The important one: no second writer. DDEV owns config.yaml, and the dashboard shells out to
  // cmd-tools-hostnames.sh so the button and the CLI cannot disagree about the collision check.
  const mod = fs.readFileSync(path.join(__dirname, '..', '..', 'ddev-domains.js'), 'utf8');
  assert.ok(!/writeFileSync/.test(mod), 'the dashboard must not write config.yaml itself');
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');
  assert.match(src, /cmd-tools-hostnames\.sh/);
});

test('the five site workspaces carry the command; the code-only ones do not', () => {
  for (const w of ['dev', 'test', 'sandboxes', 'demos', 'projects']) {
    assert.ok(fs.existsSync(path.join(ROOT, w, 'cmd-tools-hostnames.sh')), `${w} is missing it`);
  }
  for (const w of ['docs', 'videos', 'specs', 'products']) {
    if (!fs.existsSync(path.join(ROOT, w))) continue;
    assert.ok(!fs.existsSync(path.join(ROOT, w, 'cmd-tools-hostnames.sh')),
      `${w} builds no sites and should not carry it`);
  }
});

test('clone takes the address options, and --hostname is not the name it uses', () => {
  const args = fs.readFileSync(path.join(ROOT, 'core', 'scripts', 'args', 'arg-clone.sh'), 'utf8');
  assert.match(args, /'--extra-hostname'/);
  assert.match(args, /'--with-workspace-hostname'/);
  // HOSTNAME is a bash builtin; argparse assigns the dest as a shell variable, so
  // --hostname would clobber it inside every clone.
  assert.ok(!/'--hostname'/.test(args), 'must not use --hostname: it would clobber $HOSTNAME');
});

test('a clone name is checked against folders elsewhere and booked addresses', () => {
  const fun = fs.readFileSync(path.join(ROOT, 'core', 'scripts', 'functions', 'fun-clone-project.sh'), 'utf8');
  // `ddev list` is not enough on its own: an unregistered folder is invisible to
  // it, and an additional hostname is a claim on an address it says nothing about.
  assert.match(fun, /A folder called '\$\{target_name\}' already exists in this tree/);
  assert.match(fun, /ddev_hostname_owner "\$\{target_name\}"/);
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');
  assert.match(src, /function hostnameOwner/);
  assert.match(src, /already answered by/);
  assert.match(src, /a folder called \$\{esc\(to\)\} already exists in/);
});

test('hostnameOwner skips the project asking, or every project owns its own name', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');
  const fn = src.slice(src.indexOf('function hostnameOwner'), src.indexOf('function hostnameOwner') + 1200);
  assert.match(fn, /skipDir && path\.resolve\(dir\) === path\.resolve\(skipDir\)/);
  const sh = fs.readFileSync(FUN, 'utf8');
  assert.match(sh.slice(sh.indexOf('function ddev_hostname_owner')), /skip_real/);
});
