/**
 * The command catalog and the Commands page: commands as data, what each runs on, and the page out of Settings.
 *
 * What must never drift: every built-in command is valid; a line never carries $ or a backtick, and a value reaches it
 * only single-quoted and only where its target gives one; a target stays inside its workspace or project; yours replace
 * a built-in one by id, and a broken file of yours leaves the built-in ones; a write never overwrites a newer file; and
 * Commands is its own page, with Settings → Commands and Row actions sending you to it.
 */

const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'commands-'));
process.env.COMMANDS_FILE = path.join(tmp, 'commands.yml');
process.env.ROW_ACTIONS_FILE = path.join(tmp, 'row-actions.yml');
process.env.ROW_ACTIONS_SEEN_FILE = path.join(tmp, 'row-actions.seen.json');
process.env.ROW_ACTIONS_HISTORY_FILE = path.join(tmp, 'row-actions.history.jsonl');
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));

const cc = require('../../commands');

const APP = path.join(__dirname, '..', '..');
const cmd = (over = {}) => cc.cleanCommand({ id: 'cr', label: 'Rebuild caches', on: 'project', run: 'ddev drush cr', ...over });
const refusal = (over) => cc.commandRefusal(cmd(over));
const shipped = () => { delete process.env.COMMANDS_DEFAULTS_FILE; cc.invalidateCatalog(); };

test('every built-in command is valid, has its own id, and every kind of target has some', () => {
  shipped();
  fs.rmSync(process.env.COMMANDS_FILE, { force: true });
  const cat = cc.loadCatalog();
  assert.strictEqual(cat.builtinError, '');
  assert.deepStrictEqual(cat.problems, []);
  assert.ok(cat.builtin.length >= 10);
  assert.strictEqual(new Set(cat.builtin.map((e) => e.id)).size, cat.builtin.length);
  for (const on of Object.keys(cc.ON)) assert.ok(cat.builtin.some((e) => e.on === on), `no built-in command runs on ${on}`);
  // DDEV only: no built-in command runs composer or drush on the host.
  for (const e of cat.builtin) assert.doesNotMatch(cc.lineOf(e), /(^|[;&|]\s*)(composer|drush) /, e.id);
});

test('a line never carries $ or a backtick, and a value only where its target gives one', () => {
  assert.strictEqual(refusal({}), '');
  assert.match(refusal({ run: 'echo $HOME' }), /\$ or a backtick/);
  assert.match(refusal({ run: 'echo `id`' }), /\$ or a backtick/);
  assert.match(refusal({ on: 'workspace', run: 'ls {{project}}' }), /\{\{project\}\} needs "on" to be project or folder or file/);
  assert.match(refusal({ on: 'project', run: 'head {{file}}' }), /needs "on" to be file/);
  assert.match(refusal({ run: 'echo {{home}}' }), /is not a value a command can use/);
  assert.match(refusal({ run: 'git switch {{opt.branch}}' }), /no option called branch/);
  assert.strictEqual(refusal({ run: 'git switch {{opt.branch}}', options: [{ name: 'branch', required: true }] }), '');
  assert.match(refusal({ script: 'dev/cmd-tools-backup-dev.sh' }), /either run .* and not both/);
  assert.match(refusal({ run: '', script: 'dev/../cmd-x.sh' }), /script is <workspace>\/cmd-<name>\.sh/);
  assert.match(refusal({ args: '{{project}}' }), /args go with a script/);
  assert.match(refusal({ on: 'everywhere' }), /"on" is workspace, project, folder, file/);
  assert.match(refusal({ id: 'Bad Id' }), /the id is lower-case/);
  assert.match(refusal({ label: 'قل مرحبا' }), /the label is letters/);
  assert.strictEqual(refusal({ on: 'file', run: 'head -n 5 -- {{file}}' }), '');
});

test('yours replace a built-in one by id, in its place; a broken file of yours leaves the built-in ones', () => {
  const defaults = path.join(tmp, 'defaults.yml');
  fs.writeFileSync(defaults, 'commands:\n  - { id: one, label: One, on: project, run: echo one }\n  - { id: two, label: Two, on: project, run: echo two }\n');
  process.env.COMMANDS_DEFAULTS_FILE = defaults;
  fs.writeFileSync(process.env.COMMANDS_FILE, 'commands:\n'
    + '  - { id: one, label: My one, on: project, run: echo mine }\n'
    + '  - { id: three, label: Three, on: file, run: "head {{file}}" }\n'
    + '  - { id: bad, label: Bad, on: project, run: echo $HOME }\n');
  cc.invalidateCatalog();
  let cat = cc.loadCatalog();
  assert.deepStrictEqual(cat.commands.map((e) => [e.id, e.source, !!e.overrides]), [['one', 'yours', true], ['two', 'builtin', false], ['three', 'yours', false]]);
  assert.strictEqual(cat.commands[0].label, 'My one');
  assert.match(cat.problems.join(' '), /bad: .*\$ or a backtick/);

  fs.writeFileSync(process.env.COMMANDS_FILE, 'commands: [\n');
  cc.invalidateCatalog();
  cat = cc.loadCatalog();
  assert.match(cat.error, /not valid YAML/);
  assert.deepStrictEqual(cat.commands.map((e) => e.id), ['one', 'two']);
  shipped();
});

test('a write never overwrites a newer file, and no commands at all removes the file', () => {
  fs.rmSync(process.env.COMMANDS_FILE, { force: true });
  cc.invalidateCatalog();
  cc.saveYourCommands([cmd()], '');
  assert.match(fs.readFileSync(process.env.COMMANDS_FILE, 'utf8'), /run: ddev drush cr/);
  assert.throws(() => cc.saveYourCommands([cmd({ label: 'Other' })], '1'), (err) => err.code === 'CHANGED');
  cc.saveYourCommands([], String(Math.floor(fs.statSync(process.env.COMMANDS_FILE).mtimeMs)));
  assert.ok(!fs.existsSync(process.env.COMMANDS_FILE));
});

test('Definition refuses an empty paste and a YAML alias bomb, and says what would change', () => {
  shipped();
  assert.match(cc.checkDefinition('').errors.join(' '), /empty/);
  const levels = ['a: &a [x, x, x, x, x, x, x, x, x]'];
  for (const [i, k] of ['b', 'c', 'd', 'e'].entries()) levels.push(`${k}: &${k} [${Array(9).fill(`*${'abcd'[i]}`).join(', ')}]`);
  const started = Date.now();
  assert.match(cc.checkDefinition([...levels, 'commands: []'].join('\n')).errors.join(' '), /too large or too deeply nested/);
  assert.ok(Date.now() - started < 2000);
  assert.match(cc.checkDefinition('commands:\n  - { id: x, label: X, on: project, run: echo $X }\n').errors.join(' '), /Command 1 \(x\): .*\$ or a backtick/);
  const r = cc.checkDefinition('commands:\n  - { id: ddev-restart, label: Restart it, on: project, when: [ddev], run: ddev restart }\n  - { id: mine, label: Mine, on: workspace, run: ls }\n');
  assert.deepStrictEqual(r.errors, []);
  assert.match(r.notes.join(' '), /Adds ddev-restart, mine\./);
  assert.match(r.notes.join(' '), /Your version of the built-in ddev-restart\./);
});

test('a target stays inside its workspace or project, and gives only the values it has', () => {
  const wsDir = path.join(tmp, 'ws1');
  const site = path.join(wsDir, 'site');
  fs.mkdirSync(path.join(site, 'web', 'modules'), { recursive: true });
  fs.writeFileSync(path.join(site, 'composer.json'), '{}');
  fs.writeFileSync(path.join(wsDir, 'notes.md'), '# notes');
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'commands-outside-'));
  process.on('exit', () => fs.rmSync(outside, { recursive: true, force: true }));
  fs.writeFileSync(path.join(outside, 'secret'), 'x');
  fs.symlinkSync(outside, path.join(site, 'out'));
  const env = { isValidWorkspace: (k) => k === 'ws1', workspaceDir: () => wsDir };
  const at = (on, form) => cc.resolveTarget(cmd({ on, run: 'ls' }), { target_ws: 'ws1', ...form }, env);

  assert.match(at('project', { target_ws: 'nope' }).error, /Pick a workspace/);
  assert.match(at('project', {}).error, /Pick a project/);
  assert.match(at('project', { target_project: '../etc' }).error, /not a project name/);
  assert.match(at('file', { target_project: 'site', target_path: '../../etc/passwd' }).error, /relative path inside the target/);
  assert.match(at('file', { target_project: 'site', target_path: 'out/secret' }).error, /leads outside site/);
  assert.match(at('file', { target_project: 'site', target_path: 'a$b' }).error, /relative path inside the target/);
  assert.match(at('folder', { target_project: 'site', target_path: 'composer.json' }).error, /is not a folder/);
  assert.match(at('file', { target_project: 'site', target_path: 'web' }).error, /is not a file/);
  assert.match(at('file', { target_project: 'site' }).error, /Name the file/);

  let t = at('file', { target_project: 'site', target_path: './composer.json' });
  assert.deepStrictEqual([t.cwd, t.vars.file, t.vars.folder, t.vars.project, t.where], [site, 'composer.json', '.', 'site', 'site/composer.json']);
  t = at('folder', { target_project: 'site', target_path: 'web/modules/' });
  assert.deepStrictEqual([t.cwd, t.vars.folder, t.vars.file], [path.join(site, 'web', 'modules'), 'web/modules', '']);
  t = at('file', { target_path: 'notes.md' });
  assert.deepStrictEqual([t.cwd, t.vars.project, t.where, t.name], [wsDir, '', 'notes.md', 'ws1/notes.md']);
  t = at('workspace', { target_project: 'site' });
  assert.deepStrictEqual([t.cwd, t.vars.project, t.name], [wsDir, '', 'ws1']);

  const suggest = (on, typed) => cc.pathSuggestions(cmd({ on }), { target_ws: 'ws1', target_project: 'site', target_path: typed }, env);
  assert.deepStrictEqual(suggest('folder', 'web/'), ['web/modules/']);
  assert.deepStrictEqual(suggest('file', 'out/'), [], 'a link out of the project offers nothing');
  assert.deepStrictEqual(suggest('file', '../'), []);
});

test('the line quotes every value, and prints the markers a run is read back from', () => {
  const line = cc.commandLine(cmd({ on: 'file', run: 'head -n 5 -- {{file}}' }), { file: "it's here.txt" });
  assert.strictEqual(line, `{ head -n 5 -- 'it'\\''s here.txt' ; } && echo "ROW-ACTION succeeded" || echo "ROW-ACTION failed"`);
  const script = cc.commandLine(cmd({ run: '', script: 'dev/cmd-tools-backup-dev.sh', args: '{{project}} --keep 2' }), { project: 'site' }, {}, { workspaceDir: () => '/w/dev' });
  assert.match(script, /^\{ bash '\/w\/dev\/cmd-tools-backup-dev\.sh' 'site' --keep 2 ; \}/);
  const opt = cc.commandLine(cmd({ run: 'git switch {{opt.branch}}', options: [{ name: 'branch' }] }), {}, { branch: 'feature/x' });
  assert.match(opt, /git switch 'feature\/x'/);
});

test('the list shows built-in, yours and scripts together, and filters by source and by what it runs on', () => {
  shipped();
  const cp = require('../../commands-page');
  const scripts = [{ key: 'dev', label: 'Dev', items: [{ file: 'cmd-tools-backup-dev.sh', title: 'Back up', desc: 'Backs up a project' }] }];
  let html = cp.catalogListHtml({ per: 'all', q: '' }, { scripts });
  assert.match(html, /Scripts · Dev/);
  assert.match(html, /href="\/commands\/c\/ddev-restart"/);
  assert.match(html, /href="\/commands\/s\/dev\/cmd-tools-backup-dev\.sh"/);
  html = cp.catalogListHtml({ per: 'all', q: '', source: 'script' }, { scripts });
  assert.doesNotMatch(html, /\/commands\/c\//);
  html = cp.catalogListHtml({ per: 'all', q: '', on: 'file' }, { scripts });
  assert.match(html, /\/commands\/c\/file-head/);
  assert.doesNotMatch(html, /ddev-restart/);
});

test('the handlers: add, refuse and keep what was typed, change a built-in, copy, delete, run by id only', async () => {
  shipped();
  fs.rmSync(process.env.COMMANDS_FILE, { force: true });
  cc.invalidateCatalog();
  const actions = require('../../actions/commands-center');
  const call = async (route, form) => {
    const out = {};
    await actions[route]({ form, workspace: 'dev', pathname: route, send: (html, code = 200) => { out.html = html; out.code = code; } });
    return out;
  };
  const mtime = () => String(cc.loadCatalog().mtime);

  let r = await call('/actions/cc-save', { cc_label: 'Say hi', cc_on: 'project', cc_kind: 'run', cc_run: 'echo $HOME', mtime: mtime() });
  assert.strictEqual(r.code, 400);
  assert.match(r.html, /\$ or a backtick/);
  assert.match(r.html, /name="cc_run"[^>]*>echo \$HOME<\/textarea>/, 'a refused form keeps what was typed');
  r = await call('/actions/cc-save', { cc_label: 'Say hi', cc_on: 'folder', cc_kind: 'run', cc_run: 'ls -la', cc_when: 'git', cc_tags: 'files, look', mtime: mtime() });
  assert.strictEqual(r.code, 200, r.html);
  const e = cc.findCommand('say-hi');
  assert.deepStrictEqual([e.source, e.on, e.when, e.tags], ['yours', 'folder', ['git'], ['files', 'look']]);
  r = await call('/actions/cc-save', { cc_label: 'Again', cc_id: 'say-hi', cc_on: 'project', cc_kind: 'run', cc_run: 'ls', mtime: mtime() });
  assert.strictEqual(r.code, 409);
  r = await call('/actions/cc-save', { cc_label: 'Stale', cc_on: 'project', cc_kind: 'run', cc_run: 'ls', mtime: '1' });
  assert.strictEqual(r.code, 409);
  assert.match(r.html, /changed since this page was loaded/);

  r = await call('/actions/cc-save', { id: 'ddev-restart', cc_label: 'Restart', cc_on: 'project', cc_when: 'ddev', cc_kind: 'run', cc_run: 'ddev restart --skip-hooks', mtime: mtime() });
  assert.strictEqual(r.code, 200, r.html);
  assert.strictEqual(cc.findCommand('ddev-restart').overrides, true);
  r = await call('/actions/cc-remove', { id: 'ddev-describe', mtime: mtime() });
  assert.strictEqual(r.code, 404, 'a built-in command cannot be deleted');
  r = await call('/actions/cc-remove', { id: 'ddev-restart', mtime: mtime(), from: 'page' });
  assert.strictEqual(r.code, 200, r.html);
  assert.strictEqual(cc.findCommand('ddev-restart').source, 'builtin', 'deleting yours brings the built-in one back');

  r = await call('/actions/cc-copy', { id: 'git-status', mtime: mtime() });
  assert.strictEqual(r.code, 200, r.html);
  assert.strictEqual(cc.findCommand('git-status-copy').label, 'Git status copy');

  r = await call('/actions/cc-run', { id: 'no-such-command' });
  assert.strictEqual(r.code, 404);
  r = await call('/actions/cc-run', { id: 'git-status', target_ws: 'no-such-workspace' });
  assert.strictEqual(r.code, 400);
  assert.match(r.html, /Pick a workspace/);

  r = await call('/actions/cc-definition-save', { definition: 'commands:\n  - { id: x, label: X, on: project, run: echo $X }\n', mtime: mtime() });
  assert.strictEqual(r.code, 400);
  assert.match(r.html, /id: x, label: X/, 'a refused definition keeps what was pasted');
  r = await call('/actions/cc-reset', { mtime: mtime() });
  assert.strictEqual(r.code, 200, r.html);
  assert.ok(!fs.existsSync(process.env.COMMANDS_FILE));
});

test('code is edited and shown in Ace: YAML, shell steps, a one-line command, and a script read-only', () => {
  shipped();
  const cp = require('../../commands-page');
  const rl = require('../../row-layout');
  const def = cp.definitionBody();
  assert.match(def, /<textarea[^>]*name="definition"[^>]*data-ace="yaml"/);
  assert.match(def, /readonly[^>]*data-ace="yaml" data-ace-readonly="1" aria-label="The built-in commands"/);
  const page = cp.commandPageBody(cc.findCommand('git-status'), { scripts: [] });
  assert.match(page, /name="cc_run"[^>]*data-ace="sh" data-ace-single="1"/);
  assert.match(page, /name="cc_args"[^>]*data-ace="sh" data-ace-single="1"/);
  assert.match(page, /readonly[^>]*data-ace="yaml" data-ace-readonly="1" aria-label="This command as YAML"/);
  assert.match(cp.scriptPageBody({ ws: 'dev', file: 'cmd-x.sh', source: 'echo hi\n' }), /readonly[^>]*data-ace="sh" data-ace-readonly="1"/);
  const editor = rl.rowActionsEditorHtml();
  assert.match(editor, /name="definition"[^>]*data-ace="yaml"/);
  // The add-a-button fields moved into the modal, and its steps box is Ace too.
  assert.match(rl.addButtonFormHtml(), /name="add_steps_new"[^>]*data-ace="sh"/);
  const ui = fs.readFileSync(path.join(APP, 'public', 'ui.js'), 'utf8');
  assert.match(ui, /const single = ta\.dataset\.aceSingle === '1';/, 'a one-line editor');
  assert.match(ui, /bindKey: \{ win: 'Enter\|Shift-Enter', mac: 'Enter\|Shift-Enter' \}, exec: \(\) => \{\}/, 'Enter adds no line');
  assert.match(ui, /if \(readOnly\) editor\.setOptions\(\{ readOnly: true/, 'a read-only editor');
  assert.match(ui, /new ResizeObserver\(\(\) => editor\.resize\(\)\)\.observe\(host\)/, 'drawn again when a closed section opens');
});

test('an action step can use a command: its line, filled for the project, run from the right folder', () => {
  shipped();
  const rl = require('../../row-layout');
  const env = { workspaceDir: (k) => `/w/${k}`, exists: () => true };
  const ctx = { workspace: 'dev', project: 'site', projectDir: '/w/dev/site' };
  const action = (steps, over = {}) => rl.cleanCustom({ id: 'a', label: 'A', button: 'ddev', group: 'g', steps, ...over });

  assert.strictEqual(rl.customRefusal(action([{ use: 'git-status' }, 'echo done'])), '');
  assert.match(rl.customRefusal(action([{ use: 'Bad Id' }])), /not a command id/);
  assert.match(rl.customRefusal(action([{ use: 'git-status', command: 'ls' }])), /one or the other/);
  assert.match(rl.useRefusal(action(['echo a', { use: 'no-such-command' }])), /step 2 uses no-such-command, which is not a command/);
  assert.match(rl.useRefusal(action([{ use: 'file-head' }])), /runs on a file/);

  assert.deepStrictEqual(rl.customToDoc(action([{ use: 'git-status' }])).steps, [{ use: 'git-status' }]);
  const round = rl.cleanCustom(rl.customToDoc(action(['echo a', { use: 'drush-status', on_error: 'echo failed' }])));
  assert.deepStrictEqual(round.steps.map(rl.stepText), ['echo a', 'use: drush-status']);
  assert.strictEqual(round.steps[1].onError, 'echo failed');

  let x = cc.expandSteps(action([{ use: 'git-status' }, 'echo done']), ctx, env);
  assert.deepStrictEqual(x.entry.steps.map((s) => s.command), ['git status --short --branch', 'echo done'], 'a project command runs in the project');
  x = cc.expandSteps(action([{ use: 'workspace-ddev-list' }]), ctx, env);
  assert.strictEqual(x.entry.steps[0].command, "( cd '/w/dev' && ddev list )", 'a workspace command runs from the workspace folder');
  x = cc.expandSteps(action([{ use: 'backup-dev-project' }]), ctx, env);
  assert.strictEqual(x.entry.steps[0].command, "( cd '/w/dev' && bash '/w/dev/cmd-tools-backup-dev.sh' 'site' )", 'a script runs from its folder, the project in its arguments');
  x = cc.expandSteps(action([{ use: 'backup-dev-project' }]), ctx, { ...env, exists: () => false });
  assert.match(x.error, /does not exist/);
  x = cc.expandSteps(action([{ use: 'gone' }]), ctx, env);
  assert.match(x.error, /step 1 uses gone, which is not a command any more/);

  const switcher = action([{ use: 'git-switch-branch' }]);
  assert.deepStrictEqual(rl.effectiveOptions(switcher).map((o) => o.name), ['branch'], 'the options of a used command are asked for');
  assert.match(rl.actionCommandLine(cc.expandSteps(switcher, ctx, env).entry, { branch: 'main' }), /git fetch --prune && git switch 'main'/);

  const report = rl.checkDefinition('custom:\n  - { id: x, label: X, button: ddev, steps: [{ use: nope }] }\n', 'replace', rl.normalizeLayout({}));
  assert.match(report.errors.join(' '), /uses nope, which is not a command/);
});

test('buttons hold commands: added from a button or from the command, listed where used, and kept while used', async () => {
  shipped();
  fs.rmSync(process.env.COMMANDS_FILE, { force: true });
  cc.invalidateCatalog();
  const rl = require('../../row-layout');
  rl.resetRowLayout();
  const handlers = { ...require('../../actions/row-actions'), ...require('../../actions/commands-center') };
  const call = async (route, form) => {
    const out = {};
    await handlers[route]({ form, workspace: 'dev', pathname: route, send: (html, code = 200) => { out.html = html; out.code = code; } });
    return out;
  };

  let r = await call('/actions/row-custom-add', { for_button: 'git', add_use_git: 'git-log', add_label_git: '', add_steps_git: '', add_when_git: 'any' });
  assert.strictEqual(r.code, 200, r.html);
  const a = rl.loadRowLayoutFresh().custom.find((c) => c.id === 'last-20-commits');
  assert.deepStrictEqual([a.label, a.group, a.when, a.steps.map(rl.stepText)], ['Last 20 commits', 'Git', ['git'], ['use: git-log']], 'a command picked alone is the whole action');
  r = await call('/actions/row-custom-add', { for_button: 'ddev', add_label_ddev: 'Refresh', add_steps_ddev: 'use: drush-cache-rebuild\nuse: nope', add_when_ddev: 'ddev' });
  assert.strictEqual(r.code, 400);
  assert.match(r.html, /uses nope, which is not a command/);
  assert.match(rl.rowActionsEditorHtml(), /name="add_use_git"[\s\S]*?<option value="git-log">Last 20 commits<\/option>/, 'each Add an action box has the picker');

  r = await call('/actions/cc-save', { cc_label: 'Say where', cc_on: 'project', cc_kind: 'run', cc_run: 'pwd', mtime: String(cc.loadCatalog().mtime) });
  assert.strictEqual(r.code, 200, r.html);
  r = await call('/actions/cc-add-to-button', { id: 'say-where', button: 'more', group: 'Mine', label: '', mtime: String(rl.layoutMtime()) });
  assert.strictEqual(r.code, 200, r.html);
  assert.match(r.html, /Added to More → Mine/);
  assert.match(r.html, /<strong>More<\/strong> → Mine → Say where/, 'the command page lists where it is used');
  assert.deepStrictEqual(cc.usedBy('say-where').map((x) => [x.button, x.label]), [['more', 'Say where']]);

  r = await call('/actions/cc-remove', { id: 'say-where', mtime: String(cc.loadCatalog().mtime) });
  assert.strictEqual(r.code, 409, 'a command a button uses cannot be deleted');
  assert.match(r.html, /Say where is on a button: More → Mine → Say where/);
  assert.match(cc.checkDefinition('commands: []\n').errors.join(' '), /removes say-where, which is used by More → Mine → Say where/);
  r = await call('/actions/cc-reset', { mtime: String(cc.loadCatalog().mtime) });
  assert.strictEqual(r.code, 409);

  r = await call('/actions/cc-add-to-button', { id: 'file-head', button: 'more', mtime: String(rl.layoutMtime()) });
  assert.strictEqual(r.code, 400);
  assert.match(r.html, /runs on a file/);

  rl.resetRowLayout();
  cc.saveYourCommands([], '');
});

test('Commands is its own page: out of Settings, in the rail, and the old addresses send you to it', () => {
  const src = fs.readFileSync(path.join(APP, 'server.js'), 'utf8');
  assert.match(src, /'\/settings\/row-actions': '\/settings\/buttons'/);
  assert.doesNotMatch(src, /tab\('\/settings\/(commands|row-actions)'/, 'Settings no longer carries the commands');
  assert.match(src, /navLink\('\/commands', 'tabler:terminal-2', 'Commands'/);
  assert.match(src, /\.\.\.require\('\.\/actions\/commands-center'\)/);
  for (const route of ['/commands/c/', '/commands/s/', '/fragments/cc/run/', '/fragments/cc/script-run/']) {
    assert.ok(src.includes(route.replace(/\//g, '\\/')), `no route for ${route}`);
  }
  assert.ok(!/function commandRowsHtml/.test(src), 'the old list is gone, not left beside the new one');
});
