const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ui = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'ui.js'), 'utf8');

test('the modal wears its column count for width, and is never one of the count buttons', () => {
  // The modal element carries data-screens-cols; a bare attribute selector matched it and gave the
  // overlay the primary button's class and aria-pressed, which painted the whole backdrop brand blue.
  // (\s* where the part's TypeScript has a type, which ui.js holds as blank space.)
  assert.match(ui, /document\.querySelectorAll\s*\('button\[data-screens-cols\]'\)/);
  assert.doesNotMatch(ui, /document\.querySelectorAll\s*\('\[data-screens-cols\]'\)/);
  assert.match(ui, /modal\.dataset\.screensCols = read\(\)/);
});
