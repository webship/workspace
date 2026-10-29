/**
 * The New screen form.
 *
 * It asked four questions in one row of controls, and one of them was a select of 309 entries — every
 * workspace folder and every project in the tree, flat. Now it asks them in the order they are answered:
 * where it runs (the workspace, then what is inside it), what it starts, its arguments, and the prompt.
 *
 * Three things must not drift. The place is picked in TWO lists, so neither is long. The session name is
 * pre-filled with where it runs, because that is what `screen -ls` shows and what `screen -r` takes —
 * but a name typed by hand is never overwritten. And the Claude arguments come from `claude --help`,
 * so a free-text box of flags nobody checks is not the way back in.
 */

const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('fs');
const path = require('path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', '..', f), 'utf8');
const screens = require('../../screens');
const src = read('screens.js');
const ui = read('public/ui.js');
const action = read('actions/screens.js');
const server = read('server.js');

test('the place is two lists, not one of three hundred', () => {
  // One list of the workspaces, then one of what is inside the chosen one. The workspace list is short
  // whatever the tree holds; the long one only ever shows a single workspace's projects.
  const workspaces = screens.workspaceOptionsHtml('root');
  assert.ok((workspaces.match(/<option/g) || []).length < 40, 'the workspace list is short enough to read');
  assert.match(workspaces, /value="root"/, 'the workspace root is one of them');
  assert.match(src, /const inside = screenTargets\(\)\.filter\(\(t\) => t\.value === `ws:\$\{key\}` \|\| t\.value\.startsWith\(`p:\$\{key\}:`\)\);/,
    'and the second list is scoped to that workspace, not the whole tree');
});

test('a workspace folder is a place in its own right, listed first', () => {
  assert.match(src, /const folder = t\.value === `ws:\$\{key\}`;/);
  assert.match(src, /folder \? `the \$\{key\}\/ folder itself`/,
    'the folder itself is an option that says what it is, not something to notice is missing');
});

test('every place carries where it is, so the path follows the choice with no request', () => {
  assert.match(src, /data-path="\$\{esc\(tildePath\(t\.dir\)\)\}"/);
  assert.match(ui, /line\.textContent = path\.path;/);
});

test('reopening the form lands on the list the target was picked from', () => {
  assert.strictEqual(screens.workspaceOfTarget('p:dev:ha1x00b1'), 'dev');
  assert.strictEqual(screens.workspaceOfTarget('ws:modules'), 'modules');
  assert.strictEqual(screens.workspaceOfTarget('root'), 'root');
  assert.strictEqual(screens.workspaceOfTarget(''), 'root');
});

test('the session name is pre-filled with where it runs, and a short id of its own', () => {
  assert.strictEqual(screens.defaultSessionName('p:dev:ha1x00b1', '7f3a'), 'dev--ha1x00b1--7f3a');
  assert.strictEqual(screens.defaultSessionName('ws:modules', '7f3a'), 'modules--7f3a');
  assert.strictEqual(screens.defaultSessionName('root', '7f3a'), 'workspace-7f3a',
    "not 'root': in screen -ls that reads as the user it runs as, which it is not");
  assert.match(screens.defaultSessionName('p:dev:Weird Name!'), /^[a-z0-9][a-z0-9._-]*$/,
    'and it is a name screen(1) accepts');
});

test('the id makes it startable twice: two names for one place are not the same name', () => {
  const a = screens.defaultSessionName('p:dev:ha1x00b1');
  const b = screens.defaultSessionName('p:dev:ha1x00b1');
  assert.notStrictEqual(a, b, 'a second session in one project was refused as a name that already exists');
  assert.match(a, /^dev--ha1x00b1--[0-9a-f]{4}$/);
});

test('the pre-filled name already says where it runs, so the endpoint does not say it again', () => {
  const name = screens.defaultSessionName('p:dev:ha1x00b1', '7f3a');
  assert.ok(name.startsWith('dev--ha1x00b1--'), 'which is exactly what the endpoint checks for');
});

test('a name typed by hand is never overwritten by the place changing', () => {
  assert.match(ui, /if \(field\.value && field\.value !== field\.dataset\.derived\) return;/);
  assert.match(src, /data-derived="\$\{esc\(prefilled\)\}"/,
    'the rendered default says it was derived, or the first change would look hand-typed');
  assert.match(src, /data-tail="\$\{esc\(prefilled\.slice\(-4\)\)\}"/,
    'and carries its id, so changing the place does not roll a new one every time');
});

test('a name that already says where it runs is not made to say it twice', () => {
  assert.match(action, /const said = prefix && \(`\$\{session\}--` === prefix \|\| session\.startsWith\(prefix\)\);/,
    'dev--ha1x00b1 must not become dev--ha1x00b1--dev--ha1x00b1');
});

test('the free-text flags box is gone, and nothing reads it any more', () => {
  assert.ok(!/name="options"/.test(src), 'the box that meant knowing every flag by heart is not rendered');
  assert.ok(!action.includes("form.options"), 'and the endpoint no longer takes a string of flags');
  assert.match(action, /claudeArgs\.flagsFromForm\(options, form\)/);
  assert.match(action, /if \(problems\.length\)/, 'a value it will not pass on is said out loud');
});

test('the arguments are the installed CLI own, not a list kept here by hand', () => {
  assert.match(src, /await claudeArgs\.claudeOptions\(\)/);
  assert.match(src, /Read from <code>claude --help<\/code> on this machine/);
  assert.match(src, /The Claude Code options could not be read from/,
    'a machine with no claude still gets a form, and is told why it is shorter');
});

test('each argument gets the control its own shape asks for', () => {
  assert.match(src, /if \(opt\.takes === 'none'\) \{[\s\S]{0,200}type="checkbox"/);
  assert.match(src, /opt\.choices\.length[\s\S]{0,80}<select/);
  assert.match(src, /opt\.repeatable \? ' — space separated' : ''/);
});

test('the four reached for every time are in front of the other thirty', () => {
  assert.match(src, /claudeArgs\.COMMON\.map/);
  assert.match(src, /<summary>All Claude Code options \(\$\{rest\.length\}\)<\/summary>/);
});

test('a prompt template puts its flags on the controls that own them', () => {
  assert.match(ui, /window\.screenPromptTemplate = function screenPromptTemplate/);
  assert.match(ui, /if \(field\.type === 'checkbox'\) \{ field\.checked = true; continue; \}/);
  assert.ok(!src.includes('f.options.value = fl'), 'not into a text box that no longer exists');
});

test('the kind is three named choices, and it decides what the rest of the form asks', () => {
  assert.match(src, /type="radio" name="kind" value="\$\{value\}"/);
  assert.match(ui, /for \(const el of form\.querySelectorAll\('\[data-claude-only\]'\)\) el\.hidden = kind !== 'claude';/);
  assert.match(ui, /for \(const el of form\.querySelectorAll\('\[data-not-claude\]'\)\) el\.hidden = kind === 'claude';/);
});

test('the form arrives in a modal, so its state is settled on the swap rather than on load', () => {
  assert.match(ui, /document\.body\.addEventListener\('htmx:after:settle'/);
  assert.match(ui, /el\.id === 'screen-where' \? el : el\.querySelector\('#screen-where'\)/);
});

test('changing the workspace or the place does not close the modal', () => {
  const where = src.slice(src.indexOf('function screenWhereHtml'), src.indexOf('function claudeArgFieldHtml'));
  assert.match(where, /hx-on::after:request="event\.stopPropagation\(\)"/,
    "the form's own after:request hides the modal — these requests must not reach it");
  assert.match(src, /hx-get="\/fragments\/screen-where"/);
  assert.match(server, /pathname === '\/fragments\/screen-where'/);
});

test('the resume row is per DIRECTORY, so a workspace folder has one exactly as a project does', () => {
  assert.match(src, /a workspace folder has its own sessions exactly\s*\n?\s*\*? ?as a project does|folder has its own sessions exactly as a project does/,
    'stated where somebody would look for it');
  assert.match(src, /<div id="claude-resume-row">\$\{claudeResumeHtml\(p\.target\)\}<\/div>/);
  assert.match(src, /hx-target="#claude-resume-row"/, 'and it reloads when the place changes');
});

test('an empty session name is filled in, not refused', () => {
  assert.match(action, /String\(form\.session \|\| ''\)\.trim\(\) \|\| defaultSessionName\(form\.target\)/,
    'refusing it made the one field nobody wants to think about the one that fails');
  assert.ok(!/name="session" id="screen-session" required/.test(src), 'so the field is not required either');
});
