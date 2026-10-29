/**
 * The audio workspace and its sound player.
 *
 * A voice or a sound is opened from the same list a recording is, so the listing, the play route and
 * the file route have to agree on what plays. The behavioural half starts the real server on a spare
 * port against a temp tree, because a Play button that answers 404 is exactly what source checks miss.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const APP = path.join(__dirname, '../..');
const REPO = path.join(APP, '../..');
const { copyConfig } = require('./_isolated-config');
const { AUDIO_RE, VIDEO_RE } = require('../../format');
const fb = require('../../files-browser');
const types = require('../../workspace-types');

const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');

test('AUDIO_RE is the set of sound the browser plays, and no video is among it', () => {
  for (const n of ['a.mp3', 'a.WAV', 'a.ogg', 'a.oga', 'a.opus', 'a.m4a', 'a.aac', 'a.flac', 'a.weba']) {
    assert.ok(AUDIO_RE.test(n), n);
    assert.ok(!VIDEO_RE.test(n), `${n} is not a video`);
  }
  for (const n of ['a.mp4', 'a.webm', 'a.txt', 'a.mp3.txt', 'mp3']) assert.ok(!AUDIO_RE.test(n), n);
});

test('audio is a registered workspace: listed, typed as media, presented and routed', () => {
  assert.match(read(REPO, 'core/config/settings.yml'), /^workspaces:[\s\S]*?\n {2}- audio\n/m);
  assert.match(read(REPO, 'core/config/workspace.audio.settings.yml'), /^type: media$/m);
  assert.match(read(REPO, 'core/config/workspace.audio.settings.yml'), /^ {2}name: audio$/m);
  assert.strictEqual(types.resolveType('audio', undefined, 'files'), 'media');
  assert.match(read(APP, 'workspaces.js'), /audio:\s+\{ icon: 'tabler:headphones', subtitle: 'Voices & Sounds', noun: 'sound', kind: 'files' \}/);
  assert.match(read(APP, '.ddev/config.yaml'), /- "\*\.audio\.workspace"/);
  for (const f of ['README.md', 'AGENTS.md', 'CLAUDE.md']) assert.ok(fs.existsSync(path.join(REPO, 'audio', f)), f);
});

test('the audio folder is browsable and a sound row gets the music icon', () => {
  assert.ok(fb.BROWSABLE.has('audio'));
  for (const n of ['a.mp3', 'a.opus', 'a.flac', 'a.weba']) assert.strictEqual(fb.kindIcon(n), 'tabler:music', n);
});

test('the sound player controls act on the audio in their own card', () => {
  const ui = read(APP, 'public/media-player.js');
  assert.match(ui, /\[data-sound-speed\]/);
  assert.match(ui, /media\.playbackRate = r/);
  assert.match(ui, /\[data-sound-loop\]/);
  assert.match(ui, /media\.loop = e\.target\.checked/);
  assert.ok(fs.existsSync(path.join(APP, 'public/css/components/sound-player.css')));
});

// ---- the running server ------------------------------------------------------------------------

let proc;
let base;
let root;

function free() {
  return new Promise((resolve) => {
    const s = require('net').createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-audio-'));
  fs.mkdirSync(path.join(root, 'core'), { recursive: true });
  copyConfig(path.join(REPO, 'core/config'), path.join(root, 'core/config'));
  fs.symlinkSync(path.join(REPO, 'core/scripts'), path.join(root, 'core/scripts'));
  fs.symlinkSync(APP, path.join(root, 'core/workspace-app'));
  fs.mkdirSync(path.join(root, 'audio/voices'), { recursive: true });
  fs.writeFileSync(path.join(root, 'audio/voices/hello.mp3'), Buffer.alloc(5000, 1));
  fs.writeFileSync(path.join(root, 'audio/chime.wav'), Buffer.alloc(300, 2));
  fs.writeFileSync(path.join(root, 'audio/notes.txt'), 'not a sound');
  fs.writeFileSync(path.join(root, 'secret.mp3'), 'outside the workspace');
  const port = await free();
  base = `http://127.0.0.1:${port}`;
  proc = spawn(process.execPath, ['server.js'], { cwd: APP, env: { ...process.env, PORT: String(port), WORKSPACE_ROOT: root }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start')), 15000);
    proc.stdout.on('data', (d) => { if (/listening/.test(String(d))) { clearTimeout(t); resolve(); } });
    proc.on('exit', (c) => { clearTimeout(t); reject(new Error(`server exited ${c}`)); });
  });
});

after(() => {
  if (proc) proc.kill();
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

const get = (p, headers) => fetch(base + p, { headers, redirect: 'manual' });

test('the page lists the folder and its sound, each with a Play button', async () => {
  const top = await (await get('/fragments/audio/items')).text();
  assert.match(top, /items\?path=voices/);
  assert.match(top, /title="Play chime\.wav/);
  assert.match(top, /hx-get="\/fragments\/audio\/play\/chime\.wav"/);
  assert.ok(!/Play notes\.txt/.test(top), 'a text file gets no Play button');
  const sub = await (await get('/fragments/audio/items?path=voices')).text();
  assert.match(sub, /hx-get="\/fragments\/audio\/play\/voices\/hello\.mp3"/);
});

test('the play route answers a sound with an audio player, speed and loop', async () => {
  const r = await get('/fragments/audio/play/voices/hello.mp3');
  assert.strictEqual(r.status, 200);
  const html = await r.text();
  assert.match(html, /<audio class="sound-player" controls preload="metadata" src="\/files\/audio\/voices\/hello\.mp3">/);
  const rates = ['0.5', '0.75', ...Array.from({ length: 17 }, (_, i) => String(1 + i * 0.25))];
  for (const rate of rates) assert.ok(html.includes(`data-sound-speed="${rate}"`), rate);
  assert.strictEqual((html.match(/data-sound-speed=/g) || []).length, 19, 'every quarter step from 1x to 5x, and the two slower ones');
  assert.match(html, /data-sound-loop/);
  assert.ok(!/<video/.test(html));
});

test('the play route refuses a file that is not a sound, a missing one, and a path out of the workspace', async () => {
  assert.strictEqual((await get('/fragments/audio/play/notes.txt')).status, 404);
  assert.strictEqual((await get('/fragments/audio/play/voices/none.mp3')).status, 404);
  assert.strictEqual((await get('/fragments/audio/play/..%2Fsecret.mp3')).status, 400);
  assert.strictEqual((await get('/files/audio/..%2Fsecret.mp3')).status, 400);
});

test('a sound is served with an audio type and byte ranges, so it can be seeked', async () => {
  const full = await get('/files/audio/voices/hello.mp3');
  assert.strictEqual(full.status, 200);
  assert.strictEqual(full.headers.get('content-type'), 'audio/mpeg');
  assert.strictEqual(full.headers.get('accept-ranges'), 'bytes');
  const part = await get('/files/audio/voices/hello.mp3', { Range: 'bytes=100-199' });
  assert.strictEqual(part.status, 206);
  assert.strictEqual(part.headers.get('content-range'), 'bytes 100-199/5000');
  assert.strictEqual((await part.arrayBuffer()).byteLength, 100);
  assert.strictEqual((await get('/files/audio/voices/hello.mp3', { Range: 'bytes=9000-' })).status, 416);
  assert.strictEqual((await get('/files/audio/chime.wav')).headers.get('content-type'), 'audio/wav');
});

test('a video is still played as a video', async () => {
  fs.mkdirSync(path.join(root, 'videos'), { recursive: true });
  fs.writeFileSync(path.join(root, 'videos/demo.mp4'), Buffer.alloc(400, 3));
  const html = await (await get('/fragments/videos/play/demo.mp4')).text();
  assert.match(html, /<video class="video-player"/);
  assert.ok(!/<audio/.test(html));
  for (const rate of ['0.5', '1', '1.75', '2.25', '3.5', '4.75', '5']) assert.ok(html.includes(`data-sound-speed="${rate}"`), `video speed ${rate}`);
  assert.match(html, /data-sound-loop/);
});
