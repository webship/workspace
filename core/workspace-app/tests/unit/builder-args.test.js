/**
 * The Build form's Arguments panel must offer exactly what each builder accepts.
 *
 * Ground truth is the builder's own argparse: every arg source in the tree is run
 * with --help and its flags compared with what builder-args.js returns. The old
 * parser guessed the arg file from distribution_name and was wrong for 96
 * builders — no panel for the Drupal CMS site-template builders, and flags the
 * Varbase site-template parser refuses outright.
 */

const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { parseBuilderArgs, argSourceOf } = require('../../builder-args');

const ROOT = path.join(__dirname, '..', '..', '..', '..');
const SCRIPTS = path.join(ROOT, 'core', 'scripts');

function builders() {
  const out = [];
  for (const w of fs.readdirSync(ROOT)) {
    const dir = path.join(ROOT, w);
    let names = [];
    try { names = fs.readdirSync(dir); } catch (_) { continue; }
    for (const f of names) if (/^cmd-.*project.*\.sh$/.test(f)) out.push({ w, dir, f });
  }
  return out;
}

/** The flags a builder's real parser prints for --help, without running the builder. */
function realFlags({ w, dir, f }) {
  const src = fs.readFileSync(path.join(dir, f), 'utf8');
  const where = argSourceOf(src, ROOT);
  if (!where) return null;
  // Replay the builder's own assignments so an unquoted heredoc expands as it would.
  const assigns = [...src.matchAll(/^[ \t]*([A-Za-z_][A-Za-z0-9_]*)="([^"$`]*)";?[ \t]*(?:#.*)?$/gm)]
    .map((m) => `${m[1]}=${JSON.stringify(m[2])}`).join('; ');
  const settings = path.join(ROOT, 'core', 'config', `workspace.${w}.settings.yml`);
  const parser = where.kind === 'inline'
    ? `bash ${JSON.stringify(path.join(dir, f))} --help`
    : `source ${JSON.stringify(where.file)}`;
  const script = `
    WORKSPACE_SCRIPTS=${JSON.stringify(SCRIPTS)}; source "$WORKSPACE_SCRIPTS/bootstrap.sh" >/dev/null 2>&1
    [ -f ${JSON.stringify(settings)} ] && eval $(parse_yaml ${JSON.stringify(settings)})
    ${assigns}
    set -- probe --help
    ${parser}`;
  const r = spawnSync('bash', ['-c', script], { encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'pipe'] });
  const help = `${r.stdout}\n${r.stderr}`;
  return new Set([...help.matchAll(/(?:^|[\s,\[])(--[a-z][a-z0-9-]*)/g)].map((m) => m[1]).filter((x) => x !== '--help'));
}

test('every builder: the panel offers exactly the flags its real parser accepts', () => {
  const all = builders();
  assert.ok(all.length > 100, `expected the whole tree, found ${all.length} builders`);
  // One --help per distinct source: the flag SET depends only on the file.
  const bySource = new Map();
  const failures = [];
  for (const b of all) {
    const src = fs.readFileSync(path.join(b.dir, b.f), 'utf8');
    const where = argSourceOf(src, ROOT);
    const key = where ? (where.kind === 'inline' ? `inline:${b.w}/${b.f}` : where.file) : null;
    if (!key) continue;
    if (!bySource.has(key)) bySource.set(key, realFlags(b));
    const expected = bySource.get(key);
    if (!expected || !expected.size) continue;
    const got = new Set(parseBuilderArgs(b.dir, b.f, ROOT).map((a) => a.flag));
    const missing = [...expected].filter((x) => !got.has(x));
    const extra = [...got].filter((x) => !expected.has(x));
    if (missing.length || extra.length) failures.push(`${b.w}/${b.f}: missing ${missing.join(' ') || '-'}; refused-by-parser ${extra.join(' ') || '-'}`);
  }
  assert.deepStrictEqual(failures, [], failures.slice(0, 12).join('\n'));
});

test('Drupal CMS site-template builders get a panel, with their line as the default', () => {
  const dir = path.join(ROOT, 'dev');
  const rel = parseBuilderArgs(dir, 'cmd-drupalcms2-x-educare1-0-0-project.sh', ROOT);
  const dev = parseBuilderArgs(dir, 'cmd-drupalcms2-x-educare1-0-x-project.sh', ROOT);
  for (const a of [rel, dev]) {
    const flags = a.map((x) => x.flag);
    for (const f of ['--install', '--site-template-version', '--php-version']) assert.ok(flags.includes(f), `missing ${f}`);
  }
  const ver = (a) => a.find((x) => x.flag === '--site-template-version').def;
  // `1-0-0` is ~1.0.0, the three-segment form: "the 1.0 line, latest patch" rather than the whole
  // major. The panel has to say what the script will actually resolve, not a friendlier version of it.
  assert.strictEqual(ver(rel), '~1.0.0', 'the released builder builds ~1.0.0, and the panel must say so');
  assert.strictEqual(ver(dev), '1.0.x-dev');
});

test('Varbase site-template builders: no flags their parser refuses, and the version line shown', () => {
  const dir = path.join(ROOT, 'dev');
  const a = parseBuilderArgs(dir, 'cmd-educare1-0-0-project.sh', ROOT);
  const flags = a.map((x) => x.flag);
  for (const refused of ['--enable', '--skip-set-default-settings', '--skip-drop-database']) {
    assert.ok(!flags.includes(refused), `${refused} would make the build exit with "unrecognized arguments"`);
  }
  assert.strictEqual(a.find((x) => x.flag === '--site-template-version').def, '~1.0.0');
  assert.strictEqual(parseBuilderArgs(dir, 'cmd-educare1-0-x-project.sh', ROOT)
    .find((x) => x.flag === '--site-template-version').def, '1.0.x-dev');
});

test('no default is ever shown as unexpanded shell text', () => {
  for (const b of builders()) {
    for (const a of parseBuilderArgs(b.dir, b.f, ROOT)) {
      assert.ok(!String(a.def).includes('${'), `${b.w}/${b.f} ${a.flag} shows "${a.def}"`);
    }
  }
});

test('builders that source through distribution_name are unchanged', () => {
  const flags = parseBuilderArgs(path.join(ROOT, 'dev'), 'cmd-varbase11-0-x-project.sh', ROOT).map((x) => x.flag);
  for (const f of ['--install', '--add-users', '--enable']) assert.ok(flags.includes(f), `varbase11 lost ${f}`);
});
