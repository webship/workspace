const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ui = fs.readFileSync(path.join(__dirname, '../..', 'public/ui.js'), 'utf8');

test('the send button animates when a message is sent, by click or Enter, unless motion is reduced', () => {
  assert.ok(ui.includes('.input-button.inside-end.ws-sent svg { animation: ws-send-fly'));
  assert.ok(ui.includes('@keyframes ws-send-fly'));
  const frames = ui.slice(ui.indexOf('@keyframes ws-send-fly'), ui.indexOf('@keyframes ws-send-fly') + 400);
  assert.ok(frames.includes('translate:') && !frames.includes('transform:'), 'transform on the arrow is forced to none, so the individual properties are used');
  assert.ok(ui.includes('@media (prefers-reduced-motion: reduce) { .input-button.inside-end.ws-sent svg { animation: none; } }'));
  assert.ok(ui.includes('narrator.cancel(); playSendAnimation(); setWorking(true); }'), 'it is tied to the message being sent, not to a click');
});
