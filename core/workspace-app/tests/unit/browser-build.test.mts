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

const APP = path.join(import.meta.dirname, '..', '..');
const SRC = path.join(APP, 'src', 'browser');
const sources = fs.readdirSync(SRC).filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'));

test('every browser source has its built script in public/, marked as built', () => {
  assert.ok(sources.length >= 3, 'there are sources');
  for (const f of sources) {
    const built = path.join(APP, 'public', f.replace(/\.ts$/, '.js'));
    assert.ok(fs.existsSync(built), `public/${path.basename(built)} is committed`);
    assert.match(fs.readFileSync(built, 'utf8'), /^\/\/ Built from src\/browser by `npm run build:browser`/, `${f}: the built file says where its source is`);
  }
});

test('the committed scripts are what their sources build to', () => {
  const r = spawnSync(process.execPath, ['scripts/build-browser.mts', '--check'], { cwd: APP, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, `${r.stdout}${r.stderr}`);
  assert.match(r.stdout, new RegExp(`${sources.length} browser script\\(s\\) match their source`));
});

test('the pages load them at the same addresses, and the vendored libraries are not built', () => {
  const server = fs.readFileSync(path.join(APP, 'server.js'), 'utf8');
  for (const f of sources) assert.ok(server.includes(`assetUrl('/${f.replace(/\.ts$/, '.js')}')`), `${f} is loaded as before`);
  assert.ok(!sources.some((f) => /^(htmx|uikit)/.test(f)), 'htmx and UIkit stay vendored');
  assert.ok(!fs.existsSync(path.join(SRC, 'vendor')));
});
