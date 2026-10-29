const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const app = (f) => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');
const server = app('server.js');
const ui = app('public/ui.js');
const menu = server.slice(server.indexOf('function assistantMenuItemsHtml'), server.indexOf('const AI_MARK'));

test('the assistant options offer a check button for each part of the prompt', () => {
  for (const key of ['voice', 'mic', 'mode', 'suggest']) assert.ok(menu.includes(`['${key}', `), key);
  assert.ok(menu.includes('class="uk-checkbox assistant-switch" type="checkbox" data-switch="${key}"'));
});

test('every switch in the menu has a handler on the page', () => {
  const keys = [...menu.matchAll(/\['(voice|mic|mode|suggest)', '/g)].map((m) => m[1]);
  for (const key of keys) assert.match(ui, new RegExp(`\\n    ${key}: \\{`), `no handler for ${key}`);
});

test('the choice is kept per browser and the setting is only where it starts', () => {
  for (const name of ['ws-mic', 'ws-mode', 'ws-suggest']) assert.ok(ui.includes(`'${name}'`), name);
  assert.ok(ui.includes("prefSwitch('ws-mic', cfg.voiceInput !== false"));
  assert.ok(ui.includes("prefSwitch('ws-mode', true"));
  assert.ok(ui.includes("prefSwitch('ws-suggest', true"));
});

test('the microphone is hidden by an attribute on the panel, and only when it exists at all', () => {
  assert.ok(ui.includes(':host([data-assistant-mic="off"]) #microphone-button { display: none !important; }'));
  assert.ok(ui.includes("el.setAttribute('data-assistant-mic', 'off')"));
  assert.ok(ui.includes('show: cfg.speechToText !== false'));
});

test('prompt mode is hidden on the selector itself', () => {
  assert.ok(ui.includes("picker.style.display = on ? '' : 'none'"));
  assert.ok(ui.includes('show: !!picker'));
});

test('suggestions honour the switch when loaded, can be removed, and are not shown over a conversation', () => {
  assert.ok(ui.includes("'ws-suggest', null) : null) !== '0'"));
  assert.ok(ui.includes('!suggestOn()) return;'));
  assert.ok(ui.includes('if (conversationEmpty) showSuggestions()'));
  assert.ok(ui.includes("closest('[class*=\"outer-message-container\"]')"));
  assert.ok(ui.includes('init: null'), 'the switch must not show them before the history has loaded');
});

test('a switch with nothing to switch is hidden, not offered', () => {
  assert.ok(ui.includes("if (!sw || !sw.show) { box.closest('li').hidden = true; return; }"));
});

test('the copies of the menu for each way of showing the assistant stay in step', () => {
  assert.ok(ui.includes('.assistant-switch[data-switch="${box.dataset.switch}"]'));
});
