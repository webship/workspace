/**
 * The workitem an agent is working, on the project row.
 *
 * A workspace page says which projects have an agent running in them. It did not say what any of them
 * was FOR — and when the agent was started against a Jira workitem, that is the one thing the row is
 * missing: the key is what names the work, links to the description, and tells you whether the running
 * session is the one you are waiting for.
 *
 * The key is read from the SESSION NAME (`dev--blog1--jira-varbase-2199`), not from a store, so a
 * session started by hand from the CLI shows up exactly like one started from the dashboard.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const jiraRuns = require('../../jira-sessions');

const server = fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8');

test('the key comes out of the session name, in the shape Jira writes it', () => {
  assert.equal(jiraRuns.keyOfSession('dev--blog1--jira-varbase-2199'), 'VARBASE-2199');
  // A session name carries the project too, so the key has to be found in the middle as well as at
  // the end.
  assert.equal(jiraRuns.keyOfSession('test--ruverify1--jira-varbase-9999--2'), 'VARBASE-9999');
});

test('a session that is not about a workitem has no key', () => {
  // Most screens are not Jira runs; a badge guessed from a name that merely contains digits would put
  // a wrong workitem on a row, which is worse than none.
  assert.equal(jiraRuns.keyOfSession('dev--blog1--claude'), '');
  assert.equal(jiraRuns.keyOfSession('dev--blog1--jira-2199'), '');
  assert.equal(jiraRuns.keyOfSession(''), '');
  assert.equal(jiraRuns.keyOfSession(undefined), '');
});

test('the row lists live sessions only, once each', () => {
  // A finished run belongs to the workitem's own row on the Jira page. A project row that kept listing
  // last week's keys would be a history nobody asked for, and two windows on one workitem is one key.
  const block = server.slice(server.indexOf('const workKeys = ['), server.indexOf('const keysBadge ='));
  assert.match(block, /new Set\(/, 'deduplicated');
  assert.match(block, /!\/dead\/i\.test\(x\.state \|\| ''\)/, 'live sessions only');
  assert.match(block, /jiraRuns\.keyOfSession\(x\.session\)/);
});

test('the key is small text that opens the workitem in Jira', () => {
  // The description, the comments and whoever else is on it are in Jira, not in a modal here — and the
  // site is the configured one, not a hardcoded host.
  const block = server.slice(server.indexOf('const jiraSiteUrl ='), server.indexOf('res.writeHead(200', server.indexOf('const keysBadge =')));
  assert.match(block, /\(loadSettings\(\)\.jira \|\| \{\}\)\.site/, 'the configured Jira site');
  assert.match(block, /\/browse\/\$\{encodeURIComponent\(k\)\}/);
  assert.match(block, /target="_blank" rel="noopener"/);
  const css = fs.readFileSync(path.join(__dirname, '../../public/css/components/project-rows.css'), 'utf8');
  // Small text, and prefixed with the cluster because UIKit is linked after this stylesheet and a
  // single class of ours loses the tie — which is what left it rendering as grey meta text.
  assert.match(css, /\.project-note-corner \.jira-key \{[^}]*font-size: \.7\d?rem/);
  assert.match(css, /\.project-note-corner \.jira-key \{[^}]*color: var\(--link\)/, 'the link token, which lightens after dark');
});

test('it sits beside the pen, not on the name line', () => {
  // On the name line it was a third badge competing with the agent badge and the DDEV state for the
  // one line the eye scans a list of thirty cards for.
  const agentBadge = server.slice(server.indexOf('const agentBadge ='), server.indexOf('const jiraSiteUrl ='));
  assert.ok(!agentBadge.includes('jira-key'), 'not in the name-line badge any more');
  const corner = server.slice(server.indexOf('const noteCorner ='), server.indexOf('const extraRows ='));
  // `project-note-corner` starts with `project-note`, so the pen is found by the button's own class.
  assert.ok(corner.indexOf('project-jira-keys') < corner.indexOf('uk-button-link project-note'), 'to the left of the pen');
});

test('the key is swapped out of band on every poll, so it can go away again', () => {
  // Sent always, empty when there is none: an OOB swap that is only sent sometimes leaves the last
  // answer standing after the agent has finished.
  const block = server.slice(server.indexOf('const keysBadge ='));
  assert.match(block.slice(0, 300), /hx-swap-oob="true"/);
  assert.match(server, /\+ hand \+ agentBadge \+ keysBadge\)/, 'sent with the poll the row already makes');
});
