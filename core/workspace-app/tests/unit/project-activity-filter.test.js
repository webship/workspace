/**
 * Projects with something running in them: filter and sort.
 *
 * A workspace page lists dozens of projects and the question asked most is "where is something
 * happening" — which screen has an agent in it, which project somebody is working in. The row's badges
 * answer it one row at a time, and finding the four that matter among thirty was scrolling. The
 * filter and the sort ask the same sources the badges do, once for the whole table.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { PROJECT_FILTERS, SORTS, defaultSort, readPageState, listControlsHtml } = require('../../lists');
const { activityFromSessions } = require('../../screens');

const server = fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8');
const req = (qs) => ({ url: `/fragments/dev/projects?${qs}`, headers: {} });

test('the filter offers screens running and agent running, and the query accepts them', () => {
  assert.ok(PROJECT_FILTERS.screens && PROJECT_FILTERS.agents);
  assert.strictEqual(readPageState(req('status=screens')).status, 'screens');
  assert.strictEqual(readPageState(req('status=agents')).status, 'agents');
  // An unknown value falls back to everything rather than showing nothing.
  assert.strictEqual(readPageState(req('status=bogus')).status, 'all');
});

test('the active sort puts agents first, then screens, then the newest', () => {
  const rows = [
    { name: 'idle-old', mtime: 1, screens: 0, agents: 0 },
    { name: 'idle-new', mtime: 9, screens: 0, agents: 0 },
    { name: 'shell', mtime: 2, screens: 1, agents: 0 },
    { name: 'two-screens', mtime: 3, screens: 2, agents: 0 },
    { name: 'agent', mtime: 1, screens: 1, agents: 1 },
  ];
  const order = rows.slice().sort(SORTS.active.cmp).map((r) => r.name);
  assert.deepStrictEqual(order, ['agent', 'two-screens', 'shell', 'idle-new', 'idle-old']);
});

test('a row with no counts sorts as none, so the sort is harmless on a list that has none', () => {
  const files = [{ name: 'b.md', mtime: 1 }, { name: 'a.md', mtime: 2 }];
  assert.doesNotThrow(() => files.slice().sort(SORTS.active.cmp));
  assert.strictEqual(readPageState(req('sort=active')).sort, 'active');
});

test('the active sort is offered on project lists only', () => {
  const state = { q: '', sort: 'newest', auto: true };
  const plain = listControlsHtml('/fragments/x/items', '#t', state, 'files');
  const projects = listControlsHtml('/fragments/dev/projects', '#t', state, 'projects', null, null, { projectSorts: true });
  assert.ok(!plain.includes('value="active"'), 'a file list must not offer a sort it has no data for');
  assert.ok(projects.includes('value="active"'));
  assert.match(projects, />Active first</);
});

test('activity is counted per project: screens, the agents among them, and those waiting', () => {
  const sessions = [
    { session: 'dev--a--work', state: '(Detached)' },
    { session: 'dev--a--agent', state: '(Detached)' },
    { session: 'dev--a--asks', state: '(Attached)', waiting: true, waitingWhy: 'a question' },
    { session: 'dev--b--shell', state: '(Detached)' },
    { session: 'dev--c--gone', state: '(Dead ???)' },
    { session: 'elsewhere', state: '(Detached)' },
  ];
  const owner = { 'dev--a--work': '/w/a', 'dev--a--agent': '/w/a', 'dev--a--asks': '/w/a', 'dev--b--shell': '/w/b', 'dev--c--gone': '/w/c' };
  const got = activityFromSessions(sessions, {
    agents: new Set(['dev--a--agent', 'dev--a--asks']),
    dirOf: (s) => owner[s] || '',
  });
  assert.deepStrictEqual(got.get('/w/a'), { screens: 3, agents: 2, waiting: 1 });
  assert.deepStrictEqual(got.get('/w/b'), { screens: 1, agents: 0, waiting: 0 });
  assert.ok(!got.has('/w/c'), 'a dead session is not running anything');
  assert.strictEqual(got.size, 2, 'a session that belongs to no project here is not counted');
});

test('nothing running gives an empty answer, not a crash', () => {
  assert.strictEqual(activityFromSessions([], { agents: new Set(), dirOf: () => '' }).size, 0);
  assert.strictEqual(activityFromSessions(undefined, { agents: new Set(), dirOf: () => '' }).size, 0);
});

test('the project list filters on what is running, and says how many in the menu', () => {
  // includes(), not match(): a failed match would print the whole of server.js as its message.
  assert.ok(server.includes("if (wanted === 'screens') return it.screens > 0;"));
  assert.ok(server.includes("if (wanted === 'agents') return it.agents > 0;"));
  assert.ok(server.includes('{ projectSorts: true }'));
  assert.ok(server.includes("${esc(label)}${n === null ? '' : ` (${n})`}"), 'the counts are in the option labels');
});

/* ------------------------------------------------------------------ *
 * Sticky: the last search, sort and filter of a workspace's list
 * ------------------------------------------------------------------ */

const { setPageCookie } = require('../../lists');
const cookieOf = (views) => `ws-view=${encodeURIComponent(JSON.stringify(views))}`;
const reqWith = (qs, cookie) => ({ url: `/fragments/dev/projects?${qs}`, headers: { cookie: cookie || '' } });
const SAVED = { 'dev/projects': { q: 'webship', sort: 'name', status: 'agents' } };

test('a list opens the way it was left: search, sort and filter come from the cookie', () => {
  const st = readPageState(reqWith('', cookieOf(SAVED)), 'dev/projects');
  assert.strictEqual(st.q, 'webship');
  assert.strictEqual(st.sort, 'name');
  assert.strictEqual(st.status, 'agents');
});

test('what the request says wins over what was saved, field by field', () => {
  const st = readPageState(reqWith('status=screens', cookieOf(SAVED)), 'dev/projects');
  assert.strictEqual(st.status, 'screens');
  assert.strictEqual(st.q, 'webship', 'a field the request did not name keeps what was saved');
  const cleared = readPageState(reqWith('q=', cookieOf(SAVED)), 'dev/projects');
  assert.strictEqual(cleared.q, '', 'an empty search typed on purpose is a choice, not an absence');
});

test('it sticks per workspace and per list, and nothing sticks without a list', () => {
  assert.strictEqual(readPageState(reqWith('', cookieOf(SAVED)), 'test/projects').q, '');
  assert.strictEqual(readPageState(reqWith('', cookieOf(SAVED)), 'dev/items').q, '');
  assert.strictEqual(readPageState(reqWith('', cookieOf(SAVED))).q, '', 'every other list is unchanged');
});

test('reset forgets it, and so does the Reset link', () => {
  const st = readPageState(reqWith('reset=1&q=', cookieOf(SAVED)), 'dev/projects');
  assert.deepStrictEqual([st.q, st.sort, st.status], ['', defaultSort(), 'all']);
  assert.deepStrictEqual(st.view.map, {}, 'the entry is removed from the cookie');
  const html = listControlsHtml('/fragments/dev/projects', '#t', { q: '', sort: 'newest', auto: true }, 'projects');
  assert.match(html, /reset=1/);
});

test('only a request that chose something is written back; a poll leaves the preference alone', () => {
  assert.strictEqual(readPageState(reqWith('', cookieOf(SAVED)), 'dev/projects').view, null);
  assert.strictEqual(readPageState(reqWith('page=2&per=20', cookieOf(SAVED)), 'dev/projects').view, null);
  const st = readPageState(reqWith('status=screens&sort=name&q=x', ''), 'dev/projects');
  assert.deepStrictEqual(st.view.map['dev/projects'], { q: 'x', sort: 'name', status: 'screens' });
});

test('only what differs from the default is stored, and an all-default list stores nothing', () => {
  const st = readPageState(reqWith(`status=all&q=&sort=${defaultSort()}`, ''), 'dev/projects');
  assert.deepStrictEqual(st.view.map, {}, 'choosing the defaults stores nothing');
  const other = { 'ai-agents/items': { q: 'a' } };
  const next = readPageState(reqWith('status=all&q=', cookieOf(other)), 'dev/projects');
  assert.deepStrictEqual(next.view.map, other, 'another list is left exactly as it was');
});

test('a bad cookie, or a bad value in a good one, falls back to the defaults', () => {
  assert.strictEqual(readPageState(reqWith('', 'ws-view=%7Bnot-json'), 'dev/projects').q, '');
  const hostile = { 'dev/projects': { sort: 'x"><script>', status: 'nope', kind: '../../etc', q: 'ok' } };
  const st = readPageState(reqWith('', cookieOf(hostile)), 'dev/projects');
  assert.strictEqual(st.status, 'all');
  assert.ok(SORTS[st.sort]);
  assert.match(st.kind, /^[a-z-]*$/, 'a kind is a slug whichever way it arrived');
  assert.strictEqual(st.q, 'ok');
});

test('the cookie stays bounded however many lists and however long the text', () => {
  let views = {};
  for (let i = 0; i < 80; i += 1) {
    const st = readPageState(reqWith(`q=${'x'.repeat(190)}`, cookieOf(views)), `w${i}/projects`);
    views = st.view.map;
  }
  assert.ok(Object.keys(views).length <= 40);
  assert.ok(encodeURIComponent(JSON.stringify(views)).length <= 3000);
  assert.ok('w79/projects' in views, 'the newest is the one kept');
});

test('the choice is written to one cookie on the hub domain, and cleared when empty', () => {
  const sent = [];
  const res = { setHeader: (k, v) => sent.push([k, v]) };
  setPageCookie(res, readPageState(reqWith('q=abc', ''), 'dev/projects'));
  const set = sent[0][1].find((c) => c.startsWith('ws-view='));
  assert.match(set, /Domain=\./);
  assert.match(set, /Max-Age=31536000/);
  assert.ok(decodeURIComponent(set.split(';')[0].slice('ws-view='.length)).includes('"q":"abc"'));
  sent.length = 0;
  setPageCookie(res, readPageState(reqWith('reset=1', cookieOf(SAVED)), 'dev/projects'));
  assert.match(sent[0][1].find((c) => c.startsWith('ws-view=')), /Max-Age=0/);
});

test('the routes pass the list, so each workspace remembers its own', () => {
  assert.ok(server.includes('readPageState(req, `${fragMatch[1]}/projects`)'));
  assert.ok(server.includes('readPageState(req, `${itemsMatch[1]}/items`)'));
  assert.ok(server.includes('readPageState(req, sticky)'), 'the page itself opens the way the list was left');
});
