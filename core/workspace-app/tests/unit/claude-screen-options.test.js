/**
 * The New screen form, on Claude Code: the model, the effort and the agent as lists, and the form
 * opening where it was opened FROM.
 *
 * The bug underneath this one is the second half. A project row's SCREENS → "New screen here…" passes
 * the workspace and the project, but the form only honoured them when a Jira key came with them — so
 * it opened at the workspace ROOT, and a session started from it ran in ~/workspace instead of the
 * project it was asked for. Nothing said so: the place selects simply read `root`.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const claudeArgs = require('../../claude-args');
const server = fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8');
const screens = fs.readFileSync(path.join(__dirname, '../../screens.js'), 'utf8');

const HELP = `
Options:
  --model <model>                       Model for the current session. Provide
                                        an alias for the latest model (e.g.
                                        'fable', 'opus', or 'sonnet') or a
                                        model's full name (e.g.
                                        'claude-fable-5').
  --effort <level>                      Effort level for the current session
                                        (low, medium, high, xhigh, max)
  --autocompact <auto|tokens>           When to compact (default: auto)
  --agent <agent>                       Agent for the current session. Overrides
                                        the 'agent' setting.
Commands:
`;

// No guard around this: a test that can skip itself silently is a test that can stop testing without
// anyone noticing.
const opt = (name) => claudeArgs.parseOptions(HELP).find((o) => o.name === name);

test('an option that enumerates its values in prose gets a closed list', () => {
  // `--effort <level>  … (low, medium, high, xhigh, max)` — a closed list said in a sentence rather
  // than in the `(choices: …)` the help generator emits.
  const effort = opt('--effort');
  assert.deepEqual(effort.choices, ['low', 'medium', 'high', 'xhigh', 'max']);
});

test('a shape hint is still not a list of choices', () => {
  // `<auto|tokens>` means "auto, or a number of tokens". Reading it as choices would refuse 200k, and
  // the comment in claude-args.js says so; the prose rule must not undo that.
  const auto = opt('--autocompact');
  assert.deepEqual(auto.choices, [], 'pipes in the value placeholder are not choices');
  // Nor is a lone default or a pair — three or more bare words is the bar.
  assert.ok(!auto.choices.includes('auto'));
});

test('the model offers what the help NAMES, and still takes anything', () => {
  const model = opt('--model');
  assert.deepEqual(model.choices, [], 'never a closed list');
  assert.ok(model.suggestions.includes('opus') && model.suggestions.includes('sonnet'),
    'the aliases the CLI itself gives as examples');
  // A select here would refuse every model released after this help text was read.
  assert.match(screens, /an OPEN list \(--model, --agent\) is an input with a datalist/);
});

test('the agents offered are the ones that exist, by their frontmatter name', () => {
  const agents = claudeArgs.installedAgents();
  assert.ok(Array.isArray(agents));
  // A rules document in the same folder is not an agent: the CLI dispatches on a frontmatter `name`,
  // and RULES.md has none. Blocklisting the docs by name would work until somebody added another.
  assert.ok(!agents.includes('RULES'), 'prose in the agents folder is not an agent');
  assert.match(require('fs').readFileSync(path.join(__dirname, '../../claude-args.js'), 'utf8'),
    /if \(!\/\^---\\s\*\$\/m\.test/, 'frontmatter is what makes it an agent');
});

test('the four asked for every time are the four laid out first', () => {
  assert.deepEqual(claudeArgs.COMMON, ['--model', '--permission-mode', '--effort', '--agent']);
});

test('the form opens on the project it was opened from', () => {
  // Without this the whole feature is a session in the wrong directory, which is what it was.
  assert.match(server, /if \(!pre\) \{[\s\S]{0,400}pre = \{ workspace: ws, target: `p:\$\{ws\}:\$\{proj\}` \}/);
  assert.match(server, /pre = \{ workspace: ws, target: `ws:\$\{ws\}` \}/,
    'a workspace with no project still opens on that workspace');
  assert.match(server, /opened at the workspace ROOT/, 'and the reason is written down');
});
