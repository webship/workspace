/**
 * The workitems list opens at once and narrows as you type: read from the fragment's source, which is
 * the one place those promises are kept.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

const PKG = fs.existsSync(path.join(__dirname, '..', 'package.json')) ? path.join(__dirname, '..') : path.join(__dirname, '..', '..');
const src = fs.readFileSync(path.join(PKG, 'src/lib/workitems.ts'), 'utf8');
const index = fs.readFileSync(path.join(PKG, 'src/index.ts'), 'utf8');

test('the list opens at once: the shell answers before any Jira read, and the results load into their own box', () => {
  assert.match(index, /\(\\\/results\)\?\$\//, 'one route, with and without /results');
  const shell = src.indexOf('if (!jResults) {');
  const firstRead = src.indexOf("run('twg', ['jira', 'workitem', 'query'", shell);
  assert.ok(shell > 0 && firstRead > shell, 'the shell returns before the workitem query');
  assert.match(src, /<div id="jira-results"[^>]*hx-trigger="load"/);
});

test('the three reads run together', () => {
  assert.match(src, /const \[out, spOut, screensOut\] = await Promise\.all\(\[/);
});

test('searching replaces the results only, so the box keeps its focus, and narrows the cards on screen at once', () => {
  assert.match(src, /hx-target="#jira-results"/);
  assert.match(src, /hx-sync="this:replace"/);
  assert.match(src, /data-list-find="#jira-results"/, "the dashboard's quick filter, pointed at this list");
  assert.match(src, /jira-card/);
  assert.match(src, /data-find=/);
});

test('opening never waits for the list of Jira projects: it is read from the cache and warmed in the background', () => {
  assert.match(src, /const live = twg\.jiraProjectListCached\(\);\s*if \(!live\) twg\.warmJiraProjects\(\);/);
  const route = src.slice(src.indexOf('async function list('), src.indexOf('async function list(') + 3000);
  assert.doesNotMatch(route, /await twg\.jiraProjectList\(\)/);
});

test('the actions and routes are the plugin\'s own, never the dashboard\'s', () => {
  assert.doesNotMatch(src, /\/actions\/jira-|\/fragments\/projects\/jira|\/fragments\/jira\//);
  assert.match(src, /post\('task'\)/);
  assert.match(src, /post\('set-project'\)/);
});
