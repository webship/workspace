const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..', '..');
// The guide moved to the app's own docs folder, beside the screenshots it uses, so
// that the file /help renders and the file people read on GitHub are one file.
const GUIDE = path.join(__dirname, '..', '..', 'docs', 'USER-GUIDE.md');
const APP = path.join(__dirname, '..', '..');

// The /help route renders this file. If it moves or is renamed the page 404s with a message,
// but a test is how that is noticed before someone opening Help is.
test('the user guide exists where /help reads it', () => {
  assert.ok(fs.existsSync(GUIDE), `no guide at ${GUIDE}`);
  const md = fs.readFileSync(GUIDE, 'utf8');
  assert.ok(md.length > 2000, 'the guide is suspiciously short');
});

test('it answers the questions a new person actually has', () => {
  const md = fs.readFileSync(GUIDE, 'utf8').toLowerCase();
  // Not a style check — each of these is a thing seventy people will need on day one, and a
  // guide that omits one sends them to a person instead.
  for (const topic of [
    'install.sh',            // how do I install it
    'log out',               // the docker group, which blocks everything until you do
    'trust-https',           // the browser refusing every URL
    'workspace.ddev.site',   // where do I go
    'backups',               // how do I not lose work
    'web ide',               // how do I edit code
    'screens',               // where did my long job go
    'update.sh',             // how do I stay current
    'no login',              // the security posture, in plain words
  ]) {
    assert.ok(md.includes(topic), `the guide never mentions "${topic}"`);
  }
});

// The guide's pictures live in sub folders; the route once took a bare file name, so /help showed none of them.
test('every picture the guide shows exists and /help serves its path', () => {
  const md = fs.readFileSync(GUIDE, 'utf8');
  const src = fs.readFileSync(path.join(APP, 'server.js'), 'utf8');
  const literal = src.match(/pathname\.match\((\/\^\\\/help\\\/screenshots\\\/.*?\$\/)\);/);
  assert.ok(literal, 'no /help/screenshots route');
  const route = new RegExp(literal[1].slice(1, -1));
  const shots = [...md.matchAll(/\]\((screenshots\/[^)\s]+)\)/g)].map((m) => m[1]);
  assert.ok(shots.length > 20, 'the guide has lost its pictures');
  for (const s of shots) {
    assert.ok(fs.existsSync(path.join(path.dirname(GUIDE), s)), `${s} is missing`);
    assert.ok(route.test(`/help/${s}`), `/help would not serve ${s}`);
  }
  assert.ok(!route.test('/help/screenshots/../server.js') && !route.test('/help/screenshots/a/../../x.png'));
});

test('/help is wired up and reachable from every page', () => {
  const src = fs.readFileSync(path.join(APP, 'server.js'), 'utf8');
  assert.ok(src.includes("pathname === '/help'"), 'no /help route');
  assert.ok(src.includes("navLink('/help'"), 'no Help entry in the actions rail');
  assert.ok(src.includes('USER-GUIDE.md'), '/help no longer reads the guide');
});
