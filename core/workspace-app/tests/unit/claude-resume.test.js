/**
 * Resuming a Claude Code session in a screen.
 *
 * A screen that dies — the machine reboots, the terminal closes, `screen -wipe` takes a dead one — does
 * not take the conversation with it: the CLI keeps every session's transcript under
 * ~/.claude/projects/<the directory, slashes turned into dashes>/<session id>.jsonl, and
 * `claude --resume <id>` from that directory picks it back up.
 *
 * The thing that cost a screen to find: what is on disk is TWO things, and only one can be resumed.
 * `<id>.jsonl` is the transcript, and `<id>/` is that session's tool results and subagents — which
 * exists on its own for a session whose transcript was never written. Offering one of those gave a
 * screen that answered "No conversation found with session ID" and died in the same second, which from
 * the dashboard looks exactly like the feature being broken.
 */

const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-home-'));
const realHome = os.homedir;
os.homedir = () => home;
process.on('exit', () => { os.homedir = realHome; fs.rmSync(home, { recursive: true, force: true }); });

const cs = require('../../claude-sessions');

const DIR = '/home/someone/workspace/dev/ha1x00b1';
const SLUG = '-home-someone-workspace-dev-ha1x00b1';
const projectDir = path.join(home, '.claude', 'projects', SLUG);
fs.mkdirSync(projectDir, { recursive: true });

const id = (n) => `${'0'.repeat(8 - String(n).length)}${n}-10da-41df-b92f-51c00661b38c`;
const transcript = (n, lines) => fs.writeFileSync(path.join(projectDir, `${id(n)}.jsonl`), lines);
const userLine = (text) => `${JSON.stringify({ type: 'user', message: { role: 'user', content: text } })}\n`;

test("the CLI's own name for a directory is the absolute path with every slash turned into a dash", () => {
  assert.strictEqual(cs.projectSlug(DIR), SLUG);
  assert.strictEqual(cs.projectSlug('/home/someone/workspace/dev/ha1x00b1/'), SLUG, 'a trailing slash is the same directory');
  assert.strictEqual(cs.projectDirFor(DIR), projectDir);
});

test('a session id is the uuid --resume takes, and nothing else is handed to a shell', () => {
  assert.ok(cs.isSessionId('cc9ce3fd-10da-41df-b92f-51c00661b38c'));
  assert.ok(cs.isSessionId('CC9CE3FD-10DA-41DF-B92F-51C00661B38C'), 'the CLI writes them lowercase but reads either');
  assert.ok(!cs.isSessionId('cc9ce3fd'));
  assert.ok(!cs.isSessionId('$(rm -rf ~)'));
  assert.ok(!cs.isSessionId('../../../etc/passwd'));
  assert.ok(!cs.isSessionId(''));
});

test('a directory with no history at all lists nothing, rather than failing', () => {
  assert.deepStrictEqual(cs.sessionsFor('/home/someone/workspace/dev/never-used'), []);
  assert.strictEqual(cs.hasSessions('/home/someone/workspace/dev/never-used'), false);
});

test('a transcript is resumable; a directory with no transcript is listed but never offered', () => {
  transcript(1, userLine('build me a Webship 11 site'));
  fs.mkdirSync(path.join(projectDir, id(2)), { recursive: true });   // tool results only: --resume finds nothing
  fs.writeFileSync(path.join(projectDir, `${id(3)}.jsonl`), '');      // started and never got going

  const all = cs.sessionsFor(DIR);
  assert.deepStrictEqual(all.map((x) => x.id).sort(), [id(1), id(2), id(3)].sort(), 'all three are on disk');
  assert.deepStrictEqual(all.filter((x) => x.resumable).map((x) => x.id), [id(1)]);

  const offered = cs.sessionsFor(DIR, { resumableOnly: true });
  assert.deepStrictEqual(offered.map((x) => x.id), [id(1)],
    'an id --resume answers "No conversation found" for is a dead end, not a choice');
  assert.strictEqual(cs.hasSessions(DIR), true);
});

test('the title is the first thing the person typed, so two sessions can be told apart', () => {
  transcript(4, userLine('<system-reminder>a reminder</system-reminder> why does the install fail'));
  const one = cs.sessionsFor(DIR).find((x) => x.id === id(4));
  assert.strictEqual(one.title, 'a reminder why does the install fail',
    'the first thing typed, with the markup around it stripped rather than shown');

  transcript(5, `${JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text: 'a list of parts' }] } })}\n`);
  assert.strictEqual(cs.sessionsFor(DIR).find((x) => x.id === id(5)).title, 'a list of parts');

  transcript(6, 'half a line with no closing brace');
  assert.strictEqual(cs.sessionsFor(DIR).find((x) => x.id === id(6)).title, '', 'an unreadable head is no title, not a crash');
});

test('newest first, and limited: the one just left is the one being looked for', () => {
  const now = Date.now();
  for (const n of [1, 4, 5, 6]) {
    const f = path.join(projectDir, `${id(n)}.jsonl`);
    fs.utimesSync(f, new Date(now - n * 60000), new Date(now - n * 60000));
  }
  const list = cs.sessionsFor(DIR, { resumableOnly: true });
  assert.deepStrictEqual(list.map((x) => x.id), [id(1), id(4), id(5), id(6)]);
  assert.strictEqual(cs.sessionsFor(DIR, { limit: 2 }).length, 2);
});

test('the memory directory is not a session', () => {
  fs.mkdirSync(path.join(projectDir, 'memory'), { recursive: true });
  assert.ok(!cs.sessionsFor(DIR).some((x) => x.id === 'memory'));
});

/* ------------------------------------------------------------------ *
 * What the form and the runner do with it
 * ------------------------------------------------------------------ */

const read = (f) => fs.readFileSync(path.join(__dirname, '..', '..', f), 'utf8');
const screens = read('screens.js');
const action = read('actions/screens.js');
const server = read('server.js');

test('only an id that is resumable IN THIS DIRECTORY reaches the command line', () => {
  assert.match(action, /claudeSessions\.isSessionId\(wanted\)/, 'a uuid, so nothing else can be spliced in');
  assert.match(action, /\.some\(\(x\) => x\.id === wanted\)/, "and one this directory actually has");
  assert.match(action, /const wanted = form\.resume_on \? String\(form\.resume \|\| ''\)\.trim\(\) : '';/,
    'a select left on its default must not resume a session nobody asked to resume');
  assert.match(action, /const resumeFlag = resumable \? `--resume \$\{resumable\}` : '';/);
});

test('the screen runs claude in the project directory, and nothing else changes', () => {
  assert.match(action, /exec claude \$\{resumeFlag\} \$\{flags\}/);
  assert.match(action, /No Claude session <code>/, 'an id that cannot be resumed is refused, not silently dropped');
});

test('the list offers only what --resume can open, and says so when there is nothing', () => {
  assert.match(screens, /resumableOnly: true/);
  assert.match(screens, /No Claude session to resume in/);
  assert.match(screens, /no transcript written yet, so <code>--resume<\/code> cannot open/,
    'a session with no transcript is reported rather than quietly missing');
});

test('the select is disabled until the checkbox is ticked, and the newest is preselected', () => {
  assert.match(screens, /type="checkbox" name="resume_on"/);
  assert.match(screens, /<select class="uk-select uk-form-small" name="resume" disabled/);
  assert.match(screens, /s\.disabled=!this\.checked;/);
  assert.match(screens, /\$\{i === 0 \? ' selected' : ''\}/);
});

test('changing the project reloads the list, and that request does not close the modal', () => {
  assert.match(screens, /hx-get="\/fragments\/claude-sessions"/);
  // The place select asks for the list itself now, rather than the row listening for that select to
  // change: the select is re-rendered whenever the workspace changes, and a listener on the row would
  // have been listening for an element that is no longer the same one.
  assert.match(screens, /hx-target="#claude-resume-row"/);
  assert.match(screens, /hx-on::after:request="event\.stopPropagation\(\)"/,
    "the form's own after:request hides the modal — this row's request must not reach it");
  assert.match(server, /\/fragments\/claude-sessions/, 'and the route exists');
});
