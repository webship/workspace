const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public', 'css', 'components', 'project-cards.css'), 'utf8');

test('SCREENS is drawn beside the running state in the card head, not in the tool strip', () => {
  assert.match(server, /<span class="pcard-state-line">\$\{statusBadge \?[^\n]*<span class="pcard-screens">\$\{screensMenu\}<\/span><\/span>/);
  assert.match(server, /screens: screensOnTools,/);
  assert.match(server, /const screensOnTools = '';/);
});

test('in the head it is the icon and its count, and the word stays its accessible name', () => {
  assert.match(server, /aria-label="SCREENS\$\{n \? `, \$\{n\} running` : ''\}"/);
  assert.match(css, /\.pcard-screens \.uk-button \{ font-size: 0;/);
});
