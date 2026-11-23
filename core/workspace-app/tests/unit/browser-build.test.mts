/**
 * The browser scripts are TypeScript in src/browser, built by esbuild into public/ at the names the pages load,
 * and the built files are committed so a fresh clone runs with no build. This holds the two halves together:
 * every source has its built file, and the built file is what the source builds to now.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { partsOf, stripUiPart } from '../../scripts/ui-parts.mts';

const APP = path.join(import.meta.dirname, '..', '..');
const SRC = path.join(APP, 'src', 'browser');
const sources = fs.readdirSync(SRC).filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'));
// A folder is one script in parts (src/browser/ui/ is public/ui.js), joined in the order of the parts' names.
const folders = fs.readdirSync(SRC, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
const builtNames = [...sources.map((f) => f.replace(/\.ts$/, '.js')), ...folders.map((d) => `${d}.js`)];

test('every browser source has its built script in public/, marked as built', () => {
  assert.ok(sources.length >= 3, 'there are sources');
  for (const f of builtNames) {
    const built = path.join(APP, 'public', f);
    assert.ok(fs.existsSync(built), `public/${path.basename(built)} is committed`);
    assert.match(fs.readFileSync(built, 'utf8'), /^\/\/ Built from src\/browser by `npm run build:browser`/, `${f}: the built file says where its source is`);
  }
});

test('the committed scripts are what their sources build to', () => {
  const r = spawnSync(process.execPath, ['scripts/build-browser.mts', '--check'], { cwd: APP, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, `${r.stdout}${r.stderr}`);
  assert.match(r.stdout, new RegExp(`${builtNames.length} browser script\\(s\\) match their source`));
});

test('the pages load them at the same addresses, and the vendored libraries are not built', () => {
  const server = fs.readFileSync(path.join(APP, 'server.js'), 'utf8');
  // A page loads a script (assetUrl in server.js), or a module of the page imports it (from '/<name>.js').
  const pub = path.join(APP, 'public');
  const importers = fs.readdirSync(pub).filter((n) => n.endsWith('.js')).map((n) => fs.readFileSync(path.join(pub, n), 'utf8'));
  for (const f of builtNames) {
    assert.ok(server.includes(`assetUrl('/${f}')`) || importers.some((src) => src.includes(`from '/${f}'`)), `${f} is loaded as before`);
  }
  assert.ok(!sources.some((f) => /^(htmx|uikit)/.test(f)), 'htmx and UIkit stay vendored');
  assert.ok(!fs.existsSync(path.join(SRC, 'vendor')));
});

test('ui.js is its parts one after the other, each a whole script, and nothing between them', () => {
  const dir = path.join(SRC, 'ui');
  const parts = partsOf(dir);
  assert.ok(parts.length > 10, `${parts.length} parts`);
  assert.ok(parts.every((f) => /^\d{2}-[a-z0-9-]+\.(js|ts)$/.test(f)), 'named NN-<part>.js or .ts, so their order is their names');
  const built = fs.readFileSync(path.join(APP, 'public', 'ui.js'), 'utf8');
  const joined = parts.map((f) => stripUiPart(f, fs.readFileSync(path.join(dir, f), 'utf8'))).join('');
  assert.strictEqual(built.slice(built.indexOf('\n') + 1), joined, 'public/ui.js is the banner, then the parts, a .ts one with its types blanked');
  for (const f of parts) {
    const source = fs.readFileSync(path.join(dir, f), 'utf8');
    const code = stripUiPart(f, source);
    assert.doesNotThrow(() => new vm.Script(code, { filename: f }), `${f} is a whole script`);
    // A .ts part keeps its lines and its comments in ui.js: only its types are blank.
    if (f.endsWith('.ts')) {
      assert.strictEqual(code.split('\n').length, source.split('\n').length, `${f} keeps its lines`);
      for (const c of source.match(/^\s*\/\/.*$/gm) || []) assert.ok(code.includes(c), `${f} keeps "${c.trim()}"`);
    }
  }
});

test('the .ts parts of ui.js are checked together, as one script\'s parts', () => {
  const ts = partsOf(path.join(SRC, 'ui')).filter((f) => f.endsWith('.ts'));
  assert.ok(ts.length >= 3, `${ts.length} typed parts`);
  const config = fs.readFileSync(path.join(SRC, 'ui', 'tsconfig.json'), 'utf8');
  assert.match(config, /"moduleDetection": "legacy"/, 'scripts that share one scope, as they do in ui.js');
  assert.match(config, /"include": \["\*\.ts", "\.\.\/globals\.d\.ts"\]/);
  const pkg = JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8'));
  assert.match(pkg.scripts.typecheck, /tsc -p src\/browser\/ui\b/, 'npm run typecheck checks them');
});
