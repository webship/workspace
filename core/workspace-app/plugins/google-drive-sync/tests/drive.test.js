/**
 * Pushing a workspace folder to Google Drive, against a local stand-in for Google.
 *
 * The fake implements just what drive-sync.js calls: the token endpoint, about, files.list,
 * folder create and resumable upload (new file and update-in-place). The module is pointed at it
 * with the GOOGLE_* environment overrides, and run the way the job runs it, through drive-cli.js.
 */

const assert = require('node:assert');
const { test } = require('node:test');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const CLI = path.join(__dirname, '..', 'lib', 'cli.js');
const PLUGIN_FILE = 'plugin.google-drive-sync.settings.yml';
const pluginFile = (root) => path.join(root, 'core', 'config', PLUGIN_FILE);
const FOLDER = 'application/vnd.google-apps.folder';

function fakeGoogle() {
  const files = new Map();      // id -> { id, name, mimeType, parents, content }
  const sessions = new Map();   // n -> { id (existing) | null, meta, chunks: [] }
  const seen = { auth: new Set(), chunks: [] };
  let seq = 0;
  const newId = () => `id${++seq}`;
  files.set('DESTFOLDER01', { id: 'DESTFOLDER01', name: 'dest', mimeType: FOLDER, parents: ['root'] });

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (req.headers.authorization) seen.auth.add(req.headers.authorization);
    const chunks = [];
    req.on('data', (d) => chunks.push(d));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const send = (status, obj, headers = {}) => { res.writeHead(status, { 'Content-Type': 'application/json', ...headers }); res.end(obj === undefined ? '' : JSON.stringify(obj)); };
      const base = `http://127.0.0.1:${server.address().port}`;

      if (url.pathname === '/token') return send(200, { access_token: 'tok', expires_in: 3600 });
      if (url.pathname === '/drive/v3/about') return send(200, { user: { displayName: 'Test', emailAddress: 't@example.org' } });
      if (url.pathname === '/drive/v3/drives') return send(200, { drives: [{ id: 'SHAREDDRIVE01', name: 'Team Drive' }] });
      const one = url.pathname.match(/^\/drive\/v3\/files\/([^/]+)$/);
      if (one && req.method === 'GET') { const f = files.get(one[1]); return f ? send(200, { id: f.id, name: f.name, mimeType: f.mimeType, parents: f.parents, driveId: f.driveId, ownedByMe: f.ownedByMe }) : send(404, { error: { message: 'no such file' } }); }
      if (url.pathname === '/drive/v3/files' && req.method === 'GET') {
        const q = url.searchParams.get('q');
        const parent = (q.match(/'([^']+)' in parents/) || [])[1];
        const list = [...files.values()].filter((f) => (f.parents || []).includes(parent) && (!/mimeType = /.test(q) || f.mimeType === FOLDER))
          .map((f) => ({ id: f.id, name: f.name, mimeType: f.mimeType, size: f.content ? String(f.content.length) : undefined, md5Checksum: f.content ? crypto.createHash('md5').update(f.content).digest('hex') : undefined }));
        return send(200, { files: list });
      }
      if (url.pathname === '/drive/v3/files' && req.method === 'POST') {
        const m = JSON.parse(body.toString());
        const f = { id: newId(), name: m.name, mimeType: m.mimeType, parents: m.parents };
        files.set(f.id, f);
        return send(200, { id: f.id, name: f.name });
      }
      if (url.pathname.startsWith('/upload/drive/v3/files')) {
        const existing = url.pathname.split('/')[5] || null;
        const n = newId();
        sessions.set(n, { existing, meta: JSON.parse(body.toString()), parts: [] });
        return send(200, {}, { Location: `${base}/session/${n}` });
      }
      if (url.pathname.startsWith('/session/')) {
        const s = sessions.get(url.pathname.split('/')[2]);
        const m = (req.headers['content-range'] || '').match(/bytes (\d+)-(\d+)\/(\d+)/);
        if (!m) { // an empty file, or a status probe
          if (!req.headers['content-range']) { const f = { id: s.existing || newId(), ...s.meta, mimeType: 'x', content: Buffer.alloc(0) }; files.set(f.id, f); return send(200, { id: f.id }); }
          return send(308, undefined, { Range: `bytes=0-${Buffer.concat(s.parts).length - 1}` });
        }
        seen.chunks.push(body.length);
        s.parts.push(body);
        const total = Number(m[3]);
        const have = Buffer.concat(s.parts);
        if (have.length < total) return send(308, undefined, { Range: `bytes=0-${have.length - 1}` });
        const id = s.existing || newId();
        const prev = files.get(id) || {};
        files.set(id, { id, name: s.meta.name || prev.name, mimeType: 'x', parents: s.meta.parents || prev.parents, content: have });
        return send(200, { id });
      }
      return send(404, { error: { message: `fake: ${req.method} ${url.pathname}` } });
    });
  });
  return { server, files, seen };
}

function setup(g) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-drive-'));
  fs.mkdirSync(path.join(root, 'core', 'config'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs', 'guide'), { recursive: true });
  fs.writeFileSync(path.join(root, 'core', 'config', 'workspace.docs.settings.yml'), 'doc:\n  name: docs\n');
  fs.writeFileSync(path.join(root, 'core', 'config', 'settings.yml'), 'workspaces:\n  - docs\n');
  // the plugin's own settings file, flat: nothing of it lives in settings.yml
  fs.writeFileSync(pluginFile(root), [
    'client_id: cid', 'client_secret: csecret', 'refresh_token: rtoken', 'destinations:', '  docs: DESTFOLDER01', 'targets:', '  docs:', '    - "*"', 'exclude:', '  - node_modules', '  - "*.tmp"', '',
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'docs', 'a.md'), '# a\n');
  fs.writeFileSync(path.join(root, 'docs', 'guide', 'b.md'), '# b\n');
  fs.writeFileSync(path.join(root, 'docs', 'scratch.tmp'), 'ignored');
  fs.mkdirSync(path.join(root, 'docs', 'node_modules'));
  fs.writeFileSync(path.join(root, 'docs', 'node_modules', 'x.js'), 'ignored');
  fs.writeFileSync(path.join(root, 'docs', 'empty.txt'), '');
  const port = g.server.address().port;
  const env = {
    ...process.env, WORKSPACE_ROOT: root, WORKSPACE_CONFIG: path.join(root, 'core', 'config'),
    GOOGLE_DRIVE_API: `http://127.0.0.1:${port}/drive/v3`, GOOGLE_DRIVE_UPLOAD_API: `http://127.0.0.1:${port}/upload/drive/v3`, GOOGLE_TOKEN_URL: `http://127.0.0.1:${port}/token`,
  };
  return { root, env };
}

const run = (args, env) => new Promise((resolve) => {
  const child = spawn('node', [CLI, ...args], { env });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  child.on('close', (code) => resolve({ code, out }));
});

const byName = (g, name) => [...g.files.values()].filter((f) => f.name === name);

test('a push creates folders and files, honours the excludes, and a second push changes nothing', async () => {
  const g = fakeGoogle();
  await new Promise((r) => g.server.listen(0, '127.0.0.1', r));
  try {
    const { root, env } = setup(g);
    const big = crypto.randomBytes(9 * 1024 * 1024);          // two chunks of 8 MiB
    fs.writeFileSync(path.join(root, 'docs', 'guide', 'big.bin'), big);

    const first = await run(['sync', 'docs'], env);
    assert.strictEqual(first.code, 0, first.out);
    assert.match(first.out, /4 new, 0 changed, 0 already there, 2 skipped, 0 failed/, first.out);
    assert.ok(byName(g, 'guide').length === 1 && byName(g, 'guide')[0].mimeType === FOLDER && byName(g, 'guide')[0].parents[0] === 'DESTFOLDER01');
    assert.strictEqual(byName(g, 'b.md')[0].parents[0], byName(g, 'guide')[0].id, 'a nested file lands in its folder');
    assert.ok(byName(g, 'big.bin')[0].content.equals(big), 'a file over one chunk arrives whole');
    assert.ok(g.seen.chunks.includes(8 * 1024 * 1024) && g.seen.chunks.includes(1024 * 1024), `chunked: ${g.seen.chunks}`);
    assert.strictEqual(byName(g, 'empty.txt').length, 1, 'an empty file is pushed too');
    assert.strictEqual(byName(g, 'scratch.tmp').length + byName(g, 'x.js').length, 0, 'excluded paths stay home');
    assert.deepStrictEqual([...g.seen.auth], ['Bearer tok']);

    const second = await run(['sync', 'docs'], env);
    assert.match(second.out, /0 new, 0 changed, 4 already there/, second.out);
    assert.strictEqual(byName(g, 'a.md').length, 1, 'no duplicates');
  } finally { g.server.close(); }
});

test('a changed file is updated in place only once approved, and nothing on Drive is deleted', async () => {
  const g = fakeGoogle();
  await new Promise((r) => g.server.listen(0, '127.0.0.1', r));
  try {
    const { root, env } = setup(g);
    await run(['sync', 'docs'], env);
    const id = byName(g, 'a.md')[0].id;
    g.files.set('ONLYDRIVE', { id: 'ONLYDRIVE', name: 'only-on-drive.md', mimeType: 'text/markdown', parents: ['DESTFOLDER01'], content: Buffer.from('keep') });
    fs.writeFileSync(path.join(root, 'docs', 'a.md'), '# a, edited\n');

    const asked = await run(['sync', 'docs'], env);
    assert.strictEqual(asked.code, 3, asked.out);
    assert.match(asked.out, /OVERWRITE 1 file\(s\)[\s\S]*~ a\.md/);
    assert.match(asked.out, /Nothing was written/);
    assert.strictEqual(byName(g, 'a.md')[0].content.toString(), '# a\n', 'untouched until approved');

    const out = await run(['sync', 'docs', '--overwrite'], env);
    assert.strictEqual(out.code, 0, out.out);
    assert.match(out.out, /0 new, 1 changed/, out.out);
    assert.strictEqual(byName(g, 'a.md')[0].id, id, 'same file id, so links and sharing survive');
    assert.strictEqual(byName(g, 'a.md')[0].content.toString(), '# a, edited\n');
    assert.ok(g.files.has('ONLYDRIVE'), 'a push never deletes');
  } finally { g.server.close(); }
});

test('writing into a sub folder that is already on Drive needs approval too, but a push with nothing to write does not', async () => {
  const g = fakeGoogle();
  await new Promise((r) => g.server.listen(0, '127.0.0.1', r));
  try {
    const { root, env } = setup(g);
    await run(['sync', 'docs'], env);
    const none = await run(['sync', 'docs'], env);
    assert.strictEqual(none.code, 0, 'everything already there: nothing to approve');
    fs.writeFileSync(path.join(root, 'docs', 'guide', 'c.md'), '# c\n');             // a NEW file, into the existing guide/
    const asked = await run(['sync', 'docs'], env);
    assert.strictEqual(asked.code, 3, asked.out);
    assert.match(asked.out, /1 sub folder\(s\)[\s\S]*= guide/);
    assert.doesNotMatch(asked.out, /OVERWRITE/);
    assert.strictEqual(byName(g, 'c.md').length, 0);
    const dry = await run(['sync', 'docs', '--dry-run'], env);
    assert.strictEqual(dry.code, 0, 'a dry run only reports');
    assert.match(dry.out, /would need your approval/);
    assert.strictEqual((await run(['sync', 'docs', '--overwrite'], env)).code, 0);
    assert.strictEqual(byName(g, 'c.md')[0].parents[0], byName(g, 'guide')[0].id);
  } finally { g.server.close(); }
});

test('with a storage folder and no destination of its own, a workspace goes to <storage folder>/<workspace>', async () => {
  const g = fakeGoogle();
  await new Promise((r) => g.server.listen(0, '127.0.0.1', r));
  try {
    const { root, env } = setup(g);
    const settings = pluginFile(root);
    fs.writeFileSync(settings, fs.readFileSync(settings, 'utf8').replace('  docs: DESTFOLDER01\n', '  docs: ""\n').replace('destinations:', 'root_folder: https://drive.google.com/drive/folders/DESTFOLDER01\ndestinations:'));
    const out = await run(['sync', 'docs'], env);
    assert.strictEqual(out.code, 0, out.out);
    const home = byName(g, 'docs').find((f) => f.parents && f.parents[0] === 'DESTFOLDER01');
    assert.ok(home, 'a docs folder inside the storage folder');
    assert.strictEqual(byName(g, 'a.md')[0].parents[0], home.id);
    assert.strictEqual(byName(g, 'b.md')[0].parents[0], byName(g, 'guide')[0].id);
    const status = await run(['status'], env);
    assert.match(status.out, /storage folder\s+: DESTFOLDER01/);
  } finally { g.server.close(); }
});

test('the places a folder may come from follow `locations` in the plugin settings: My Drive alone by default', async () => {
  const g = fakeGoogle();
  await new Promise((r) => g.server.listen(0, '127.0.0.1', r));
  try {
    const { root, env } = setup(g);
    const probe = (extra) => new Promise((resolve) => {
      const settings = pluginFile(root);
      const base = fs.readFileSync(settings, 'utf8').replace(/\nlocations:[\s\S]*?(?=\n\w)/, '');
      const dir = fs.mkdtempSync(path.join(root, 'cfg-'));
      fs.cpSync(path.join(root, 'core', 'config'), dir, { recursive: true });
      fs.writeFileSync(path.join(dir, PLUGIN_FILE), `${extra}${base}`);
      const code = "const d = require('./lib/drive'); (async () => { const out = {}; out.locations = d.driveSettings().locations;" +
        " for (const p of ['shared', 'drives', 'starred', 'recent']) { try { out[p] = await d.listFolders(p); } catch (e) { out[p] = e.message; } }" +
        " out.mine = d.locationOf({ id: 'a', ownedByMe: true }); out.theirs = d.locationOf({ id: 'b', ownedByMe: false }); out.team = d.locationOf({ id: 'c', driveId: 'x' });" +
        " for (const f of [{ ownedByMe: true }, { ownedByMe: false }, { driveId: 'x' }]) { try { d.assertAllowed(f); out['ok' + Object.keys(f)[0] + f[Object.keys(f)[0]]] = true; } catch (e) { out['no' + Object.keys(f)[0] + f[Object.keys(f)[0]]] = true; } }" +
        " console.log(JSON.stringify(out)); })()";
      const c = spawn('node', ['-e', code], { env: { ...env, WORKSPACE_CONFIG: dir }, cwd: path.join(__dirname, '..') });
      let o = ''; c.stdout.on('data', (d) => { o += d; }); c.on('close', () => resolve(JSON.parse(o)));
    });

    const mine = await probe('');
    assert.deepStrictEqual(mine.locations, ['my_drive']);
    assert.match(mine.shared, /Shared with me is not allowed.*shared_with_me/);
    assert.match(mine.drives, /Shared drives is not allowed.*shared_drives/);
    assert.match(mine.starred, /Starred is not allowed.*starred/);
    assert.match(mine.recent, /Recent is not allowed.*recent/);
    assert.deepStrictEqual([mine.mine, mine.theirs, mine.team], ['my_drive', 'shared_with_me', 'shared_drives'], 'a pasted link is judged by where it lives');
    assert.ok(mine.okownedByMetrue && mine.noownedByMefalse && mine.nodriveIdx, 'only My Drive passes by default');

    const all = await probe('locations:\n  - my_drive\n  - shared_with_me\n  - shared_drives\n  - starred\n  - recent\n');
    assert.deepStrictEqual(all.locations, ['my_drive', 'shared_with_me', 'shared_drives', 'starred', 'recent']);
    assert.ok(Array.isArray(all.starred) && Array.isArray(all.recent), 'the views list folders once allowed');
    assert.deepStrictEqual(all.drives, [{ id: 'SHAREDDRIVE01', name: 'Team Drive' }], 'shared drives are listed, and are folders like any other');
    assert.ok(Array.isArray(all.shared));
    assert.ok(all.okownedByMetrue && all.okownedByMefalse && all.okdriveIdx);

    const junk = await probe('locations:\n  - nonsense\n');
    assert.deepStrictEqual(junk.locations, ['my_drive'], 'an unknown value falls back rather than allowing everything');
  } finally { g.server.close(); }
});

test('--dry-run writes nothing, and --item pushes one folder into one of its own name', async () => {
  const g = fakeGoogle();
  await new Promise((r) => g.server.listen(0, '127.0.0.1', r));
  try {
    const { env } = setup(g);
    const before = g.files.size;
    const dry = await run(['sync', 'docs', '--dry-run'], env);
    assert.strictEqual(dry.code, 0, dry.out);
    assert.match(dry.out, /Would do: 3 new/);
    assert.strictEqual(g.files.size, before, 'nothing created');

    const one = await run(['sync', 'docs', '--item', 'guide'], env);
    assert.strictEqual(one.code, 0, one.out);
    const guide = byName(g, 'guide')[0];
    assert.strictEqual(guide.parents[0], 'DESTFOLDER01');
    assert.strictEqual(byName(g, 'b.md')[0].parents[0], guide.id);
    assert.strictEqual(byName(g, 'a.md').length, 0, 'only that item');
    const bad = await run(['sync', 'docs', '--item', '../x'], env);
    assert.strictEqual(bad.code, 1);
    assert.match(bad.out, /one name/);
  } finally { g.server.close(); }
});

test('it says what is missing instead of failing in the middle', async () => {
  const g = fakeGoogle();
  await new Promise((r) => g.server.listen(0, '127.0.0.1', r));
  try {
    const { root, env } = setup(g);
    const noFolder = await run(['sync', 'docs', '--folder', ''], { ...env, WORKSPACE_CONFIG: (() => { const d = path.join(root, 'cfg2'); fs.cpSync(env.WORKSPACE_CONFIG, d, { recursive: true }); fs.writeFileSync(path.join(d, PLUGIN_FILE), fs.readFileSync(path.join(d, PLUGIN_FILE), 'utf8').replace('docs: DESTFOLDER01', 'docs: ""')); return d; })() });
    assert.strictEqual(noFolder.code, 1);
    assert.match(noFolder.out, /No Drive folder chosen for docs/);
    const unknown = await run(['sync', 'nope'], env);
    assert.match(unknown.out, /Unknown workspace/);
    const placeholder = await run(['status'], { ...env, WORKSPACE_CONFIG: (() => { const d = path.join(root, 'cfg3'); fs.cpSync(env.WORKSPACE_CONFIG, d, { recursive: true }); fs.writeFileSync(path.join(d, PLUGIN_FILE), fs.readFileSync(path.join(d, PLUGIN_FILE), 'utf8').replace('client_id: cid', 'client_id: CHANGE_ME')); return d; })() });
    assert.match(placeholder.out, /MISSING/);
  } finally { g.server.close(); }
});

test('the test workspace pushes each project\'s reports, screenshots and recordings, and nothing else', async () => {
  const g = fakeGoogle();
  await new Promise((r) => g.server.listen(0, '127.0.0.1', r));
  try {
    const { root, env } = setup(g);
    fs.writeFileSync(path.join(root, 'core', 'config', 'workspace.test.settings.yml'), 'doc:\n  name: test\n');
    fs.writeFileSync(path.join(root, 'core', 'config', 'settings.yml'), fs.readFileSync(path.join(root, 'core', 'config', 'settings.yml'), 'utf8').replace('  - docs', '  - docs\n  - test'));
    fs.writeFileSync(pluginFile(root), fs.readFileSync(pluginFile(root), 'utf8').replace('destinations:\n', 'sources:\n  test: test-reports\ndestinations:\n  test: DESTFOLDER01\n'));
    const mod = path.join(root, 'test', 'v11x0xb1', 'packages', 'webship_ai', 'tests');
    fs.mkdirSync(path.join(mod, 'reports'), { recursive: true });
    fs.mkdirSync(path.join(mod, 'screenshots'));
    fs.mkdirSync(path.join(mod, 'features'));
    fs.writeFileSync(path.join(mod, 'reports', 'cucumber_report.json'), '[]');
    fs.writeFileSync(path.join(mod, 'screenshots', 'fail.png'), crypto.randomBytes(2000));
    fs.writeFileSync(path.join(mod, 'features', 'a.feature'), 'Feature: source, not evidence');
    fs.mkdirSync(path.join(root, 'test', 'v11x0xb1', 'web'), { recursive: true });
    fs.writeFileSync(path.join(root, 'test', 'v11x0xb1', 'web', 'index.php'), '<?php // the site');
    fs.mkdirSync(path.join(root, 'test', 'plain'));

    const out = await run(['sync', 'test'], env);
    assert.strictEqual(out.code, 0, out.out);
    assert.match(out.out, /v11x0xb1\/webship_ai\/reports/);
    const project = byName(g, 'v11x0xb1')[0];
    const module = byName(g, 'webship_ai')[0];
    assert.strictEqual(project.parents[0], 'DESTFOLDER01');
    assert.strictEqual(module.parents[0], project.id);
    const reports = byName(g, 'reports')[0];
    assert.strictEqual(reports.parents[0], module.id);
    assert.strictEqual(byName(g, 'cucumber_report.json')[0].parents[0], reports.id);
    assert.strictEqual(byName(g, 'fail.png')[0].parents[0], byName(g, 'screenshots')[0].id);
    assert.strictEqual(byName(g, 'a.feature').length + byName(g, 'index.php').length + byName(g, 'plain').length, 0, 'not the source, the site or a project with no report');

    const again = await run(['sync', 'test'], env);
    assert.match(again.out, /0 new, 0 changed, 2 already there/, again.out);
    const none = await run(['sync', 'test', '--item', 'plain'], env);
    assert.match(none.out, /No test reports found in test\/plain/);
    const bad = await run(['sync', 'test', '--item', 'nope'], env);
    assert.match(bad.out, /not a project here/);
  } finally { g.server.close(); }
});

test('only selected, targeted files go: no targets means nothing, hidden folders never, and an explicit item is its own selection', async () => {
  const g = fakeGoogle();
  await new Promise((r) => g.server.listen(0, '127.0.0.1', r));
  try {
    const { root, env } = setup(g);
    const D = path.join(root, 'docs');
    const put = (rel, text = 'x\n') => { fs.mkdirSync(path.dirname(path.join(D, rel)), { recursive: true }); fs.writeFileSync(path.join(D, rel), text); };
    for (const f of ['a.md', 'notes.txt', 'img.png', 'guide/x.png', 'guide/y.txt', 'other/deep/c.md', 'other/deep/c.png', 'onlypng/p.png', '.work/hidden.md', '.work/video.mp4']) put(f);
    const settings = pluginFile(root);
    const withTargets = (lines) => fs.writeFileSync(settings, fs.readFileSync(settings, 'utf8').replace(/targets:\n(?: {2,}.*\n)*/, lines));

    withTargets('targets:\n  docs:\n    - "*.md"\n    - guide/\n    - "other/deep/*.png"\n');
    const out = await run(['sync', 'docs'], env);
    assert.strictEqual(out.code, 0, out.out);
    const names = [...g.files.values()].filter((f) => f.content).map((f) => f.name).sort();
    // *.md anywhere, everything under guide/, and the one path glob. Not notes.txt, img.png, the other png, the hidden folder or an untargeted folder.
    assert.deepStrictEqual(names, ['a.md', 'b.md', 'c.md', 'c.png', 'x.png', 'y.txt']);
    assert.ok(!names.includes('notes.txt') && !names.includes('img.png') && !names.includes('p.png') && !names.includes('hidden.md') && !names.includes('video.mp4'));
    assert.strictEqual(byName(g, 'onlypng').length, 0, 'a folder with nothing selected in it is not even created');
    assert.strictEqual(byName(g, '.work').length, 0);
    assert.match(out.out, /not selected/);

    // a *.mp4 target still does not reach into a hidden folder
    withTargets('targets:\n  docs:\n    - "*.mp4"\n');
    const mp4 = await run(['sync', 'docs'], env);
    assert.match(mp4.out, /0 new, 0 changed/, mp4.out);
    assert.ok(![...g.files.values()].some((f) => f.name === 'video.mp4'));

    // no targets at all: nothing is pushed, and it says what to do
    withTargets('');
    const none = await run(['sync', 'docs'], env);
    assert.strictEqual(none.code, 0, none.out);
    assert.match(none.out, /No files are selected for docs.*targets\.docs/);
    assert.strictEqual(byName(g, 'img.png').length, 0);

    // naming an item is an explicit selection, so it does not need a target
    const item = await run(['sync', 'docs', '--item', 'onlypng'], env);
    assert.strictEqual(item.code, 0, item.out);
    assert.strictEqual(byName(g, 'p.png').length, 1);
  } finally { g.server.close(); }
});

test('tooling files and anything that holds a password or key are never pushed, whatever the settings say', async () => {
  const g = fakeGoogle();
  await new Promise((r) => g.server.listen(0, '127.0.0.1', r));
  try {
    const { root, env } = setup(g);
    const D = path.join(root, 'docs');
    const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(D, rel)), { recursive: true }); fs.writeFileSync(path.join(D, rel), text); };
    // the workspace's own tooling, at its root
    put('cmd-tools-anything.sh', '#!/bin/sh\n'); put('AGENTS.md', '# agents\n'); put('CLAUDE.md', '# claude\n'); put('README.md', '# readme\n'); put('docs.code-workspace', '{}');
    put('guide/cmd-nested.sh', '#!/bin/sh\n');                                 // a cmd script anywhere
    put('guide/README.md', '# a real doc about the guide\n');                  // a README below the root is content
    // secrets by name
    for (const n of ['.env', '.env.local', 'server.pem', 'deploy.key', 'id_rsa', 'client_secret_123.json', 'passwords.txt', 'my-credentials.yml', 'x.keystore', 'api_key.txt']) put(`guide/${n}`, 'harmless text\n');
    // secrets by content
    put('guide/notes.md', 'ssh in with:\n-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n');
    put('guide/config.yml', 'database:\n  password: s3cretPassw0rd99\n');
    put('guide/gh.txt', 'token ghp_' + 'a'.repeat(36) + '\n');
    put('guide/google.json', '{"client_secret": "GOCSPX-' + 'b'.repeat(28) + '"}');
    // must still go: placeholders and ordinary prose about passwords
    put('guide/ok-placeholder.yml', 'password: CHANGE_ME\napi_key: your-key-here\ntoken: ${TOKEN}\nsecret: xxxxxxxxxxxx\n');
    put('guide/ok-prose.md', 'Set a strong password. The token is shown once; keep the secret safe.\npassword: requiredvalue\n');
    put('guide/ok-url.md', 'token: https://example.test/path/to/token-page\n');

    const out = await run(['sync', 'docs'], env);
    assert.strictEqual(out.code, 0, out.out);
    const pushed = [...g.files.values()].map((f) => f.name);
    for (const n of ['cmd-tools-anything.sh', 'AGENTS.md', 'CLAUDE.md', 'docs.code-workspace', 'cmd-nested.sh', '.env', '.env.local', 'server.pem', 'deploy.key', 'id_rsa', 'client_secret_123.json', 'passwords.txt', 'my-credentials.yml', 'x.keystore', 'api_key.txt', 'notes.md', 'config.yml', 'gh.txt', 'google.json']) {
      assert.ok(!pushed.includes(n), `${n} must not be pushed`);
    }
    // the root README is tooling and stays home, the one in guide/ is a doc and goes
    const readmes = [...g.files.values()].filter((f) => f.name === 'README.md');
    assert.strictEqual(readmes.length, 1, 'only the README below the root');
    assert.strictEqual(readmes[0].parents[0], byName(g, 'guide')[0].id);
    for (const n of ['ok-placeholder.yml', 'ok-prose.md', 'ok-url.md', 'a.md']) assert.ok(pushed.includes(n), `${n} is ordinary and must go`);
    assert.match(out.out, /guide\/notes\.md: not pushed, it looks like it holds a private key/);
    assert.match(out.out, /guide\/config\.yml: not pushed, it looks like it holds a password value/);
    assert.match(out.out, /guide\/gh\.txt: not pushed, it looks like it holds a GitHub token/);
    assert.match(out.out, /guide\/google\.json: not pushed, it looks like it holds a Google client secret/);

    // the baseline cannot be switched off by the exclude list in settings
    const settings = pluginFile(root);
    fs.writeFileSync(settings, fs.readFileSync(settings, 'utf8').replace(/exclude:[\s\S]*$/, 'exclude:\n  - nothing-at-all\n'));
    const again = await run(['sync', 'docs'], env);
    assert.strictEqual(again.code, 0, again.out);
    assert.ok(![...g.files.values()].some((f) => f.name === 'id_rsa' || f.name === 'cmd-tools-anything.sh'), 'still not pushed');

    // and the content scan is the only part that can be turned off
    fs.writeFileSync(settings, `scan_for_secrets: false\n${fs.readFileSync(settings, 'utf8')}`);
    await run(['sync', 'docs', '--overwrite'], env);
    assert.ok([...g.files.values()].some((f) => f.name === 'config.yml'), 'with the scan off a content-only secret goes (the name rules still hold)');
    assert.ok(![...g.files.values()].some((f) => f.name === 'id_rsa' || f.name === '.env'), 'but never one that is secret by name');
  } finally { g.server.close(); }
});

test('naming one file selects it past the targets, but never past the never-push rules', async () => {
  const g = fakeGoogle();
  await new Promise((r) => g.server.listen(0, '127.0.0.1', r));
  try {
    const { root, env } = setup(g);
    const D = path.join(root, 'docs');
    fs.writeFileSync(path.join(D, 'id_rsa'), 'not really a key, but named like one\n');
    fs.writeFileSync(path.join(D, 'cmd-tools-x.sh'), '#!/bin/sh\n');
    fs.writeFileSync(path.join(D, '.env'), 'A=1\n');
    fs.writeFileSync(path.join(D, 'deploy-notes.md'), '# fine\n');
    for (const name of ['id_rsa', 'cmd-tools-x.sh', '.env']) {
      const out = await run(['sync', 'docs', '--item', name], env);
      assert.strictEqual(out.code, 0, out.out);
      assert.match(out.out, new RegExp(`${name.replace('.', '\\.')}: not pushed, it is on the never-push list`), out.out);
      assert.strictEqual(byName(g, name).length, 0, `${name} must not be pushed`);
    }
    const ok = await run(['sync', 'docs', '--item', 'deploy-notes.md'], env);
    assert.strictEqual(ok.code, 0, ok.out);
    assert.strictEqual(byName(g, 'deploy-notes.md').length, 1);
  } finally { g.server.close(); }
});

test('a pasted Drive link or a bare id both give the folder id', () => {
  const { parseFolderId, globToRegex } = require('../lib/drive');
  assert.strictEqual(parseFolderId('https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz0123?usp=sharing'), '1AbCdEfGhIjKlMnOpQrStUvWxYz0123');
  assert.strictEqual(parseFolderId('https://drive.google.com/drive/u/0/folders/abc123_-XYZ'), 'abc123_-XYZ');
  assert.strictEqual(parseFolderId('1AbCdEfGhIjKlMnOpQrStUvWxYz0123'), '1AbCdEfGhIjKlMnOpQrStUvWxYz0123');
  assert.strictEqual(parseFolderId('not a folder'), '');
  assert.ok(globToRegex('*.tmp').test('a.tmp') && !globToRegex('*.tmp').test('a/b.tmp') && globToRegex('a/**').test('a/b/c'));
});
