/**
 * Edit a video into a new version of itself.
 *
 * The real server and the real `videos/cmd-tools-video-edit.sh` run here, on a six second video made for the
 * test, so nothing depends on what is installed on the machine beyond ffmpeg (and Chrome, for the logo scenes).
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

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-vedit-root-'));
process.env.WORKSPACE_ROOT = root;
const videoEdit = require('../../video-edit');
const voice = require('../../audio-voice');

const have = (tool) => spawnSync('bash', ['-c', `command -v ${tool}`]).status === 0;
const CAN_RUN = have('ffmpeg') && have('ffprobe');
const CAN_CARD = CAN_RUN && (have('google-chrome') || have('chromium') || have('chromium-browser'));

const SCRIPT = `# Demo

## How to use this script

Not a timed section.

## S01 Opening (00:00.0 to 00:03.0)

> The opening.

## S02 Close (00:03.0 to 00:06.0)

> The close.
`;
const ENGINES = [
  { id: 'piper', label: 'Piper', available: true, free: true, hostOnly: true, voices: [{ id: 'en_US-lessac-high', installed: true, label: 'American' }] },
  { id: 'elevenlabs', label: 'ElevenLabs', available: true, can_list_voices: true, default_model: 'eleven_v4', models: [{ id: 'eleven_v4', label: 'v4' }, { id: 'eleven_flash_v2_5', label: 'Flash' }],
    voices: [{ id: 'voiceAAAAAAAAAAAAAAAA', label: 'Alice' }] },
];

let home;
const servers = [];

const free = () => new Promise((resolve) => {
  const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});

before(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-vedit-home-'));
  fs.mkdirSync(path.join(home, 'bin'), { recursive: true });
  for (const tool of ['ffmpeg', 'ffprobe']) {
    const found = (process.env.PATH || '').split(path.delimiter).map((d) => path.join(d, tool)).find((f) => fs.existsSync(f));
    if (found) fs.symlinkSync(found, path.join(home, 'bin', tool));
  }
  fs.mkdirSync(path.join(home, '.claude/skills/voice-narration/scripts'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude/skills/voice-narration/scripts/claude-say'),
    '#!/usr/bin/env bash\necho "claude-say voices:"\necho "   1) en_US-lessac-high            American English"\n');
  fs.mkdirSync(path.join(root, 'core'), { recursive: true });
  copyConfig(path.join(REPO, 'core/config'), path.join(root, 'core/config'));
  fs.symlinkSync(path.join(REPO, 'core/scripts'), path.join(root, 'core/scripts'));
  fs.symlinkSync(APP, path.join(root, 'core/workspace-app'));
  for (const d of ['audio/sounds', 'videos', 'docs']) fs.mkdirSync(path.join(root, d), { recursive: true });
  fs.copyFileSync(path.join(REPO, 'videos/cmd-tools-video-edit.sh'), path.join(root, 'videos/cmd-tools-video-edit.sh'));
  fs.copyFileSync(path.join(REPO, 'audio/cmd-tools-voice.sh'), path.join(root, 'audio/cmd-tools-voice.sh'));
  fs.copyFileSync(path.join(REPO, 'videos/cmd-tools-elevenlabs.sh'), path.join(root, 'videos/cmd-tools-elevenlabs.sh'));
  fs.writeFileSync(path.join(root, 'docs/demo-voiceover-script.md'), SCRIPT);
  if (CAN_RUN) {
    const env = { PATH: `${path.join(home, 'bin')}:/usr/bin:/bin`, HOME: home };
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=15', '-f', 'lavfi', '-i', 'sine=frequency=440',
      '-t', '6', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', path.join(root, 'videos/demo.mp4')], { env });
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=10', '-c:a', 'libmp3lame', path.join(root, 'audio/sounds/bed.mp3')], { env });
    fs.writeFileSync(path.join(root, 'videos/demo-poster.jpg'), Buffer.alloc(50, 2));
  } else {
    fs.writeFileSync(path.join(root, 'videos/demo.mp4'), Buffer.alloc(100, 1));
    fs.writeFileSync(path.join(root, 'audio/sounds/bed.mp3'), Buffer.alloc(100, 1));
  }
});

after(() => {
  for (const s of servers) s.kill();
  for (const d of [root, home]) fs.rmSync(d, { recursive: true, force: true });
});

const env = (extra = {}) => ({ PATH: `/usr/bin:/bin:${path.dirname(process.execPath)}:${path.join(home, 'bin')}`, HOME: home, WORKSPACE_ROOT: root, ...extra });
const cli = (args) => run('bash', [path.join(root, 'videos/cmd-tools-video-edit.sh'), ...args], { env: env() });
const refused = (args) => cli(args).then(() => assert.fail('should have been refused'), (e) => e);
const seconds = async (f) => parseFloat((await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { env: env() })).stdout);
const videos = (n) => path.join(root, 'videos', n);
const heading = (text, id) => (text.match(new RegExp(`^## ${id} .*\\((\\S+) to (\\S+)\\)`, 'm')) || []).slice(1);

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
const post = (base, p, form) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form) });

// ---- what a form may ask for ----------------------------------------------------------------------------

test('a new version is named after the video, and never takes a name that is there', () => {
  assert.strictEqual(videoEdit.nextName('demo'), 'demo-v2.mp4');
  assert.strictEqual(videoEdit.nextName('demo-v2'), 'demo-v2.mp4', 'a version is numbered from the video it came from');
  fs.writeFileSync(videos('demo-v2.mp4'), 'x');
  assert.strictEqual(videoEdit.nextName('demo'), 'demo-v3.mp4');
  assert.strictEqual(videoEdit.nextName('demo-v2'), 'demo-v3.mp4', 'a version of a version is the next number, not -v2-v2');
  fs.rmSync(videos('demo-v2.mp4'));
});

test('a request is checked before anything runs, and free text never reaches the arguments', () => {
  const plan = (form) => videoEdit.plan({ file: 'demo.mp4', ...form }, ENGINES);
  assert.match(plan({ file: 'nope.mp4', mode: 'clone' }).error, /Choose a video/);
  assert.deepStrictEqual(plan({ mode: 'clone' }).args, ['--clone']);
  assert.strictEqual(plan({ mode: 'clone' }).out, 'demo-v2.mp4');
  assert.strictEqual(plan({ mode: 'clone', name: 'Client cut #1' }).out, 'client-cut-1.mp4');
  // logo scenes and music
  assert.match(plan({ mode: 'scenes' }).error, /Choose a logo scene or some music/);
  assert.match(plan({ mode: 'scenes', intro_card: '30' }).error, /1 to 10 seconds/);
  assert.match(plan({ mode: 'scenes', intro_music: '../../etc/passwd' }).error, /Choose music from the audio workspace/);
  const scenes = plan({ mode: 'scenes', intro_card: '3', intro_title: 'Hello $(rm -rf /)', outro_card: '2', outro_music: 'sounds/bed.mp3', level: '0.8' });
  assert.deepStrictEqual(scenes.args, ['--intro-card', '3', '--outro-card', '2', '--outro-music', path.join(root, 'audio/sounds/bed.mp3'), '--music-volume', '0.8']);
  assert.strictEqual(scenes.strings.intro_title, 'Hello $(rm -rf /)', 'the words travel in a file');
  assert.ok(!scenes.args.join(' ').includes('rm -rf'));
  // pace
  assert.match(plan({ mode: 'pace' }).error, /Choose a speed, a length or a trim/);
  assert.match(plan({ mode: 'pace', speed: '2', length: '1:00' }).error, /not both/);
  assert.match(plan({ mode: 'pace', speed: '5' }).error, /0\.25 to 4/);
  assert.match(plan({ mode: 'pace', length: 'soon' }).error, /seconds or minutes:seconds/);
  assert.match(plan({ mode: 'pace', trim_start: '0:40', trim_end: '0:05' }).error, /ends before it starts/);
  assert.deepStrictEqual(plan({ mode: 'pace', speed: '1.5', trim_end: '0:04' }).args, ['--speed', '1.5', '--trim', '0-0:04']);
  assert.deepStrictEqual(plan({ mode: 'pace', length: '1:30' }).args, ['--length', '1:30']);
  // sections
  assert.match(plan({ mode: 'sections' }).error, /Choose sections to remove, borrow or add/);
  assert.match(plan({ mode: 'sections', rm_S09: 'yes' }).error, /not in the script/);
  assert.match(plan({ mode: 'sections', rm_S01: 'yes', rm_S02: 'yes' }).error, /every section/);
  assert.match(plan({ mode: 'sections', add_title: 'Only a title' }).error, /title and the words/);
  assert.match(plan({ mode: 'sections', add_title: 'T', add_text: 'W', add_after: 'S77', add_voice: 'piper:en_US-lessac-high' }).error, /where the new section goes/);
  assert.match(plan({ mode: 'sections', add_title: 'T', add_text: 'W', add_voice: 'piper:nobody' }).error, /Piper voices/);
  assert.match(plan({ mode: 'sections', add_title: 'T', add_text: 'W', add_voice: 'elevenlabs:other' }).error, /not on this account/);
  const remove = plan({ mode: 'sections', rm_S02: 'yes' });
  assert.deepStrictEqual(remove.args, ['--remove', 'S02']);
  assert.strictEqual(remove.spends, false);
  const free = plan({ mode: 'sections', add_title: 'Extra', add_text: 'Words $HOME `x`', add_after: 'S01', add_voice: 'piper:en_US-lessac-high' });
  assert.deepStrictEqual(free.args, ['--add-after', 'S01', '--engine', 'piper', '--voice', 'en_US-lessac-high']);
  assert.strictEqual(free.spends, false, 'Piper is free');
  const paid = plan({ mode: 'sections', add_title: 'Extra', add_text: 'Twelve chars', add_voice: 'elevenlabs:voiceAAAAAAAAAAAAAAAA' });
  assert.strictEqual(paid.spends, true);
  assert.strictEqual(paid.characters, 12);
  assert.deepStrictEqual(paid.args.slice(-2), ['--model', 'eleven_v4']);
  const flash = plan({ mode: 'sections', add_title: 'T', add_text: 'W', add_voice: 'elevenlabs:voiceAAAAAAAAAAAAAAAA', add_model: 'eleven_flash_v2_5' });
  assert.deepStrictEqual(flash.args.slice(-2), ['--model', 'eleven_flash_v2_5'], 'the model chosen for an added section');
  const typed = plan({ mode: 'sections', add_title: 'T', add_text: 'W', add_voice: 'elevenlabs:voiceAAAAAAAAAAAAAAAA', add_model_other: 'eleven_brand_new' });
  assert.deepStrictEqual(typed.args.slice(-2), ['--model', 'eleven_brand_new']);
  assert.match(plan({ mode: 'sections', add_title: 'T', add_text: 'W', add_voice: 'elevenlabs:voiceAAAAAAAAAAAAAAAA', add_model: 'nope' }).error, /Choose one of the models/);
  assert.match(plan({ mode: 'sections', add_title: 'T', add_text: 'W', add_voice: 'elevenlabs:voiceAAAAAAAAAAAAAAAA', add_model_other: 'a b' }).error, /not a model id/);
});

test('the line the host runs holds no shell expansion, and only a paid section carries --confirm', () => {
  const p = videoEdit.plan({ file: 'demo.mp4', mode: 'sections', add_title: 'Extra $(x)', add_text: 'Words `y` $HOME', add_voice: 'elevenlabs:voiceAAAAAAAAAAAAAAAA' }, ENGINES);
  const strings = path.join(root, '.screens/voice-text/e-test/strings.json');
  const plain = videoEdit.commandLine(p, strings, false);
  assert.ok(!/[`$]/.test(plain), 'no backtick and no dollar sign on the line');
  assert.ok(!plain.includes('Words') && !plain.includes('Extra'), 'the text is in the file, not on the line');
  assert.ok(!plain.includes('--confirm'));
  assert.match(plain, /"--strings-file" ".*strings\.json"/);
  assert.match(plain, /"--script" ".*demo-voiceover-script\.md" "--script-out" ".*demo-v2-voiceover-script\.md"/);
  assert.match(plain, /rm -rf ".*e-test"/, 'the text is removed afterwards, success or not');
  assert.ok(videoEdit.commandLine(p, strings, true).includes('"--confirm"'));
  assert.ok(!videoEdit.commandLine(videoEdit.plan({ file: 'demo.mp4', mode: 'clone' }, ENGINES), null, true).includes('--confirm'));
});

// ---- the modal and the page -------------------------------------------------------------------------------

test('the modal has a tab for each kind of change, and fields that belong to the tab', () => {
  const form = (mode) => videoEdit.formHtml('demo.mp4', mode, { engines: ENGINES });
  for (const [mode, label] of [['voice', 'Voice'], ['scenes', 'Logo and music'], ['pace', 'Speed and length'], ['sections', 'Sections'], ['clone', 'Clone']]) {
    const html = form(mode);
    assert.match(html, new RegExp(`hx-get="/fragments/videos/edit\\?file=demo\\.mp4&amp;mode=${mode}"`), `${mode} tab`);
    assert.ok(html.includes(label), label);
    assert.ok(html.includes('<li class="uk-active"><a href="#" aria-current="true" hx-get="/fragments/videos/edit?file=demo.mp4&amp;mode=' + mode), `${mode} is the active tab`);
    assert.ok(html.includes('<div id="voice-result"'), `${mode} keeps its result in the modal`);
  }
  const voiceTab = form('voice');
  assert.match(voiceTab, /<option value="demo\.mp4" selected>/, 'the video is chosen');
  assert.match(voiceTab, /<option value="demo-voiceover-script\.md" selected>/, 'and so is its script');
  assert.match(form('scenes'), /name="intro_card"[\s\S]*name="outro_card"[\s\S]*<option value="sounds\/bed\.mp3">/);
  assert.match(form('pace'), /name="speed"[\s\S]*name="length"[\s\S]*name="trim_start"[\s\S]*name="trim_end"/);
  const sections = form('sections');
  assert.match(sections, /name="rm_S01"[\s\S]*name="rm_S02"/);
  assert.match(sections, /<option value="after-S01"|<option value="S01">After S01 Opening/);
  assert.match(sections, /<optgroup label="ElevenLabs — uses credits">[\s\S]*<optgroup label="Piper — free, on this machine">/);
  assert.match(form('clone'), /Makes a copy of the video, its poster and its script/);
  assert.match(form('nonsense'), /Voice over a video|Edit a video/, 'an unknown tab is the voice tab');
  assert.match(videoEdit.formHtml('', 'pace', { engines: [] }), /<option value="demo\.mp4" selected>/, 'no video given: the newest');
});

test('each video row offers Edit, and the rail offers Edit a video', async () => {
  const base = await serve();
  const page = await (await fetch(`${base}/videos`)).text();
  assert.match(page, /hx-get="\/fragments\/videos\/edit\?mode=voice" hx-target="#editor-modal-body" hx-swap="innerHTML"/, 'the rail');
  assert.ok(page.includes('Edit a video'));
  assert.ok(page.includes('tabler-sprite.svg#cut"'), 'Edit a video has its own icon, apart from Notes');
  const rows = await (await fetch(`${base}/fragments/videos/items`)).text();
  assert.match(rows, /class="uk-button uk-button-default uk-button-small fx-open fx-edit"/, 'the row button');
  assert.match(rows, /hx-get="\/fragments\/videos\/edit\?file=demo\.mp4&amp;mode=voice"/);
  for (const mode of ['voice', 'scenes', 'pace', 'sections', 'clone']) assert.ok(rows.includes(`mode=${mode}"`), `${mode} is in the row's menu`);
  const audio = await (await fetch(`${base}/fragments/audio/items`)).text();
  assert.ok(!audio.includes('fx-edit'), 'only videos are edited');
  const modal = await fetch(`${base}/fragments/videos/edit?file=demo.mp4&mode=pace`);
  assert.strictEqual(modal.status, 200);
  assert.match(await modal.text(), /name="trim_start"/);
});

// ---- the action --------------------------------------------------------------------------------------------

const screens = () => path.join(root, '.screens');
function hostRuns(asked) {
  fs.mkdirSync(path.join(screens(), 'queue'), { recursive: true });
  fs.mkdirSync(path.join(screens(), 'results'), { recursive: true });
  return setInterval(() => {
    fs.writeFileSync(path.join(screens(), 'host-sessions.json'), JSON.stringify({ at: Date.now(), host: 'test', sessions: [] }));
    for (const f of fs.readdirSync(path.join(screens(), 'queue'))) {
      if (!f.endsWith('.json')) continue;
      const req = JSON.parse(fs.readFileSync(path.join(screens(), 'queue', f), 'utf8'));
      fs.unlinkSync(path.join(screens(), 'queue', f));
      asked.push(req);
      fs.writeFileSync(path.join(screens(), 'results', `${req.id}.json`), JSON.stringify({ ok: true }));
    }
  }, 80);
}

test('the action refuses what the form should never send, and asks before a paid section', async () => {
  const asked = [];
  const runner = hostRuns(asked);
  try {
    const base = await serve();
    const send = (form) => post(base, '/actions/video-edit', { workspace: 'videos', file: 'demo.mp4', ...form });
    const other = await post(base, '/actions/video-edit', { workspace: 'dev', file: 'demo.mp4', mode: 'clone' });
    assert.strictEqual(other.status, 400);
    const none = await send({ mode: 'scenes' });
    assert.strictEqual(none.status, 400);
    assert.match(await none.text(), /Choose a logo scene or some music/);
    assert.strictEqual((await send({ mode: 'clone', file: '../../etc/passwd' })).status, 400);
    assert.strictEqual(asked.length, 0, 'nothing was started by any of those');
    const ask = await send({ mode: 'sections', add_title: 'Extra', add_text: 'Spoken words', add_voice: 'elevenlabs:voiceAAAAAAAAAAAAAAAA' });
    assert.strictEqual(ask.status, 400, 'with no key here the paid voice is not on offer');
    // a free section runs, and its progress says it is an edit
    const ok = await send({ mode: 'clone', name: 'press-test' });
    assert.strictEqual(ok.status, 200);
    const html = await ok.text();
    assert.match(html, /class="voice-progress" hx-get="\/fragments\/audio\/generation\?kind=video&amp;file=press-test\.mp4&amp;session=videos--press-test--edit&amp;t0=\d+&amp;engine=&amp;edit=1"/);
    assert.match(html, /Making <strong>press-test\.mp4<\/strong> <span/, 'no engine named: it is an edit');
    assert.strictEqual(asked.length, 1);
    assert.match(asked[0].cmd, /bash cmd-tools-video-edit\.sh "-a" "edit" "--video" ".*videos\/demo\.mp4" "--out" ".*videos\/press-test\.mp4" "--clone"/);
    assert.ok(!asked[0].cmd.includes('--confirm'));
  } finally { clearInterval(runner); }
});

test('when the new version is there the modal shows it and offers to edit it again', async () => {
  const base = await serve();
  const q = { kind: 'video', file: 'demo-v9.mp4', session: 'videos--demo-v9--edit', t0: String(Date.now() - 20000), engine: '', edit: '1' };
  fs.writeFileSync(path.join(screens(), 'host-sessions.json'), JSON.stringify({ at: Date.now(), host: 'test', sessions: [{ session: 'videos--demo-v9--edit' }] }));
  const running = await (await fetch(`${base}/fragments/audio/generation?${new URLSearchParams(q)}`)).text();
  assert.match(running, /Making <strong>demo-v9\.mp4<\/strong> <span/);
  assert.match(running, /edit=1/, 'the next poll still knows it is an edit');
  fs.writeFileSync(videos('demo-v9.mp4'), Buffer.alloc(100, 1));
  fs.writeFileSync(path.join(screens(), 'host-sessions.json'), JSON.stringify({ at: Date.now(), host: 'test', sessions: [] }));
  const done = await fetch(`${base}/fragments/audio/generation?${new URLSearchParams(q)}`);
  assert.strictEqual(done.headers.get('hx-trigger'), 'refresh-projects');
  const html = await done.text();
  assert.match(html, /<strong>demo-v9\.mp4<\/strong> is ready, in <code>videos\/<\/code>/);
  assert.match(html, /<video class="video-player"[^>]*src="\/files\/videos\/demo-v9\.mp4">/);
  assert.match(html, /hx-get="\/fragments\/videos\/edit\?file=demo-v9\.mp4&amp;mode=pace"[^>]*>Edit this version</);
  assert.ok(!/Make another/.test(html));
  fs.rmSync(videos('demo-v9.mp4'));
});

// ---- the command ---------------------------------------------------------------------------------------------

test('the command refuses an edit that changes nothing, a name that is taken and a section that is not there', { skip: !CAN_RUN }, async () => {
  const base = ['-a', 'edit', '--video', videos('demo.mp4'), '--script', path.join(root, 'docs/demo-voiceover-script.md')];
  assert.match((await refused([...base, '--out', videos('x1.mp4')])).stderr, /Nothing to change/);
  assert.match((await refused([...base, '--out', videos('x2.mp4'), '--remove', 'S99'])).stderr, /no section "S99". It has: S01, S02/);
  assert.match((await refused([...base, '--out', videos('x3.mp4'), '--speed', '9'])).stderr, /Speed goes from 0\.25x to 4x/);
  assert.match((await refused([...base, '--out', videos('x4.mp4'), '--length', '1'])).stderr, /would play at 6\.00x/);
  assert.match((await refused([...base, '--out', videos('demo.mp4'), '--clone'])).stderr, /already exists/);
  assert.ok(!fs.existsSync(videos('x1.mp4')) && !fs.existsSync(videos('x2.mp4')));
});

test('speed changes the length and the script follows; the original is untouched', { skip: !CAN_RUN }, async () => {
  const before = fs.readFileSync(videos('demo.mp4'));
  const script = path.join(root, 'docs/demo-voiceover-script.md');
  const { stdout } = await cli(['-a', 'edit', '--video', videos('demo.mp4'), '--out', videos('fast.mp4'), '--script', script, '--script-out', path.join(root, 'docs/fast-voiceover-script.md'), '--speed', '2']);
  assert.match(stdout, /Wrote .*fast\.mp4 \(00:03\.0\)/);
  assert.ok(Math.abs(await seconds(videos('fast.mp4')) - 3) < 0.25, 'twice as fast is half as long');
  const text = fs.readFileSync(path.join(root, 'docs/fast-voiceover-script.md'), 'utf8');
  assert.deepStrictEqual(heading(text, 'S01'), ['00:00.0', '00:01.5']);
  assert.deepStrictEqual(heading(text, 'S02'), ['00:01.5', '00:03.0']);
  assert.match(text, /## How to use this script\n\nNot a timed section\./, 'what is not a timed section stays');
  assert.ok(before.equals(fs.readFileSync(videos('demo.mp4'))), 'the source is byte for byte what it was');
  assert.ok(fs.existsSync(videos('fast-poster.jpg')), 'the poster comes along');
  const record = JSON.parse(fs.readFileSync(videos('fast-edit.json'), 'utf8'));
  assert.deepStrictEqual([record.kind, record.source, record.changes], ['video-edit', 'demo.mp4', ['at 2.00x speed']]);
});

test('a length, a trim and a section removed each leave a script that matches the picture', { skip: !CAN_RUN }, async () => {
  const script = path.join(root, 'docs/demo-voiceover-script.md');
  const edit = (name, more) => cli(['-a', 'edit', '--video', videos('demo.mp4'), '--out', videos(`${name}.mp4`), '--script', script, '--script-out', path.join(root, `docs/${name}-voiceover-script.md`), ...more]);
  await edit('long', ['--length', '0:12']);
  assert.ok(Math.abs(await seconds(videos('long.mp4')) - 12) < 0.3, 'made exactly that long');
  assert.deepStrictEqual(heading(fs.readFileSync(path.join(root, 'docs/long-voiceover-script.md'), 'utf8'), 'S02'), ['00:06.0', '00:12.0']);
  await edit('cut', ['--remove', 'S01']);
  assert.ok(Math.abs(await seconds(videos('cut.mp4')) - 3) < 0.25);
  const cut = fs.readFileSync(path.join(root, 'docs/cut-voiceover-script.md'), 'utf8');
  assert.ok(!/## S01/.test(cut) && !cut.includes('The opening.'), 'the section and its words are gone');
  assert.deepStrictEqual(heading(cut, 'S02'), ['00:00.0', '00:03.0'], 'the next one moved up to the start');
  await edit('trim', ['--trim', '0:02-0:05']);
  assert.ok(Math.abs(await seconds(videos('trim.mp4')) - 3) < 0.25);
  const trim = fs.readFileSync(path.join(root, 'docs/trim-voiceover-script.md'), 'utf8');
  assert.deepStrictEqual(heading(trim, 'S01'), ['00:00.0', '00:01.0'], 'a section cut in part is shortened');
  assert.deepStrictEqual(heading(trim, 'S02'), ['00:01.0', '00:03.0']);
});

test('a plain clone is a byte for byte copy with its poster and script', { skip: !CAN_RUN }, async () => {
  await cli(['-a', 'edit', '--video', videos('demo.mp4'), '--out', videos('copy.mp4'), '--script', path.join(root, 'docs/demo-voiceover-script.md'), '--script-out', path.join(root, 'docs/copy-voiceover-script.md'), '--clone']);
  assert.ok(fs.readFileSync(videos('demo.mp4')).equals(fs.readFileSync(videos('copy.mp4'))));
  assert.strictEqual(fs.readFileSync(path.join(root, 'docs/copy-voiceover-script.md'), 'utf8'), SCRIPT);
  assert.ok(fs.existsSync(videos('copy-poster.jpg')));
});

test('the Vardot logo scenes and music add their length, and the script moves later by the opening', { skip: !CAN_CARD }, async () => {
  const strings = path.join(root, 'strings.json');
  fs.writeFileSync(strings, JSON.stringify({ intro_title: 'Hello $(x) `y`', intro_subtitle: 'A "quoted" line', outro_title: 'Thank you' }));
  const script = path.join(root, 'docs/demo-voiceover-script.md');
  await cli(['-a', 'edit', '--video', videos('demo.mp4'), '--out', videos('scenes.mp4'), '--script', script, '--script-out', path.join(root, 'docs/scenes-voiceover-script.md'),
    '--intro-card', '2', '--outro-card', '2', '--intro-music', path.join(root, 'audio/sounds/bed.mp3'), '--outro-music', path.join(root, 'audio/sounds/bed.mp3'), '--strings-file', strings]);
  assert.ok(Math.abs(await seconds(videos('scenes.mp4')) - 10) < 0.3, 'six seconds and two scenes of two');
  const text = fs.readFileSync(path.join(root, 'docs/scenes-voiceover-script.md'), 'utf8');
  assert.deepStrictEqual(heading(text, 'S01'), ['00:02.0', '00:05.0']);
  assert.deepStrictEqual(heading(text, 'S02'), ['00:05.0', '00:08.0']);
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height', '-of', 'csv=p=0', videos('scenes.mp4')], { env: env() });
  assert.match(stdout, /video,320,180/, 'the scenes are drawn at the size of the video');
  assert.match(stdout, /audio/);
  const record = JSON.parse(fs.readFileSync(videos('scenes-edit.json'), 'utf8'));
  assert.deepStrictEqual(record.changes, ['opens with the Vardot logo', 'closes with the Vardot logo', 'intro music', 'outro music']);
});

test('a section added after another lands where it was asked, and an ElevenLabs one stops at its plan', { skip: !CAN_RUN }, async () => {
  const py = async (code) => JSON.parse((await run('python3', ['-B', '-I', '-c', `import sys, json; sys.path.insert(0, ${JSON.stringify(path.join(REPO, 'core/scripts/libs'))})\nimport video_edit as v\n${code}`])).stdout);
  const out = await py(`
pieces = v.source_pieces(6.0, [], 1.0)
a, b = v.Piece('source', 0.0, 3.0), v.Piece('source', 3.0, 6.0)
card = v.Piece('card', seconds=2.0, title='Extra')
pieces = [a, card, b]
v.lay_out(pieces)
text = v.retime_script(${JSON.stringify(SCRIPT)}, pieces, [{'after': 'S01', 'id': 'N01', 'title': 'Extra', 'text': 'Added words.', 'card': card}])
print(json.dumps(text))`);
  assert.deepStrictEqual(heading(out, 'S01'), ['00:00.0', '00:03.0']);
  assert.deepStrictEqual(heading(out, 'N01'), ['00:03.0', '00:05.0']);
  assert.deepStrictEqual(heading(out, 'S02'), ['00:05.0', '00:08.0']);
  assert.ok(out.indexOf('## N01') > out.indexOf('## S01') && out.indexOf('## N01') < out.indexOf('## S02'));
  assert.match(out, /## N01 Extra[^\n]*\n> Added words\./);
  const plan = await refused(['-a', 'edit', '--video', videos('demo.mp4'), '--out', videos('el.mp4'), '--add-title', 'X', '--add-text', 'Hello there', '--engine', 'elevenlabs', '--voice', 'abc']);
  assert.strictEqual(plan.code, 4, 'plan only');
  assert.match(plan.stdout, /would send 11 characters to ElevenLabs/);
  assert.ok(!fs.existsSync(videos('el.mp4')), 'and nothing was made');
});

test('the tests work on a copy of the config, whatever the machine\'s own settings hold', () => {
  const used = fs.readFileSync(path.join(root, 'core/config/settings.yml'), 'utf8');
  assert.ok(!/api_key: sk_/.test(used.slice(used.indexOf('elevenlabs:'))));
  assert.ok(voice.ID_RE.test('voiceAAAAAAAAAAAAAAAA'));
});

// ---- what the videos list holds ---------------------------------------------------------------------------

test('the videos list holds only videos: a script beside one is read from its card, not listed', async () => {
  const w = (name, body = 'x') => fs.writeFileSync(videos(name), body);
  w('walk.mp4', 'v');
  w('walk-voiceover-script.md', '# Walk\n\n## W01 Start (00:00.0 to 00:02.0)\n\n> Words in a script saved beside its video.\n');
  w('stray-notes.md', '# notes');
  w('stray.png', 'p');
  const base = await serve();
  const rows = await (await fetch(`${base}/fragments/videos/items`)).text();
  const names = [...rows.matchAll(/class="fx-name" title="([^"]*)"/g)].map((m) => m[1]);
  assert.ok(names.includes('demo.mp4') && names.includes('walk.mp4'), 'the videos are listed');
  assert.deepStrictEqual(names.filter((n) => !/\.(mp4|webm|mov)$/.test(n)), [], 'and nothing else is');
  assert.ok(!rows.includes('walk-voiceover-script') || rows.includes('Read the voiceover script: walk-voiceover-script.md'), 'the script is only named by its button');
  assert.ok(!/item-row-body|stray-notes/.test(rows), 'no markdown card for a script or a note');
  const walk = rows.slice(rows.indexOf('title="walk.mp4"'));
  assert.match(walk.slice(0, walk.indexOf('fx-actions') + 900), /fx-transcript/, 'the script is one click from its card');
  assert.match(rows, /<img src="\/files\/videos\/demo-poster\.jpg"/, 'a poster is still the thumbnail');
  assert.ok(!rows.includes('stray.png'), 'a picture that is nobody\'s poster is not a video');
  const words = await fetch(`${base}/fragments/videos/transcript/walk.mp4`);
  assert.strictEqual(words.status, 200);
  const html = await words.text();
  assert.match(html, /Words in a script saved beside its video\./);
  assert.match(html, /href="\/files\/videos\/walk-voiceover-script\.md"/, 'it links to where the script is');
  const docsScript = await (await fetch(`${base}/fragments/videos/transcript/demo.mp4`)).text();
  assert.match(docsScript, /href="\/files\/docs\/demo-voiceover-script\.md"/, 'one in docs/ still links there');
  for (const n of ['walk.mp4', 'walk-voiceover-script.md', 'stray-notes.md', 'stray.png']) fs.rmSync(videos(n), { force: true });
});
