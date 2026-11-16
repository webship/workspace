'use strict';
// A phone's page must not scroll sideways because of one long path or command.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', '..', 'public/css/components', f), 'utf8');

test('on a phone inline code and the command pill wrap; a code block is left alone', () => {
  const css = read('responsive-home-and-the-workspace-pages.css');
  const phone = css.slice(css.lastIndexOf('@media (max-width: 39.9375em)'));
  assert.match(phone, /:not\(pre\) > code, code\.fname \{ white-space: normal; overflow-wrap: anywhere; \}/);
  assert.ok(!/(^|[\s,])pre code/.test(phone), 'no rule here touches code inside pre');
});

test('the one-column Help grid cannot be wider than the screen', () => {
  const css = read('help-page.css');
  const small = css.slice(css.indexOf('@media (max-width: 59.9375em)'));
  assert.match(small, /\.help-layout \{ grid-template-columns: minmax\(0, 1fr\); \}/);
});
