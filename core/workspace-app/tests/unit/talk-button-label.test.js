/**
 * The hold-to-talk button keeps its icon and its words on a narrow screen.
 *
 * Below 960px the stylesheet hid `.dock-talk span, .dock-talk kbd`, and the microphone icon is a span as well, so
 * the button was an empty blue pill (round 7, 390px: 240×42, every child display:none, no visible text).
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', '..');
const css = fs.readFileSync(path.join(APP, 'public', 'css', 'components', 'assistant-avatar.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const server = fs.readFileSync(path.join(APP, 'server.js'), 'utf8');

test('the button carries an icon, its words and the key hint', () => {
  assert.match(server, /class="dock-btn dock-talk"[^>]*><span class="dock-talk-icon"><\/span><span>Hold to talk<\/span> <kbd>Space<\/kbd><\/button>/);
});

test('a narrow screen hides the key hint only', () => {
  const narrow = [...css.matchAll(/@media \(max-width: 59\.99em\) \{([^{}]*\{[^}]*\})+\s*\}/g)].map((m) => m[0]).join('\n');
  assert.match(narrow, /\.dock-talk kbd \{ display: none; \}/, 'no Space bar to hold on a phone');
  assert.doesNotMatch(narrow, /\.dock-talk span/, 'the icon and the words are spans: they must stay');
  assert.doesNotMatch(css, /\.dock-talk span\s*[,{][^}]*display:\s*none/, 'nowhere else hides them either');
});
