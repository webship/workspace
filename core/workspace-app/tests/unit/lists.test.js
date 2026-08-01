/**
 * The list state: what a query string is allowed to say, and what a bad value falls back to.
 *
 * These are the rules a page of rows depends on, and they are pure functions of a request — which
 * is exactly what a unit test is good for, and what a browser test would only reach indirectly.
 */

const { test } = require('node:test');
const assert = require('node:assert');

const { readListState, defaultListState, paginate, searchSortPage, pageSizes } = require('../../lists');

const req = (url) => ({ url, headers: {} });

test('a page size the settings file does not offer is refused', () => {
  const offered = pageSizes().map(String);
  assert.ok(offered.length, 'the fields file should offer some sizes');
  const notOffered = ['7', '999', 'banana'].find((v) => !offered.includes(v));
  assert.equal(String(readListState(req(`/?per=${notOffered}`)).per), String(defaultListState().per));
});

test('a page size the settings file offers is accepted', () => {
  const offered = pageSizes().filter((s) => s !== 'all')[0];
  assert.equal(readListState(req(`/?per=${offered}`)).per, offered);
});

test('an unknown sort falls back rather than erroring', () => {
  assert.equal(readListState(req('/?sort=../etc')).sort, defaultListState().sort);
});

test('an unknown status filter falls back to all', () => {
  assert.equal(readListState(req('/?status=nonsense')).status, 'all');
});

test('the query is trimmed and bounded', () => {
  assert.equal(readListState(req('/?q=%20%20hello%20%20')).q, 'hello');
  assert.equal(readListState(req(`/?q=${'x'.repeat(400)}`)).q.length, 200);
});

test('a page number below one is clamped', () => {
  assert.equal(readListState(req('/?page=-5')).page, 1);
  assert.equal(readListState(req('/?page=0')).page, 1);
});

test('paginate clamps a page past the end to the last one', () => {
  const rows = Array.from({ length: 25 }, (_, i) => ({ name: `r${i}`, mtime: i }));
  const p = paginate(rows, { per: 10, page: 99 });
  assert.equal(p.page, 3);
  assert.equal(p.pages, 3);
  assert.equal(p.slice.length, 5);
  assert.equal(p.to, 25);
});

test('paginate on an empty list reports nothing rather than page 1 of 0', () => {
  const p = paginate([], { per: 10, page: 1 });
  assert.equal(p.total, 0);
  assert.equal(p.from, 0);
  assert.equal(p.pages, 1);
});

test('all means one page, whatever the page asked for', () => {
  const rows = Array.from({ length: 300 }, (_, i) => ({ name: `r${i}`, mtime: i }));
  const p = paginate(rows, { per: 'all', page: 4 });
  assert.equal(p.pages, 1);
  assert.equal(p.slice.length, 300);
});

test('search runs before paging, so page two is page two of the matches', () => {
  const rows = [...Array(30).keys()].map((i) => ({ name: i % 2 ? `keep-${i}` : `drop-${i}`, mtime: i }));
  const state = { ...defaultListState(), q: 'keep', per: 10, page: 2, sort: 'name' };
  const p = searchSortPage(rows, state);
  assert.equal(p.total, 15, 'only the matches are counted');
  assert.ok(p.slice.every((r) => r.name.startsWith('keep')));
});

test('sorting by name is stable and by newest is by mtime', () => {
  const rows = [{ name: 'b', mtime: 3 }, { name: 'a', mtime: 1 }, { name: 'c', mtime: 2 }];
  const byName = searchSortPage(rows, { ...defaultListState(), sort: 'name', per: 'all' });
  assert.deepEqual(byName.slice.map((r) => r.name), ['a', 'b', 'c']);
  const byNewest = searchSortPage(rows, { ...defaultListState(), sort: 'newest', per: 'all' });
  assert.deepEqual(byNewest.slice.map((r) => r.name), ['b', 'c', 'a']);
});

test('a checkbox that posts twice is read from the last value, not the first', () => {
  // The form emits a hidden 0 and then the box; reading the first would make a ticked box read off.
  assert.equal(readListState(req('/?auto=0&auto=1')).auto, true);
  assert.equal(readListState(req('/?auto=0')).auto, false);
});
