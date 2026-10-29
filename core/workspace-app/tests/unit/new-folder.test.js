const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const folders = require('../../folders');
const { typeActions } = require('../../workspace-types');

const root = path.join(__dirname, '..', '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

test('a folder name is lowercase letters, digits, - and _', () => {
  for (const ok of ['folder1', 'my-app', 'a_b', '9lives']) assert.equal(folders.nameProblem(ok), '', ok);
  for (const bad of ['', 'My App', '../x', '.hidden', '-x', 'a/b', 'x.y', 'A1', 'a'.repeat(64)]) {
    assert.notEqual(folders.nameProblem(bad), '', bad);
  }
  assert.match(folders.nameProblem('node_modules'), /reserved/);
});

test('createFolder makes the folder once, inside the workspace, and refuses the rest', () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-'));
  try {
    const made = folders.createFolder(ws, 'demo1');
    assert.equal(made.ok, true);
    assert.ok(fs.statSync(path.join(ws, 'demo1')).isDirectory());
    assert.equal(folders.createFolder(ws, 'demo1').status, 409);
    assert.equal(folders.createFolder(ws, '../out').status, 400);
    assert.equal(folders.createFolder(path.join(ws, 'missing'), 'x').status, 404);
    assert.equal(folders.suggestName(ws, 'demo'), 'demo2');
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test('the form posts the name, the note and what to start, and shows the Claude message only for Claude', () => {
  const html = folders.folderFormHtml('dev', { label: 'Dev', suggestion: 'folder1' });
  assert.match(html, /hx-post="\/actions\/folder-new"/);
  assert.match(html, /name="workspace" value="dev"/);
  assert.match(html, /name="name"[^>]*value="folder1"/s);
  for (const v of ['none', 'shell', 'claude']) assert.match(html, new RegExp(`name="then" value="${v}"`));
  const css = fs.readFileSync(path.join(root, 'public/css/components/folders.css'), 'utf8');
  assert.match(css, /:has\(input\[name="then"\]\[value="claude"\]:checked\) \.folder-prompt \{ display: block; \}/);
});

test('every workspace type takes new folders except the AI items, where a folder is a skill', () => {
  for (const t of ['sites', 'code', 'files', 'media']) assert.ok(typeActions(t).has('folder'), t);
  assert.ok(!typeActions('ai-items').has('folder'));
});

test('a files workspace makes the folder inside the one being viewed, with readable names and nothing to set up', () => {
  assert.equal(folders.nameProblem('Webship Demo Guide 2.0', { files: true }), '');
  assert.notEqual(folders.nameProblem('Webship Demo Guide', {}), '');
  for (const bad of ['..', '.x', 'a/b', 'ends.', 'ends ']) assert.notEqual(folders.nameProblem(bad, { files: true }), '', bad);
  const html = folders.filesFolderFormHtml('docs', { label: 'Docs', sub: 'guides', suggestion: 'new-folder-1' });
  assert.match(html, /New folder in Docs \/ guides/);
  assert.match(html, /name="sub" value="guides"/);
  assert.doesNotMatch(html, /name="ddev"|name="then"|name="upsun"/);
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-'));
  try {
    assert.equal(folders.createFolder(ws, 'My Guide', { files: true }).ok, true);
    assert.equal(folders.createFolder(ws, 'My Guide').status, 400);
  } finally { fs.rmSync(ws, { recursive: true, force: true }); }
});

test('the files workspaces offer New folder in their Create group, and the form reads the folder being viewed', () => {
  assert.match(server, /create\.push\(btn\('default', 'tabler:folder-plus', 'New folder', `hx-get="\/fragments\/\$\{esc\(key\)\}\/folder-new" \$\{modal\}`/);
  assert.match(server, /meta\.kind !== 'files' && require\('\.\/actions\/folders'\)\.canMakeFolder\(key\)/);
  assert.match(server, /require\('\.\/actions\/folders'\)\.folderFormFor\(fm\[1\], req, \{ readPageState \}\)/);
  const src = fs.readFileSync(path.join(root, 'actions/folders.js'), 'utf8');
  assert.match(src, /req\.headers\['hx-current-url'\]/);
  assert.match(src, /if \(isFilesWorkspace\(ws\)\) return filesFolderNew/);
  assert.match(src, /safeSub\(ws, String\(form\.sub \|\| ''\)\)/);
});

test('the Create group, the form route and the action are wired in', () => {
  assert.match(server, /btn\('default', 'tabler:folder-plus', 'New folder'/);
  assert.match(server, /\\\/fragments\\\/\(\[a-z0-9_-\]\+\)\\\/folder-new\$/);
  assert.match(server, /\.\.\.require\('\.\/actions\/folders'\)/);
  const action = require('../../actions/folders');
  assert.equal(typeof action['/actions/folder-new'], 'function');
});

test('the form offers Configure DDEV, and webship-js only where the workspace can test', () => {
  const types = require('../../actions/folders').projectTypes();
  assert.ok(types.includes('php') && types.includes('drupal11'));
  const withTests = folders.folderFormHtml('dev', { projectTypes: types, canTest: true });
  assert.match(withTests, /name="ddev" value="1"/);
  assert.match(withTests, /name="e2e" value="1"/);
  assert.match(withTests, /<option value="php" selected>/);
  assert.doesNotMatch(folders.folderFormHtml('modules', { projectTypes: types, canTest: false }), /name="e2e"/);
  const css = fs.readFileSync(path.join(root, 'public/css/components/folders.css'), 'utf8');
  assert.match(css, /:has\(\.folder-setup input:checked\) \.folder-ddev-type \{ display: block; \}/);
});

test('the setup line chains DDEV, the webship-js setup and the Upsun link, in that order', () => {
  const fa = require('../../actions/folders');
  const line = fa.setupLine('dev', 'demo1', { ddev: '1', e2e: '1', project_type: 'php', upsun: 'link', upsun_id: 'abcd1234efgh5' });
  assert.ok(line.startsWith("( cd 'demo1' && ddev 'config' '--auto=false' '--project-name=demo1' '--project-type=php' '--docroot=' )"), line);
  assert.ok(line.indexOf("bash cmd-tools-testing.sh 'demo1'") > line.indexOf("'config'"));
  assert.ok(line.indexOf("bash cmd-tools-upsun.sh 'demo1' --link 'abcd1234efgh5'") > line.indexOf('cmd-tools-testing.sh'));
  assert.match(line, /git rev-parse --git-dir >\/dev\/null 2>&1 \|\| git init -q/);
  // webship-js alone still configures DDEV first, and an unknown type falls back to php.
  assert.match(fa.setupLine('dev', 'demo1', { e2e: '1', project_type: 'nope' }), /'--project-type=php'/);
  assert.equal(fa.setupLine('dev', 'demo1', {}), '');
});

test('the AI tasks go to one Claude Code prompt, and the form is checked before anything is made', () => {
  const fa = require('../../actions/folders');
  const p = fa.claudePrompt('dev', 'demo1', { jira: '1', jira_project: 'WEBSHIP', note: 'Try search', upsun: 'create', prompt: 'Then say hello' });
  assert.match(p, /jira-workitem-manager agent to create one workitem in the Jira project WEBSHIP/);
  assert.match(p, /ask me which organization, region and plan to use, and wait for my answer/);
  assert.ok(p.endsWith('Then say hello'));
  assert.equal(fa.claudePrompt('dev', 'demo1', {}), '');
  assert.match(fa.formProblem('dev', { upsun: 'link', upsun_id: 'BAD ID' }), /Upsun project id/);
  if (fa.jiraProject('dev')) {
    assert.match(fa.formProblem('dev', { jira: '1', jira_project: 'WEBSHIP', note: '' }), /what the folder is for/);
    assert.match(fa.formProblem('dev', { jira: '1', jira_project: '1x', note: 'x' }), /Jira project key/);
  }
  assert.equal(fa.formProblem('dev', {}), '');
});

test('the form offers Jira and Upsun only where the workspace has them', () => {
  const html = folders.folderFormHtml('dev', { jiraProject: 'WEBSHIP', canUpsun: true });
  assert.match(html, /name="jira" value="1"/);
  assert.match(html, /name="jira_project" value="WEBSHIP"/);
  for (const v of ['none', 'link', 'create']) assert.match(html, new RegExp(`name="upsun" value="${v}"`));
  const bare = folders.folderFormHtml('modules', {});
  assert.doesNotMatch(bare, /name="jira"|name="upsun"/);
  const css = fs.readFileSync(path.join(root, 'public/css/components/folders.css'), 'utf8');
  assert.match(css, /:has\(input\[name="upsun"\]\[value="link"\]:checked\) \.folder-upsun-id \{ display: block; \}/);
});
