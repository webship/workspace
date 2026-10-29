/**
 * The Claude Code runs a Jira workitem has had, and what may be said about them on the workitem.
 *
 * Two things this is careful about, and both are about not asserting more than is true:
 *
 *   - **a local CLI session has no page on claude.ai.** `claude --cloud` sessions do — the CLI's own
 *     help attaches to one "by session ID or claude.ai/code URL" — but those run on Anthropic's
 *     infrastructure and cannot touch a DDEV project, which is the whole job here. So the comment
 *     offers the session's real identity and says plainly where it lives.
 *   - **the conversation id is not known when the session starts.** `exec claude` writes its first
 *     transcript line a second or two later, and the directory may already hold transcripts from
 *     earlier runs — so an id is only claimed when it appeared AFTER this run began.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { ROOT } = require('../../workspaces');
const runs = require('../../jira-sessions');
const screens = fs.readFileSync(path.join(__dirname, '../../screens.js'), 'utf8');
const screenActions = fs.readFileSync(path.join(__dirname, '../../actions/screens.js'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8');

const SESSION = 'test--unit--jira-unit-1';
const KEY = 'UNIT-1';
const clean = () => { try { fs.unlinkSync(runs.noteFile(SESSION)); } catch (_) { /* gone */ } };

test('a workitem key is read back out of a session name', () => {
  assert.equal(runs.keyOfSession('dev--blog1--jira-webship-2199'), 'WEBSHIP-2199');
  assert.equal(runs.keyOfSession('dev--blog1--build'), '', 'an ordinary session belongs to no workitem');
});

test('every run is noted, so a FINISHED one is still listed', () => {
  // `screen -ls` answers only for the ones still running; without the note, a run that ended left
  // nothing that maps a conversation back to the task.
  clean();
  runs.recordRun(SESSION, { key: KEY, workspace: 'test', project: 'unit', dir: '/nowhere' });
  const list = runs.runsFor(KEY, []);
  assert.equal(list.length, 1);
  assert.equal(list[0].live, false, 'not running, and still listed');
  clean();
});

test('live runs come first, and a live session with no note is still a run', () => {
  clean();
  runs.recordRun(SESSION, { key: KEY, workspace: 'test', project: 'unit', dir: '/nowhere' });
  const live = [
    { session: 'dev--x--jira-unit-1', state: 'Detached' },       // running, never noted
    { session: 'dev--y--jira-unit-1', state: 'Dead ???' },       // a dead socket is not a run
  ];
  const list = runs.runsFor(KEY, live);
  assert.equal(list.length, 2, 'the noted one and the live-but-unnoted one; not the dead socket');
  assert.equal(list[0].live, true, 'live first');
  clean();
});

test('a conversation id is claimed only when it appeared after the run began', () => {
  // The directory may already hold transcripts from earlier runs, and `claude --resume` on one of
  // those opens somebody else's conversation.
  const dir = path.join(ROOT, 'dev', 'v11x00b1gleap');
  if (!fs.existsSync(dir)) return;
  assert.equal(runs.claudeIdFor(dir, Date.now() + 60000), '', 'nothing is newer than the future');
  assert.equal(runs.claudeIdFor('/nowhere', 0), '', 'no directory, no claim');
});

test('the checkbox is off, and says exactly what it posts', () => {
  // A Jira comment is visible to everyone on the workitem: a run meant to stay quiet must not become
  // public as a side effect of starting it.
  const box = screens.slice(screens.indexOf('name="comment_session"') - 400, screens.indexOf('name="comment_session"') + 600);
  assert.doesNotMatch(box, /name="comment_session" value="1"\s+checked/, 'unticked when the form opens');
  assert.match(box, /never the transcript/, 'the label says what it does NOT post');
  assert.match(box, /no page on claude\.ai/, 'and that there is no such link to expect');
});

test('what is posted is built here, and carries no transcript', () => {
  const body = screenActions.slice(screenActions.indexOf('const body = ['), screenActions.indexOf("].join('\\n')"));
  assert.match(body, /session: /);
  assert.match(body, /watch it: \$\{where\}/);
  assert.match(body, /claude --resume/);
  assert.match(body, /not on claude\.ai/, 'it says where the session actually lives');
  // Nothing from the agent, the workitem or a model reaches the comment.
  assert.doesNotMatch(body, /stdout|transcript|tail|output/i);
});

test('the row lists every run, not only the one that is up', () => {
  assert.match(server, /jiraRuns\.runsFor\(it\.key, screenRows\)/);
  assert.match(server, /runs\.length\} run\$\{runs\.length === 1 \? '' : 's'\}/);
  // A dead socket is not a run, which is decided in runsFor and asserted above.
  assert.match(server, /const screenRows = screens\.split/);
});
