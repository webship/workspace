'use strict';
// Every core module must load. A module the core no longer ships, still required somewhere,
// surfaces here instead of at the first start of the dashboard (issue #91: `./graphs` after the
// graph feature moved to its plugin).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', '..');
const SKIP = new Set(['server.js']); // starts listening on require

function modules(dir) {
  return fs.readdirSync(dir).filter((f) => f.endsWith('.js') && !SKIP.has(f)).map((f) => path.join(dir, f));
}

test('every core module in the app root and actions/ loads', () => {
  const failures = [];
  for (const file of [...modules(APP), ...modules(path.join(APP, 'actions'))]) {
    try { require(file); } catch (e) { failures.push(`${path.relative(APP, file)}: ${e.message.split('\n')[0]}`); }
  }
  assert.deepStrictEqual(failures, []);
});
