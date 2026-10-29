const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const APP = path.join(__dirname, '..', '..');
const FILES = ['server.js', 'screens.js', 'jobs.js', 'assistant.js', 'ai-items.js', 'ddev.js'];

// A backtick inside an HTML comment inside a template literal ENDS THE LITERAL and takes the
// whole app down with a syntax error. CLAUDE.md warns about it; it has still happened three
// times, because the comment reads perfectly well to a person and the failure appears
// hundreds of lines away.
//
// This is the cheap guard: an HTML comment inside these files must not contain a backtick.
// It costs one rule — write `update.sh --check` as update.sh --check inside a comment — and
// removes a class of bug whose symptom is "the dashboard will not start".
test('no HTML comment carries a backtick', () => {
  const offenders = [];
  for (const f of FILES) {
    const src = fs.readFileSync(path.join(APP, f), 'utf8');
    const lines = src.split('\n');
    let inComment = false;
    lines.forEach((line, i) => {
      if (line.includes('<!--')) inComment = true;
      if (inComment && line.includes('`')) offenders.push(`${f}:${i + 1}: ${line.trim().slice(0, 70)}`);
      if (line.includes('-->')) inComment = false;
    });
  }
  assert.deepEqual(offenders, [],
    'a backtick in an HTML comment inside a template literal ends the literal — write it without one');
});

// The belt to that braces: whatever the rule above misses, the file must still parse. Cheap,
// and it is the actual property that matters.
test('every dashboard module parses', () => {
  for (const f of FILES.concat(['workspaces.js', 'urls.js', 'checks.js', 'public/ui.js', 'public/suggest.js'])) {
    execFileSync('node', ['--check', path.join(APP, f)]);
  }
});

// Security headers are set ONCE in the request handler, because they were previously set at
// three writeHead sites out of fifty-six — so every page but the graph viewer went without.
// A regression here is invisible in the UI, which is exactly why it needs a test.
test('the request handler sets the security headers centrally', () => {
  const src = fs.readFileSync(path.join(APP, 'server.js'), 'utf8');
  const handler = src.slice(src.indexOf('const server = http.createServer'), src.indexOf('const server = http.createServer') + 1600);
  for (const h of ['X-Content-Type-Options', 'Referrer-Policy', 'X-Frame-Options']) {
    assert.ok(handler.includes(h), `${h} is no longer set at the top of the request handler`);
  }
  assert.ok(handler.includes("'nosniff'"), 'nosniff value changed');
});
