/**
 * The player and the cards, the way a streaming site has them.
 *
 * Lengths are read from the files, so they are checked against ffprobe where it is installed and against
 * hand-built headers where it is not. The rows, the chapters and the player markup come from the real server.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn, execFileSync } = require('child_process');

const APP = path.join(__dirname, '../..');
const REPO = path.join(APP, '../..');
const { copyConfig } = require('./_isolated-config');
const mi = require('../../media-info');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-media-'));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-media-root-'));

function hasFfmpeg() {
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch (_) { return false; }
}
const ffmpeg = (...a) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...a]);

test('a length is said the way a player says it', () => {
  assert.strictEqual(mi.clock(476.1), '7:56');
  assert.strictEqual(mi.clock(59.6), '1:00');
  assert.strictEqual(mi.clock(3725), '1:02:05');
  assert.strictEqual(mi.clock(0), '');
  assert.strictEqual(mi.clock(null), '');
});

test('a wav and a constant bit rate mp3 are read from their headers', () => {
  const wav = Buffer.alloc(44 + 88200);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + 88200, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(22050, 24); wav.writeUInt32LE(44100, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(88200, 40);
  fs.writeFileSync(path.join(tmp, 'two.wav'), wav);
  assert.strictEqual(mi.seconds(path.join(tmp, 'two.wav')), 2);
  // MPEG-1 Layer III, 128 kbit/s, 44.1 kHz: 0xFFFB 0x90 0x00. 160000 bytes at 128 kbit/s is 10 seconds.
  const mp3 = Buffer.alloc(160000, 0);
  Buffer.from([0xff, 0xfb, 0x90, 0x00]).copy(mp3, 0);
  fs.writeFileSync(path.join(tmp, 'ten.mp3'), mp3);
  assert.strictEqual(mi.seconds(path.join(tmp, 'ten.mp3')), 10);
  fs.writeFileSync(path.join(tmp, 'junk.mp3'), Buffer.alloc(500, 1));
  assert.strictEqual(mi.seconds(path.join(tmp, 'junk.mp3')), null);
  assert.strictEqual(mi.seconds(path.join(tmp, 'missing.mp4')), null);
  assert.strictEqual(mi.seconds(path.join(tmp, 'two.txt')), null);
});

test('an mp4 length is found whether the encoder put its header first or last', { skip: !hasFfmpeg() }, () => {
  for (const [name, flags] of [['front.mp4', ['-movflags', '+faststart']], ['end.mp4', []]]) {
    const out = path.join(tmp, name);
    ffmpeg('-f', 'lavfi', '-i', 'testsrc=duration=5:size=160x120:rate=10', '-f', 'lavfi', '-i', 'sine=duration=5', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', ...flags, out);
    const truth = parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]).toString());
    assert.ok(Math.abs(mi.seconds(out) - truth) < 0.1, `${name}: ${mi.seconds(out)} against ${truth}`);
  }
  const mp3 = path.join(tmp, 'tone.mp3');
  ffmpeg('-f', 'lavfi', '-i', 'sine=duration=4', '-codec:a', 'libmp3lame', '-b:a', '128k', mp3);
  assert.ok(Math.abs(mi.seconds(mp3) - 4) < 0.2, String(mi.seconds(mp3)));
});

test('the player offers what people expect, and the cards say how long and whether there are words', () => {
  const js = fs.readFileSync(path.join(APP, 'public/media-player.js'), 'utf8');
  for (const bit of ["key === 'j'", "key === 'l'", "'ArrowLeft'", "'ArrowUp'", "key === 'm'", "requestFullscreen", "key === '<'", "/^[0-9]$/", "ws-media-speed", "media.play()", "data-media-step", "mouseover"]) {
    assert.ok(js.includes(bit), bit);
  }
  assert.strictEqual(fs.readFileSync(path.join(APP, 'public/ui.js'), 'utf8').indexOf('data-sound-speed'), -1, 'the old handlers are gone from ui.js');
});

// ---- the running server ------------------------------------------------------------------------

let proc; let base;
const free = () => new Promise((resolve) => {
  const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});
const SCRIPT = `# Demo

## E01 Opening (00:00.0 to 00:02.0)

> Hello there.

## E02 Close (00:02.0 to 00:05.0)

> Goodbye now.
`;

before(async () => {
  fs.mkdirSync(path.join(root, 'core'), { recursive: true });
  copyConfig(path.join(REPO, 'core/config'), path.join(root, 'core/config'));
  fs.symlinkSync(path.join(REPO, 'core/scripts'), path.join(root, 'core/scripts'));
  fs.symlinkSync(APP, path.join(root, 'core/workspace-app'));
  for (const d of ['videos', 'docs', 'audio']) fs.mkdirSync(path.join(root, d), { recursive: true });
  if (hasFfmpeg()) {
    ffmpeg('-f', 'lavfi', '-i', 'testsrc=duration=5:size=160x120:rate=10', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(root, 'videos/demo.mp4'));
    ffmpeg('-f', 'lavfi', '-i', 'sine=duration=3', '-codec:a', 'libmp3lame', '-b:a', '128k', path.join(root, 'audio/tone.mp3'));
  } else {
    fs.writeFileSync(path.join(root, 'videos/demo.mp4'), Buffer.alloc(100, 1));
    fs.writeFileSync(path.join(root, 'audio/tone.mp3'), Buffer.alloc(100, 1));
  }
  fs.writeFileSync(path.join(root, 'videos/plain.mp4'), Buffer.alloc(100, 2));
  fs.writeFileSync(path.join(root, 'docs/demo-voiceover-script.md'), SCRIPT);
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
  for (const d of [tmp, root]) fs.rmSync(d, { recursive: true, force: true });
});

const get = (p) => fetch(base + p);
const rowOf = (html, name) => { const at = html.indexOf(`title="Play ${name}`); return html.slice(Math.max(0, at - 2500), at + 1500); };

test('a recording\'s card carries its length, CC when it has a script, and a preview address', { skip: !hasFfmpeg() }, async () => {
  const html = await (await get('/fragments/videos/items')).text();
  const demo = rowOf(html, 'demo.mp4');
  assert.match(demo, /<span class="fx-duration">0:05<\/span>/);
  assert.match(demo, /<span class="fx-cc" title="Has a transcript">CC<\/span>/);
  assert.match(demo, /data-preview="\/files\/videos\/demo\.mp4"/);
  assert.match(demo, /<span class="fx-size">[^<]*· 0:05<\/span>/);
  const plain = rowOf(html, 'plain.mp4');
  assert.ok(!/fx-duration|fx-cc/.test(plain.slice(plain.lastIndexOf('<div class="fx-row'))), 'no length and no CC where there is neither');
  const sound = await (await get('/fragments/audio/items')).text();
  assert.match(sound, /<span class="fx-duration">0:03<\/span>/);
  assert.ok(!/data-preview/.test(sound), 'a sound has no picture to preview');
});

test('the player is a stage with a speed menu, chapters from the script, and previous and next', async () => {
  const html = await (await get('/fragments/videos/play/demo.mp4')).text();
  assert.match(html, /class="uk-card uk-card-default uk-card-body uk-margin-top editor-card media-card"/);
  assert.match(html, /<div class="media-stage"><video class="video-player"/);
  assert.match(html, /data-speed-label[^>]*>1×<\/button>\s*<div uk-dropdown=/);
  assert.strictEqual((html.match(/data-sound-speed=/g) || []).length, 19);
  const chapters = JSON.parse(html.match(/data-chapters="([^"]*)"/)[1].replace(/&quot;/g, '"'));
  assert.deepStrictEqual(chapters, [{ start: 0, end: 2, title: 'E01 Opening' }, { start: 2, end: 5, title: 'E02 Close' }]);
  assert.match(html, /<section class="transcript-section" data-start="2" data-end="5">/);
  assert.match(html, /data-media-step="-1" disabled/);
  assert.match(html, /data-media-step="1" disabled/);
  assert.match(html, /Space play/);
  assert.match(html, /<p class="player-chapter" data-chapter hidden><\/p>/);
  const sound = await (await get('/fragments/audio/play/tone.mp3')).text();
  assert.match(sound, /media-stage is-sound/);
  assert.ok(!/chapter-bar/.test(sound), 'a sound has no chapters');
  const plain = await (await get('/fragments/videos/play/plain.mp4')).text();
  assert.ok(!/chapter-bar/.test(plain), 'no script, no chapters');
});

test('the shell loads the player script', async () => {
  const page = await (await get('/videos')).text();
  assert.match(page, /<script src="\/media-player\.js[^"]*" defer><\/script>/);
  const js = await get('/media-player.js');
  assert.strictEqual(js.status, 200);
});
