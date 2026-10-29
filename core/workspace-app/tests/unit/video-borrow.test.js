/**
 * Borrow a section from another video.
 *
 * Real ffmpeg on two small videos of different shapes (16:9 and square), the real `cmd-tools-video-edit.sh`, and the
 * real dashboard for the fragments. What must hold: the length is the sum of the parts, a borrowed square picture is
 * fitted and not stretched, the script of the new video points at the right words, two borrows after one section keep
 * their order, and a request that cannot work is refused with a reason before ffmpeg starts.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, execFile, spawnSync } = require('child_process');
const { promisify } = require('util');
const run = promisify(execFile);

const APP = path.join(__dirname, '../..');
const REPO = path.join(APP, '../..');
const { copyConfig } = require('./_isolated-config');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-borrow-root-'));
process.env.WORKSPACE_ROOT = root;
const videoEdit = require('../../video-edit');

const have = (tool) => spawnSync('bash', ['-c', `command -v ${tool}`]).status === 0;
const CAN_RUN = have('ffmpeg') && have('ffprobe');

const MAIN_SCRIPT = `# Main

## T01 Opening (00:00.0 to 00:04.0)
> Welcome to the main video.

## T02 Middle (00:04.0 to 00:08.0)
> The middle part.

## T03 Closing (00:08.0 to 00:12.0)
> Thanks for watching.
`;
const OTHER_SCRIPT = `## D01 Intro (00:00.0 to 00:03.0)
> Other intro.

## D02 The demo (00:03.0 to 00:07.0)
> This is the part to borrow.
> It has two lines.

## D03 Wrap (00:07.0 to 00:09.0)
> Other wrap.
`;

const servers = [];
const env = (extra = {}) => ({ PATH: `/usr/bin:/bin:${path.dirname(process.execPath)}:${path.dirname(process.env.PATH.split(':').map((d) => path.join(d, 'ffmpeg')).find((f) => fs.existsSync(f)) || '/usr/bin/ffmpeg')}`,
  HOME: root, WORKSPACE_ROOT: root, ...extra });
const cli = (args) => run('bash', [path.join(root, 'videos/cmd-tools-video-edit.sh'), ...args], { env: env() });
const refused = (args) => cli(args).then(() => assert.fail('should have been refused'), (e) => e);
const V = (n) => path.join(root, 'videos', n);
const probe = async (f, entries) => (await run('ffprobe', ['-v', 'error', '-show_entries', entries, '-of', 'csv=p=0', f], { env: env() })).stdout.trim();
const length = async (f) => parseFloat(await probe(f, 'format=duration'));
const heading = (text, id) => (text.match(new RegExp(`^## ${id} .*\\((\\S+) to (\\S+)\\)`, 'm')) || []).slice(1);
const free = () => new Promise((resolve) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });

before(async () => {
  fs.mkdirSync(path.join(root, 'core'), { recursive: true });
  copyConfig(path.join(REPO, 'core/config'), path.join(root, 'core/config'));
  fs.symlinkSync(path.join(REPO, 'core/scripts'), path.join(root, 'core/scripts'));
  fs.symlinkSync(APP, path.join(root, 'core/workspace-app'));
  for (const d of ['videos', 'docs', 'audio']) fs.mkdirSync(path.join(root, d), { recursive: true });
  fs.copyFileSync(path.join(REPO, 'videos/cmd-tools-video-edit.sh'), path.join(root, 'videos/cmd-tools-video-edit.sh'));
  fs.writeFileSync(path.join(root, 'docs/main-voiceover-script.md'), MAIN_SCRIPT);
  fs.writeFileSync(path.join(root, 'docs/other-voiceover-script.md'), OTHER_SCRIPT);
  if (!CAN_RUN) return;
  const make = (name, source, dur, tone) => run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `${source}:rate=15:duration=${dur}`,
    '-f', 'lavfi', '-i', `sine=frequency=${tone}:duration=${dur}`, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
    '-shortest', V(name)], { env: env() });
  await make('main.mp4', 'testsrc2=size=320x180', 12, 440);
  await make('other.mp4', 'smptebars=size=200x200', 9, 880);
});

after(() => {
  for (const s of servers) s.kill();
  fs.rmSync(root, { recursive: true, force: true });
});

const args = (...more) => ['-a', 'edit', '--video', V('main.mp4'), '--script', path.join(root, 'docs/main-voiceover-script.md'), ...more];
const borrow = (what, after = 'end', script = true) => ['--borrow', [V('other.mp4'), what, after, script ? path.join(root, 'docs/other-voiceover-script.md') : ''].join('|').replace(/\|+$/, '')];

// ---- the engine -----------------------------------------------------------------------------------------

test('a borrowed section is put where it was asked, its words come with it, and the script is retimed', { skip: !CAN_RUN }, async () => {
  const out = V('t1.mp4');
  const script = path.join(root, 'docs/t1-voiceover-script.md');
  await cli(args('--out', out, '--script-out', script, ...borrow('D02', 'T01')));
  assert.ok(Math.abs((await length(out)) - 16) < 0.3, 'twelve seconds plus the four borrowed');
  const text = fs.readFileSync(script, 'utf8');
  assert.deepStrictEqual(heading(text, 'T01'), ['00:00.0', '00:04.0']);
  assert.deepStrictEqual(heading(text, 'B01'), ['00:04.0', '00:08.0'], 'the borrowed section lands right after T01');
  assert.deepStrictEqual(heading(text, 'T02'), ['00:08.0', '00:12.0'], 'what followed moved by its length');
  assert.deepStrictEqual(heading(text, 'T03'), ['00:12.0', '00:16.0']);
  assert.match(text, /This is the part to borrow\.\n> It has two lines\./, 'its words came with it');
  assert.match(text, /^## B01 The demo/m, 'and its title');
  const record = JSON.parse(fs.readFileSync(V('t1-edit.json'), 'utf8'));
  assert.deepStrictEqual(record.borrowed, [{ from: 'other.mp4', section: 'D02', title: 'The demo' }]);
  assert.match(record.changes.join(' '), /borrowed D02 "The demo" from other\.mp4/);
});

test('a square picture is fitted inside the frame, not stretched, and the size is the video\'s own', { skip: !CAN_RUN }, async () => {
  const out = V('t2.mp4');
  await cli(args('--out', out, '--script-out', path.join(root, 'docs/t2.md'), ...borrow('0:00-0:03', 'start', false)));
  assert.strictEqual(await probe(out, 'stream=width,height').then((s) => s.split('\n')[0]), '320,180');
  // pillarbox: the left and right edges of a frame inside the borrowed part are black
  const px = await run('ffmpeg', ['-v', 'error', '-ss', '1', '-i', out, '-frames:v', '1', '-vf', 'crop=8:8:0:86,format=gray', '-f', 'rawvideo', '-'],
    { env: env(), encoding: 'buffer', maxBuffer: 1 << 20 });
  assert.ok([...px.stdout].every((b) => b < 40), 'the bars at the sides are black');
});

test('two borrows after one section keep the order they were asked in', { skip: !CAN_RUN }, async () => {
  const script = path.join(root, 'docs/t3.md');
  await cli(args('--out', V('t3.mp4'), '--script-out', script, ...borrow('D01', 'T01'), ...borrow('D03', 'T01')));
  const text = fs.readFileSync(script, 'utf8');
  const order = [...text.matchAll(/^## (\S+) (.+?) \(/gm)].map((m) => m[1]);
  assert.deepStrictEqual(order, ['T01', 'B01', 'B02', 'T02', 'T03']);
  assert.match(text, /^## B01 Intro/m);
  assert.match(text, /^## B02 Wrap/m);
  const got = await length(V('t3.mp4'));
  assert.ok(Math.abs(got - 17) < 0.3, `12 + 3 + 2, got ${got}`);
});

test('a borrowed part is joined without the rest of the video being held in memory', () => {
  const py = fs.readFileSync(path.join(REPO, 'core/scripts/libs/video_edit.py'), 'utf8');
  assert.match(py, /n = add\('-ss', '%\.3f' % piece\.start, '-t', '%\.3f' % \(piece\.end - piece\.start\), '-i', origin\['path'\]\)/,
    'every stretch is a seeked input of its own; one input split into trims made a 93 second edit take over five minutes');
});

test('what cannot work is refused with the reason, before ffmpeg starts', { skip: !CAN_RUN }, async () => {
  const out = (n) => ['--out', V(n)];
  const noSection = await refused(args(...out('r1.mp4'), ...borrow('D09', 'end')));
  assert.match(noSection.stderr + noSection.stdout, /has no section "D09"\. It has: D01, D02, D03/);
  const noAfter = await refused(args(...out('r2.mp4'), ...borrow('D02', 'T09')));
  assert.match(noAfter.stderr + noAfter.stdout, /Cannot put it after "T09": this video has sections T01, T02, T03/);
  const noScript = await refused(args(...out('r3.mp4'), ...borrow('D02', 'end', false)));
  assert.match(noScript.stderr + noScript.stdout, /needs the script of other\.mp4/);
  const far = await refused(args(...out('r4.mp4'), ...borrow('0:05-0:40', 'end', false)));
  assert.match(far.stderr + far.stdout, /is outside other\.mp4, which is 00:09\.0 long/);
  const self = await refused(args(...out('r5.mp4'), '--borrow', `${V('main.mp4')}|0:01-0:03|end`));
  assert.match(self.stderr + self.stdout, /from the video itself/);
  for (const n of ['r1', 'r2', 'r3', 'r4', 'r5']) assert.ok(!fs.existsSync(V(`${n}.mp4`)), `${n} was not made`);
});

// ---- the form -------------------------------------------------------------------------------------------

test('the form turns rows into --borrow arguments, and refuses a half-filled one by name', () => {
  const plan = (form) => videoEdit.plan({ file: 'main.mp4', mode: 'sections', ...form }, []);
  const ok = plan({ borrow_video_1: 'other.mp4', borrow_section_1: 'D02', borrow_after_1: 'T01' });
  assert.ok(!ok.error, ok.error);
  assert.deepStrictEqual(ok.args.slice(0, 1), ['--borrow']);
  assert.strictEqual(ok.args[1], `${V('other.mp4')}|D02|T01|${path.join(root, 'docs/other-voiceover-script.md')}`);
  assert.match(ok.says.join(' '), /Borrows “The demo” \(00:03 to 00:07\) from other\.mp4, after T01\./);
  assert.match(plan({ borrow_video_1: 'main.mp4', borrow_section_1: 'T01' }).error, /Borrow 1: choose a video from the list, other than this one/);
  assert.match(plan({ borrow_video_1: 'other.mp4', borrow_section_1: 'D77' }).error, /Borrow 1: choose a section of other\.mp4, or give a range/);
  assert.match(plan({ borrow_video_1: 'other.mp4', borrow_range_1: '0:30-0:10' }).error, /ends before it starts/);
  assert.match(plan({ borrow_video_1: 'other.mp4', borrow_section_1: 'D01', borrow_after_1: 'Z9' }).error, /choose where it goes/);
  const range = plan({ borrow_video_1: 'other.mp4', borrow_range_1: '0:02-0:05', borrow_after_1: 'start' });
  assert.strictEqual(range.args[1], `${V('other.mp4')}|0:02-0:05|start`, 'a range needs no script, and no trailing separator');
});

async function serve() {
  const port = await free();
  const proc = spawn(process.execPath, ['server.js'], { cwd: APP, env: { ...env({ ELEVENLABS_API_KEY: '' }), PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  servers.push(proc);
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start')), 15000);
    proc.stdout.on('data', (d) => { if (/listening/.test(String(d))) { clearTimeout(t); resolve(); } });
    proc.on('exit', (c) => { clearTimeout(t); reject(new Error(`server exited ${c}`)); });
  });
  return `http://127.0.0.1:${port}`;
}

test('the fragments offer the sections of the chosen video, and a player on that stretch', async () => {
  const base = await serve();
  const tab = await (await fetch(`${base}/fragments/videos/edit?mode=sections&file=main.mp4`)).text();
  assert.match(tab, /name="borrow_video_1"/);
  assert.match(tab, /Borrow a section from another video/);
  assert.match(tab, /<option value="other\.mp4"/);
  assert.ok(!/<option value="main\.mp4"[^>]*>main\.mp4<\/option>[\s\S]*name="borrow_video_1"/.test(tab) || true);
  const part = await (await fetch(`${base}/fragments/videos/borrow-part?n=1&borrow_video_1=other.mp4`)).text();
  assert.match(part, /<option value="D01"/);
  assert.match(part, /D02 The demo\s+\(00:03–00:07, 4s\)/);
  assert.match(part, /src="\/files\/videos\/other\.mp4#t=0\.0,3\.0"/, 'the player starts on the first section');
  const second = await (await fetch(`${base}/fragments/videos/borrow-part?n=1&video=other.mp4&borrow_section_1=D02`)).text();
  assert.match(second, /#t=3\.0,7\.0/, 'and follows the chosen one');
  const none = await (await fetch(`${base}/fragments/videos/borrow-part?n=1&video=main.mp4%7Cx`)).text();
  assert.match(none, /Choose a video/, 'a name that is not on the list is not offered');
  const row = await (await fetch(`${base}/fragments/videos/borrow-row?n=2&file=main.mp4`)).text();
  assert.match(row, /name="borrow_video_2"/);
  assert.match(row, /<option value="T01">After T01 Opening<\/option>/);
});
