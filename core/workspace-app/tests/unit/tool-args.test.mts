// Run a tool: what is typed after the command is split into arguments the way a shell reads quotes,
// so a platform tool's --run "plugin list" is one argument, and nothing typed can start a second command.
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { splitToolArgs, shellArgs, shownArgs, ARGS_PATTERN, ALLOWED, UNCLOSED } from '../../tool-args.mts';

/** The arguments of a split that is known to succeed. */
function argvOf(typed: string): string[] {
  const r = splitToolArgs(typed);
  assert.ok(r.ok, typed);
  return r.argv;
}

test('plain arguments are split on spaces, as before', () => {
  assert.deepStrictEqual(splitToolArgs('mysite --install --version ^5.2 --path tests/features/a.feature'),
    { ok: true, argv: ['mysite', '--install', '--version', '^5.2', '--path', 'tests/features/a.feature'] });
  assert.deepStrictEqual(splitToolArgs(''), { ok: true, argv: [] });
  assert.deepStrictEqual(splitToolArgs('   '), { ok: true, argv: [] });
  assert.deepStrictEqual(splitToolArgs(undefined), { ok: true, argv: [] });
});

test('an argument of several words goes in quotes and stays one argument', () => {
  assert.deepStrictEqual(argvOf('mysite --run "plugin list --status=active"'), ['mysite', '--run', 'plugin list --status=active']);
  assert.deepStrictEqual(argvOf("mysite --run 'config get url'"), ['mysite', '--run', 'config get url']);
  assert.deepStrictEqual(argvOf('mysite --tags="@critical and @smoke"'), ['mysite', '--tags=@critical and @smoke']);
  assert.deepStrictEqual(argvOf('mysite --run ""'), ['mysite', '--run', '']);
});

test('what could leave the argument is refused, in or out of quotes', () => {
  for (const typed of ['mysite; rm -rf x', 'mysite && ls', 'mysite | cat', 'mysite $(id)', 'mysite `id`', 'mysite $HOME', 'mysite > out',
    'mysite --run "a; b"', 'mysite --run "$(id)"', 'mysite --run "a `b`"', 'mysite --run "a \\" b"', "mysite --run 'a \\' b'", 'mysite --run "it\'s"', 'mysite\\n']) {
    const r = splitToolArgs(typed);
    assert.ok(!r.ok, typed);
    assert.ok([ALLOWED, UNCLOSED].includes(r.error), typed);
  }
  assert.deepStrictEqual(splitToolArgs('mysite --run "plugin list'), { ok: false, error: UNCLOSED });
});

test('the shell is given each argument in single quotes, and bash reads back exactly what was typed', () => {
  const argv = argvOf('mysite --run "plugin list --status=active" --tags \'@a and @b\' ^1.0 ~/x');
  assert.strictEqual(shellArgs(argv), "'mysite' '--run' 'plugin list --status=active' '--tags' '@a and @b' '^1.0' '~/x'");
  const r = spawnSync('bash', ['-c', `printf '%s\\n' ${shellArgs(argv)}`], { encoding: 'utf8' });
  assert.deepStrictEqual(r.stdout.split('\n').slice(0, -1), argv, 'no expansion, no splitting: ~ and ^ and spaces arrive as typed');
});

test('the label shows quotes only where an argument has a space, and never a double quote', () => {
  const argv = argvOf('mysite --run "plugin list"');
  assert.strictEqual(shownArgs(argv), "mysite --run 'plugin list'");
  assert.doesNotMatch(shownArgs(argvOf('a --run "b c" --x ""')), /"/, 'the label goes inside echo "…" at the end of the session');
});

test('the field of the form carries the same rule, and says how to type several words', () => {
  const field = new RegExp(`^(?:${ARGS_PATTERN})$`, 'v');   // how a browser reads the pattern attribute
  for (const ok of ['', 'mysite --install', 'mysite --run "plugin list --status=active"', "mysite --run 'config get url'"]) {
    assert.ok(field.test(ok), ok);
    assert.strictEqual(splitToolArgs(ok).ok, true, ok);
  }
  for (const bad of ['mysite; ls', 'mysite --run "a', 'mysite $(id)', 'mysite --run "a; b"']) {
    assert.ok(!field.test(bad), bad);
    assert.strictEqual(splitToolArgs(bad).ok, false, bad);
  }
  const server = readFileSync(join(import.meta.dirname, '..', '..', 'server.js'), 'utf8');
  assert.match(server, /name="args"[^>]*pattern="\$\{esc\(require\('\.\/tool-args\.mts'\)\.ARGS_PATTERN\)\}"/s, 'the Run a tool field takes its pattern from tool-args.mts');
  assert.match(server, /An argument of several words goes in quotes/);
  assert.match(server, /toolArgs\.shellArgs\(split\.argv\)/, 'the command line is built from the split arguments, not from what was typed');
  assert.doesNotMatch(server, /bash \$\{script\}\$\{rawArgs/, 'what was typed never reaches the shell as it is');
});
