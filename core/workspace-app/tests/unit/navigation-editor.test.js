/**
 * The Navigation editor and its endpoints.
 *
 * Two things here have already broken once and must not again. **A form's fields cannot share a name
 * with the arrangement's**: the Add form posts the whole arrangement with it (hx-include), so an input
 * called `group` merged with the sidebar's group order and the typed value arrived as the whole list
 * joined by commas. And **the group an entry posts is rewritten on every drop**, because htmx collects
 * a form's values when the request is TRIGGERED — rewriting them in htmx:before:request is already too
 * late, and the save kept arriving with every entry still in the group it was rendered in.
 */

const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'navigation-editor-'));
process.env.NAVIGATION_FILE = path.join(tmp, 'navigation.yml');
process.env.NAVIGATION_SEEN_FILE = path.join(tmp, 'navigation.seen.json');
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));

const read = (f) => fs.readFileSync(path.join(__dirname, '..', '..', f), 'utf8');
const nav = require('../../navigation');
const page = read('navigation-page.js');
const actions = read('actions/navigation.js');
const ui = read('public/ui.js');
const server = read('server.js');
const tabs = read('commands-page.js');

test('the Add form shares no field name with the arrangement it posts with it', () => {
  const add = page.slice(page.indexOf('class="nav-add-form"'));
  const names = [...add.matchAll(/name="([a-z_]+)"/g)].map((m) => m[1]);
  assert.ok(names.length >= 5, 'the form still has its fields');
  for (const n of names) {
    assert.ok(!['group', 'item', 'scope', 'mtime'].includes(n),
      `"${n}" is a field of the arrangement; hx-include would merge the two into one value`);
  }
  assert.ok(names.every((n) => n.startsWith('new_')), 'every field of the Add form is prefixed');
  for (const n of names) assert.match(actions, new RegExp(`form\\.${n}\\b`), `the endpoint reads ${n}`);
});

test('the group an entry posts is rewritten on every drop, not when the form is sent', () => {
  assert.match(ui, /window\.navSyncGroups = function navSyncGroups/);
  assert.match(ui, /for \(const ev of \['moved', 'added', 'removed', 'stop'\]\)/,
    "UIkit's sortable events are the moment the values go stale");
  assert.match(ui, /input\.value = `\$\{list\.dataset\.group\}:\$\{entry\.dataset\.id\}`/);
});

test('every list is a drop target of the same sortable group, so one drag reaches them all', () => {
  const lists = [...page.matchAll(/class="nav-entries" data-group="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(lists.includes('hidden'), 'Hidden is a place you can drag into');
  // The three regions are drawn from one template, so the source carries the interpolated name once.
  assert.ok(lists.includes('topbar-${r}'), 'each top-bar region is a drop target');
  assert.match(page, /rail\.REGIONS\.map\(\(r\) =>/, 'and all three are drawn, not one hardcoded');
  const sortables = [...page.matchAll(/uk-sortable="group: nav-entries/g)];
  assert.strictEqual(sortables.length, 3, "the regions, the sidebar groups and Hidden are all one sortable group — each drawn once, from a template");
});

test('a reserved list is never saved back as a sidebar group', () => {
  assert.match(actions, /\.filter\(\(g\) => !rail\.RESERVED\.has\(g\)\)/);
  assert.match(actions, /const region = rail\.regionOf\(group\);/);
  assert.match(actions, /if \(region\) \{ topbar\[region\]\.push\(id\); continue; \}/);
});

test('the group order is a set: a repeat would draw the same group twice', () => {
  assert.match(actions, /\[\.\.\.new Set\(asArray\(form\.group\)/);
});

test('an added link is an https address or a path of this dashboard, and nothing else', () => {
  assert.match(actions, /\/\^\(https\?:\\\/\\\/\|\\\/\)\[\^\\s"'<>\]\*\$\/i/,
    'javascript: and data: never reach an href');
  assert.match(actions, /An entry is a link or a command, not both/);
  assert.match(actions, /No such command/, 'a use: must name a command of the catalog');
});

test('every write carries the mtime and is refused with 409 when the file changed underneath', () => {
  assert.match(actions, /if \(String\(form\.mtime \|\| ''\) !== String\(mtime\)\) \{/);
  const refusals = [...actions.matchAll(/, 409\)/g)];
  assert.ok(refusals.length >= 3, 'save, add and remove all refuse rather than overwrite');
  assert.match(page, /name="mtime" value="\$\{mtime\}"/);
});

test('removing an entry asks first, the way every destructive action here does', () => {
  assert.match(page, /class="uk-button uk-button-link nav-remove arm-step"/);
  assert.match(page, /hx-trigger="confirmed-remove"/);
});

test('the navigation is a SETTING, and both the tabs it used to be land on it', () => {
  // What the sidebar and the top bar show is configuration, not a command — so it is a Settings tab.
  // It was Commands → Rail, then Commands → Navigation; neither bookmark is a dead link.
  assert.match(server, /pathname === '\/commands\/rail' \|\| pathname === '\/commands\/navigation'[\s\S]{0,240}Location: `\/settings\/navigation/);
  assert.match(server, /pathname === '\/settings\/navigation'/);
  assert.match(server, /settingsPage\('navigation', readPageState\(req\), \{ scope, fragment: isFragment\(req\) \}\)/);
  assert.match(server, /card\('\/settings\/navigation', 'tabler:layout-sidebar-right', 'Navigation',/,
    'and it is one of the cards there, in The dashboard group rather than among the workspaces');
  assert.ok(!tabs.includes('/commands/navigation'), 'and no longer one of the Commands tabs');
  assert.match(page, /href="\/settings\/navigation\?scope=/, 'the scope tabs stay inside Settings');
});

test('adding opens in the editor modal, and posts the arrangement with it', () => {
  // The add card sat under a list of groups that can run past the fold, so the way to put something IN
  // the navigation was the one thing you had to scroll to find.
  assert.match(page, /hx-get="\/fragments\/nav-add\?scope=/);
  assert.match(page, /hx-target="#editor-modal-body"/);
  assert.match(server, /pathname === '\/fragments\/nav-add'/);
  const form = page.slice(page.indexOf('function navAddFormHtml'));
  assert.match(form, /hx-include="#nav-form"/, 'a drag that has not been saved is not lost by adding');
  assert.match(form, /hx-target="#nav-editor" hx-swap="outerHTML"/, 'the answer is the editor behind it');
  assert.match(form, /UIkit\.modal\('#editor-modal'\)\.hide\(\)/, 'which the modal stops covering');
});

test('the Add form offers the two places by name, rather than asking for a group id', () => {
  const form = page.slice(page.indexOf('function navAddFormHtml'));
  assert.match(form, /optgroup label="The navigation topbar"/);
  assert.match(form, /optgroup label="The navigation sidebar"/);
  assert.match(form, /rail\.REGIONS\.map\(\(r\) => `<option value="topbar-\$\{r\}">/);
  assert.match(form, /<option value="yours" selected>/, 'with a sensible default');
});

test('the top bar renders only the regions that have something in them', () => {
  assert.match(server, /const topbarHtml = \(region\) => \(topbar\[region\]\.length/,
    'an empty region is three pieces of furniture for no one');
  assert.match(server, /toolbar-nav toolbar-nav-\$\{region\}/);
  assert.match(server, /\$\{topbarHtml\('start'\)\}/);
  assert.match(server, /uk-navbar-center[\s\S]{0,80}topbarHtml\('center'\)/);
  assert.match(server, /\$\{topbarHtml\('end'\)\}/);
});

test('two entries never share an id: a layout would move or hide both at once', () => {
  assert.match(server, /id: 'open-screens'/,
    "the Screens BUTTON is not the Go group's Screens link");
});

test('a fresh install has the AI assistant at the start of the top bar too', () => {
  assert.match(server, /\{ id: 'ai-assistant', topbar: 'start', show: 'icon', label: assistantName/,
    'it applies to whatever page you are on, and it is the only way in when the panel is closed');
  // Its menu is anchored below the control, because the control is PLACED now rather than fixed to the
  // rail: centred on the left it opened across the wordmark with half of it off the top of the page.
  assert.match(server, /uk-dropdown="mode: click; pos: bottom-right"/);
});

test('a fresh install has the version at the start of the top bar and the screens count at the end', () => {
  // Both are default PLACEMENTS in the code, so a machine with no core/config/navigation.yml — which is
  // every fresh install — gets them, and arranging either in Settings → Navigation still wins.
  assert.match(server, /id: 'version',\s*\n\s*topbar: 'start',/,
    'the release is what the product IS: it belongs beside the wordmark');
  assert.match(server, /id: 'open-screens',\s*\n\s*topbar: 'end',/,
    'a live count of what is running is a status, not a page action');
});

test('the screens status is on every page: what is running is a fact about the machine', () => {
  const block = server.slice(server.indexOf('// Not gated on Jira'), server.indexOf("id: 'open-screens'"));
  assert.ok(!block.includes("if (view === 'workspace'"),
    'a count that appeared on /dev and vanished on /settings was telling you about the page');
  assert.ok(/not gated on being on a[\s/]*workspace page/i.test(block), 'and it says why');
});

test('the status button carries its own class rather than having one patched into its markup', () => {
  assert.match(server, /action-btn actions-screens" type="button"/);
  assert.ok(!/it\.html\.replace\('<\/button>'/.test(server),
    'reaching into a button\'s markup to add a class is how this breaks');
});

test('the button follows the count, the way a project row SCREENS button does', () => {
  const css = read('public/css/components/settings-editor-core-config-yml.css');
  assert.match(css, /\.toolbar-nav \.actions-screens:has\(\.uk-badge\)/,
    'the count arrives on a poll, so the button follows the badge rather than a re-render');
  assert.match(css, /\.actions-screens \.screens-count:empty \{ display: none; \}/,
    'nothing running, nothing shouting');
  assert.match(server, /n \? ` <span class="uk-badge">\$\{n\}<\/span>` : ''/,
    'and the fragment says nothing at all when nothing is running');
});

test("a plugin's group is given ids, so what a plugin adds can be arranged like anything else", () => {
  assert.match(server, /id: g\.id \|\| rail\.slugId\(g\.label\)/);
  assert.match(server, /return \{ id: rail\.slugId\(label\), label, html: it \};/);
});

test('Settings is grouped and shown as a grid, not 26 identical pills', () => {
  // The hub's own settings, an editor that is not a file at all, and twenty-four workspaces were all
  // weighted the same and wrapped onto three lines.
  assert.match(server, /<h2 class="settings-group-head">The dashboard<\/h2>/);
  assert.match(server, /<h2 class="settings-group-head">Workspace settings<\/h2>/);
  // Every editor that is not a settings FILE has to be excluded here, or choosing it would fall
  // through to the index. Matched loosely on purpose: the list grows (Command order joined it), and a
  // test that pins the exact expression fails on the addition rather than on the behaviour.
  assert.match(server, /const isIndex = !isScreens && !isNavigation && !isButtons &&[^;]*!current;/,
    'with nothing chosen the page IS the index, rather than defaulting into one file');
  assert.match(server, /class="settings-grid"/);
  // Not `settings-card`: that is already the class of the settings FORM wrapper, and a grid rule on it
  // squeezed that form's description into a 71px ribbon down the right of the page.
  assert.match(server, /class="settings-tile\$\{active \? ' is-current' : ''\}"/);
});

test('a workspace card carries that workspace own icon and name', () => {
  assert.match(server, /const m = meta\[key\] \|\| \{\};/);
  assert.match(server, /m\.icon \|\| 'tabler:folder',\s*\n?\s*m\.label \|\| key/);
});

test('opening one gives it the width, with a line back rather than the whole list again', () => {
  assert.match(server, /class="settings-back"/);
  assert.match(server, /href="\/settings">\s*<span uk-icon="icon: arrow-left; ratio: \.8"><\/span> All settings<\/a>/);
});

test('each entry says how much of itself is shown, and the control offers all three', () => {
  const card = page.slice(page.indexOf('function entryCard'), page.indexOf('function navEditorHtml'));
  assert.match(card, /<select class="nav-entry-show" name="show"/);
  for (const how of ['both', 'icon', 'text']) {
    assert.ok(card.includes(`:${how}"`), `${how} is one of the answers`);
  }
  assert.match(card, /aria-label="How much of \$\{esc\(label\)\} is shown"/, 'and the control has a name');
});

test('the drawn state of that control is the layout answer, or the way the entry ships', () => {
  assert.match(page, /const asked = own\.show\[id\];/);
  assert.match(page, /return shipsAs\(id\) \|\| 'both';/);
  assert.match(page, /const shipsAs = \(id\) => rail\.seenShips\(seenItem\(id\)\);/);
});

test('both is not written down, except when it overrides something the dashboard ships', () => {
  assert.match(actions, /if \(how === 'both' && ships\[id\]\) show\[id\] = 'both';/,
    'without it there would be no way to put the assistant label back — leaving the key out lets its own default win again');
  assert.match(actions, /function shippedShow\(scope\)/, 'and what ships is read from what the navigation drew');
});

test('an entry shown one way is WRAPPED, never rewritten', () => {
  assert.match(server, /const navItemHtml = \(it\) => \(it\.show === 'icon' \|\| it\.show === 'text'/,
    "an entry's html is built by whatever added it; reaching into that string is how this breaks");
  assert.match(server, /nav-show-\$\{it\.show\}/);
  assert.match(server, /\$\{g\.items\.map\(\(it\) => railIcons\(navItemHtml\(it\)\)\)\.join\(''\)\}/, 'the sidebar draws it');
  assert.match(server, /topbar\[region\]\.map\(\(it\) => navItemHtml\(it\)\)/, 'and so does the top bar');
});

test('the assistant ships as its mark alone, and keeps its label in the markup', () => {
  assert.match(server, /\{ id: 'ai-assistant', topbar: 'start', show: 'icon', label: assistantName/);
  assert.match(server, /\$\{AI_MARK\}<span class="action-label">\$\{esc\(assistantName\)\}<\/span>/,
    'a screen reader still reads the name; hiding it is presentation only');
});

test('every place that names the assistant reads the same setting', () => {
  // A heading, a button, a launcher and a full page, each with its own hardcoded 'AI Assistant',
  // is four things to miss when somebody renames it — and the one that gets missed is the one that
  // then contradicts the other three. They all go through assistantIdentityFor(context).
  assert.match(server, /const assistantName = assistantIdentityFor\(context\)\.name;/,
    'the navigation control');
  assert.match(server, /<h3 class="uk-margin-remove">\$\{esc\(identity\.name\)\}<\/h3>/,
    "the panel's heading");
  assert.match(server, /title="Ask the \$\{esc\(assistantIdentityFor\(context\)\.name\)\}"/,
    'the launcher, which is the way back in when the panel is closed');
  assert.match(server, /<h1 class="uk-margin-remove">\$\{esc\(identity\.name\)\}<\/h1>/,
    'the full page at /assistant');
  assert.doesNotMatch(server, /\$\{scopeLabel\} AI Assistant/,
    'and none of them prefixes the workspace: it is not the "Designs AI Assistant"');
});

test('the panel and the composer are scoped to the page, not to the whole dashboard', () => {
  assert.match(server, /data-settings="\$\{esc\(JSON\.stringify\(assistantSettings\(context\)\)\)\}"/,
    'the placeholder is a per-workspace setting, so the panel has to be told which page it is on');
});
