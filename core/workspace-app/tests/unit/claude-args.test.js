/**
 * The Claude Code arguments the New screen form offers, read from `claude --help`.
 *
 * The form used to carry a permission-mode select and one free-text box called "more claude options",
 * which meant knowing the flags by heart and typing them with no check at all until the screen either
 * started or died. The CLI documents every one of them, so the list is PARSED rather than kept here by
 * hand — the same reason the icon chooser parses the vendored sprite and builder-args.js reads a
 * builder's own argparse block.
 *
 * Parsed against a fixture of the real help text, so these tests do not need claude on the machine and
 * do not change meaning when it is updated.
 */

const assert = require('node:assert');
const { test } = require('node:test');

const ca = require('../../claude-args');

// The two-column shape `claude --help` prints: flags, a wide gap, then a description that wraps — and
// that starts on the next line when the flags are too long for the column.
const HELP = `Usage: claude [options] [command] [prompt]

Options:
  --add-dir <directories...>            Additional directories to allow tool
                                        access to
  --agent <agent>                       Agent for the current session. Overrides
                                        the 'agent' setting.
  --allowedTools, --allowed-tools <tools...>
      Comma or space-separated list of tool names to allow (e.g. "Bash(git *)
      Edit")
  --autocompact <auto|tokens>           Auto-compact window size (auto, or
                                        100k-1M tokens)
  --bg, --background                    Start the session in the background and
                                        return immediately
  -c, --continue                        Continue the most recent conversation in
                                        the current directory
  --debug [filter]                      Enable debug mode with optional category
                                        filtering
  --max-budget-usd <amount>             Maximum dollar amount to spend on API
                                        calls (only works with --print)
  --model <model>                       Model for the current session
  --output-format <format>              Output format (only works with --print):
                                        "text" (default) (choices: "text",
                                        "json")
  --permission-mode <mode>              Permission mode to use for the session
                                        (choices: "acceptEdits", "auto",
                                        "bypassPermissions", "plan")
  -p, --print                           Print response and exit
  --prompt-suggestions [value]          Enable prompt suggestions (choices:
                                        "true", "false", preset: "true")
  -r, --resume [value]                  Resume a conversation by session ID
  --verbose                             Override verbose mode setting from config
  -v, --version                         Output the version number

Commands:
  doctor                                Check the health of your installation
`;

const parsed = ca.parseOptions(HELP);
const by = (name) => parsed.find((o) => o.name === name);

test('the two columns are told apart, wrapped description and all', () => {
  assert.strictEqual(by('--model').description, 'Model for the current session');
  assert.strictEqual(by('--add-dir').description, 'Additional directories to allow tool access to',
    'a description that wraps is one description, not two options');
  assert.strictEqual(by('--allowed-tools').description,
    'Comma or space-separated list of tool names to allow (e.g. "Bash(git *) Edit")',
    'and one that starts on the line below still belongs to the flags above it');
});

test('a flag says what it takes, and whether it repeats', () => {
  assert.strictEqual(by('--verbose').takes, 'none');
  assert.strictEqual(by('--model').takes, 'required');
  assert.strictEqual(by('--debug').takes, 'optional');
  assert.strictEqual(by('--add-dir').repeatable, true, '<directories...> is a list');
  assert.strictEqual(by('--model').repeatable, false);
  assert.strictEqual(by('--add-dir').placeholder, 'directories');
});

test('aliases are kept, and the long one is the name', () => {
  assert.deepStrictEqual(by('--allowed-tools').flags, ['--allowedTools', '--allowed-tools']);
  assert.deepStrictEqual(by('--continue').flags, ['-c', '--continue']);
});

test('only what the CLI calls a choice is a choice', () => {
  assert.deepStrictEqual(by('--permission-mode').choices, ['acceptEdits', 'auto', 'bypassPermissions', 'plan']);
  assert.deepStrictEqual(by('--prompt-suggestions').choices, ['true', 'false'],
    'the preset: inside the same parenthesis is not one of them');
  assert.deepStrictEqual(by('--autocompact').choices, [],
    '<auto|tokens> is the SHAPE of the value ("auto, or 100k-1M tokens") — a select there would refuse 200k');
  assert.strictEqual(by('--autocompact').placeholder, 'auto|tokens', 'it is a placeholder instead');
});

test('what only works with --print is not offered: a screen IS the interactive session', () => {
  const offered = parsed.filter(ca.usableOnAScreen).map((o) => o.name);
  assert.ok(!offered.includes('--max-budget-usd'));
  assert.ok(!offered.includes('--output-format'));
  assert.ok(!offered.includes('--print'));
});

test('what starts the session somewhere else is not offered either', () => {
  const offered = parsed.filter(ca.usableOnAScreen).map((o) => o.name);
  assert.ok(!offered.includes('--background'), 'it returns immediately, so the screen would hold nothing');
  assert.ok(!offered.includes('--version'));
  for (const name of Object.keys(ca.WITHHELD)) {
    assert.ok(ca.WITHHELD[name].length > 10, `${name} says WHY it is held back, so the decision can be argued with`);
  }
});

test('what the form already asks about is not asked twice', () => {
  const offered = parsed.filter(ca.usableOnAScreen).map((o) => o.name);
  assert.ok(!offered.includes('--resume'), 'the Resume row asks this, and checks the id against that directory');
  assert.ok(!offered.includes('--continue'));
});

test('everything else IS offered, including a flag added after this was written', () => {
  const offered = parsed.filter(ca.usableOnAScreen).map((o) => o.name);
  assert.deepStrictEqual(offered.sort(), ['--add-dir', '--agent', '--allowed-tools', '--autocompact',
    '--debug', '--model', '--permission-mode', '--prompt-suggestions', '--verbose'].sort());
});

test('a field name cannot collide with the form own fields', () => {
  assert.strictEqual(ca.fieldName('--add-dir'), 'arg_add_dir');
  assert.strictEqual(ca.fieldName('--permission-mode'), 'arg_permission_mode');
  for (const own of ['session', 'target', 'workspace', 'kind', 'command', 'resume', 'resume_on']) {
    assert.notStrictEqual(ca.fieldName(`--${own}`), own);
  }
});

test('a submitted form becomes shell words, in the order the CLI printed them', () => {
  const { words, problems } = ca.flagsFromForm(parsed.filter(ca.usableOnAScreen), {
    arg_model: 'opus', arg_permission_mode: 'bypassPermissions', arg_verbose: '1',
  });
  assert.deepStrictEqual(problems, []);
  assert.deepStrictEqual(words, ['--model', 'opus', '--permission-mode', 'bypassPermissions', '--verbose']);
});

test('a repeatable flag takes its words one at a time, not as one argument', () => {
  const { words } = ca.flagsFromForm(parsed.filter(ca.usableOnAScreen), { arg_add_dir: '../shared ../other' });
  assert.deepStrictEqual(words, ['--add-dir', '../shared', '../other']);
});

test('an empty field asks for nothing', () => {
  const { words } = ca.flagsFromForm(parsed.filter(ca.usableOnAScreen), { arg_model: '', arg_agent: '   ' });
  assert.deepStrictEqual(words, []);
});

test('a value off the choice list is refused BY NAME, not dropped', () => {
  const { words, problems } = ca.flagsFromForm(parsed.filter(ca.usableOnAScreen), { arg_permission_mode: 'whatever' });
  assert.deepStrictEqual(words, []);
  assert.match(problems[0], /--permission-mode does not take/);
});

test('nothing a shell would read reaches the command line', () => {
  for (const bad of ['opus; rm -rf /', 'opus && curl x', '$(whoami)', '`id`', 'a\nb', "it's", 'x|y', 'a>b']) {
    const { words, problems } = ca.flagsFromForm(parsed.filter(ca.usableOnAScreen), { arg_model: bad });
    assert.deepStrictEqual(words, [], `refused: ${JSON.stringify(bad)}`);
    assert.strictEqual(problems.length, 1, `and said so: ${JSON.stringify(bad)}`);
  }
  // The shapes a real value takes are all allowed.
  for (const good of ['opus', 'claude-fable-5', '../shared', 'Bash,Edit,Read', 'user,project', 'a@b.example']) {
    const { problems } = ca.flagsFromForm(parsed.filter(ca.usableOnAScreen), { arg_model: good });
    assert.deepStrictEqual(problems, [], `allowed: ${good}`);
  }
});

test('a field naming no option of this CLI is ignored, not passed through', () => {
  const { words } = ca.flagsFromForm(parsed.filter(ca.usableOnAScreen), { arg_made_up: 'x', options: '--whatever' });
  assert.deepStrictEqual(words, []);
});

test('the four asked about every time are asked about first', () => {
  assert.deepStrictEqual(ca.COMMON, ['--model', '--permission-mode', '--effort', '--agent']);
});

test('help that says nothing is an error, not an empty list of options', async () => {
  ca.forget();
  const { options, error } = await ca.claudeOptions();
  // On a machine with claude installed this reads the real help; on one without, it is the error path.
  // Either is correct — what must never happen is an empty list reported as success.
  assert.ok(error ? options.length === 0 : options.length > 0);
});
