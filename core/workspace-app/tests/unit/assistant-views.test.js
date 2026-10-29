/**
 * How the assistant is shown: sidebar, wide, floating, full page — plus the switch that closes it.
 *
 * Modelled on Drupal AI's own chatbot (a toggle in the admin toolbar, a menu in the panel header
 * carrying Clear history and Close, an expand control, and the state on the document element), so
 * what is checked here is the part that would break quietly: the state must be applied BEFORE first
 * paint, the view must be a default rather than an override, and the full-page view must not leave
 * two copies of one conversation on the screen.
 */

const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('fs');
const path = require('path');

const app = path.join(__dirname, '..', '..');
const server = fs.readFileSync(path.join(app, 'server.js'), 'utf8');
const ui = fs.readFileSync(path.join(app, 'public', 'ui.js'), 'utf8');
const css = fs.readFileSync(path.join(app, 'public', 'css', 'components', 'assistant-views.css'), 'utf8');
const { styleSettings } = require(path.join(app, 'workspaces'));

test('the view and the open state are settings, with a fallback rather than a blank panel', () => {
  const s = styleSettings();
  assert.ok(['sidebar', 'wide', 'float', 'full'].includes(s.assistantView), s.assistantView);
  assert.ok(['yes', 'no'].includes(s.assistantOpen), s.assistantOpen);
});

test('the state is applied before first paint, and a stored choice wins over the setting', () => {
  const head = server.slice(server.indexOf("var d=document.documentElement"), server.indexOf('</script>'));
  // Read through wsPref: the stored choice is a cookie on the hub domain, so it is the same choice on
  // every workspace subdomain rather than one per origin.
  assert.match(head, /wsPref\('ws-assistant-view',null\)\|\|'\$\{style\.assistantView\}'/,
    'the setting is the default, the stored choice wins — as with style.mode');
  assert.match(head, /indexOf\(v\)<0\)v='sidebar'/, 'an unknown view must fall back, not render nothing');
  assert.match(head, /d\.dataset\.assistantView=v/);
  assert.match(head, /classList\.add\('assistant-closed'\)/);
  // The panel is 25rem of the layout: deciding this in the deferred ui.js would draw the page one
  // way and reflow it a frame later, which is the bug the rail's own pre-paint line exists for. So
  // ui.js may only CHANGE the class, from the one function a click reaches.
  const setsClosed = ui.match(/classList\.toggle\('assistant-closed'/g) || [];
  assert.strictEqual(setsClosed.length, 1, 'only setAssistantOpen may write that class');
  const fn = ui.slice(ui.indexOf('function setAssistantOpen'), ui.indexOf('function setAssistantOpen') + 400);
  assert.match(fn, /classList\.toggle\('assistant-closed', !open\)/, 'and that is where it lives');
});

test('the panel header carries the menu, wider and close — and the menu carries the rest', () => {
  // Up to the close button: the avatar's own menu (when it is on) comes first and is long.
  const from = server.indexOf('class="assistant-controls"');
  const head = server.slice(from, server.indexOf('assistant-hide', from) + 200);
  assert.match(head, /assistant-ctl[^>]*Assistant options/, 'the kebab');
  assert.match(head, /assistant-wider/, 'wider');
  assert.match(head, /assistant-hide/, 'close');
  // The items themselves are one function, since the toolbar hangs the same menu.
  const menu = server.slice(server.indexOf('function assistantMenuItemsHtml'), server.indexOf('const AI_MARK'));
  assert.match(menu, /hx-post="\/actions\/chat-reset"[\s\S]*?hx-trigger="confirmed-remove"/,
    'New chat must ask first, like every other action that throws something away');
  assert.match(menu, /class="assistant-view-pick" data-view="\$\{v\}"/, 'the views are rendered from a list');
  assert.match(menu, /assistant-close-pick/, 'and closing it is offered where the views are');
  for (const [v, label] of [['sidebar', 'Sidebar'], ['wide', 'Wide'], ['float', 'Floating'], ['full', 'Full page']]) {
    assert.match(menu, new RegExp(`\\['${v}', '${label}'`), `no way to choose ${v}`);
  }
});

test('the control is in the rail, not in the toolbar', () => {
  // The toolbar is the corner the brand and the page identity own. The rail is where the things that
  // apply to whatever page you are on live, which is exactly what this is.
  const left = server.slice(server.indexOf('<div class="uk-navbar-left">'), server.indexOf('<div class="uk-navbar-right">'));
  assert.ok(!/assistant-toggle|assistant-switch/.test(left), 'the toolbar must not carry the switch');
  const rail = server.slice(server.indexOf("label: 'Go'"), server.indexOf("] });", server.indexOf("label: 'Go'")));
  assert.match(rail, /<button type="button" class="action-btn actions-assistant/,
    'the rail row is the control, and a real button — UIKit puts aria-haspopup on whatever precedes the '
    + 'dropdown, and that attribute is not allowed on a span');
  assert.match(rail, /\$\{assistantMenuItemsHtml\(\)\}/, 'and it carries the whole menu');
});

test('show and hide are two items the stylesheet picks between', () => {
  const menu = server.slice(server.indexOf('function assistantMenuItemsHtml'), server.indexOf('const AI_MARK'));
  assert.match(menu, /assistant-when-closed[\s\S]*?assistant-open-pick/, 'Show, for when it is hidden');
  assert.match(menu, /assistant-when-open[\s\S]*?assistant-close-pick/, 'Hide, for when it is not');
  // Neither needs a script to rename itself: which applies is a state the stylesheet already knows.
  assert.match(css, /html\.assistant-closed \.assistant-when-open,\s*\n\s*html:not\(\.assistant-closed\) \.assistant-when-closed \{ display: none; \}/);
});

test('the full-page view is a place, not a layout', () => {
  assert.match(ui, /if \(view === 'full'\)[\s\S]*?window\.location\.href = '\/assistant'/,
    'choosing it must go there');
  assert.match(ui, /window\.location\.pathname === '\/assistant'[\s\S]*?referrer/,
    'leaving it must leave the page too — /assistant has no sidebar to become');
  assert.match(server, /pathname === '\/assistant'/, 'the page itself');
  // Two panels on one screen would be two views of one conversation, both live.
  assert.match(server, /context === 'assistant' \? '' : `<aside class="assistant-side">/,
    'the page must not also carry the docked panel');
  assert.match(css, /html\[data-assistant-view="full"\] \.assistant-side \{ display: none; \}/);
});

test('the full-page view is escapable from an ordinary page', () => {
  // In that view no page but /assistant draws a panel, so the panel's own menu is not there to use.
  // The toolbar carries the same menu, or picking Full page and then navigating anywhere would leave
  // no way back to a sidebar — the tile alone only leads back to /assistant.
  assert.match(server, /function assistantMenuItemsHtml\(\)/, 'one menu, hung from two places');
  // To the end of the control, not a fixed window: the comments around it grow, and a slice that is
  // one character short reads as the menu having been taken away.
  const railStart = server.indexOf('class="uk-inline actions-assistant-wrap"');
  const rail = server.slice(railStart, server.indexOf('</div>`', railStart));
  assert.match(rail, /\$\{assistantMenuItemsHtml\(\)\}/, 'the rail carries the menu, so any page can change the view');
  const header = server.slice(server.indexOf('class="uk-inline assistant-menu"'), server.indexOf('class="uk-inline assistant-menu"') + 600);
  assert.match(header, /\$\{assistantMenuItemsHtml\(\)\}/, 'and it must be the same menu, not a second copy');
});

test('showing it does not pretend to open a page that is already open', () => {
  // On /assistant the assistant IS the page: writing a closed/open state there set something nobody
  // could see, which then decided the panel on the next ordinary page for no reason the user gave.
  const handler = ui.slice(ui.indexOf("e.target.closest('.assistant-open-pick')"), ui.indexOf("e.target.closest('.assistant-open-pick')") + 500);
  assert.match(handler, /if \(window\.location\.pathname === '\/assistant'\) return;/);
  assert.ok(handler.indexOf("pathname === '/assistant'") < handler.indexOf('setAssistantOpen'),
    'it must return before writing the open state');
  assert.match(handler, /assistantView\(\) === 'full'[\s\S]*?window\.location\.href = '\/assistant'/,
    'and in the full-page view showing it means going there');
});

test('the floating panel can be moved, and only that one', () => {
  // Where a floating panel should sit depends on what is under it, and that changes page by page.
  assert.match(ui, /function draggableAssistant/);
  assert.match(ui, /dataset\.assistantView !== 'float'\) return;/, 'only the floating view is draggable');
  // A drag that began on the close button would close the panel on release.
  assert.match(ui, /e\.target\.closest\('button, a, input, select, \.assistant-dropdown'\)\) return;/,
    'the header is the handle, minus its controls');
  assert.match(ui, /const maxX = Math\.max\(0, window\.innerWidth - r\.width\)/, 'it is clamped into the viewport');
  assert.match(ui, /window\.addEventListener\('resize', applyStored\)/,
    'a window that got smaller must not leave it off-screen');
  // Leftover inline positions would fight the stylesheet in every other view.
  assert.match(ui, /el\.style\.left = el\.style\.top = el\.style\.bottom = el\.style\.right = '';/);
  assert.match(css, /html\[data-assistant-view="float"\] \.assistant-side \.assistant-head \{\s*\n\s*cursor: grab;/,
    'and it has to say it can be dragged');
});

test('the launcher is the way back in, in every view', () => {
  // The control lives in the rail now, and a collapsed rail is an icon strip a newcomer has no reason
  // to search — so a closed assistant must leave something on the page that opens it.
  assert.match(css, /\.assistant-launcher \{ display: none; \}/, 'not while the panel is open');
  assert.match(css, /html\.assistant-closed \.assistant-launcher \{/, 'and in every view when it is closed');
  assert.ok(!/html\[data-assistant-view="float"\]\.assistant-closed \.assistant-launcher \{/.test(css),
    'not the floating view alone any more');
  assert.match(ui, /closest\('\.assistant-launcher'\)[\s\S]*?assistantView\(\) === 'full'[\s\S]*?'\/assistant'/,
    'and in the full-page view it leads to the page, since there is no panel to show');
});
