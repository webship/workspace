/**
 * Commands → Navigation: the sidebar and the top bar, arranged.
 *
 * What must never drift: with no file the navigation is exactly what the code built; hiding, reordering
 * and adding are presentation only; an entry lives in exactly ONE place, so moving it to the top bar
 * takes it out of its sidebar group; a workspace's own settings are applied after the global ones; an
 * added link can only be an https address or a path of this dashboard; and the reserved lists (the three
 * top-bar regions and Hidden) are never written back as sidebar groups.
 */

const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'navigation-'));
process.env.NAVIGATION_FILE = path.join(tmp, 'navigation.yml');
process.env.NAVIGATION_SEEN_FILE = path.join(tmp, 'navigation.seen.json');
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));

const nav = require('../../navigation');

const entry = (id, label = id) => ({ id, label, html: `<a class="action-btn" href="/${id}"><span class="action-label">${label}</span></a>` });
const built = () => ([
  { id: 'create', label: 'Create', items: [entry('new-project', 'New project')] },
  { id: 'go', label: 'Go', items: [entry('all-workspaces', 'All workspaces'), entry('commands', 'Commands'), entry('help', 'Help')] },
]);
const write = (raw) => nav.saveLayout(raw);
const reset = () => { try { fs.unlinkSync(process.env.NAVIGATION_FILE); } catch (_) { /* already gone */ } };

test('with no file the navigation is what the code built, and the top bar is empty', () => {
  reset();
  const out = nav.arrange(built(), 'global');
  assert.deepStrictEqual(out.groups.map((g) => g.id), ['create', 'go']);
  assert.deepStrictEqual(out.groups[1].items.map((i) => i.id), ['all-workspaces', 'commands', 'help']);
  assert.deepStrictEqual(nav.REGIONS.map((r) => out.topbar[r].length), [0, 0, 0]);
});

test('an id slugs from the label with any count stripped, so a backup does not forget the layout', () => {
  assert.strictEqual(nav.slugId('Backups (2)'), 'backups');
  assert.strictEqual(nav.slugId('Run a tool (13)'), 'run-a-tool');
  assert.strictEqual(nav.slugId('All workspaces'), 'all-workspaces');
});

test('hidden is presentation only: the entry goes, the group survives its last entry leaving', () => {
  write({ global: { hidden: ['commands'] } });
  const out = nav.arrange(built(), 'global');
  assert.deepStrictEqual(out.groups[1].items.map((i) => i.id), ['all-workspaces', 'help']);

  write({ global: { hidden: ['new-project'] } });
  const only = nav.arrange(built(), 'global');
  assert.ok(!only.groups.some((g) => g.id === 'create'), 'a group with nothing left in it is not drawn');
});

test('order names what it names; anything unlisted keeps its place AFTER it', () => {
  write({ global: { groups: ['go', 'create'], order: { go: ['help', 'commands'] } } });
  const out = nav.arrange(built(), 'global');
  assert.deepStrictEqual(out.groups.map((g) => g.id), ['go', 'create'], 'the group order is the one named');
  assert.deepStrictEqual(out.groups[0].items.map((i) => i.id), ['help', 'commands', 'all-workspaces'],
    'an entry the layout has never seen must not vanish into the middle of it');
});

test('an entry moved to the top bar leaves its sidebar group: it is in one place, not two', () => {
  write({ global: { topbar: { end: ['commands'] } } });
  const out = nav.arrange(built(), 'global');
  assert.deepStrictEqual(out.topbar.end.map((i) => i.id), ['commands']);
  assert.deepStrictEqual(out.groups.find((g) => g.id === 'go').items.map((i) => i.id), ['all-workspaces', 'help']);
  assert.deepStrictEqual(out.topbar.start, []);
  assert.deepStrictEqual(out.topbar.center, []);
});

test('the three regions are kept apart, and each is in the order the layout names', () => {
  write({ global: { topbar: { start: ['help'], center: ['commands'], end: ['all-workspaces', 'new-project'] } } });
  const out = nav.arrange(built(), 'global');
  assert.deepStrictEqual(out.topbar.start.map((i) => i.id), ['help']);
  assert.deepStrictEqual(out.topbar.center.map((i) => i.id), ['commands']);
  assert.deepStrictEqual(out.topbar.end.map((i) => i.id), ['all-workspaces', 'new-project'],
    'the order inside a region is the order it was saved in');
  assert.deepStrictEqual(out.groups, [], 'everything moved up leaves nothing behind');
});

test('an entry the dashboard ships in the top bar stays there until someone says otherwise', () => {
  reset();
  const groups = [{ id: 'screens', label: 'Screens', items: [{ ...entry('open-screens', 'Screens'), topbar: 'end' }] }];
  const shipped = nav.arrange(groups, 'global');
  assert.deepStrictEqual(shipped.topbar.end.map((i) => i.id), ['open-screens'],
    'a live count is a status, glanced at rather than gone to');
  assert.deepStrictEqual(shipped.groups, [], 'and it is not also down the side');

  write({ global: { order: { screens: ['open-screens'] } } });
  const moved = nav.arrange(groups, 'global');
  assert.deepStrictEqual(moved.topbar.end, [], 'naming it anywhere is saying otherwise');
  assert.deepStrictEqual(moved.groups.map((g) => g.id), ['screens']);

  write({ global: { topbar: { start: ['open-screens'] } } });
  assert.deepStrictEqual(nav.arrange(groups, 'global').topbar.start.map((i) => i.id), ['open-screens'],
    'and so is moving it to another region');

  write({ global: { hidden: ['open-screens'] } });
  const gone = nav.arrange(groups, 'global');
  assert.deepStrictEqual(gone.topbar.end, []);
  assert.deepStrictEqual(gone.groups, [], 'hiding it takes it out of the default placement too');
});

test('what the dashboard ships in the top bar: the assistant and the version, then the screens count', () => {
  reset();
  const groups = [
    { id: 'screens', label: 'Screens', items: [{ ...entry('open-screens', 'Screens'), topbar: 'end' }] },
    { id: 'go', label: 'Go', items: [
      entry('commands', 'Commands'),
      { ...entry('ai-assistant', 'AI Assistant'), topbar: 'start' },
      { ...entry('version', '1.0.12'), topbar: 'start' },
    ] },
  ];
  const out = nav.arrange(groups, 'global');
  assert.deepStrictEqual(out.topbar.start.map((i) => i.id), ['ai-assistant', 'version'],
    'in the order the page built them, so a default placement does not need an order of its own');
  assert.deepStrictEqual(out.topbar.end.map((i) => i.id), ['open-screens']);
  assert.deepStrictEqual(out.groups.map((g) => g.id), ['go'], 'and neither is also down the side');
  assert.deepStrictEqual(out.groups[0].items.map((i) => i.id), ['commands']);
});

test('hidden beats the top bar: an entry hidden is nowhere at all', () => {
  write({ global: { hidden: ['commands'], topbar: { end: ['commands'] } } });
  const out = nav.arrange(built(), 'global');
  assert.deepStrictEqual(out.topbar.end, []);
  assert.ok(!out.groups.some((g) => g.items.some((i) => i.id === 'commands')));
});

test("a workspace's own settings are applied after the global ones", () => {
  write({ global: { hidden: ['help'] }, workspaces: { dev: { topbar: { start: ['commands'] } } } });
  const onDev = nav.arrange(built(), 'dev');
  assert.deepStrictEqual(onDev.topbar.start.map((i) => i.id), ['commands'], "the workspace's own move applies");
  assert.ok(!onDev.groups.some((g) => g.items.some((i) => i.id === 'help')), 'and the global hide still applies');

  const elsewhere = nav.arrange(built(), 'global');
  assert.deepStrictEqual(elsewhere.topbar.start, [], "a workspace's move is that workspace's alone");
});

test('scopeFor reads the page context, and anything else is the global scope', () => {
  assert.strictEqual(nav.scopeFor('workspace:dev'), 'dev');
  assert.strictEqual(nav.scopeFor('backups:dev'), 'dev');
  assert.strictEqual(nav.scopeFor('commands:navigation'), 'global');
  assert.strictEqual(nav.scopeFor('home'), 'global');
  assert.strictEqual(nav.scopeFor(undefined), 'global');
});

test('an added entry joins the group it names, or a group of its own at the end', () => {
  write({ global: { items: [{ id: 'jira', label: 'Jira', href: 'https://vardot.atlassian.net', group: 'go' }] } });
  const inGo = nav.arrange(built(), 'global').groups.find((g) => g.id === 'go');
  assert.deepStrictEqual(inGo.items.map((i) => i.id), ['all-workspaces', 'commands', 'help', 'jira']);

  write({ global: { items: [{ id: 'jira', label: 'Jira', href: 'https://vardot.atlassian.net' }] } });
  const own = nav.arrange(built(), 'global').groups;
  assert.strictEqual(own[own.length - 1].id, 'yours', 'with no group named it is Yours, at the end');
});

test('an added entry can name a top-bar region as its group and land there', () => {
  write({ global: { items: [{ id: 'jira', label: 'Jira', href: 'https://x.example', group: 'topbar-center' }] } });
  const out = nav.arrange(built(), 'global');
  assert.deepStrictEqual(out.topbar.center.map((i) => i.id), ['jira']);
  assert.ok(!out.groups.some((g) => g.id === 'topbar-center'), 'a region is never a sidebar group');
});

test('an added entry that is a link off this dashboard opens in a new tab, and one inside it does not', () => {
  const away = nav.customItemHtml({ id: 'jira', label: 'Jira', href: 'https://vardot.atlassian.net' });
  assert.match(away, /target="_blank"/);
  assert.match(away, /rel="noopener"/);
  const here = nav.customItemHtml({ id: 'dev', label: 'Dev', href: '/dev' });
  assert.ok(!here.includes('target="_blank"'), 'replacing the page you are working on is not what a link here does');
});

test('an added entry that runs a command goes through the same runner and the same confirm dialog', () => {
  const plain = nav.customItemHtml({ id: 'cr', label: 'Rebuild', use: 'drush-cr' });
  assert.match(plain, /hx-post="\/actions\/nav-run"/);
  assert.ok(!plain.includes('arm-step'), 'a command that does not ask is not armed');
  const asks = nav.customItemHtml({ id: 'cr', label: 'Rebuild', use: 'drush-cr', confirm: true });
  assert.match(asks, /arm-step/);
  assert.match(asks, /hx-trigger="confirmed-remove"/, 'the request fires on the dialog alone');
});

test('an icon that is not a name we know falls back rather than reaching the markup', () => {
  const html = nav.customItemHtml({ id: 'x', label: 'X', href: '/x', icon: '"><script>alert(1)</script>' });
  assert.ok(!html.includes('<script>'), 'nothing a person types becomes markup');
  assert.match(html, /icon: link;/, 'and it draws the fallback icon');
});

test('withScope drops what is empty, so the file stays a record of what someone changed', () => {
  const raw = nav.withScope({}, 'global', { hidden: [], groups: [], order: {}, topbar: nav.emptyTopbar(), items: [] });
  assert.deepStrictEqual(raw, {}, 'a scope with nothing in it is not written at all');

  const one = nav.withScope({}, 'dev', { hidden: ['help'], topbar: { start: ['commands'], center: [], end: [] } });
  assert.deepStrictEqual(one, { workspaces: { dev: { hidden: ['help'], topbar: { start: ['commands'] } } } },
    'and an empty region is not written either');
});

test('an id is a slug, and anything else is refused rather than escaped into unreadability', () => {
  assert.ok(nav.isId('all-workspaces'));
  assert.ok(!nav.isId('Go To'));
  assert.ok(!nav.isId('../etc'));
  assert.ok(!nav.isId(''));
  assert.strictEqual(nav.regionOf('topbar-end'), 'end');
  assert.strictEqual(nav.regionOf('go'), null);
  assert.ok(nav.RESERVED.has('hidden'), 'Hidden is a place, not a group someone can name');
});

test('the saved file can be read back exactly, and reading it is what a later render sees', () => {
  const raw = { global: { hidden: ['help'], topbar: { end: ['commands'] }, items: [{ id: 'jira', label: 'Jira', href: '/x' }] } };
  write(raw);
  const back = nav.scopeLayout(nav.rawLayout().raw, 'global');
  assert.deepStrictEqual(back.hidden, ['help']);
  assert.deepStrictEqual(back.topbar.end, ['commands']);
  assert.deepStrictEqual(back.items.map((i) => i.id), ['jira']);
  assert.deepStrictEqual(back.topbar.start, [], 'every key is present, so no caller has to test for undefined');
});

test('an entry shows its icon, its text, or both — wherever it sits', () => {
  reset();
  const groups = [{ id: 'go', label: 'Go', items: [entry('commands', 'Commands'), entry('help', 'Help'), entry('settings', 'Settings')] }];
  assert.deepStrictEqual(nav.arrange(groups, 'global').groups[0].items.map((i) => i.show), ['', '', ''],
    'both is what every entry is until somebody says otherwise');

  write({ global: { show: { commands: 'icon', help: 'text' } } });
  const out = nav.arrange(groups, 'global').groups[0].items;
  assert.deepStrictEqual(out.map((i) => `${i.id}:${i.show || 'both'}`), ['commands:icon', 'help:text', 'settings:both']);
});

test('it applies in the top bar as much as in the sidebar: it is about room, not about which strip', () => {
  write({ global: { show: { commands: 'icon' }, topbar: { end: ['commands'] } } });
  const out = nav.arrange([{ id: 'go', label: 'Go', items: [entry('commands', 'Commands')] }], 'global');
  assert.deepStrictEqual(out.topbar.end.map((i) => i.show), ['icon']);
});

test('an entry the dashboard ships one way keeps it, and an explicit both is what puts it back', () => {
  reset();
  const shipped = [{ id: 'go', label: 'Go', items: [{ ...entry('ai-assistant', 'AI Assistant'), show: 'icon' }] }];
  assert.strictEqual(nav.arrange(shipped, 'global').groups[0].items[0].show, 'icon',
    'the assistant is its mark and nothing else until the layout says otherwise');

  write({ global: { show: { 'ai-assistant': 'both' } } });
  const back = nav.arrange(shipped, 'global').groups[0].items[0];
  assert.strictEqual(back.show, '', 'both, written down, is what overrides a shipped default');
  assert.strictEqual(back.ships, 'icon', 'and the shipped value is still reported, so the editor can offer it');

  write({ global: { show: { 'ai-assistant': 'text' } } });
  assert.strictEqual(nav.arrange(shipped, 'global').groups[0].items[0].show, 'text');
});

test('a value that is not one of the three is not a value', () => {
  write({ global: { show: { commands: 'sideways', help: 'icon' } } });
  const layout = nav.scopeLayout(nav.rawLayout().raw, 'global');
  assert.deepStrictEqual(layout.show, { help: 'icon' });
});
