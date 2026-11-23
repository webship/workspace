/**
 * "Open … in Attu" on a project's RAG menu (#785): the RAG server's address on the hub, its canonical DDEV address on
 * a plain address, the way a DDEV project's Launch is since #764. The link is only drawn for a running Milvus with a
 * built index, so the address is asked of rag.js's attuUrl under each Host, and the row is checked to use it.
 */
import { test, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { copyConfig } from './_isolated-config.js';

const APP = path.join(import.meta.dirname, '..', '..');
const REPO = path.join(APP, '..', '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-rag-attu-'));
fs.mkdirSync(path.join(root, 'core'), { recursive: true });
copyConfig(path.join(REPO, 'core/config'), path.join(root, 'core/config'));
// A RAG server named after its folder, and one whose DDEV project has a name of its own.
for (const [dir, name] of [['milvus', 'milvus'], ['vectors', 'vec-store']]) {
  fs.mkdirSync(path.join(root, 'rag', dir, '.ddev'), { recursive: true });
  fs.writeFileSync(path.join(root, 'rag', dir, '.ddev', 'config.yaml'), `name: ${name}\ntype: php\n`);
}
// The modules read the workspace when they load: set it first, then load them.
process.env.WORKSPACE_ROOT = root;
for (const k of ['WORKSPACE_PATH', 'WORKSPACE_SCRIPTS', 'WORKSPACE_CONFIG']) delete process.env[k];
const require = createRequire(import.meta.url);
const { attuUrl } = require('../../rag.js') as { attuUrl: (instance: string) => string };
const { withRequest } = require('../../urls.js') as { withRequest: <T>(req: { headers: { host: string } }, fn: () => T) => T };
const on = (host: string, instance: string): string => withRequest({ headers: { host } }, () => attuUrl(instance));

after(() => fs.rmSync(root, { recursive: true, force: true }));

test('Attu on a plain address: the RAG server\'s canonical address, by its DDEV name (#785)', () => {
  for (const host of ['127.0.0.1:3999', 'localhost:3000', '10.0.0.7:30080', 'ws.example.org']) {
    assert.strictEqual(on(host, 'milvus'), 'https://milvus.ddev.site', host);
    assert.strictEqual(on(host, 'vectors'), 'https://vec-store.ddev.site', `${host}: a DDEV name of its own`);
  }
});

test('Attu on the hub: the hub\'s address, as before (#785)', () => {
  for (const host of ['workspace.ddev.site', 'rag.workspace.ddev.site', 'dev.workspace.ddev.site:443']) {
    assert.strictEqual(on(host, 'milvus'), 'https://milvus.rag.workspace.ddev.site', host);
  }
  // Outside a request (a page built for no address), the hub's.
  assert.strictEqual(attuUrl('milvus'), 'https://milvus.rag.workspace.ddev.site');
});

test('the RAG menu links Attu through attuUrl, not a hub address of its own (#785)', () => {
  const src = fs.readFileSync(path.join(APP, 'server.js'), 'utf8');
  const link = src.split('\n').find((l) => l.includes('in Attu</a>')) || '';
  assert.match(link, /href="\$\{esc\(attuUrl\(instance\)\)\}"/);
  assert.doesNotMatch(src, /\.rag\.\$\{hubDomain\(\)\}/, 'no other link to the hub\'s RAG address');
});
