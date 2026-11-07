import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';

import { register } from '../src/index';
import { fakeApi, workspaceTree } from './fake-api';

const SETTINGS = { site: 'https://acme.atlassian.net/', default_project: 'ACME', allow_writes: false };

test('register() asks for exactly the surface the plugin owns', () => {
  const { api, calls } = fakeApi(workspaceTree(), SETTINGS);
  register(api);
  assert.deepStrictEqual(Object.keys(calls.rowMenus), ['jira']);
  assert.deepStrictEqual(calls.rowMenus.jira.spec, { label: 'JIRA', row: 0 });
  assert.deepStrictEqual(Object.keys(calls.actions).sort(), ['set-project', 'task']);
  assert.strictEqual(calls.fragments.length, 1);
  assert.strictEqual(calls.badges.length, 1);
  assert.strictEqual(calls.keyLinks.length, 1);
  assert.strictEqual(calls.prompts.length, 1);
  assert.strictEqual(calls.logs.length, 1);
  assert.strictEqual(calls.starts.length, 1);
  assert.deepStrictEqual(calls.options.map((o: any) => [o.file, o.dotted]), [['plugin.jira.settings.yml', 'default_project']]);
  assert.strictEqual(calls.contexts.length, 1);
  assert.strictEqual(calls.setups.length, 1);
});

test('the row menu needs a default project and a usable twg, and says which is missing', () => {
  const root = workspaceTree();
  const { api, calls } = fakeApi(root, SETTINGS);
  register(api);
  const ctx: any = { key: 'dev', project: 'site1', dir: path.join(root, 'dev'), meta: {}, allowed: new Set(['jira']), vals: () => '' };
  const html = calls.rowMenus.jira.fn(ctx);
  // This machine has no twg on the paths the plugin looks at, so the button is there and disabled.
  assert.match(html, /JIRA/);
  assert.match(html, /disabled/);
  assert.match(html, /twg missing|twg not signed in|twg out of date/);
  const { api: api2, calls: calls2 } = fakeApi(root, { ...SETTINGS, default_project: '' });
  register(api2);
  assert.strictEqual(calls2.rowMenus.jira.fn(ctx), null, 'no default project, no menu');
  assert.strictEqual(calls.rowMenus.jira.fn({ ...ctx, allowed: new Set() }), null, 'a type that does not allow jira gets nothing');
});

test('a work key in a folder name links to the configured site; an agent at work shows its key', () => {
  const { api, calls } = fakeApi(workspaceTree(), SETTINGS);
  register(api);
  assert.strictEqual(calls.keyLinks[0]('ACME-12'), 'https://acme.atlassian.net/browse/ACME-12');
  assert.strictEqual(calls.keyLinks[0]('not a key'), null);
  const badge = calls.badges[0]({ sessions: [{ session: 'dev--site1--jira-acme-12' }, { session: 'dev--site1--jira-acme-12', state: 'Dead' }, { session: 'dev--site1--build' }] });
  assert.match(badge, /href="https:\/\/acme\.atlassian\.net\/browse\/ACME-12"/);
  assert.strictEqual((badge.match(/jira-key/g) || []).length, 1, 'live sessions only, once each');
});

test('a jira session logs inside the project it works, and its prompt reads the workitem with twg', () => {
  const root = workspaceTree();
  const { api, calls } = fakeApi(root, SETTINGS);
  register(api);
  fs.writeFileSync(path.join(root, 'dev', 'site1', '.jira-ACME-7.log'), '');
  assert.strictEqual(calls.logs[0]('dev--site1--jira-acme-7', [path.join(root, 'dev', 'site1')]), path.join(root, 'dev', 'site1', '.jira-ACME-7.log'));
  assert.strictEqual(calls.logs[0]('dev--site1--build', [path.join(root, 'dev', 'site1')]), '');
  assert.match(calls.prompts[0]({ key: 'ACME-7', workspace: 'dev', project: 'site1' }), /twg CLI/);
  assert.strictEqual(calls.prompts[0]({ key: 'nope' }), null);
});

test('the New-folder section files a workitem only where the workspace has Jira, and checks its inputs', () => {
  const { api, calls } = fakeApi(workspaceTree(), SETTINGS);
  register(api);
  const [setup] = calls.setups;
  assert.match(setup.html('dev', { allowed: new Set(['jira']) }), /name="jira_project" value="ACME"/);
  assert.strictEqual(setup.html('modules', { allowed: new Set() }), '');
  assert.match(setup.prompt('dev', 'demo1', { jira: '1', jira_project: 'ACME', note: 'Try search' })[0], /jira-workitem-manager agent .*ACME.*dev\/demo1.*Try search/);
  assert.deepStrictEqual(setup.prompt('dev', 'demo1', {}), []);
  assert.match(setup.problem('dev', { jira: '1', jira_project: '1x', note: 'x' }, { allowed: new Set(['jira']) }), /Jira project key/);
  assert.match(setup.problem('dev', { jira: '1', jira_project: 'ACME', note: '' }, { allowed: new Set(['jira']) }), /what the folder is for/);
  assert.strictEqual(setup.problem('dev', {}, { allowed: new Set(['jira']) }), '');
});

test('the assistant is told about Jira only when a project is configured, with the writes switch', () => {
  const { api, calls } = fakeApi(workspaceTree(), SETTINGS);
  register(api);
  assert.match(calls.contexts[0](), /Default project: ACME/);
  assert.match(calls.contexts[0](), /writes are DISABLED/);
  const { api: api2, calls: calls2 } = fakeApi(workspaceTree(), { default_project: '' });
  register(api2);
  assert.strictEqual(calls2.contexts[0](), '');
});

test('the package requires nothing outside itself, and ships what the manifest names', () => {
  const PKG = fs.existsSync(path.join(__dirname, '..', 'package.json')) ? path.join(__dirname, '..') : path.join(__dirname, '..', '..');
  for (const f of ['src/index.ts', 'src/lib/twg.ts', 'src/lib/sessions.ts', 'src/lib/task.ts', 'src/lib/workitems.ts']) {
    const src = fs.readFileSync(path.join(PKG, f), 'utf8');
    assert.doesNotMatch(src, /from ['"](\.\.\/)+(html|jobs|workspaces|format|validate|screens|tab-modal)['"]/, `${f} imports a dashboard module`);
    assert.doesNotMatch(src, /require\(/, `${f} uses imports`);
  }
  const m = JSON.parse(fs.readFileSync(path.join(PKG, 'package.json'), 'utf8')).workspacePlugin;
  for (const f of [m.settingsTemplate, m.labels, m.scripts.hostInstall, ...m.ddev.compose, ...m.css, ...m.features]) assert.ok(fs.existsSync(path.join(PKG, f)), `${f} is in the package`);
});
