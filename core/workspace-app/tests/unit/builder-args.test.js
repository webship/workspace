/**
 * The Build form's Arguments panel must offer exactly what each builder accepts.
 *
 * Ground truth is the builder's own argparse: every arg source in the tree is run
 * with --help and its flags compared with what builder-args.js returns. The old
 * parser guessed the arg file from distribution_name and was wrong for 96
 * builders — a panel full of flags for the Drupal CMS site-template builders, whose
 * parser takes a name and nothing else, and flags the Webship site-template parser
 * refuses outright.
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

test('Drupal CMS site-template builders take a name and nothing else', () => {
  // arg-site-template.sh declares only PROJECT_NAME: the template decides what the site is, so
  // there is nothing left to choose, and a panel that offered --install or --php-version would be
  // offering flags the build exits on.
  const dir = path.join(ROOT, 'site-templates');
  for (const f of ['cmd-byte-project.sh', 'cmd-haven-project.sh', 'cmd-website_starter-project.sh']) {
    assert.deepStrictEqual(parseBuilderArgs(dir, f, ROOT), [], `${f} takes no flags`);
  }
});

test('Webship site-template builders: no flags their parser refuses, and only the ones it takes', () => {
  const dir = path.join(ROOT, 'site-templates');
  const flagsOf = (f) => parseBuilderArgs(dir, f, ROOT).map((x) => x.flag).sort();
  // The Website line's parser takes the users and the pending fixes, nothing from the distribution set.
  assert.deepStrictEqual(flagsOf('cmd-website_starter-1-0-x-project.sh'), ['--add-users', '--with-pending-fixes']);
  assert.deepStrictEqual(flagsOf('cmd-webship_portal-1-0-x-project.sh'), ['--add-users', '--with-pending-fixes']);
  // The Webships line's parser takes the users alone.
  assert.deepStrictEqual(flagsOf('cmd-webships_starter-1-0-x-project.sh'), ['--add-users']);
  for (const refused of ['--install', '--enable', '--skip-set-default-settings', '--skip-drop-database', '--php-version']) {
    assert.ok(!flagsOf('cmd-website_starter-1-0-x-project.sh').includes(refused),
      `${refused} would make the build exit with "unrecognized arguments"`);
  }
});

test('no default is ever shown as unexpanded shell text', () => {
  for (const b of builders()) {
    for (const a of parseBuilderArgs(b.dir, b.f, ROOT)) {
      assert.ok(!String(a.def).includes('${'), `${b.w}/${b.f} ${a.flag} shows "${a.def}"`);
    }
  }
});

test('builders that source through distribution_name are unchanged', () => {
  const flags = parseBuilderArgs(path.join(ROOT, 'dev'), 'cmd-webship11-0-x-project.sh', ROOT).map((x) => x.flag);
  for (const f of ['--install', '--add-users', '--enable', '--php-version']) assert.ok(flags.includes(f), `webship11 lost ${f}`);
});
