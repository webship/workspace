/**
 * Past sessions: a screen session that is gone can still be read, and its Claude Code conversation resumed.
 *
 * Every session the dashboard starts leaves a note (screen-notes.mts), stamped when it is found gone. The Screens
 * modal and page list the notes of the sessions that are not running, with Read (the conversation from its
 * transcript, or the end of a command's log, all of it escaped), Resume (a new screen with `claude --resume <id>`)
 * and Forget. Run against a workspace built here, a HOME of its own (so ~/.claude/projects is a fixture), a
 * `screen` stand-in whose listing the test writes, and a stand-in host runner that answers the dashboard's queue.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { copyConfig } = require('./_isolated-config');

const APP = path.join(__dirname, '../..');
const REPO = path.join(APP, '../..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-past-sessions-'));
const home = path.join(root, 'home');
const bin = path.join(root, 'bin');
const lsFile = path.join(root, 'screen-ls.txt');
fs.mkdirSync(home, { recursive: true });
fs.mkdirSync(bin, { recursive: true });
// What `screen -ls` answers here: written by the test, read by the stand-in.
fs.writeFileSync(lsFile, `No Sockets found in ${root}/sockets.\n`);
fs.writeFileSync(path.join(bin, 'screen'), `#!/bin/sh
case "$1" in --version) echo "Screen version 4.09.01 (stand-in)"; exit 0 ;; -ls) cat ${JSON.stringify(lsFile)}; exit 1 ;; esac
exit 0
`, { mode: 0o755 });
// And a `claude` whose --help is enough for the New screen form to know two options.
fs.writeFileSync(path.join(bin, 'claude'), `#!/bin/sh
cat <<'HELP'
Usage: claude [options] [command] [prompt]

Options:
  --model <model>                  Model for the current session.
  --permission-mode <mode>         Permission mode to use for the session (choices: "manual", "plan")
  -h, --help                       Display help for command
HELP
`, { mode: 0o755 });
process.env.PATH = `${bin}${path.delimiter}${process.env.PATH}`;
process.env.WORKSPACE_ROOT = root;
process.env.HOME = home;

const notes = require('../../screen-notes.mts');
const claudeSessions = require('../../claude-sessions.mts');
const screens = require('../../screens');
const actions = require('../../actions/screens');
const { loadWorkspaces } = require('../../workspaces');

const store = path.join(root, '.screens');
const project = path.join(root, 'dev', 'blog1');
const CONVO = '0b9e5c1a-7d2f-4e3b-9a8c-1f2e3d4c5b6a';
const transcript = () => path.join(home, '.claude', 'projects', project.replace(/\//g, '-'), `${CONVO}.jsonl`);

/** A transcript the way the CLI writes one, with everything a person should not be shown in it as well. */
function writeTranscript() {
  const at = (m) => `2026-11-21T08:${String(m).padStart(2, '0')}:00.000Z`;
  const lines = [
    { type: 'user', message: { role: 'user', content: 'Make the "home" page & the <b>footer</b> faster' }, timestamp: at(0), sessionId: CONVO },
    { type: 'attachment', attachment: { type: 'skill_listing' } },
    { type: 'assistant', timestamp: at(1), message: { role: 'assistant', content: [
      { type: 'thinking', thinking: 'private reasoning that is never shown' },
      { type: 'text', text: 'Looking at it.' },
      { type: 'tool_use', name: 'Bash', input: { command: 'ls -la', description: 'List the files' } },
    ] } },
    { type: 'user', timestamp: at(2), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'a tool answer' }] } },
    { type: 'user', isMeta: true, timestamp: at(2), message: { role: 'user', content: 'Caveat: injected by the CLI' } },
    { type: 'user', isSidechain: true, timestamp: at(2), message: { role: 'user', content: 'a subagent brief' } },
    { type: 'user', timestamp: at(3), message: { role: 'user', content: '<command-name>/model</command-name>\n<command-message>model</command-message>\n<command-args>opus</command-args>' } },
    { type: 'user', timestamp: at(4), message: { role: 'user', content: 'Also <system-reminder>hidden context</system-reminder>check the footer' } },
    { type: 'assistant', timestamp: at(5), message: { role: 'assistant', content: [
      { type: 'text', text: 'Done: <img src=x onerror=alert(1)> "><script>alert(2)</script> ‮evil‬ \x1b[31mred\x1b[0m' },
    ] } },
  ];
  fs.mkdirSync(path.dirname(transcript()), { recursive: true });
  fs.writeFileSync(transcript(), `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
}

// The host runner's two halves the dashboard reads: its published list (fresh = up) and its answers to the queue.
let runnerTimer = null;
const started = [];
let published = [];
function startRunner() {
  const tick = () => {
    fs.mkdirSync(path.join(store, 'queue'), { recursive: true });
    fs.mkdirSync(path.join(store, 'results'), { recursive: true });
    fs.writeFileSync(path.join(store, 'host-sessions.json'), JSON.stringify({ at: Date.now(), sessions: published }));
    for (const f of fs.readdirSync(path.join(store, 'queue')).filter((x) => x.endsWith('.json'))) {
      const req = JSON.parse(fs.readFileSync(path.join(store, 'queue', f), 'utf8'));
      fs.unlinkSync(path.join(store, 'queue', f));
      started.push(req);
      fs.writeFileSync(path.join(store, 'results', `${req.id}.json`), JSON.stringify({ ok: true, session: req.session }));
    }
  };
  tick();
  runnerTimer = setInterval(tick, 50);
}

const call = async (route, form) => {
  let body = '';
  let code = 200;
  const headers = {};
  await actions[route]({ form, send: (html, c = 200) => { body = html; code = c; }, res: { setHeader: (k, v) => { headers[k] = v; } } });
  return { body, code, headers };
};

before(() => {
  fs.mkdirSync(path.join(root, 'core'), { recursive: true });
  copyConfig(path.join(REPO, 'core/config'), path.join(root, 'core/config'));
  fs.symlinkSync(path.join(REPO, 'core/scripts'), path.join(root, 'core/scripts'));
  fs.symlinkSync(APP, path.join(root, 'core/workspace-app'));
  for (const w of Object.values(loadWorkspaces())) fs.mkdirSync(w.dir, { recursive: true });
  fs.mkdirSync(project, { recursive: true });
});

after(() => {
  if (runnerTimer) clearInterval(runnerTimer);
  fs.rmSync(root, { recursive: true, force: true });
});

/* ------------------------------------------------------------------ the notes */

test('a started session leaves a note, readable by this user only, with what it was', () => {
  const note = notes.noteStarted(store, { session: 'dev--blog1--a1b2', dir: project, workspace: 'dev', project: 'blog1',
    kind: 'claude', what: 'claude --model opus', claude: CONVO.toUpperCase(), flags: ['--model', 'opus'] }, 1763712000000);
  assert.strictEqual(note.id, '1763712000000-dev--blog1--a1b2');
  assert.strictEqual(note.claude, CONVO, 'the id is kept in the shape the CLI writes its file under');
  const file = path.join(store, 'notes', `${note.id}.json`);
  assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600);
  assert.strictEqual(fs.statSync(path.join(store, 'notes')).mode & 0o777, 0o700);
  assert.deepStrictEqual(notes.readNote(store, note.id), note);
  assert.strictEqual(note.ended, 0);
  assert.strictEqual(notes.noteStarted(store, { session: '-S', dir: project }), null, 'a name screen would read as an option is not noted');
  assert.strictEqual(notes.noteStarted(store, { session: 'a/../../x', dir: project }), null);
  notes.forgetNote(store, note.id);
});

test('a note id is checked before it becomes a path', () => {
  for (const bad of ['', '../x', '1763712000000-../../etc', '1763712000000-a/b', 'x.json', '123-a']) {
    assert.strictEqual(notes.isNoteId(bad), false, bad);
    assert.strictEqual(notes.readNote(store, bad), null, bad);
    assert.strictEqual(notes.forgetNote(store, bad), false, bad);
  }
});

test('the conversation id is read from a claude line, and only from one', () => {
  assert.strictEqual(notes.claudeIdIn(`exec env A='b' claude --session-id ${CONVO} --model opus`), CONVO);
  assert.strictEqual(notes.claudeIdIn(`exec claude --resume ${CONVO}`), CONVO);
  assert.strictEqual(notes.claudeIdIn(`cd x && claude --resume=${CONVO}`), CONVO);
  assert.strictEqual(notes.claudeIdIn(`ddev drush --resume ${CONVO}`), '', 'not claude');
  assert.strictEqual(notes.claudeIdIn('exec claude --model opus'), '', 'claude with no id');
  assert.strictEqual(notes.claudeIdIn(`exec claude --resume ${CONVO}-extra`), '', 'not a whole id');
});

test('two starts of one name in one millisecond are two notes, and a new run closes the one before it', () => {
  const a = notes.noteStarted(store, { session: 'dev--twice', dir: project }, 1763712100000);
  const b = notes.noteStarted(store, { session: 'dev--twice', dir: project }, 1763712100000);
  assert.notStrictEqual(a.id, b.id);
  const older = notes.readNote(store, a.id);
  assert.strictEqual(older.end, 'gone', 'screen runs one session of a name: the earlier run is over');
  assert.strictEqual(older.ended, b.started);
  assert.strictEqual(notes.readNote(store, b.id).ended, 0);
  notes.forgetNote(store, a.id);
  notes.forgetNote(store, b.id);
});

test('settling tells a session seen ending from one that went while nobody was looking', () => {
  const now = 1763713000000;
  const seenEnd = notes.noteStarted(store, { session: 'dev--seen', dir: project }, now - 600000);
  const unseen = notes.noteStarted(store, { session: 'dev--unseen', dir: project }, now - 900000);
  const stale = notes.noteStarted(store, { session: 'dev--stale', dir: project }, now - 7200000);
  const running = notes.noteStarted(store, { session: 'dev--running', dir: project }, now - 300000);
  const seen = new Map([['dev--seen', now - 30000], ['dev--stale', now - 3600000], ['dev--running', now - 1000]]);
  const changed = notes.settle(store, ['dev--running'], { seen, now, lastSignOf: (n) => (n.session === 'dev--unseen' ? now - 700000 : 0) });
  assert.strictEqual(changed, 3);
  assert.deepStrictEqual(pick(notes.readNote(store, seenEnd.id)), { ended: now, end: 'seen', lastSign: 0 });
  assert.deepStrictEqual(pick(notes.readNote(store, unseen.id)), { ended: now, end: 'gone', lastSign: now - 700000 });
  // Seen an hour ago and gone now: when in that hour is not known, so it is not called seen.
  assert.deepStrictEqual(pick(notes.readNote(store, stale.id)), { ended: now, end: 'gone', lastSign: now - 3600000 });
  assert.strictEqual(notes.readNote(store, running.id).ended, 0, 'a running session is not over');
  // A runner that was down comes back: the session it lists again was never over.
  notes.settle(store, [], { seen: new Map(), now: now + 1000 });
  assert.ok(notes.readNote(store, running.id).ended);
  notes.settle(store, ['dev--running'], { seen: new Map(), now: now + 2000 });
  assert.deepStrictEqual(pick(notes.readNote(store, running.id)), { ended: 0, end: '', lastSign: 0 });
  const past = notes.pastNotes(store, ['dev--running']).map((n) => n.session);
  assert.deepStrictEqual(past, ['dev--seen', 'dev--unseen', 'dev--stale'], 'past, newest first, and never the running one');
  for (const n of [seenEnd, unseen, stale, running]) notes.forgetNote(store, n.id);
});

const pick = (n) => ({ ended: n.ended, end: n.end, lastSign: n.lastSign });

test('only the newest notes are kept', () => {
  for (let i = 0; i < notes.KEEP + 5; i += 1) notes.noteStarted(store, { session: `dev--many-${i}`, dir: project }, 1763714000000 + i);
  const all = notes.allNotes(store);
  assert.strictEqual(all.length, notes.KEEP);
  assert.strictEqual(all[0].session, `dev--many-${notes.KEEP + 4}`);
  assert.ok(!all.some((n) => n.session === 'dev--many-0'), 'the oldest went');
  for (const n of all) notes.forgetNote(store, n.id);
});

/* ------------------------------------------------------------------ the conversation */

test('a transcript reads back as what was typed and answered, and the tools in between, nothing else', () => {
  writeTranscript();
  const { turns, total, cut, missing } = claudeSessions.readConversation(transcript());
  assert.strictEqual(missing, false);
  assert.strictEqual(cut, false);
  assert.strictEqual(total, 5);
  assert.deepStrictEqual(turns.map((t) => t.who), ['you', 'claude', 'you', 'you', 'claude']);
  assert.strictEqual(turns[0].text, 'Make the "home" page & the <b>footer</b> faster', 'what was typed, tags and all: escaping is the page\'s job');
  assert.deepStrictEqual(turns[1].tools, ['Bash · List the files']);
  assert.strictEqual(turns[2].text, '/model opus', 'a slash command as it was typed');
  assert.strictEqual(turns[3].text, 'Also check the footer', 'what the CLI added to a typed line is not shown');
  const all = JSON.stringify(turns);
  for (const hidden of ['private reasoning', 'a tool answer', 'Caveat: injected', 'a subagent brief', 'hidden context']) {
    assert.ok(!all.includes(hidden), `${hidden} stays out`);
  }
  assert.strictEqual(claudeSessions.readConversation(path.join(home, 'nothing.jsonl')).missing, true);
});

test('a long transcript is read from its end only', () => {
  const r = claudeSessions.readConversation(transcript(), { maxBytes: 400 });
  assert.strictEqual(r.cut, true);
  assert.ok(r.turns.length >= 1 && r.turns.length < 5);
  assert.strictEqual(r.turns[r.turns.length - 1].who, 'claude');
});

/* ------------------------------------------------------------------ the page */

let convoNote;
let commandNote;

test('the Past sessions list shows a gone session with Read, Resume and Forget', async () => {
  writeTranscript();
  convoNote = notes.noteStarted(store, { session: 'dev--blog1--c0de', dir: project, workspace: 'dev', project: 'blog1', kind: 'claude',
    what: 'claude --model opus (with an opening prompt)', claude: CONVO, flags: ['--model', 'opus'] }, Date.now() - 60000);
  fs.writeFileSync(path.join(store, 'dev--blog1--build.log'), 'Step 1\n\x1b[32mBuilt.\x1b[0m <b>done</b>\n');
  commandNote = notes.noteStarted(store, { session: 'dev--blog1--build', dir: project, workspace: 'dev', project: 'blog1',
    kind: 'command', what: 'bash cmd-build.sh <x>' }, Date.now() - 50000);
  const html = await screens.pastSessionsHtml();
  assert.match(html, /<h2 class="uk-h4 screens-past-title" id="screens-past-title" tabindex="-1">Past sessions/);
  assert.match(html, /<ul class="screens-past-list" aria-labelledby="screens-past-title">/);
  const row = html.slice(html.indexOf(`data-note="${convoNote.id}"`));
  assert.match(row, /hx-get="\/fragments\/screen-note\/[0-9]{13}-dev--blog1--c0de"[^>]*hx-target="#editor-modal-body"/);
  assert.match(row, /hx-post="\/actions\/screen-resume"[^>]*hx-target="previous \.screens-past-result"/);
  assert.match(row, /hx-post="\/actions\/screen-forget"[^>]*hx-target="closest \.screens-past"/);
  assert.match(row, /aria-label="Read dev--blog1--c0de, started [^"]+"/, 'each verb names the session it acts on');
  assert.match(row, /“Make the &quot;home&quot; page &amp; the footer faster”/, 'the first message is the title, escaped');
  const cmdRow = html.slice(html.indexOf(`data-note="${commandNote.id}"`));
  assert.ok(!cmdRow.slice(0, cmdRow.indexOf('</li>')).includes('screen-resume'), 'a command is not a conversation to resume');
  assert.match(cmdRow, /<code>bash cmd-build\.sh &lt;x&gt;<\/code>/);
  // The modal and the page carry the same section, which refreshes itself when a session starts or ends.
  const section = await screens.pastSessionsSectionHtml();
  assert.match(section, /^<div class="screens-past-result" aria-live="polite"><\/div>/);
  assert.match(section, /<section id="screens-past" class="screens-past" aria-labelledby="screens-past-title"\s+hx-get="\/fragments\/screens-past" hx-trigger="screens-changed from:body, every 60s"/);
});

test('Read shows the conversation in the modal, escaped and stripped, never as markup', async () => {
  const html = await screens.sessionNoteHtml(convoNote.id);
  assert.match(html, /<h3 class="uk-margin-small-bottom" id="screen-note-title" tabindex="-1">dev--blog1--c0de: the conversation<\/h3>/);
  assert.match(html, /<ol class="screen-note-turns" aria-label="The conversation">/);
  assert.match(html, /data-screen-note-back="[0-9]{13}-dev--blog1--c0de"/, 'a way back to the list');
  assert.match(html, /Done: &lt;img src=x onerror=alert\(1\)&gt; &quot;&gt;&lt;script&gt;alert\(2\)&lt;\/script&gt;/);
  assert.ok(!/<img|<script|<b>/i.test(html), 'nothing from the transcript is markup');
  assert.ok(!html.includes('‮') && !html.includes('\x1b'), 'no bidirectional override and no terminal escape');
  assert.match(html, /<li>Bash · List the files<\/li>/);
  assert.match(html, /<code>cd [^<]*dev\/blog1 &amp;&amp; claude --resume 0b9e5c1a-7d2f-4e3b-9a8c-1f2e3d4c5b6a<\/code>/, 'the line to resume it in a terminal');
  assert.match(html, /Make the &quot;home&quot; page &amp; the &lt;b&gt;footer&lt;\/b&gt; faster/, 'what was typed, escaped');
});

test('Read on a command shows the end of its log, escaped and without its colours', async () => {
  const html = await screens.sessionNoteHtml(commandNote.id);
  assert.match(html, /dev--blog1--build: its log/);
  assert.match(html, /<pre class="terminal-pre screen-note-log" tabindex="0" aria-label="The end of its log">Step 1\nBuilt\. &lt;b&gt;done&lt;\/b&gt;/);
  assert.match(await screens.sessionNoteHtml('1763712000000-no-such'), /No such past session/);
});

test('New screen notes what it started: Claude Code with its id chosen at the start, and a command logged once', async () => {
  startRunner();
  const claude = await call('/actions/screen-new', { target: 'p:dev:blog1', kind: 'claude', session: 'n3w1', arg_model: 'opus', arg_permission_mode: 'plan', command: 'Look around' });
  assert.strictEqual(claude.code, 200, claude.body);
  const cReq = started[started.length - 1];
  const id = (cReq.cmd.match(/ claude --session-id ([0-9a-f-]{36}) /) || [])[1];
  assert.ok(id, `a new conversation gets its id on the line: ${cReq.cmd}`);
  const cNote = notes.allNotes(store).find((n) => n.session === 'dev--blog1--n3w1');
  assert.strictEqual(cNote.kind, 'claude');
  assert.strictEqual(cNote.claude, id, 'the note knows the conversation from the first second');
  assert.deepStrictEqual(cNote.flags, ['--model', 'opus', '--permission-mode', 'plan']);
  assert.strictEqual(cNote.what, 'claude --model opus --permission-mode plan (with an opening prompt)');
  assert.ok(!cNote.what.includes('Look around'), 'the prompt itself stays in its private file');

  const cmd = await call('/actions/screen-new', { target: 'p:dev:blog1', kind: 'command', session: 'n3w2', command: 'echo one; echo two' });
  assert.strictEqual(cmd.code, 200, cmd.body);
  const kReq = started[started.length - 1];
  assert.match(kReq.cmd, /; \{ echo one; echo two ; \}$/);
  assert.ok(!/tee/.test(kReq.cmd), 'the runner logs it; teed here as well, every line was in the log twice');
  const kNote = notes.allNotes(store).find((n) => n.session === 'dev--blog1--n3w2');
  assert.deepStrictEqual([kNote.kind, kNote.what, kNote.claude], ['command', 'echo one; echo two', '']);
  for (const n of [cNote, kNote]) notes.forgetNote(store, n.id);
});

test('a row, a build or a tool that starts a session notes it, and a claude line as the conversation it opens', async () => {
  const { startInScreen } = require('../../jobs');
  const cmd = await startInScreen({ workspace: 'dev', project: 'blog1', projectDir: project, verb: 'describe', cmdLine: 'ddev describe', label: 'ddev describe' });
  assert.ok(cmd.ok, JSON.stringify(cmd));
  const cNote = notes.allNotes(store).find((n) => n.session === 'dev--blog1--describe');
  assert.deepStrictEqual([cNote.kind, cNote.what, cNote.dir, cNote.workspace, cNote.project], ['command', 'ddev describe', project, 'dev', 'blog1']);
  const ai = await startInScreen({ workspace: 'dev', project: 'blog1', projectDir: project, verb: 'agent', cmdLine: `exec claude --resume ${CONVO}`, label: 'Claude Code' });
  assert.ok(ai.ok, JSON.stringify(ai));
  const aNote = notes.allNotes(store).find((n) => n.session === 'dev--blog1--agent');
  assert.deepStrictEqual([aNote.kind, aNote.claude], ['claude', CONVO]);
  for (const n of [cNote, aNote]) notes.forgetNote(store, n.id);
});

test('Resume starts a new screen with claude --resume, in the folder it ran in, with the options it had', async () => {
  const r = await call('/actions/screen-resume', { note: convoNote.id });
  assert.strictEqual(r.code, 200, r.body);
  const req = started[started.length - 1];
  assert.strictEqual(req.action, 'start');
  assert.strictEqual(req.session, 'dev--blog1--c0de', 'its own name, which is free');
  assert.strictEqual(req.dir, project);
  assert.strictEqual(req.cmd, `exec env WEBSHIP_WORKSPACE='dev' WEBSHIP_PROJECT='blog1' WEBSHIP_WORKSPACE_DIR='${project}' claude --resume ${CONVO} --model opus`);
  assert.match(r.body, /Resumed “Make the &quot;home&quot; page &amp; the footer faster” in a new screen/);
  assert.match(r.body, /data-open-terminal="dev--blog1--c0de"/);
  assert.match(String(r.headers['HX-Trigger']), /screens-changed/);
  const fresh = notes.allNotes(store).find((n) => n.session === 'dev--blog1--c0de' && n.id !== convoNote.id);
  assert.strictEqual(fresh.resumedFrom, convoNote.id, 'the new run is noted, and says where it came from');
  assert.strictEqual(fresh.claude, CONVO);
});

test('Resume refuses a conversation that is open in a running screen, one with no transcript, and a tampered note', async () => {
  const before = started.length;
  // The resumed one is running now (the runner lists it): a second Claude Code on one conversation is refused.
  published = [{ pid: '4242', session: 'dev--blog1--c0de', started: 'now', state: 'Detached' }];
  await new Promise((r) => { setTimeout(r, 120); });
  const open = await call('/actions/screen-resume', { note: convoNote.id });
  assert.strictEqual(open.code, 409);
  assert.match(open.body, /That conversation is open in <strong>dev--blog1--c0de<\/strong> already/);
  assert.match(open.body, /data-open-terminal="dev--blog1--c0de"/);
  published = [];
  await new Promise((r) => { setTimeout(r, 120); });

  const none = notes.noteStarted(store, { session: 'dev--blog1--n0ne', dir: project, kind: 'claude', claude: '11111111-2222-4333-8444-555555555555' });
  const noTranscript = await call('/actions/screen-resume', { note: none.id });
  assert.strictEqual(noTranscript.code, 409);
  assert.match(noTranscript.body, /has no transcript/);

  const tampered = notes.noteStarted(store, { session: 'dev--blog1--t4mp', dir: project, kind: 'claude', claude: CONVO, flags: ['--model', 'opus;rm -rf ~'] });
  const bad = await call('/actions/screen-resume', { note: tampered.id });
  assert.strictEqual(bad.code, 400);
  const outside = notes.noteStarted(store, { session: 'dev--blog1--0ut', dir: '/etc', kind: 'claude', claude: CONVO });
  assert.strictEqual((await call('/actions/screen-resume', { note: outside.id })).code, 409);
  assert.strictEqual((await call('/actions/screen-resume', { note: commandNote.id })).code, 400, 'a command is not a conversation');
  assert.strictEqual((await call('/actions/screen-resume', { note: '../../x' })).code, 404);
  assert.strictEqual(started.length, before, 'none of them started anything');
  for (const n of [none, tampered, outside]) notes.forgetNote(store, n.id);
});

test('Forget takes a note off the list and leaves the conversation and the log where they are', async () => {
  const r = await call('/actions/screen-forget', { note: commandNote.id });
  assert.strictEqual(r.code, 200);
  assert.ok(!r.body.includes(commandNote.id), 'off the list it answers with');
  assert.strictEqual(notes.readNote(store, commandNote.id), null);
  assert.ok(fs.existsSync(path.join(store, 'dev--blog1--build.log')), 'the log stays');
  assert.ok(fs.existsSync(transcript()), 'the transcript stays');
  assert.strictEqual((await call('/actions/screen-forget', { note: commandNote.id })).code, 200, 'twice is still off the list');
});

/* ------------------------------------------------------------------ the wiring */

const read = (f) => fs.readFileSync(path.join(APP, f), 'utf8');

test('every way a session starts leaves a note', () => {
  const action = read('actions/screens.js');
  assert.match(action, /screenNotes\.noteStarted\(logDir, \{\n\s+session: fullSession, dir,/, 'New screen');
  assert.match(action, /claudeId = resumable \|\| crypto\.randomUUID\(\);/, 'a new conversation gets its id at the start');
  const jobs = read('jobs.js');
  assert.match(jobs, /if \(started && started\.ok\) \{[\s\S]*?const notes = require\('\.\/screen-notes\.mts'\);[\s\S]*?notes\.noteStarted\(/, 'every command a row, a build or a tool starts');
  assert.match(read('actions/claude-session.js'), /require\('\.\.\/screen-notes\.mts'\)\.noteStarted\(/, 'Resume Claude Code in a SCREENS menu');
  assert.match(read('build-ai.js'), /claude --session-id \$\{claudeId\}/, 'Claude Code after a build');
  assert.match(read('scripts/screen-then.js'), /noteStarted\(path\.join\(ROOT, '\.screens'\)/);
});

test('the list is in the Screens modal and on the Screens page, and its routes exist', () => {
  const server = read('server.js');
  assert.match(server, /<div id="webship-workspace-projects" hx-get="\/fragments\/screens-grid" hx-trigger="screens-changed from:body">\$\{await screensGridHtml\(\)\}<\/div>\n\s+\$\{await require\('\.\/screens'\)\.pastSessionsSectionHtml\(\)\}/, 'the modal');
  assert.match(server, /\$\{await screensGridHtml\(\)\}\n\s+<\/div>\n\s+\$\{await require\('\.\/screens'\)\.pastSessionsSectionHtml\(\)\}`/, 'the page');
  assert.match(server, /pathname === '\/fragments\/screens-past'/);
  assert.match(server, /\/\^\\\/fragments\\\/screen-note\\\/\(\[0-9\]\{13\}-\[a-z0-9\]\[a-zA-Z0-9\._-\]\{0,59\}\)\$\//);
  assert.match(read('screens.js'), /if \(own\.sure \|\| published\) settleNotes\(all\);/, 'stamped from the one list every view reads');
});

test('focus follows the person through Read, Back, Forget and Resume', () => {
  const ui = read('public/ui.js');
  assert.match(ui, /focusInModalSoon\(el\.querySelector\('#screen-note-title'\)\)/, 'into the conversation when it opens');
  assert.match(ui, /if \(!from\.inModal\) \{ try \{ window\.UIkit\.modal\('#editor-modal'\)\.hide\(\); \}/, 'Back from the page closes the modal');
  assert.match(ui, /window\.htmx\.ajax\('GET', '\/fragments\/screens', \{ target: '#editor-modal-body', swap: 'innerHTML' \}\);\n\}\);/, 'Back in the modal shows the list');
  assert.match(ui, /\(row && row\.querySelector\('\.screens-past-read'\)\) \|\| el\.querySelector\('#screens-past-title'\)/, 'back on the Read button it left from');
  assert.match(ui, /const open = opens\[opens\.length - 1\];\n\s+if \(open\) open\.focus\(\);/, 'Open terminal after Resume');
  const css = read('public/css/components/past-sessions.css');
  assert.match(css, /\.screen-note-said \{ white-space: pre-wrap; overflow-wrap: anywhere; \}/, 'a long line wraps on a phone');
});

test('a session starts clean of the Claude Code session that started the runner or the dashboard', () => {
  // With CLAUDE_CODE_CHILD_SESSION and the rest inherited, Claude Code in a screen took itself for that session's
  // child and saved no transcript: nothing to read and nothing to resume once it was gone.
  const { sessionEnv, PARENT_SESSION_VARS } = require('../../session-env.mts');
  const env = sessionEnv({ PATH: '/bin', HOME: '/h', CLAUDECODE: '1', CLAUDE_CODE_CHILD_SESSION: '1', CLAUDE_CODE_SESSION_ID: 'x',
    CLAUDE_CODE_MESSAGING_SOCKET: '/run/s.sock', CLAUDE_CODE_MESSAGING_TOKEN: 't', CLAUDE_PID: '1', CLAUDE_CODE_USE_BEDROCK: '1', ANTHROPIC_MODEL: 'm' });
  assert.deepStrictEqual(env, { PATH: '/bin', HOME: '/h', CLAUDE_CODE_USE_BEDROCK: '1', ANTHROPIC_MODEL: 'm' }, 'the user\'s own settings stay');
  assert.ok(PARENT_SESSION_VARS.includes('CLAUDE_CODE_CHILD_SESSION'));
  assert.match(read('scripts/screen-runner.js'), /const SESSION_ENV = \{ \.\.\.require\(path\.join\(__dirname, '\.\.', 'session-env\.mts'\)\)\.sessionEnv\(process\.env\), TERM: 'xterm-256color' \};/);
  assert.match(read('jobs.js'), /\{ timeoutMs: 30 \* 1000, env: require\('\.\/session-env\.mts'\)\.sessionEnv\(jobEnv\(\)\) \}/);
});
