/**
 * A recording's card: a default picture when it has none, and its voiceover script one click away.
 *
 * The script is found by name in docs/ (`<video>-voiceover-script.md`). The pure parts are tested
 * directly; the rows, the player and the transcript route run on the real server and a temp tree.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');

const APP = path.join(__dirname, '../..');
const REPO = path.join(APP, '../..');
const { copyConfig } = require('./_isolated-config');
const tr = require('../../transcripts');

const SCRIPT = `# Demo: voiceover script (draft 1)

- **Version:** Draft 1

## Section timings

| # | Section |
|---|---|
| E01 | Opening |

## E01 Opening (00:00.0 to 00:20.0)

**On screen:** the home page.

> This is **Webship 11**, running on [Drupal](https://drupal.org) 11.
> *(optional)* A spare sentence.

## E02 Close (00:20.0 to 01:05.5)

> Thank you for <watching> & goodbye.
`;

test('a script is found by the video\'s name, in the order of its suffixes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-tr-'));
  for (const n of ['a-voiceover-script.md', 'b-transcript.md', 'c-script.md', 'd.md', 'a-script.md']) fs.writeFileSync(path.join(dir, n), 'x');
  assert.strictEqual(tr.findScript(dir, 'a'), 'a-voiceover-script.md');
  assert.strictEqual(tr.findScript(dir, 'b'), 'b-transcript.md');
  assert.strictEqual(tr.findScript(dir, 'c'), 'c-script.md');
  assert.strictEqual(tr.findScript(dir, 'd'), null, 'a bare name is not a script');
  assert.strictEqual(tr.findScript(path.join(dir, 'missing'), 'a'), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a timed script gives sections with only the words spoken', () => {
  const p = tr.parseTranscript(SCRIPT);
  assert.strictEqual(p.timed, true);
  assert.strictEqual(p.title, 'Demo: voiceover script (draft 1)');
  assert.deepStrictEqual(p.sections.map((s) => [s.id, s.title, s.start, s.end]), [['E01', 'Opening', 0, 20], ['E02', 'Close', 20, 65.5]]);
  assert.deepStrictEqual(p.sections[0].lines, [
    { text: 'This is Webship 11, running on Drupal 11.', optional: false },
    { text: 'A spare sentence.', optional: true },
  ]);
  assert.ok(!JSON.stringify(p).includes('On screen'));
});

test('a plain script gives its paragraphs, without lists, tables or headings', () => {
  const p = tr.parseTranscript('# Title\n\n- a note\n\nFirst paragraph\nstill first.\n\n| a | b |\n\nSecond paragraph.\n');
  assert.deepStrictEqual([p.timed, p.paragraphs], [false, ['First paragraph still first.', 'Second paragraph.']]);
});

test('the transcript is escaped, and a section time seeks only when asked to', () => {
  const html = tr.transcriptHtml(tr.parseTranscript(SCRIPT), { file: 'd.md', href: '/files/docs/d.md', seek: true });
  assert.match(html, /Thank you for &lt;watching&gt; &amp; goodbye\./);
  assert.ok(!/<watching>/.test(html));
  assert.match(html, /<button type="button" class="transcript-seek" data-seek="20"[^>]*>00:20<\/button>/);
  assert.match(html, /class="is-optional"/);
  assert.ok(!/data-seek/.test(tr.transcriptHtml(tr.parseTranscript(SCRIPT), {})), 'no seek buttons without a player');
  assert.strictEqual(tr.stamp(65.5), '01:06');
  assert.strictEqual(tr.stamp(3725), '1:02:05');
});

// ---- the running server ------------------------------------------------------------------------

let proc; let base; const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-tr-root-'));

const free = () => new Promise((resolve) => {
  const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});

before(async () => {
  fs.mkdirSync(path.join(root, 'core'), { recursive: true });
  copyConfig(path.join(REPO, 'core/config'), path.join(root, 'core/config'));
  fs.symlinkSync(path.join(REPO, 'core/scripts'), path.join(root, 'core/scripts'));
  fs.symlinkSync(APP, path.join(root, 'core/workspace-app'));
  for (const d of ['videos', 'docs', 'audio']) fs.mkdirSync(path.join(root, d), { recursive: true });
  fs.writeFileSync(path.join(root, 'videos/demo-draft-1.mp4'), Buffer.alloc(200, 1));
  fs.writeFileSync(path.join(root, 'videos/posted.mp4'), Buffer.alloc(200, 2));
  fs.writeFileSync(path.join(root, 'videos/posted-poster.jpg'), Buffer.alloc(50, 3));
  fs.writeFileSync(path.join(root, 'audio/hello.mp3'), Buffer.alloc(200, 4));
  fs.mkdirSync(path.join(root, 'audio/sounds'), { recursive: true });
  const put = (name, body) => fs.writeFileSync(path.join(root, 'audio', name), body);
  put('sounds/rain.mp3', Buffer.alloc(300, 5));
  put('sounds/rain.txt', 'Rain on a tin roof\n');
  put('sounds/rain.json', JSON.stringify({ kind: 'sound', engine: 'elevenlabs', duration: 4, loop: true, created_utc: '2026-10-07T12:00:00Z' }));
  put('sounds/rain.jpg', Buffer.alloc(60, 6));
  put('sounds/stray.bin', 'not a sound');
  put('sounds/loose.txt', 'a text with no sound');
  put('sounds/chime-cover.png', Buffer.alloc(60, 8));
  put('sounds/chime.wav', Buffer.alloc(300, 9));
  put('sounds/chime-transcript.md', 'A single chime.\n');
  fs.mkdirSync(path.join(root, 'videos/older-takes'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs/notes-folder'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs/loose-note.md'), 'x');
  fs.writeFileSync(path.join(root, 'docs/demo-draft-1-voiceover-script.md'), SCRIPT);
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
  fs.rmSync(root, { recursive: true, force: true });
});

const get = (p) => fetch(base + p);

test('a recording with no poster gets the default picture, one with a poster keeps its own', async () => {
  const html = await (await get('/fragments/videos/items')).text();
  const row = (name) => html.slice(html.indexOf(`title="${name}.mp4`) - 1500, html.indexOf(`title="${name}.mp4`) + 1500);
  assert.match(row('demo-draft-1'), /fx-thumb is-default/);
  assert.match(html, /<span class="fx-thumb is-video"[^>]*>\s*<img src="[^"]*posted-poster\.jpg/);
  const posted = html.slice(html.indexOf('posted-poster.jpg') - 200, html.indexOf('posted-poster.jpg') + 600);
  assert.ok(!/is-default/.test(posted));
  assert.match(await (await get('/fragments/audio/items')).text(), /fx-thumb is-default/);
});

test('pressing the picture of a recording or a sound plays it, like its Play button', async () => {
  const videos = await (await get('/fragments/videos/items')).text();
  assert.match(videos, /<span class="fx-thumb is-default" role="button" tabindex="0" title="Play demo-draft-1\.mp4"\s+hx-get="\/fragments\/videos\/play\/demo-draft-1\.mp4"/);
  assert.match(videos, /<span class="fx-thumb is-video" role="button" tabindex="0" title="Play posted\.mp4"\s+hx-get="\/fragments\/videos\/play\/posted\.mp4"/);
  assert.match(videos, /hx-trigger="click, keyup\[key=='Enter'\]" hx-target="#editor-modal-body"/);
  assert.match(await (await get('/fragments/audio/items')).text(), /fx-thumb is-default" role="button"[^>]*hx-get="\/fragments\/audio\/play\/hello\.mp3"/);
  // The same address the button uses, and it answers.
  assert.strictEqual((await get('/fragments/videos/play/posted.mp4')).status, 200);
});

test('only a recording that has a script shows the Transcript button', async () => {
  const html = await (await get('/fragments/videos/items')).text();
  assert.strictEqual((html.match(/fx-transcript/g) || []).length, 1);
  assert.match(html, /hx-get="\/fragments\/videos\/transcript\/demo-draft-1\.mp4"/);
  assert.match(html, /Read the voiceover script: demo-draft-1-voiceover-script\.md/);
});

test('the player shows the words under the video, with times that seek', async () => {
  const withScript = await (await get('/fragments/videos/play/demo-draft-1.mp4')).text();
  assert.match(withScript, /<details class="transcript-details" open><summary>Transcript<\/summary>/);
  assert.match(withScript, /data-seek="20"/);
  assert.ok(!/<h4[^>]*>Transcript/.test(withScript), 'the summary says it, the body does not repeat it');
  assert.match(withScript, /This is Webship 11, running on Drupal 11\./);
  const without = await (await get('/fragments/videos/play/posted.mp4')).text();
  assert.ok(!/transcript/.test(without));
});

test('the transcript opens on its own, and says nothing it should not', async () => {
  const r = await get('/fragments/videos/transcript/demo-draft-1.mp4');
  assert.strictEqual(r.status, 200);
  const html = await r.text();
  assert.match(html, /from <a href="\/files\/docs\/demo-draft-1-voiceover-script\.md"/);
  assert.ok(!/data-seek|<video|On screen/.test(html));
  assert.strictEqual((await get('/fragments/videos/transcript/posted.mp4')).status, 404, 'no script');
  assert.strictEqual((await get('/fragments/videos/transcript/nothing.mp4')).status, 404, 'no video');
  assert.strictEqual((await get('/fragments/videos/transcript/..%2Fdocs%2Fdemo-draft-1-voiceover-script.md')).status, 404);
  assert.strictEqual((await get('/fragments/videos/transcript/demo-draft-1.mp4.txt')).status, 404);
});

test('the seek buttons and the card styles are in the front end', () => {
  assert.match(fs.readFileSync(path.join(APP, 'public/media-player.js'), 'utf8'), /\[data-seek\][\s\S]*media\.currentTime = /);
  assert.match(fs.readFileSync(path.join(APP, 'public/css/components/project-rows.css'), 'utf8'), /\.fx-thumb\.is-default/);
});

test('the audio workspace lists sounds and what belongs to them, nothing else', async () => {
  const html = await (await get('/fragments/audio/items?path=sounds')).text();
  assert.match(html, /title="Play rain\.mp3/);
  assert.match(html, /title="Play chime\.wav/);
  for (const hidden of ['rain.txt', 'rain.json', 'rain.jpg', 'stray.bin', 'loose.txt', 'chime-cover.png', 'chime-transcript.md']) {
    assert.ok(!html.includes(`title="${hidden}`) && !html.includes(`/${hidden}"`) || /fx-thumb[^>]*>\s*<img src="[^"]*(rain\.jpg|chime-cover\.png)/.test(html) && !/title="[^"]*(rain\.txt|stray)/.test(html), hidden);
  }
  assert.ok(!/stray\.bin|loose/.test(html), 'a file that is not a sound is not listed');
  assert.match(html, /<span class="fx-thumb is-video"[^>]*>\s*<img src="[^"]*rain\.jpg/, 'the cover is the picture');
  assert.match(html, /<span class="fx-thumb is-video"[^>]*>\s*<img src="[^"]*chime-cover\.png/, 'a -cover picture too');
  assert.strictEqual((html.match(/fx-transcript/g) || []).length, 2, 'both have text');
  assert.match(html, /hx-get="\/fragments\/audio\/transcript\/sounds\/rain\.mp3"/);
  assert.match(html, /See how it was made, and the text/);
});

test('a sound shows how it was made, and the text, in the player and on its own', async () => {
  const play = await (await get('/fragments/audio/play/sounds/rain.mp3')).text();
  assert.match(play, /<summary>How it was made<\/summary>/);
  assert.match(play, /Made as<\/span> sound/);
  assert.match(play, /With<\/span> elevenlabs/);
  assert.match(play, /Loop<\/span> yes/);
  assert.match(play, /<h4 class="uk-margin-small-bottom">Description /);
  assert.match(play, /Rain on a tin roof/);
  assert.match(play, /data-sound-speed="5"/);
  const own = await get('/fragments/audio/transcript/sounds/rain.mp3');
  assert.strictEqual(own.status, 200);
  assert.match(await own.text(), /sound-record[\s\S]*Rain on a tin roof/);
  const plain = await (await get('/fragments/audio/transcript/sounds/chime.wav')).text();
  assert.match(plain, /A single chime\./);
  assert.ok(!/sound-record/.test(plain), 'no record, so no facts line');
  assert.strictEqual((await get('/fragments/audio/transcript/hello.mp3')).status, 404, 'nothing belongs to it');
  assert.strictEqual((await get('/fragments/audio/transcript/sounds/rain.txt')).status, 404, 'only a sound opens one');
});

test('videos and audio list the newest files first, then the folders; other workspaces keep folders first', async () => {
  const order = (html, ...names) => names.map((n) => html.indexOf(n));
  const videos = await (await get('/fragments/videos/items')).text();
  const [file, folder] = order(videos, 'title="Play demo-draft-1.mp4', 'older-takes');
  assert.ok(file > 0 && folder > 0 && file < folder, 'a recording comes before the folder');
  assert.match(videos, /<option value="files-first" selected>Files first<\/option>/);
  const folders = await (await get('/fragments/videos/items?kind=all')).text();
  const [f2, d2] = order(folders, 'title="Play demo-draft-1.mp4', 'older-takes');
  assert.ok(d2 > 0 && f2 > 0 && d2 < f2, 'choosing Folders first puts the folder first');
  assert.match(folders, /<option value="all" selected>Folders first<\/option>/);
  assert.match(folders, /kind=all/, 'the choice travels with the pager and the search');
  const sounds = await (await get('/fragments/audio/items')).text();
  assert.match(sounds, /<option value="files-first" selected>/);
  assert.ok(sounds.indexOf('title="Play hello.mp3') < sounds.indexOf('items?path=sounds'));
  const docs = await (await get('/fragments/docs/items')).text();
  assert.match(docs, /<option value="all" selected>Folders first<\/option>/);
  assert.ok(docs.indexOf('notes-folder') < docs.indexOf('loose-note'), 'docs still lists folders first');
});
