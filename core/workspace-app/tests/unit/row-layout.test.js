/**
 * Commands → Buttons: rows management for project rows, and the actions someone adds.
 *
 * What must never drift: with no file every row is exactly the default; every button is placed once and
 * a new one appears in its default row; rearranging never breaks a menu (markup it cannot read is left
 * alone); the dashboard's own commands can be moved and hidden but never deleted; an action's line can
 * never carry $ or a backtick, and a value reaches it only checked and single-quoted; and the row, the
 * SCREENS fragment and the Settings page are wired to it.
 */

const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');

// The GIT menu is a plugin's now (@webship/workspace-git); its slot is registered here the way the loader does.
require('../../row-layout').registerButton({ id: 'git', label: 'GIT', row: 0 });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rowlayout-'));
process.env.ROW_ACTIONS_FILE = path.join(tmp, 'row-actions.yml');
process.env.ROW_ACTIONS_SEEN_FILE = path.join(tmp, 'row-actions.seen.json');
process.env.ROW_ACTIONS_HISTORY_FILE = path.join(tmp, 'row-actions.history.jsonl');
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));

const rl = require('../../row-layout');

const action = (over = {}) => ({ id: 'cr', label: 'Rebuild caches', button: 'ddev', group: 'drupal', when: 'ddev', command: 'ddev drush cr', ...over });
const clean = (over) => rl.cleanCustom(action(over));

const DDEV_INNER = `
  <li class="uk-nav-header" data-group="project">site1</li>
  <li data-entry="start-stop"><a href hx-post="/actions/ddev-stop">Stop</a></li>
  <li><a href hx-post="/actions/ddev-restart">Restart</a></li>
  <li><a href hx-post="/actions/ddev-describe">Describe</a></li>
  <li class="uk-nav-divider"></li>
  <li class="uk-nav-header">build</li>
  <li><a href hx-post="/actions/ddev-composer-install">Composer install</a></li>
  <li class="uk-nav-divider"></li>
  <!-- a comment the arrangement may drop -->
  <li class="uk-nav-header">database</li>
  <li><a href hx-post="/actions/ddev-export-db">Export the database</a></li>
  <li class="uk-parent" data-entry="checks"><a href>Checks</a><ul class="uk-nav-sub"><li><a href>one</a></li><li><a href>two</a></li></ul></li>
  <li class="uk-nav-divider"></li>
  <li class="uk-nav-header">a note with no entries</li>`;

const texts = (html) => rl.splitTopLevelLi(html).map((li) => rl.plainText(li));

// ------------------------------------------------------------------ rows

test('with no file there are two rows, and they are the row as it was', () => {
  const layout = rl.loadRowLayoutFresh();
  assert.deepStrictEqual(rl.DEFAULT_ROWS, [
    ['ddev', 'ide', 'tests', 'git'],
    ['screens', 'composer', 'node', 'backup', 'clone', 'graph', 'rag', 'more'],
  ]);
  assert.deepStrictEqual(layout.rows, rl.DEFAULT_ROWS);
  assert.deepStrictEqual([layout.hidden, layout.custom, layout.menus], [[], [], {}]);
});

test('rows: every button placed exactly once, extra rows kept, a new button in its default row', () => {
  const l = rl.normalizeLayout({
    rows: [['git', 'nope', 'ddev', 'git'], [], ['composer', 'ddev']],
    hidden: ['rag', 'rag', 'x-unknown'],
    custom: [action({ id: 'deploy', button: 'tools', when: 'any', command: 'ddev deploy' })],
  });
  assert.strictEqual(l.rows.length, 3, 'an empty row someone added stays');
  assert.deepStrictEqual(l.rows[0].slice(0, 2), ['git', 'ddev'], 'the saved order first, duplicates dropped');
  assert.strictEqual(l.rows[2][0], 'composer');
  assert.deepStrictEqual(l.hidden, ['rag']);
  const all = [...l.rows.flat(), ...l.hidden];
  assert.strictEqual(all.length, new Set(all).size, 'no button twice');
  for (const b of rl.BUILTIN_BUTTONS) assert.ok(all.includes(b.id), `${b.id} is missing`);
  assert.ok(l.rows[0].includes('ide'), 'a button the file never mentions keeps its default row');
  assert.ok(l.rows[1].includes('tools'), 'a button made by an action goes to the second row');
  assert.ok(!all.includes('nope') && !all.includes('x-unknown'));

  // The first version of the file called rows `lines`, and still loads.
  assert.deepStrictEqual(rl.normalizeLayout({ lines: [['more'], ['ddev']] }).rows[0][0], 'more');
  const many = rl.normalizeLayout({ rows: Array.from({ length: 9 }, () => []) });
  assert.strictEqual(many.rows.length, rl.MAX_ROWS);
});

// ------------------------------------------------------------------ actions

test('an action must be safe to hand to the screen runner, and only goes where a menu is', () => {
  assert.strictEqual(rl.customRefusal(clean()), '');
  assert.strictEqual(rl.customRefusal(clean({ command: 'git pull --ff-only && ddev drush cr -y' })), '');
  for (const [over, why] of [
    [{ command: 'echo $HOME' }, /\$ or a backtick/],
    [{ command: 'echo `id`' }, /\$ or a backtick/],
    [{ command: 'ddev drush cr\nrm -rf ~' }, /one line/],
    [{ command: '' }, /steps|one line/],
    [{ steps: ['ok', { command: 'bad $X' }] }, /step 2/],
    [{ steps: [{ command: 'ok', on_error: 'echo `id`' }] }, /on_error/],
    [{ label: 'say "hi"' }, /label/],
    [{ id: 'Bad Id' }, /id/],
    [{ button: 'DDEV!' }, /button/],
    [{ button: 'backup' }, /single button/],
    [{ when: ['ddev', 'always'] }, /when/],
    [{ command: 'git switch {{opt.branch}}' }, /no option called branch/],
    [{ options: [{ name: 'b', enforced: true }] }, /enforced but lists no values/],
    [{ options: [{ name: 'b', regex: '(' }] }, /regex does not compile/],
    [{ options: [{ name: 'b', value: 'x$y' }] }, /\$/],
    [{ options: [{ name: 'b' }, { name: 'b' }] }, /unique/],
  ]) {
    assert.match(rl.customRefusal(clean(over)), why, JSON.stringify(over));
  }
  assert.deepStrictEqual(rl.normalizeLayout({ custom: [action({ command: 'echo $X' })] }).custom, [], 'refused entries never reach the layout');
});

test('when is a filter: every clause must match, ! negates, a workspace can be named', () => {
  const ctx = { key: 'dev', isDdev: true, hasComposer: true, hasNode: false, hasGit: true };
  assert.strictEqual(rl.whenMatches(['ddev', 'composer'], ctx), true);
  assert.strictEqual(rl.whenMatches(['ddev', 'node'], ctx), false);
  assert.strictEqual(rl.whenMatches(['ddev', '!workspace:products'], ctx), true);
  assert.strictEqual(rl.whenMatches(['ddev', '!workspace:products'], { ...ctx, key: 'products' }), false);
  assert.strictEqual(rl.whenMatches('any', {}), true);
  assert.strictEqual(rl.whenMatches(undefined, {}), true);
  assert.strictEqual(rl.describeWhen(['ddev', '!workspace:products']), 'DDEV projects and not the products workspace');
});

test('steps become one line: && stops at a failure, keepgoing runs on, on_error takes the step\'s place', () => {
  const stop = rl.cleanCustom(action({ steps: ['a', 'b'] }));
  assert.strictEqual(rl.actionCommandLine(stop), '{ { a ; } && { b ; } ; } && echo "ROW-ACTION succeeded" || echo "ROW-ACTION failed"');
  const go = rl.cleanCustom(action({ keepgoing: true, steps: ['a', { command: 'b', on_error: 'c' }] }));
  const line = rl.actionCommandLine(go);
  assert.match(line, /^\{ \{ \{ a ; \} \|\| echo "ROW-ACTION step 1 failed" ; \} ; \{ \{ \{ b ; \} \|\| \{ echo "ROW-ACTION step 2 failed: running its on_error" ; c ; \} ; \} \|\| echo "ROW-ACTION step 2 failed" ; \} ; \}/);
  for (const l of [rl.actionCommandLine(stop), line]) assert.ok(!l.includes('$'), l);
});

test('an option is checked, falls back to its default, and reaches the line single-quoted', () => {
  const e = rl.cleanCustom(action({
    command: 'git switch {{opt.branch}} && echo {{opt.note}}',
    options: [
      { name: 'branch', value: 'main', regex: '^[A-Za-z0-9._/-]+$', required: true },
      { name: 'note', value: '' },
      { name: 'env', values: ['dev', 'stage'], enforced: true, value: 'dev' },
    ],
  }));
  assert.strictEqual(rl.customRefusal(e), '');
  let r = rl.resolveOptions(e, {});
  assert.deepStrictEqual(r.values, { branch: 'main', note: '', env: 'dev' }, 'defaults');
  r = rl.resolveOptions(e, { opt_branch: 'feature/x', opt_note: "it's fine; rm -rf ~", opt_env: 'stage' });
  assert.strictEqual(rl.actionCommandLine(e, r.values).split(' && echo "ROW-ACTION')[0],
    "{ { git switch 'feature/x' && echo 'it'\\''s fine; rm -rf ~' ; } ; }");
  assert.match(rl.resolveOptions(e, { opt_branch: 'bad branch!' }).error, /does not match/);
  assert.match(rl.resolveOptions(e, { opt_env: 'prod' }).error, /must be one of/);
  assert.match(rl.resolveOptions(e, { opt_note: 'x $(id)' }).error, /\$/);
  const req = rl.cleanCustom(action({ command: 'echo {{opt.who}}', options: [{ name: 'who', required: true }] }));
  assert.match(rl.resolveOptions(req, {}).error, /required/);
});

test('a run\'s result is read from the markers its line prints', () => {
  assert.deepStrictEqual(rl.runStatus('x\nROW-ACTION succeeded\n', false), { state: 'succeeded', note: '' });
  assert.deepStrictEqual(rl.runStatus('ROW-ACTION failed', false).state, 'failed');
  assert.deepStrictEqual(rl.runStatus('ROW-ACTION step 2 failed\nROW-ACTION succeeded', false), { state: 'partly', note: 'step 2 failed' });
  assert.strictEqual(rl.runStatus('ROW-ACTION step 1 failed: running its on_error\nROW-ACTION succeeded', false).state, 'succeeded', 'a handled step is not a failed one');
  assert.strictEqual(rl.runStatus('working…', true).state, 'running');
  assert.strictEqual(rl.runStatus('', false).state, 'unknown');
});

// ------------------------------------------------------------------ menus

test('a menu is split into its top-level entries; anything else in it means it is left alone', () => {
  assert.deepStrictEqual(texts(DDEV_INNER).slice(0, 3), ['site1', 'Stop', 'Restart']);
  assert.strictEqual(rl.splitTopLevelLi('<li>a</li> stray text <li>b</li>'), null);
  assert.strictEqual(rl.splitTopLevelLi('<li>a</li><li>unclosed'), null);
  const layout = rl.normalizeLayout({ menus: { ddev: { groups: ['build'] } } });
  assert.strictEqual(rl.arrangeNavInner('ddev', '<li>a</li> text', { layout }), '<li>a</li> text');
});

test('with nothing saved a menu keeps its order and every entry', () => {
  const out = rl.arrangeNavInner('ddev', DDEV_INNER, { layout: rl.normalizeLayout({}) });
  assert.deepStrictEqual(texts(out).filter(Boolean), texts(DDEV_INNER).filter(Boolean));
});

test('a menu with nothing to apply is returned exactly as it was rendered, and is still recorded', () => {
  const inner = '<li class="uk-nav-header" data-group="fastpath">x</li>\n  <!-- kept -->\n  <li><a>Only here</a></li>';
  const out = rl.arrangeNavInner('fastpath-menu', inner, { layout: rl.normalizeLayout({}) });
  assert.strictEqual(out, inner, 'no settings and no actions: not rebuilt at all');
  assert.strictEqual(rl.seenMenu('fastpath-menu').groups.fastpath.entries['only here'], 'Only here', 'still listed for the Settings page');
  // A menu with an action of yours in it is rebuilt, so the action can be added.
  const withAction = rl.normalizeLayout({ custom: [action({ id: 'fp', label: 'FP', button: 'fastpath-menu', group: 'fastpath', when: 'any', command: 'echo fp' })] });
  assert.match(rl.arrangeNavInner('fastpath-menu', inner, { layout: withAction, key: 'dev', project: 'p' }), /"id":"fp"/);
});

test('groups and the commands inside them follow the saved order; hidden ones go; nested entries survive', () => {
  const layout = rl.normalizeLayout({ menus: { ddev: {
    groups: ['database', 'build'],
    order: { project: ['describe', 'start-stop'] },
    hidden_entries: ['restart'],
  } } });
  const out = rl.arrangeNavInner('ddev', DDEV_INNER, { layout });
  const headers = rl.splitTopLevelLi(out).filter((li) => li.includes('uk-nav-header')).map((li) => rl.plainText(li));
  assert.deepStrictEqual(headers, ['database', 'build', 'site1', 'a note with no entries']);
  const project = texts(out).slice(texts(out).indexOf('site1'));
  assert.deepStrictEqual(project.slice(1, 3), ['Describe', 'Stop'], 'the order of the commands inside a group');
  assert.ok(!/Restart/.test(out));
  assert.match(out, /<ul class="uk-nav-sub"><li><a href>one<\/a><\/li><li><a href>two<\/a><\/li><\/ul>/);

  const hide = rl.normalizeLayout({ menus: { ddev: { hidden_groups: ['build'], hidden_entries: ['export the database', 'checks'] } } });
  const out2 = rl.arrangeNavInner('ddev', DDEV_INNER, { layout: hide });
  assert.ok(!/Composer install|>build</.test(out2), 'a hidden group goes with its header');
  assert.ok(!/>database</.test(out2), 'a group whose every entry is hidden loses its header too');
  assert.match(out2, /a note with no entries/, 'a header that never had entries is a note, and stays');
});

test('a group and an entry are named by data-group / data-entry first, else by their text', () => {
  assert.strictEqual(rl.groupKeyOf('<li class="uk-nav-header" data-group="project">my-site</li>'), 'project');
  assert.strictEqual(rl.groupKeyOf('<li class="uk-nav-header">Git · main</li>'), 'git');
  assert.strictEqual(rl.entryKey('<li data-entry="start-stop"><a>Start</a></li>'), 'start-stop');
  assert.strictEqual(rl.entryKey('<li><a>Build the graph (running…)</a></li>'), 'build the graph');
});

test('actions go into their group only where they apply, once per button, and open the way they say', () => {
  const layout = rl.normalizeLayout({ custom: [
    action({ when: ['ddev', '!workspace:products'], confirm: true }),
    action({ id: 'mine', label: 'Say hello', group: 'Mine', when: 'any', command: 'echo hello' }),
    action({ id: 'switch', label: 'Switch branch', group: 'Mine', when: 'any', command: 'git switch {{opt.b}}', options: [{ name: 'b', value: 'main' }] }),
  ] });
  const onDdev = rl.arrangeNavInner('ddev', DDEV_INNER, { layout, key: 'dev', project: 'site1', isDdev: true });
  assert.match(onDdev, /hx-post="\/actions\/row-custom-run" hx-vals='\{"workspace":"dev","projectName":"site1","id":"cr"\}'[^>]*class="arm-step" hx-trigger="confirmed-remove"/, 'confirm asks in a dialog first');
  assert.match(onDdev, /<li class="uk-nav-header" data-group="mine">Mine<\/li><li><a [^>]*"id":"mine"/, 'a group that does not exist is made');
  assert.match(onDdev, /hx-post="\/actions\/row-custom-options"[^>]*"id":"switch"[^>]*hx-target="#editor-modal-body"/, 'an action with options opens its form');
  assert.ok(!/"id":"cr"/.test(rl.arrangeNavInner('ddev', DDEV_INNER, { layout, key: 'products', project: 'x', isDdev: true })), '!workspace:products');
  assert.ok(!/"id":"cr"/.test(rl.arrangeNavInner('ddev', DDEV_INNER, { layout, key: 'dev', project: 'x', isDdev: false })));

  const twoLists = '<div><ul class="uk-nav uk-dropdown-nav"><li><span>info</span></li></ul><ul class="uk-nav uk-dropdown-nav"><li><a href>go</a></li></ul></div>';
  const out = rl.arrangeButtonHtml('ddev', twoLists, { layout, isDdev: true, key: 'dev', project: 'site1' });
  assert.strictEqual((out.match(/"id":"mine"/g) || []).length, 1, 'one copy, in the list that has links');
});

test('rows render in order; hidden and inapplicable buttons draw nothing; rows past the second come out as extra', () => {
  const btn = (id) => `<span class="b-${id}"><ul class="uk-nav uk-dropdown-nav"><li><a href>${id}</a></li></ul></span>`;
  const buttons = Object.fromEntries(rl.BUILTIN_BUTTONS.map((b) => [b.id, btn(b.id)]));
  buttons.clone = '';
  const layout = rl.normalizeLayout({
    rows: [['git', 'ddev'], ['more'], ['composer']],
    hidden: ['tests'],
    custom: [action({ id: 'deploy', label: 'Deploy', button: 'tools', group: 'Ship', when: 'git', command: 'git push' })],
  });
  const order = (html) => [...html.matchAll(/class="b-([a-z]+)"/g)].map((m) => m[1]);
  let out = rl.rowLinesHtml(buttons, { layout, key: 'dev', project: 'p', hasGit: false });
  assert.deepStrictEqual(order(out.first).slice(0, 2), ['git', 'ddev']);
  assert.deepStrictEqual(out.extra.length, 1);
  assert.deepStrictEqual(order(out.extra[0]), ['composer']);
  assert.ok(!out.rows.join('').includes('b-tests'), 'hidden');
  assert.ok(!/act-menu-tools/.test(out.second), 'no git here, so no TOOLS button');
  out = rl.rowLinesHtml(buttons, { layout, key: 'dev', project: 'p', hasGit: true });
  assert.match(out.second, /act-menu-tools[\s\S]*TOOLS[\s\S]*"id":"deploy"/);
});

test('a menu can be laid out in columns, each group in the column it was put in', () => {
  const btn = `<div uk-dropdown class="ddev-dropdown-wide"><ul class="uk-nav uk-dropdown-nav ddev-nav-columns">${DDEV_INNER}</ul></div>`;
  const layout = rl.normalizeLayout({ menus: { ddev: { columns: [['project', 'build'], ['database']] } } });
  const out = rl.columnizeButtonHtml('ddev', rl.arrangeButtonHtml('ddev', btn, { layout }), layout);
  const m = /<div class="menu-columns menu-columns-2">(<ul[^>]*>[\s\S]*<\/ul>)<\/div>/.exec(out);
  assert.ok(m, out.slice(0, 300));
  // Split at each column's own list: a nested sub-list inside an entry has its own </ul>.
  const lists = m[1].split('<ul class="uk-nav uk-dropdown-nav">').slice(1);
  assert.strictEqual(lists.length, 2);
  assert.ok(!/ddev-nav-columns/.test(m[1]), 'the lists are not split again by DDEV\'s own CSS columns');
  assert.match(lists[0], />site1<[\s\S]*>build</);
  assert.match(lists[1], />database<[\s\S]*a note with no entries/, 'a group not placed yet goes to the last column');
  // One column, a menu that lays out its own, or a list filled in by a request: left as it was.
  assert.strictEqual(rl.columnizeButtonHtml('ddev', btn, rl.normalizeLayout({})), btn);
  const composer = rl.normalizeLayout({ menus: { composer: { columns: [['daily'], ['inspect']] } } });
  assert.strictEqual(rl.columnizeButtonHtml('composer', btn, composer), btn);
  const loader = '<div><ul class="uk-nav uk-dropdown-nav" hx-get="/fragments/x"><li>loading…</li></ul></div>';
  assert.strictEqual(rl.columnizeButtonHtml('ddev', loader, layout), loader);

  rl.arrangeNavInner('ddev', DDEV_INNER, { layout: rl.normalizeLayout({}) });
  const doc = rl.arrangementFromForm(rl.normalizeLayout({}), {
    menu_present_ddev: '1', columns_ddev: '2', group_ddev: ['project', 'build', 'database'],
    gcol_ddev: ['project\t0', 'build\t1', 'database\t7'],
  });
  assert.deepStrictEqual(rl.normalizeLayout(doc).menus.ddev.columns, [['project'], ['build', 'database']], 'a column that no longer exists hands its groups to the last');
  assert.deepStrictEqual(rl.normalizeLayout(rl.arrangementFromForm(rl.normalizeLayout({}), { menu_present_ddev: '1', columns_ddev: '1' })).menus.ddev.columns, []);
  rl.saveRowLayout(rl.normalizeLayout(doc));
  const html = rl.rowActionsEditorHtml('', 0, { openButton: 'ddev' });
  assert.match(html, /<details class="row-button-body" open>[\s\S]*name="columns_ddev"/, 'the card being worked in stays open');
  assert.match(html, /data-col="1"[^>]*uk-sortable="group: cols-ddev/);
  assert.match(html, /COMPOSER lays out its own columns/);
  rl.resetRowLayout();
});

// ------------------------------------------------------------------ the file

test('saving refuses a file that changed since the form was drawn; reset goes back to the defaults', () => {
  const mtime = rl.saveRowLayout(rl.normalizeLayout({ hidden: ['rag'] }));
  assert.ok(fs.readFileSync(process.env.ROW_ACTIONS_FILE, 'utf8').startsWith('# Rows management'));
  assert.deepStrictEqual(rl.loadRowLayoutFresh().hidden, ['rag']);
  assert.throws(() => rl.saveRowLayout(rl.normalizeLayout({}), mtime - 1000), (e) => e.code === 'CHANGED');
  rl.resetRowLayout(rl.layoutMtime());
  assert.strictEqual(fs.existsSync(process.env.ROW_ACTIONS_FILE), false);
  fs.writeFileSync(process.env.ROW_ACTIONS_FILE, 'rows: [ [unclosed');
  const broken = rl.loadRowLayoutFresh();
  assert.deepStrictEqual(broken.rows, rl.DEFAULT_ROWS, 'a file that does not parse falls back to the defaults');
  assert.ok(broken.error);
  fs.unlinkSync(process.env.ROW_ACTIONS_FILE);
  rl.invalidateRowLayout();
});

test('Definition: a pasted file is checked before anything is written, and loads like rd jobs load', () => {
  const current = rl.normalizeLayout({ custom: [action({ id: 'keep', label: 'Keep me', when: 'any', command: 'echo keep' })] });
  assert.match(rl.checkDefinition('rows: [ [', 'replace', current).errors[0], /does not parse/);
  assert.match(rl.checkDefinition('custom:\n  - id: x\n    label: X\n    button: ddev\n    command: echo $HOME\n', 'replace', current).errors[0], /Action 1 \(x\).*\$ or a backtick/);
  const replace = rl.checkDefinition('rows:\n  - [ddev, nope]\nhidden: [rag]\n', 'replace', current);
  assert.deepStrictEqual(replace.errors, []);
  assert.match(replace.notes.join(' '), /Not a button, so ignored: nope/);
  assert.strictEqual(replace.next.custom.length, 0, 'replace takes the whole file');
  const pasted = 'custom:\n  - { id: keep, label: Changed, button: ddev, command: echo changed }\n  - { id: new-one, label: New, button: tools, command: echo new }\n';
  const skip = rl.checkDefinition(pasted, 'skip', current);
  assert.match(skip.notes[0], /1 action\(s\) added, 0 updated, 1 skipped/);
  assert.strictEqual(skip.next.custom.find((c) => c.id === 'keep').label, 'Keep me');
  const update = rl.checkDefinition(pasted, 'update', current);
  assert.strictEqual(update.next.custom.find((c) => c.id === 'keep').label, 'Changed');
  assert.ok(rl.definitionText().includes('rows:'), 'with no file the definition shows the defaults');
});

test('a YAML alias bomb is refused at once, wherever it is, and an empty paste says it is empty', () => {
  const levels = ['a: &a ["lol","lol","lol","lol","lol","lol","lol","lol","lol"]'];
  for (let i = 1; i < 9; i += 1) { const p = String.fromCharCode(96 + i); levels.push(`${String.fromCharCode(97 + i)}: &${String.fromCharCode(97 + i)} [${Array(9).fill(`*${p}`).join(',')}]`); }
  const current = rl.normalizeLayout({});
  for (const where of ['rows', 'hidden', 'menus', 'custom', 'lines']) {
    const t0 = Date.now();
    const r = rl.checkDefinition(`${levels.join('\n')}\n${where}: *i\n`, 'replace', current);
    assert.ok(Date.now() - t0 < 1000, `${where}: took ${Date.now() - t0}ms`);
    assert.match(r.errors[0] || '', /too large or too deeply nested/, where);
  }
  // Loading such a file is refused the same way: every page is rendered from it.
  fs.writeFileSync(process.env.ROW_ACTIONS_FILE, `${levels.join('\n')}\nrows: *i\n`);
  const t0 = Date.now();
  const l = rl.loadRowLayoutFresh();
  assert.ok(Date.now() - t0 < 1000, `loading took ${Date.now() - t0}ms`);
  assert.deepStrictEqual(l.rows, rl.DEFAULT_ROWS);
  assert.match(l.error, /too large or too deeply nested/);
  fs.unlinkSync(process.env.ROW_ACTIONS_FILE);
  rl.invalidateRowLayout();
  // A list inside a list is skipped, not turned into text.
  assert.deepStrictEqual(rl.normalizeLayout({ rows: [[['ddev', 'git'], 'more', 12, null]] }).rows[0][0], 'more');
  for (const empty of ['', '   \n\n']) {
    assert.match(rl.checkDefinition(empty, 'replace', current).errors[0], /The definition is empty/);
  }
  assert.strictEqual(rl.withinBudget({ rows: rl.DEFAULT_ROWS, custom: [] }), true);
});

test('what a menu showed is remembered, and the editor offers it: built-in commands hide, yours edit and delete', () => {
  rl.arrangeNavInner('ddev', DDEV_INNER, { layout: rl.normalizeLayout({}) });
  const groups = rl.seenMenu('ddev').groups;
  assert.ok(groups.project && groups.build && groups.database, Object.keys(groups).join(','));
  rl.saveRowLayout(rl.normalizeLayout({ custom: [action({ id: 'mine', label: 'Say hello', group: 'build', when: 'any', command: 'echo hi' })] }));
  const html = rl.rowActionsEditorHtml();
  assert.match(html, /name="hide_entry_ddev" value="start-stop"/);
  assert.match(html, /name="entry_ddev" value="project&#9;start-stop"/, 'the order of each command is posted with its group');
  assert.match(html, /row-entry-builtin[^>]*>built in</);
  assert.match(html, /hx-post="\/actions\/row-custom-save" hx-vals='\{"id":"mine"/);
  assert.match(html, /hx-post="\/actions\/row-custom-remove" hx-vals='\{"id":"mine"[^>]*hx-trigger="confirmed-remove">Delete/);
  assert.ok(!/row-custom-remove[^>]*"id":"start-stop"/.test(html), 'a built-in command has no delete');
  // Add a row and add a button open in the modal now; their forms are checked in rows-add-modal.test.js.
  assert.match(html, /hx-get="\/fragments\/row\/add-row"[\s\S]{0,140}Add a row/);
  assert.match(html, /<li><a href="#">Rows<\/a><\/li><li><a href="#">Activity<\/a><\/li><li><a href="#">Definition<\/a><\/li>/);
  rl.resetRowLayout();
});

test('the Rows tab keeps your place: a save bar in view, open cards and scroll carried over, a warning before losing changes', () => {
  const html = rl.rowActionsEditorHtml();
  assert.match(html, /<div class="row-save-bar">\s*<span class="row-unsaved-note" role="status">Unsaved changes<\/span>\s*<button type="submit"[^>]*>[^<]*<span[^>]*><\/span> Save the rows<\/button>\s*<\/div>\s*<\/form>/,
    'Save sits in the sticky bar at the end of the Rows form');
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'components', 'settings-editor-core-config-yml.css'), 'utf8');
  assert.match(css, /\.row-save-bar \{ position: sticky; bottom: 0;/);
  assert.match(css, /#row-arrange-form\[data-dirty="1"\] \.row-unsaved-note \{ display: inline; \}/);
  const ui = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'ui.js'), 'utf8');
  // htmx 4 event names: the old camel-case ones never fire, which is how the first version of this did nothing.
  assert.match(ui, /addEventListener\('htmx:before:swap', \(e\) => \{\s*const from = [^\n]*closest\('#row-actions-editor'\)[\s\S]*?details\.row-button-body\[open\][\s\S]*?scrollY/, 'the open cards and the scroll position are remembered');
  assert.match(ui, /addEventListener\('htmx:after:swap', \(e\) => \{\s*if \(!rowEditorPlace\) return;\s*if \(swappedEl\(e\)\.id !== 'row-actions-editor'\) \{ rowEditorPlace = null; return; \}[\s\S]*?d\.open = true;[\s\S]*?window\.scrollTo\(0, place\.y\)/, 'and restored only after the editor itself is swapped');
  assert.ok(!/'htmx:(beforeSwap|afterSwap)'/.test(ui), 'no listener uses the htmx 1/2 event names, which htmx 4 never fires');
  assert.match(ui, /beforeunload[\s\S]*#row-arrange-form\[data-dirty="1"\][\s\S]*e\.preventDefault\(\)/, 'leaving with unsaved changes asks first');
  assert.match(ui, /\/\^\(add\|edit\)_\/\.test\(el\.name\)/, 'the action fields, which save on their own, do not mark the rows as changed');
});

test('a save writes only what differs from what a menu shows by default', () => {
  rl.arrangeNavInner('ddev', DDEV_INNER, { layout: rl.normalizeLayout({}) });
  rl.arrangeNavInner('ide', '<li class="uk-nav-header">link</li><li><a>Status</a></li><li><a>Logs</a></li>', { layout: rl.normalizeLayout({}) });
  const untouched = (id) => {
    const cat = rl.seenMenu(id).groups;
    return {
      [`menu_present_${id}`]: '1',
      [`group_${id}`]: Object.keys(cat),
      [`entry_${id}`]: Object.entries(cat).flatMap(([g, v]) => Object.keys(v.entries).map((e) => `${g}\t${e}`)),
    };
  };
  // Every card posts its whole, unchanged order; the one change is a hidden command in DDEV.
  const form = { ...untouched('ddev'), ...untouched('ide'), hide_entry_ddev: 'restart' };
  const doc = rl.toDoc(rl.normalizeLayout(rl.arrangementFromForm(rl.normalizeLayout({}), form)));
  assert.deepStrictEqual(Object.keys(doc.menus), ['ddev'], 'a menu nobody changed is not written');
  assert.deepStrictEqual(doc.menus.ddev, { groups: [], hidden_groups: [], hidden_entries: ['restart'] }, 'nor the order of a menu that was only hidden from');

  // A real change of order is kept — of the groups, and of the commands inside one.
  const cat = rl.seenMenu('ddev').groups;
  const groups = Object.keys(cat).reverse();
  const project = Object.keys(cat.project.entries).reverse();
  const moved = rl.toDoc(rl.normalizeLayout(rl.arrangementFromForm(rl.normalizeLayout({}), {
    menu_present_ddev: '1', group_ddev: groups,
    entry_ddev: [...project.map((e) => `project\t${e}`), ...Object.keys(cat.build.entries).map((e) => `build\t${e}`)],
  })));
  assert.deepStrictEqual(moved.menus.ddev.groups, groups);
  assert.deepStrictEqual(moved.menus.ddev.order, { project }, 'only the group whose commands moved');
});

test('every command can be reordered without dragging: move arrows beside its handle', () => {
  rl.arrangeNavInner('ddev', DDEV_INNER, { layout: rl.normalizeLayout({}) });
  const html = rl.rowActionsEditorHtml();
  const items = html.split('<li class="row-entry-item">').slice(1).map((x) => x.split('</li>')[0]);
  assert.ok(items.length > 0);
  for (const item of items) {
    assert.match(item, /row-handle-entry/);
    assert.match(item, /<span class="ws-move">[\s\S]*title="Move [^"]+ up"[\s\S]*title="Move [^"]+ down"/, 'each command has its own arrows');
  }
});

test('the Rows form describes rows, the order inside groups, and hidden commands', () => {
  rl.arrangeNavInner('ddev', DDEV_INNER, { layout: rl.normalizeLayout({}) });
  const layout = rl.normalizeLayout({});
  const doc = rl.arrangementFromForm(layout, {
    button: ['more', 'ddev', 'git'], row_more: '0', row_ddev: '1', row_git: 'hidden',
    menu_present_ddev: '1', group_ddev: ['build', 'project'], entry_ddev: ['project\tdescribe', 'project\tstart-stop', 'project\tnope'],
    hide_entry_ddev: 'restart',
  });
  const next = rl.normalizeLayout(doc);
  assert.strictEqual(next.rows[0][0], 'more');
  assert.ok(next.rows[1].includes('ddev'));
  assert.deepStrictEqual(next.hidden, ['git']);
  assert.ok(next.rows[0].includes('ide'), 'a button the form did not carry keeps the place it had');
  assert.deepStrictEqual(next.menus.ddev.groups.slice(0, 2), ['build', 'project']);
  assert.deepStrictEqual(next.menus.ddev.order.project, ['describe', 'start-stop'], 'an entry the menu never had is dropped');
  assert.deepStrictEqual(next.menus.ddev.hiddenEntries, ['restart']);
});

test('a run is recorded, and settled only once its log says how it ended', () => {
  rl.recordRun({ at: new Date().toISOString(), id: 'mine', label: 'Say hello', workspace: 'dev', project: 'p', session: 'dev--p--custom-mine-test' });
  assert.strictEqual(rl.readRuns().length, 1);
  // No output yet — the run may still be going (a request refused as "still running" calls this too):
  // it must stay open, not be written down as unknown mid-run.
  rl.settleRun('dev--p--custom-mine-test');
  assert.strictEqual(rl.readRuns()[0].status, undefined);
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'row-layout.js'), 'utf8');
  const fn = src.slice(src.indexOf('function settleRun('), src.indexOf('// ---', src.indexOf('function settleRun(')));
  assert.match(fn, /if \(!\/ROW-ACTION \(succeeded\|failed\)\/\.test\(text\)\) return;/, 'settled only from a finished log');
});

test('the handlers: runs by id only, refuses a $ anywhere, keeps unknown buttons out, manages rows and actions', async () => {
  const actions = require('../../actions/row-actions');
  const call = async (route, form) => {
    const out = {};
    await actions[route]({ form, workspace: 'test', pathname: route, send: (html, code = 200) => { out.html = html; out.code = code; } });
    return out;
  };
  let r = await call('/actions/row-custom-run', { projectName: 'anything', id: 'no-such-action' });
  assert.strictEqual(r.code, 404);
  r = await call('/actions/row-custom-run', { projectName: '../etc', id: 'x' });
  assert.strictEqual(r.code, 400);
  r = await call('/actions/row-custom-add', { for_button: 'ddev', add_label_ddev: 'Bad', add_steps_ddev: 'echo $HOME' });
  assert.strictEqual(r.code, 400);
  assert.match(r.html, /\$ or a backtick/);

  r = await call('/actions/row-arrange-save', { button: ['git', 'evil', 'ddev'], row_git: '0', row_ddev: 'hidden', row_evil: '0' });
  assert.strictEqual(r.code, 200);
  let saved = rl.loadRowLayoutFresh();
  assert.strictEqual(saved.rows[0][0], 'git');
  assert.deepStrictEqual(saved.hidden, ['ddev']);
  assert.ok(!saved.rows.flat().includes('evil'));

  r = await call('/actions/row-rows', { op: 'add' });
  assert.strictEqual(rl.loadRowLayoutFresh().rows.length, 3);
  r = await call('/actions/row-rows', { op: 'remove', index: '1' });
  saved = rl.loadRowLayoutFresh();
  assert.strictEqual(saved.rows.length, 2);
  assert.ok(saved.rows[0].includes('screens'), 'a removed row\'s buttons move to the row above');

  r = await call('/actions/row-custom-add', { for_button: '__new__', add_button_new: 'tools', add_label_new: 'Say hello', add_steps_new: 'echo one\necho two', add_open_new: 'screen', add_confirm_new: '1' });
  assert.strictEqual(r.code, 200, r.html);
  let e = rl.loadRowLayoutFresh().custom.find((c) => c.id === 'say-hello');
  assert.deepStrictEqual([e.button, e.steps.length, e.open, e.confirm], ['tools', 2, 'screen', true]);
  r = await call('/actions/row-custom-save', { id: 'say-hello', edit_label_say_hello: 'x', 'edit_label_say-hello': 'Say hi', 'edit_group_say-hello': 'Ship', 'edit_when_say-hello': 'git !workspace:products', 'edit_steps_say-hello': 'echo hi', 'edit_open_say-hello': 'toast' });
  assert.strictEqual(r.code, 200, r.html);
  e = rl.loadRowLayoutFresh().custom.find((c) => c.id === 'say-hello');
  assert.deepStrictEqual([e.label, e.group, e.when, e.steps.length, e.open, e.confirm], ['Say hi', 'Ship', ['git', '!workspace:products'], 1, 'toast', false]);
  r = await call('/actions/row-custom-remove', { id: 'start-stop' });
  assert.strictEqual(r.code, 404, 'a built-in command cannot be deleted');
  r = await call('/actions/row-custom-remove', { id: 'say-hello' });
  assert.strictEqual(rl.loadRowLayoutFresh().custom.length, 0);

  r = await call('/actions/row-definition-check', { definition: 'custom:\n  - { id: a, label: A, button: ddev, command: echo `id` }\n', mode: 'replace' });
  assert.strictEqual(r.code, 400);
  r = await call('/actions/row-definition-save', { definition: 'hidden: [rag]\n', mode: 'replace' });
  assert.strictEqual(r.code, 200, r.html);
  assert.deepStrictEqual(rl.loadRowLayoutFresh().hidden, ['rag']);
  await call('/actions/row-layout-reset', {});
  assert.deepStrictEqual(rl.loadRowLayoutFresh().rows, rl.DEFAULT_ROWS);
});

test('the row, the SCREENS fragment and the Commands page are wired to rows management', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');
  const map = /rowLayout\.rowLinesHtml\(\{([\s\S]*?)\}, rowCtx, \{ preArranged: new Set\(\['ddev', 'more'\]\) \}\)/.exec(src);
  assert.ok(map, 'the row draws its rows from rowLinesHtml');
  // The GIT slot is registered by this test (a plugin's), so it reaches the layout through pluginRowMenus, not the map.
  for (const b of rl.BUILTIN_BUTTONS) if (b.id !== 'git') assert.match(map[1], new RegExp(`\\b${b.id}: \\w+`), `${b.id} is not handed to the layout`);
  assert.match(src, /<div class="pcard-tools"[^>]*>\s*\$\{rowLines\.first\}\$\{rowLines\.second\}/);
  // The empty extra rows are filtered out, and what remains joins the same strip of tools on the card.
  assert.match(src, /const extraRows = rowLines\.extra\.filter\(Boolean\);/);
  assert.match(src, /\$\{extraRows\.join\(''\)\}/);
  assert.match(src, /const ddevItems = rowLayout\.arrangeNavInner\('ddev', ddevMenuItems, rowCtx\);/);
  assert.match(src, /return res\.end\(rowLayout\.arrangeNavInner\('screens', screensNav,/);
  assert.match(src, /'\/settings\/buttons'[\s\S]{0,400}settingsPage\('buttons'/);
  assert.match(src, /\.\.\.require\('\.\/actions\/row-actions'\)/);
  const ui = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'ui.js'), 'utf8');
  assert.match(ui, /function syncRowButtons\(\)/, 'a dragged button carries its new row into the form');
});

/* ------------------------------------------------------------------ *
 * How much of a button is drawn
 * ------------------------------------------------------------------ */

test('a button shows its icon, its text, or both — the same three the navigation gives', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'row-layout.js'), 'utf8');
  // Deliberately the same word: a row of buttons and a rail of entries are the same question about room.
  assert.match(src, /show:\s+\{ <id>: icon \| text \}/, 'and the file says so');
  assert.match(src, /const how = \(layout\.show \|\| \{\}\)\[id\];/);
  assert.match(src, /`<span class="row-show-\$\{how\}">\$\{placed\}<\/span>`/,
    'the button is WRAPPED, never rewritten — its markup is built by whoever added it');
  assert.ok(server.length > 0);
});

test('only icon and text are values; anything else is no value at all', () => {
  fs.writeFileSync(process.env.ROW_ACTIONS_FILE, 'rows:\n  - [ddev]\nshow:\n  ddev: icon\n  screens: sideways\n  nosuchbutton: text\n');
  const l = rl.loadRowLayoutFresh();
  assert.deepStrictEqual(l.show, { ddev: 'icon' }, 'a value it does not know, and a button it does not know, are dropped');
});

test('both is not written down: the file stays a record of what somebody changed', () => {
  fs.writeFileSync(process.env.ROW_ACTIONS_FILE, 'rows:\n  - [ddev]\n');
  const layout = rl.loadRowLayoutFresh();
  const doc = rl.arrangementFromForm(layout, { button: ['ddev'], row_ddev: '0', show: ['ddev:both'] });
  assert.ok(!doc.show || !doc.show.ddev, 'both leaves no trace');

  const on = rl.arrangementFromForm(layout, { button: ['ddev'], row_ddev: '0', show: ['ddev:icon'] });
  assert.deepStrictEqual(on.show, { ddev: 'icon' });
});

test('posting both is what turns it back off', () => {
  fs.writeFileSync(process.env.ROW_ACTIONS_FILE, 'rows:\n  - [ddev]\nshow:\n  ddev: icon\n');
  const layout = rl.loadRowLayoutFresh();
  assert.strictEqual(layout.show.ddev, 'icon');
  const off = rl.arrangementFromForm(layout, { button: ['ddev'], row_ddev: '0', show: ['ddev:both'] });
  assert.ok(!off.show || !off.show.ddev);
});

test('a button the form did not carry keeps the answer it had', () => {
  fs.writeFileSync(process.env.ROW_ACTIONS_FILE, 'rows:\n  - [ddev, screens]\nshow:\n  screens: icon\n');
  const layout = rl.loadRowLayoutFresh();
  const doc = rl.arrangementFromForm(layout, { button: ['ddev'], row_ddev: '0', show: ['ddev:text'] });
  assert.strictEqual(doc.show.screens, 'icon', 'the one that was not on the form is not forgotten');
  assert.strictEqual(doc.show.ddev, 'text');
});

test('the wrapper is what the stylesheet hides through, and the label stays in the markup', () => {
  fs.writeFileSync(process.env.ROW_ACTIONS_FILE, 'rows:\n  - [ddev]\nshow:\n  ddev: icon\n');
  rl.loadRowLayoutFresh();
  const out = rl.rowLinesHtml({ ddev: '<button class="uk-button"><span uk-icon="icon: x"></span> DDEV</button>' }, {});
  assert.match(out.first, /class="row-show-icon"/);
  assert.match(out.first, /DDEV/, 'a screen reader still reads the name: this is presentation only');
});

test('a plugin button registers like a built-in one, in its default row, once', () => {
  rl.registerButton({ id: 'x-cloud', label: 'CLOUD', row: 0 });
  rl.registerButton({ id: 'x-cloud', label: 'CLOUD', row: 0 });
  assert.strictEqual(rl.DEFAULT_ROWS[0].filter((b) => b === 'x-cloud').length, 1);
  const l = rl.normalizeLayout({ rows: [['ddev'], []] });
  assert.ok(l.rows[0].includes('x-cloud'), 'a layout written before the plugin existed still places its button');
});
