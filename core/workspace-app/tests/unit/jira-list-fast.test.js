const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'public', 'ui.js'), 'utf8');

test('the list opens at once: the shell answers before any Jira read, and the results load into their own box', () => {
  assert.match(server, /\(\\\/results\)\?\$\//, 'one route, with and without /results');
  const shell = server.indexOf('if (!jResults) {');
  const firstRead = server.indexOf("run('twg', ['jira', 'workitem', 'query'", shell);
  assert.ok(shell > 0 && firstRead > shell, 'the shell returns before the workitem query');
  assert.match(server, /<div id="jira-results"[^>]*hx-trigger="load"/);
});

test('the three reads run together', () => {
  assert.match(server, /const \[out, spOut, screensOut\] = await Promise\.all\(\[/);
});

test('searching replaces the results only, so the box keeps its focus', () => {
  assert.match(server, /hx-target="#jira-results"/);
  assert.match(server, /hx-trigger="input changed delay:350ms from:find input\[name=q\], change from:find select\[name=scope\], submit"/);
  assert.match(server, /hx-sync="this:replace"/);
});

test('typing narrows the cards on screen at once', () => {
  assert.match(server, /jira-card/);
  assert.match(server, /data-find=/);
  assert.match(ui, /input\[data-jira-find\]/);
  assert.match(ui, /words\.every\(\(w\) => hay\.includes\(w\)\)/);
});

test('opening never waits for the list of Jira projects: it is read from the cache and warmed in the background', () => {
  assert.match(server, /const live = jiraProjectListCached\(\);\s*if \(!live\) warmJiraProjects\(\);/);
  const route = server.slice(server.indexOf('const jiraMatch ='), server.indexOf('const jiraMatch =') + 3000);
  assert.doesNotMatch(route, /await jiraProjectList\(\)/);
  const jira = fs.readFileSync(path.join(root, 'jira.js'), 'utf8');
  assert.match(jira, /function warmJiraProjects\(\)/);
  assert.match(jira, /_jiraProjectsInflight/);
});
