/**
 * The Build form's Arguments panel must offer exactly what each builder accepts.
 *
 * Ground truth is the builder's own argparse: every arg source in the tree is run
 * with --help and its flags compared with what builder-args.mts returns. The old
 * parser guessed the arg file from distribution_name and was wrong for 96
 * builders — a panel full of flags for the Drupal CMS site-template builders, whose
 * parser takes a name and nothing else, and flags the Webship site-template parser
 * refuses outright.
 */

import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseBuilderArgs, argSourceOf, expandHelp } from '../../builder-args.mts';

const ROOT = path.join(import.meta.dirname, '..', '..', '..', '..');
const SCRIPTS = path.join(ROOT, 'core', 'scripts');

/** A builder script: its workspace folder, that folder's path, and its file name. */
interface Builder { w: string; dir: string; f: string }

function builders(): Builder[] {
  const out: Builder[] = [];
  for (const w of fs.readdirSync(ROOT)) {
    const dir = path.join(ROOT, w);
    let names: string[] = [];
    try { names = fs.readdirSync(dir); } catch (_) { continue; }
    for (const f of names) if (/^cmd-.*project.*\.sh$/.test(f)) out.push({ w, dir, f });
  }
  return out;
}

/** The flags a builder's real parser prints for --help, without running the builder. */
function realFlags({ w, dir, f }: Builder): Set<string> | null {
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
  return new Set([...help.matchAll(/(?:^|[\s,\[])(--[a-z][a-z0-9-]*)/g)].map((m) => m[1] ?? '').filter((x) => x !== '' && x !== '--help'));
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
  const flagsOf = (f: string): string[] => parseBuilderArgs(dir, f, ROOT).map((x) => x.flag).sort();
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

test('a help reads as --help prints it: %(default)s and %(choices)s filled, %% a percent sign (#767)', () => {
  assert.strictEqual(expandHelp('Profile [default %(default)s].', 'standard', []), 'Profile [default standard].');
  assert.strictEqual(expandHelp('One of %(choices)s, %(default)s first.', '8.3', ['8.3', '8.4']), 'One of 8.3, 8.4, 8.3 first.');
  assert.strictEqual(expandHelp('[default %(default)s]', true, []), '[default True]');
  assert.strictEqual(expandHelp('[default %(default)s]', false, []), '[default False]');
  assert.strictEqual(expandHelp('[default %(default)s]', '', []), '[default ]');
  assert.strictEqual(expandHelp('100%% of %(dest)s', 'x', []), '100% of %(dest)s', 'any other name is left as it is');
  // Every builder's every option: nothing of argparse's placeholders is left, and the profile says its default.
  for (const b of builders()) {
    for (const a of parseBuilderArgs(b.dir, b.f, ROOT)) {
      assert.doesNotMatch(a.help, /%\((default|choices)\)s/, `${b.w}/${b.f} ${a.flag}: ${a.help}`);
    }
  }
  const profile = parseBuilderArgs(path.join(ROOT, 'dev'), 'cmd-drupal11-recommended-project.sh', ROOT).find((a) => a.flag === '--profile');
  assert.ok(profile, 'the Drupal 11 builder takes --profile');
  assert.match(profile.help, /\[default standard\]/);
});

test('the Arguments panel shows each help whole, as its title has it, and cuts none (#767)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'core', 'workspace-app', 'server.js'), 'utf8');
  const fn = src.slice(src.indexOf('function builderArgsHtml('), src.indexOf('function backupRowsHtml('));
  assert.ok(fn.length > 100, 'builderArgsHtml is where it was');
  assert.doesNotMatch(fn, /help\.slice\(/, 'no help is cut to a length');
  assert.doesNotMatch(fn, /placeholder="\$\{esc\(a\.help/, 'and none is put in a placeholder, which the field cuts to its width');
  // Each of the three kinds of row (a switch, a list, a box) shows the help beside its field.
  assert.strictEqual((fn.match(/<span class="uk-text-meta arg-help">\$\{esc\(a\.help\)\}<\/span>/g) || []).length, 3);
  const css = fs.readFileSync(path.join(ROOT, 'core', 'workspace-app', 'public', 'css', 'components', 'mic-on-any-field-that-wants-typing.css'), 'utf8');
  assert.match(css, /\.builder-args \.arg-help \{[^}]*overflow-wrap: anywhere/, 'a long help wraps');
});
