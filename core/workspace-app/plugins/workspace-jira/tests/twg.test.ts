/**
 * The Teamwork Graph CLI: kept current, and honest when it is not. twg refuses every real command when
 * it is too old; the plugin says so in its own words and names both halves of the fix.
 */
import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';

import twgFactory from '../src/lib/twg';

const PKG = fs.existsSync(path.join(__dirname, '..', 'package.json')) ? path.join(__dirname, '..') : path.join(__dirname, '..', '..');
const twgSrc = fs.readFileSync(path.join(PKG, 'src/lib/twg.ts'), 'utf8');
const listSrc = fs.readFileSync(path.join(PKG, 'src/lib/workitems.ts'), 'utf8');
const indexSrc = fs.readFileSync(path.join(PKG, 'src/index.ts'), 'utf8');
const compose = fs.readFileSync(path.join(PKG, 'ddev/docker-compose.twg.yaml'), 'utf8');
const twg = twgFactory({ run: async () => ({ ok: false, code: 1, stdout: '', stderr: '' }) } as any);

// What the CLI actually printed, the day this was found.
const REAL = 'Update required: Please run `twg update`: this CLI is running v1.2.7, '
  + 'below the minimum supported version v1.3.1. Update Required to apply critical fixes.';

test('the refusal is recognised, and both versions read out of it; none is hardcoded', () => {
  assert.deepStrictEqual(twg.twgUpdateNeeded(REAL), { running: '1.2.7', minimum: '1.3.1' });
  const code = twgSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/\b\d+\.\d+\.\d+\b/.test(code), 'no version number is hardcoded in the gate');
});

test('it still reads when the CLI hard-wraps its prose, and a full stop is not part of a version', () => {
  const wrapped = 'Update required: this CLI is running v1.2.7,\nbelow the minimum supported\nversion v1.3.1.';
  assert.deepStrictEqual(twg.twgUpdateNeeded(wrapped), { running: '1.2.7', minimum: '1.3.1' });
  assert.strictEqual(twg.twgUpdateNeeded('running v2.0, minimum supported version v2.5.')!.minimum, '2.5');
});

test('every other failure is left alone', () => {
  for (const other of ['AUTH_REQUIRED: authentication required', 'no issues found', '', undefined]) {
    assert.strictEqual(twg.twgUpdateNeeded(other), null, String(other));
  }
});

test('the message names both halves of the fix', () => {
  const hint = twg.twgUpdateHint(twg.twgUpdateNeeded(REAL));
  assert.match(hint, /running twg 1\.2\.7/);
  assert.match(hint, /needs 1\.3\.1/);
  assert.match(hint, /twg update/);
  assert.match(hint, /ddev restart/);
  assert.match(twg.twgUpdateHint(null), /^On the host, run: twg update\./);
});

test('the version failure outranks the login one, in the gate and in the list', () => {
  const reason = twgSrc.slice(twgSrc.indexOf('function twgAuthReason()'));
  assert.ok(reason.indexOf('_twgStale') > 0 && reason.indexOf('_twgStale') < reason.indexOf('twgSessionFileExists'), 'checked first');
  const branch = listSrc.slice(listSrc.indexOf("const said = String(out.stderr || out.stdout || '');"));
  assert.match(branch, /const stale = twg\.twgNoteOutput\(said\);/);
  assert.match(branch, /The Teamwork Graph CLI is out of date/);
  assert.ok(branch.indexOf('twgNoteOutput') < branch.indexOf('twgNeedsLogin'), 'before the login branch');
  assert.match(indexSrc, /twgIsStale\(\) \? 'twg out of date' : 'twg not signed in'/, "the row's disabled button says which of the three it is");
});

test('the container follows the host binary instead of pinning it, and the gate asks the binary, not the wrapper', () => {
  assert.match(compose, /\$\{HOME\}\/\.local\/bin:\/host-local-bin:ro/);
  assert.ok(!/\.local\/bin\/twg:/.test(compose), 'the binary itself is no longer mounted');
  assert.match(compose, /\$\{HOME\}\/\.config\/twg:.*:rw/, 'one binary, one session, still shared');
  const paths = twgSrc.match(/const TWG_PATHS = \[([^\]]+)\]/)![1];
  assert.ok(paths.indexOf("'/host-local-bin/twg'") < paths.indexOf("'/usr/local/bin/twg'"), 'the real binary is checked first');
});
