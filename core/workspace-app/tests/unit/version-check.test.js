/**
 * "Is there a newer release than the one this machine runs?"
 *
 * The version in the top bar answers "what am I on". It cannot answer "and is that current", and a
 * number with nothing beside it reads as up to date whether it is or not — which is how a team ends up
 * spread across four releases with nobody aware of it.
 *
 * Every test here is about not lying: unknown is not up to date, only a number that is really greater is
 * newer, and nothing is claimed when the check could not be made. This repository is PRIVATE and the
 * dashboard's container has no GitHub token of its own unless one is put in `.ddev/config.yaml`
 * `web_environment` — so "cannot read it" is the normal case, not the edge case.
 */

const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('fs');
const path = require('path');

const vc = require('../../version-check');
const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const src = fs.readFileSync(path.join(__dirname, '..', '..', 'version-check.js'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');

test('newer is segment by segment, numerically — not by string', () => {
  assert.strictEqual(vc.isNewer('1.0.14', '1.0.13'), true);
  assert.strictEqual(vc.isNewer('1.0.10', '1.0.9'), true, '10 is after 9, which string order gets wrong');
  assert.strictEqual(vc.isNewer('1.0.9', '1.0.10'), false);
  assert.strictEqual(vc.isNewer('1.1.0', '1.0.99'), true);
  assert.strictEqual(vc.isNewer('2.0.0', '1.9.9'), true);
  assert.strictEqual(vc.isNewer('1.2', '1.1.9'), true, 'a shorter tag still compares');
  assert.strictEqual(vc.isNewer('1.0.0', '1'), false, 'and equal is not newer');
});

test('the same release is not a newer release', () => {
  assert.strictEqual(vc.isNewer('1.0.13', '1.0.13'), false);
});

test('a tag it cannot parse makes no claim in either direction', () => {
  for (const odd of ['v1.0.14', '1.0.14-rc1', 'latest', 'main', '', null, undefined, '1.0.x']) {
    assert.strictEqual(vc.isNewer(odd, '1.0.13'), false, `no claim from ${JSON.stringify(odd)}`);
    assert.strictEqual(vc.isNewer('1.0.13', odd), false, `and none against it either`);
  }
});

test('with no version of its own it says nothing: there is nothing to compare', async () => {
  assert.strictEqual(await vc.updateHintHtml({ current: '', repo: 'webship/workspace', esc }), '');
});

test('with no repository configured it says nothing, rather than guessing one', async () => {
  vc.forget();
  const answer = await vc.latestRelease('');
  assert.strictEqual(answer.tag, '');
  assert.match(answer.error, /no repository/);
  assert.strictEqual(await vc.updateHintHtml({ current: '1.0.0', repo: '', esc }), '');
});

test('unknown is never rendered as up to date, and never as an update', () => {
  // The container cannot read a private repository without a token, and a plain request to one answers
  // 404 — which is indistinguishable from "no releases" and would be reported as one.
  assert.match(src, /Unknown is not up to date/);
  assert.match(src, /There is no\s*\n?\s*\* unauthenticated fallback on purpose/,
    'so there is no anonymous fallback that would turn 404 into "none"');
  assert.match(src, /if \(!tag \|\| !isNewer\(tag, current\)\) return '';/);
});

test('the answer is cached, and a failure is cached too', () => {
  assert.ok(vc.TTL >= 60 * 60 * 1000, 'releases are not frequent; this is not a per-page network call');
  assert.ok(vc.FAIL_TTL > 0 && vc.FAIL_TTL < vc.TTL,
    'a machine with no token must not shell out on every render to be told so again');
});

test('the hint links to that release and says what to run', () => {
  // Read from the generator rather than rendered through it: these tests must not need a token, and the
  // network answer is exactly the part a test cannot have.
  assert.match(src, /releases\/tag\/\$\{encodeURIComponent\(tag\)\}/);
  assert.match(src, /has been released — this machine runs \$\{current\}/);
  assert.match(src, /scripts\/update\.sh/, 'and what to do about it');
  assert.match(src, /target="_blank" rel="noopener"/);
});

test('it never blocks a page: the answer arrives in its own fragment', () => {
  assert.match(server, /pathname === '\/fragments\/version-latest'/);
  assert.match(server, /hx-get="\/fragments\/version-latest"/);
  // Minutes, not hours: htmx only parses ms/s/m, and `6h` polled in a tight loop.
  assert.match(server, /hx-trigger="load, every 360m"/);
  assert.doesNotMatch(server, /hx-trigger="[^"]*every [0-9.]+[hd]"/,
    'an hour/day unit htmx cannot parse becomes an interval of zero');
  assert.match(server, /class="version-hint"/);
});

test('the version entry is called what it is, and shows what it is', () => {
  assert.match(server, /const label = 'Current local version';/,
    'a bare "1.0.13" reads as a release rather than as a thing you can move');
  assert.match(server, /<span class="action-label">\$\{esc\(shown\)\}<\/span>/,
    'and what is SHOWN is still the number, because that is the answer to the question');
  assert.match(server, /Current local version: Webship Workspace \$\{v\}/, 'the title says both');
  assert.match(server, /The latest release may be newer/, 'and that the number is local, not latest');
});
