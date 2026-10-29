/**
 * The Teamwork Graph CLI: kept current, and honest when it is not.
 *
 * Two failures, one symptom. The container bind-mounted the twg BINARY, and a single-file bind mount
 * binds an inode — so `twg update` on the host wrote a new file, the container went on running the
 * old one, and the dashboard was stuck on a version the Jira server had stopped accepting. All the
 * page said was "No open tasks matched — twg said: <400 bytes of CLI output>", which reads like an
 * empty backlog, and the CLI's own advice ("run twg update") had already been followed.
 *
 * So: the bin DIRECTORY is mounted and `twg` on PATH is a wrapper, so an update is live immediately;
 * and when twg does refuse on its version, the dashboard says so in its own words and names both
 * halves of the fix.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const jira = require('../../jira');

const APP = path.join(__dirname, '../..');
const compose = fs.readFileSync(path.join(APP, '.ddev/docker-compose.twg.yaml'), 'utf8');
const dockerfile = fs.readFileSync(path.join(APP, '.ddev/web-build/Dockerfile.workspace-app'), 'utf8');
const server = fs.readFileSync(path.join(APP, 'server.js'), 'utf8');
const jiraSrc = fs.readFileSync(path.join(APP, 'jira.js'), 'utf8');

// What the CLI actually printed, the day this was found.
const REAL = 'Update required: Please run `twg update`: this CLI is running v1.2.7, '
  + 'below the minimum supported version v1.3.1. Update Required to apply critical fixes.';

test('the refusal is recognised, and both versions read out of it', () => {
  assert.deepEqual(jira.twgUpdateNeeded(REAL), { running: '1.2.7', minimum: '1.3.1' });
  // The minimum is the SERVER's to decide, so it is read from what twg says rather than pinned in
  // this code, where it would go stale the next time the minimum moves. Comments are stripped first:
  // the example in the docblock above the parser quotes the very versions this is looking for.
  const code = jiraSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/\b\d+\.\d+\.\d+\b/.test(code), 'no version number is hardcoded in the gate');
});

test('it still reads when the CLI hard-wraps its prose', () => {
  // twg wraps to the terminal width, so anything matched across the whole sentence fails on a narrow
  // one — the lesson the AUTH_REQUIRED matcher beside it already learned.
  const wrapped = 'Update required: this CLI is running v1.2.7,\nbelow the minimum supported\nversion v1.3.1.';
  assert.deepEqual(jira.twgUpdateNeeded(wrapped), { running: '1.2.7', minimum: '1.3.1' });
  // A version at the end of a sentence must not take the full stop with it.
  assert.equal(jira.twgUpdateNeeded('running v2.0, minimum supported version v2.5.').minimum, '2.5');
});

test('every other failure is left alone', () => {
  // Being signed out, or finding nothing, is not a version problem — and reporting one would send
  // somebody to update a CLI that is already current.
  for (const other of ['AUTH_REQUIRED: authentication required', 'no issues found', '', undefined]) {
    assert.equal(jira.twgUpdateNeeded(other), null, String(other));
  }
});

test('the message names both halves of the fix', () => {
  const hint = jira.twgUpdateHint(jira.twgUpdateNeeded(REAL));
  assert.match(hint, /running twg 1\.2\.7/, 'what it is on');
  assert.match(hint, /needs 1\.3\.1/, 'what it needs');
  assert.match(hint, /twg update/, "the CLI's own fix");
  // And the half the CLI cannot know about: a container created before this change mounted the
  // binary itself, so it keeps running the file it started with until it is recreated.
  assert.match(hint, /ddev restart/);
  // It reads without the versions too — an unparsed message is still worth acting on.
  assert.match(jira.twgUpdateHint(null), /^On the host, run: twg update\./);
});

test('the version failure outranks the login one', () => {
  // twg refuses on its version BEFORE it looks at the session, so every other reason is unreachable
  // until this one is dealt with. Reporting "not signed in" would send somebody to log in again and
  // watch it fail for a reason nothing mentioned.
  const reason = jiraSrc.slice(jiraSrc.indexOf('function twgAuthReason()'));
  const stale = reason.indexOf('_twgStale');
  const login = reason.indexOf('twgSessionFileExists');
  assert.ok(stale > 0 && stale < login, 'checked first');
});

test('the workitems list says it, instead of printing the CLI at the reader', () => {
  const branch = server.slice(server.indexOf("const said = String(out.stderr || out.stdout || '');"));
  assert.match(branch, /const stale = twgNoteOutput\(said\);/);
  assert.match(branch, /The Teamwork Graph CLI is out of date/);
  assert.ok(branch.indexOf('twgNoteOutput') < branch.indexOf('twgNeedsLogin'), 'before the login branch');
  // And the row's disabled button says which of the three it is.
  assert.match(server, /twgIsStale\(\) \? 'twg out of date' : 'twg not signed in'/);
});

test('the container follows the host binary instead of pinning it', () => {
  // A single-file bind mount binds an inode: `twg update` writes a new file and the container keeps
  // the old one. Mounting the directory means the name is resolved on every call.
  assert.match(compose, /\$\{HOME\}\/\.local\/bin:\/host-local-bin:ro/);
  assert.ok(!/\.local\/bin\/twg:/.test(compose), 'the binary itself is no longer mounted');
  assert.match(compose, /\$\{HOME\}\/\.config\/twg:.*:rw/, 'one binary, one session, still shared');

  // PATH still finds `twg`, through a wrapper that execs whatever is there now.
  assert.match(dockerfile, /exec \/host-local-bin\/twg "\$@"/);
  assert.match(dockerfile, /chmod 0755 \/usr\/local\/bin\/twg/);
  assert.match(dockerfile, /twg is not installed on the host/, 'a machine without twg says so');
});

test('the gate asks the host binary, not the wrapper', () => {
  // /usr/local/bin/twg now exists on every machine, installed or not — asking IT whether twg exists
  // would answer yes on a machine with nothing behind it.
  const paths = jiraSrc.match(/const TWG_PATHS = \[([^\]]+)\]/)[1];
  assert.ok(paths.indexOf("'/host-local-bin/twg'") < paths.indexOf("'/usr/local/bin/twg'"),
    'the real binary is checked first');
});
