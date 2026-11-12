// The /files/<workspace>/<path> route resolves the file to `real` and must stream that. It streamed
// `file`, a name the route never defines, so every plain (non-range) request sent headers and no body.
const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('fs');
const path = require('path');

test('the files route streams the file it resolved', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');
  const start = src.indexOf('filesBrowser.realFileIn(workspaceDir(fileMatch[1]), name)');
  assert.ok(start > 0, 'the files route was not found');
  const route = src.slice(start, src.indexOf('builder-args', start));
  const streams = [...route.matchAll(/fs\.createReadStream\((\w+)/g)].map((m) => m[1]);
  assert.ok(streams.length >= 2, 'expected the range branch and the whole-file branch');
  for (const name of streams) assert.strictEqual(name, 'real', `the route streams "${name}", which it does not define`);
});
