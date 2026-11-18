/**
 * Every module the dashboard requires is in the npm package.
 *
 * package.json `files` lists `core/workspace-app/*.js` and named folders. `images-providers/` (a folder of
 * modules) was not one of them, so every workspace made from npm answered "Cannot find module
 * './images-providers'" (500) on the image actions: Generate, Edit with AI, Describe, the SVG form.
 * This reads each local require of the app's code and checks a `files` entry covers it.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const APP = 'core/workspace-app';

test('the files list covers every local module the app requires', () => {
  const { files } = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  const covered = (rel) => files.some((f) => f === rel || rel.startsWith(`${f}/`)
    || (f.endsWith('/*.js') && path.dirname(rel) === f.slice(0, -5) && rel.endsWith('.js')));
  const missing = new Set();
  const scan = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (['node_modules', 'tests', '.ddev', 'public', 'docs', 'commands', 'plugins'].includes(e.name)) continue;
        scan(p);
        continue;
      }
      if (!e.name.endsWith('.js')) continue;
      for (const m of fs.readFileSync(p, 'utf8').matchAll(/require\('(\.{1,2}\/[^']+)'\)/g)) {
        const t = path.join(path.dirname(p), m[1]);
        const found = [`${t}.js`, t].find((x) => fs.existsSync(x));
        if (!found) continue;
        const rel = path.relative(REPO, found).split(path.sep).join('/');
        if (rel.startsWith(`${APP}/`) && !covered(rel)) missing.add(`${rel} (required by ${path.relative(REPO, p)})`);
      }
    }
  };
  scan(path.join(REPO, APP));
  assert.deepStrictEqual([...missing], [], 'each of these would be missing from a workspace made from npm');
});
