/**
 * The SCREENS menu: a pick closes it, and what it says is current.
 *
 * Choosing "Open the screen" started the terminal and left the menu open on top of it — a control that
 * looks like it did not take, over the thing it just did. The close rule was scoped to items carrying
 * `uk-toggle` (the modal openers), and a screens item carries `data-open-terminal` instead, so it was
 * never covered.
 *
 * The timing had the opposite problem: every project row polled its own screens list every 15 seconds
 * whether or not anybody looked at it — a request per row, forever — while the things that actually
 * change the list (starting a session, stopping one) waited out that poll before the page admitted it.
 * So: slower in the background, immediate when something changes and immediate when the menu opens.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '../..');
const ui = fs.readFileSync(path.join(APP, 'public/ui.js'), 'utf8');
const server = fs.readFileSync(path.join(APP, 'server.js'), 'utf8');
const actions = fs.readFileSync(path.join(APP, 'actions/screens.js'), 'utf8');

test('a pick closes the menu it was made in, whatever the item does', () => {
  // The general rule, not a list of the item kinds somebody remembered: opening a modal, opening a
  // terminal and posting an action are all picks, and none of them is the outside click UIkit closes on.
  const block = ui.slice(ui.indexOf('// A pick closes the menu it was made in.'));
  assert.match(block, /e\.target\.closest\('\.uk-dropdown a, \.uk-dropdown button'\)/);
  assert.match(block, /UIkit\.dropdown\(drop\)\.hide\(0\)/);
  // The old rule was narrower, and that is exactly why the screens menu was missed.
  assert.ok(!/closest\('\.act-menu \[uk-toggle\]'\)/.test(ui), 'the uk-toggle-only rule is gone');
});

test('a dropdown that is being typed in or paged stays open', () => {
  const block = ui.slice(ui.indexOf('// A pick closes the menu it was made in.'));
  // Only links and buttons close it, so a filter box inside a picker keeps its menu.
  assert.ok(!/'\.uk-dropdown input/.test(block), 'inputs are not picks');
  assert.match(block, /if \(item\.closest\('\[data-keep-open\]'\)\) return;/);
  // And the one place that needs it today: switching npm/yarn changes which pane shows INSIDE the
  // menu, so closing on it would make the other manager unreachable.
  assert.match(server, /class="uk-tab node-tabs" data-keep-open/);
});

test('the row polls slowly, and catches up the moment anything happens', () => {
  // The row's SCREENS is the shared lazy shell (plugin-loader's menuShellHtml): its body is
  // /fragments/row-menu/screens/<ws>/<project>, fetched on `menu-opened` by the shell itself and, for the
  // badges that ride on the answer, on the triggers the row adds.
  const shell = server.match(/menuShellHtml\('screens', \{[\s\S]*?triggers: '([^']+)'/)[1];
  const loader = fs.readFileSync(path.join(__dirname, '..', '..', 'plugin-loader.js'), 'utf8');
  const menu = `${loader.match(/const trigger = \['([a-z-]+)'/)[1]}, ${shell}`;
  assert.match(menu, /every 30s/, 'the background poll is the cheap one');
  assert.ok(!/every 15s/.test(menu), 'not twice a minute per row, forever');
  assert.match(menu, /screens-changed from:body/, 'a session starting or stopping reaches it');
  assert.match(menu, /menu-opened/, 'and opening it asks for what is there now');
});

test('opening a menu asks for its contents', () => {
  // A list of sessions is the one thing the menu is opened to read, and a stale one is how you click a
  // session that has already finished.
  const block = ui.slice(ui.indexOf('// Opening a menu asks for what is in it NOW.'));
  assert.match(block, /addEventListener\('beforeshow'/, "UIkit's own event, before it is on screen");
  assert.match(block, /querySelector\('\[hx-trigger\*="menu-opened"\]'\)/);
  assert.match(block, /dispatchEvent\(new CustomEvent\('menu-opened'\)\)/);
});

test('starting and stopping a session both say so', () => {
  // Otherwise the count in the topbar, the row's menu and the screens page each wait out their own
  // poll before admitting to something you did a moment ago.
  const started = actions.slice(actions.indexOf('async function screen_new'));
  assert.match(started, /'screens-changed': \{ session: fullSession \}/);
  assert.match(actions, /'screen-killed': \{ session \}, 'screens-changed': \{ session \}/);
  // And the three places that listen.
  assert.match(server, /screens-count" hx-get="\/fragments\/screens-count" hx-trigger="load, every 30s, screens-changed from:body/);
  assert.match(server, /screens-grid" hx-trigger="refresh-projects from:body, screens-changed from:body/);
});

test('a session in the menu says what it is doing', () => {
  // The row already tells you something is running; the menu is where you choose WHICH, so each line
  // carries its state rather than only its name.
  const items = server.slice(server.indexOf('const items = sessions.map((s) => {'), server.indexOf("}).join('');", server.indexOf('const items = sessions.map((s) => {')));
  assert.match(items, /uk-label-warning" title="\$\{esc\(why\)\}">✋ waiting/);
  assert.match(items, /uk-label-success">running/);
  assert.match(items, /dead \? '<span class="uk-label">dead<\/span>'/, 'a session whose process is gone opens onto nothing');
  assert.match(items, /isAgent \? iconHtml\('tabler:robot-face'/);
  // The name is `<workspace>--<project>--<what>`, and the first two are the row it is already on.
  assert.match(items, /s\.session\.startsWith\(`\$\{ws\}--\$\{project\}--`\)/);
  assert.match(items, /title="\$\{esc\(s\.session\)\}/, 'the whole name is still one hover away');
});
