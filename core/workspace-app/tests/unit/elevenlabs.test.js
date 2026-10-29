const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFile, spawnSync } = require('child_process');
const yaml = require('js-yaml');

const REPO = path.join(__dirname, '../../../..');
const CORE = path.join(REPO, 'core');
const COMMAND = path.join(REPO, 'videos/cmd-tools-elevenlabs.sh');
const KEY = 'test-key-1234567890';
const VOICE = 'JBFqnCBsd6RMkjVDRZzb';
const have = (tool) => spawnSync('which', [tool]).status === 0;
const media = have('ffmpeg') && have('ffprobe') && have('python3');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'elevenlabs-'));

function workspace(block = '') {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'config'));
  fs.writeFileSync(path.join(root, 'config/settings.yml'), `workspaces:\n  - videos\n${block}`);
  return { root, config: path.join(root, 'config') };
}

function run(args, { ws, env = {}, bin } = {}) {
  const base = { ...process.env };
  for (const k of Object.keys(base)) if (k.startsWith('ELEVENLABS_')) delete base[k];
  const w = ws || workspace();
  const full = { ...base, WORKSPACE_ROOT: w.root, WORKSPACE_CONFIG: w.config, ...env };
  if (bin) full.PATH = `${bin}:${full.PATH}`;
  return new Promise((resolve) => {
    execFile('bash', [COMMAND, ...args], { env: full, cwd: w.root }, (error, stdout, stderr) => {
      resolve({ code: error ? error.code : 0, stdout, stderr, ws: w });
    });
  });
}

function tone(seconds) {
  return spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `sine=frequency=300:duration=${seconds.toFixed(2)}`, '-f', 'mp3', '-'], { maxBuffer: 1 << 26 }).stdout;
}

function stub() {
  const seen = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const url = new URL(req.url, 'http://x');
      seen.push({ method: req.method, path: url.pathname, query: url.search, key: req.headers['xi-api-key'], body });
      const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (req.headers['xi-api-key'] !== KEY) return json(401, { detail: { status: 'invalid_api_key', message: 'Invalid API key' } });
      if (url.pathname === '/v1/user/subscription') return json(200, { tier: 'creator', status: 'active', character_count: 1000, character_limit: 100000, next_character_count_reset_unix: 1796000000 });
      if (url.pathname === '/v2/voices') return json(200, { voices: [{ voice_id: VOICE, name: 'George', category: 'premade', labels: { accent: 'british' } }] });
      if (url.pathname.startsWith('/v1/text-to-speech/')) {
        const text = JSON.parse(body.toString()).text;
        const audio = tone((text.length / 15) * (text.includes('TOOLONG') ? 2 : 1));
        res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'request-id': 'req_test', 'x-character-count': String(text.length) });
        return res.end(audio);
      }
      if (url.pathname === '/v1/audio-isolation') { res.writeHead(200, { 'Content-Type': 'audio/mpeg' }); return res.end(tone(3)); }
      return json(404, {});
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    base: `http://127.0.0.1:${server.address().port}`, seen, close: () => server.close(),
    posts: () => seen.filter((r) => r.method === 'POST'),
  })));
}

const SCRIPT = `# Demo (draft 1)

## How to use this script

Ignore this section.

## S01 Opening (00:00.0 to 00:04.0)

**On screen:** the home page.

> Hello from the **first** section.

## S02 Middle part (00:04.0 to 00:10.0)

> One sentence with \`code\` and a [link](https://example.com/x).
> *(optional)* A spare line to drop when time runs short.

## S03 Close (00:10.0 to 00:12.0)

> Goodbye.
`;

function fixtures() {
  const dir = tmp();
  const script = path.join(dir, 'draft-1-voiceover-script.md');
  const video = path.join(dir, 'draft-1.mp4');
  fs.writeFileSync(script, SCRIPT);
  if (media) {
    spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=duration=12:size=160x90:rate=5', '-f', 'lavfi', '-i', 'sine=frequency=100:duration=12',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', video]);
    spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', video, '-frames:v', '1', path.join(dir, 'draft-1-poster.jpg')]);
  }
  return { dir, script, video };
}

const seconds = (file) => Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).stdout.toString());

/* ---- settings and wiring ---- */

// A machine's settings.yml holds its real key, so the committed copy can only be checked in a git checkout.
const CHECKOUT = fs.existsSync(path.join(REPO, '.git'));

test('the committed settings carry the block with placeholders, and every key is labelled', { skip: CHECKOUT ? false : 'not a git checkout: settings.yml is this machine\'s own' }, () => {
  const settings = yaml.load(fs.readFileSync(path.join(CORE, 'config/settings.yml'), 'utf8'));
  assert.deepStrictEqual(settings.elevenlabs, { api_key: 'CHANGE_ME', voice_id: 'ask', model_id: 'eleven_v4', region: 'global', pronunciation: '' });
  const labels = yaml.load(fs.readFileSync(path.join(CORE, 'config/settings.labels.yml'), 'utf8'));
  for (const k of ['api_key', 'voice_id', 'model_id', 'region', 'pronunciation']) {
    assert.ok(labels[`elevenlabs.${k}`] && labels[`elevenlabs.${k}`].label && labels[`elevenlabs.${k}`].info, `elevenlabs.${k}`);
  }
  assert.deepStrictEqual(Object.keys(labels['elevenlabs.region'].options), ['global', 'us', 'eu', 'in', 'sg']);
});

test('the key row is masked by the settings editor like every other secret', () => {
  const { isSecretKey } = require('../../settings-file');
  assert.strictEqual(isSecretKey('api_key', 'elevenlabs.api_key'), true);
  assert.strictEqual(isSecretKey('voice_id', 'elevenlabs.voice_id'), false);
});

test('the function file is loaded by bootstrap, and the scripts parse', () => {
  assert.ok(fs.readFileSync(path.join(CORE, 'scripts/bootstrap-functions.sh'), 'utf8').includes('functions/fun-elevenlabs.sh'));
  for (const f of [COMMAND, path.join(CORE, 'scripts/functions/fun-elevenlabs.sh')]) assert.strictEqual(spawnSync('bash', ['-n', f]).status, 0, f);
  if (have('python3')) assert.strictEqual(spawnSync('python3', ['-c', 'import ast,sys; ast.parse(open(sys.argv[1]).read())', path.join(CORE, 'scripts/libs/elevenlabs.py')]).status, 0);
});

test('the catalog offers the two free commands on the videos workspace, and the script they run exists', () => {
  const cc = require('../../commands');
  cc.invalidateCatalog();
  const cat = cc.loadCatalog();
  const mine = cat.builtin.filter((e) => e.id.startsWith('elevenlabs-'));
  assert.deepStrictEqual(mine.map((e) => e.id), ['elevenlabs-status', 'elevenlabs-check']);
  for (const e of mine) {
    assert.deepStrictEqual(e.when, ['workspace:videos']);
    assert.ok(fs.existsSync(path.join(REPO, e.script)), e.script);
    assert.doesNotMatch(e.args, /confirm|--out/, 'a catalog command must not spend credits');
  }
});

/* ---- the command, without the network ---- */

test('help lists every action and exits 0', async () => {
  const r = await run(['--help']);
  assert.strictEqual(r.code, 0);
  for (const a of ['status', 'init', 'sections', 'check', 'voices', 'speak', 'voiceover', 'isolate', 'polish', 'mcp-register']) assert.ok(r.stdout.includes(a), a);
});

test('status says no key and exits 3 for a missing key and for the placeholder', async () => {
  for (const block of ['', 'elevenlabs:\n  api_key: CHANGE_ME\n  voice_id: ask\n']) {
    const r = await run(['-a', 'status'], { ws: workspace(block) });
    assert.strictEqual(r.code, 3);
    assert.match(r.stdout, /key:\s+not set/);
    assert.doesNotMatch(r.stdout, /CHANGE_ME/);
  }
});

test('status finds a key in settings.yml or the environment and never prints it', async () => {
  const fromFile = await run(['-a', 'status'], { ws: workspace(`elevenlabs:\n  api_key: "${KEY}"\n  voice_id: ${VOICE}\n  region: eu\n`) });
  assert.strictEqual(fromFile.code, 0);
  assert.match(fromFile.stdout, /set \(settings\.yml\)/);
  assert.ok(fromFile.stdout.includes(VOICE) && fromFile.stdout.includes('api.eu.residency.elevenlabs.io'));
  const fromEnv = await run(['-a', 'status'], { env: { ELEVENLABS_API_KEY: KEY } });
  assert.match(fromEnv.stdout, /set \(environment\)/);
  for (const r of [fromFile, fromEnv]) assert.ok(!r.stdout.includes(KEY) && !r.stderr.includes(KEY));
});

test('init adds the block once, with a placeholder, and leaves the rest of the file alone', async () => {
  const ws = workspace();
  const before = fs.readFileSync(path.join(ws.config, 'settings.yml'), 'utf8');
  const first = await run(['-a', 'init'], { ws });
  assert.strictEqual(first.code, 0);
  const after = fs.readFileSync(path.join(ws.config, 'settings.yml'), 'utf8');
  assert.ok(after.startsWith(before));
  assert.deepStrictEqual(yaml.load(after).elevenlabs, { api_key: 'CHANGE_ME', voice_id: 'ask', model_id: 'eleven_v4', region: 'global', pronunciation: '' });
  const second = await run(['-a', 'init'], { ws });
  assert.match(second.stdout, /already has/);
  assert.strictEqual(fs.readFileSync(path.join(ws.config, 'settings.yml'), 'utf8'), after);
});

test('an unknown action exits 2', async () => {
  const r = await run(['-a', 'nonsense']);
  assert.strictEqual(r.code, 2);
});

test('no key: an action that needs one exits 3 before anything is sent', async () => {
  const r = await run(['-a', 'voices']);
  assert.strictEqual(r.code, 3);
  assert.match(r.stderr, /No ElevenLabs key/);
});

test('an argument cannot carry a command: unsafe characters are refused before anything runs', async () => {
  const dir = tmp();
  const marker = path.join(dir, 'RAN');
  for (const args of [['--voice', `$(touch ${marker})`, '--out', 'x.mp3'], ['--voice', VOICE, '--out', `x\`touch ${marker}\`.mp3`], ['--voice', 'a"b', '--out', 'x.mp3']]) {
    const r = await run(['-a', 'speak', '--text-file', path.join(dir, 'none.txt'), ...args], { env: { ELEVENLABS_API_KEY: KEY } });
    assert.strictEqual(r.code, 2, JSON.stringify(args));
    assert.match(r.stderr, /may not contain/);
  }
  assert.ok(!fs.existsSync(marker));
});

/* ---- the script ---- */

test('sections: the timed sections, cleaned of markdown, with the optional line counted apart', { skip: !have('python3') }, async () => {
  const { script } = fixtures();
  const r = await run(['-a', 'sections', '--script', script, '--json']);
  assert.strictEqual(r.code, 0);
  const found = JSON.parse(r.stdout).sections;
  assert.deepStrictEqual(found.map((s) => [s.id, s.start, s.end, s.window]), [['S01', 0, 4, 4], ['S02', 4, 10, 6], ['S03', 10, 12, 2]]);
  assert.strictEqual(found[0].text, 'Hello from the first section.');
  assert.strictEqual(found[1].text, 'One sentence with code and a link. A spare line to drop when time runs short.');
  const dropped = JSON.parse((await run(['-a', 'sections', '--script', script, '--json', '--drop-optional'])).stdout).sections;
  assert.strictEqual(dropped[1].text, 'One sentence with code and a link.');
  assert.ok(found[1].optional_chars > 0 && dropped[1].chars < found[1].chars);
});

test('sections: a script without timed sections is refused with the format, not guessed at', { skip: !have('python3') }, async () => {
  const dir = tmp();
  const plain = path.join(dir, 'plain.md');
  fs.writeFileSync(plain, '# A script\n\nJust some lines.\n> A quote\n');
  const r = await run(['-a', 'sections', '--script', plain]);
  assert.strictEqual(r.code, 1);
  assert.match(r.stderr, /No timed sections found/);
  fs.writeFileSync(plain, '## S01 One (00:05.0 to 00:02.0)\n> Hi.\n');
  assert.match((await run(['-a', 'sections', '--script', plain])).stderr, /ends before it starts/);
  fs.writeFileSync(plain, '## S01 One (00:00.0 to 00:05.0)\n> Hi.\n## S02 Two (00:03.0 to 00:09.0)\n> Again.\n');
  assert.match((await run(['-a', 'sections', '--script', plain])).stderr, /starts before the previous/);
});

/* ---- the network, against a stub ---- */

test('check reads the account and voices lists them; the key travels as a header and never on a command line', { skip: !have('python3') }, async () => {
  const api = await stub();
  const bin = tmp();
  const log = path.join(bin, 'python3.log');
  fs.writeFileSync(path.join(bin, 'python3'), `#!/bin/bash\nprintf '%s\\n' "$*" >> "${log}"\nprintf 'env=%s\\n' "\${ELEVENLABS_API_KEY:+present}" >> "${log}"\nexec "$(PATH="\${PATH#*:}" command -v python3)" "$@"\n`, { mode: 0o755 });
  const env = { ELEVENLABS_API_KEY: KEY, ELEVENLABS_API_BASE: api.base };
  const check = await run(['-a', 'check'], { env, bin });
  const voices = await run(['-a', 'voices'], { env, bin });
  api.close();
  assert.strictEqual(check.code, 0);
  assert.match(check.stdout, /Plan: creator \(active\)/);
  assert.match(check.stdout, /Remaining: 99000/);
  assert.match(voices.stdout, new RegExp(`${VOICE}\\s+George`));
  assert.ok(api.seen.length >= 2 && api.seen.every((r) => r.key === KEY));
  const logged = fs.readFileSync(log, 'utf8');
  assert.ok(!logged.includes(KEY), 'the key must not be on a command line');
  assert.match(logged, /env=present/);
});

test('a rejected key is reported plainly, without the key', { skip: !have('python3') }, async () => {
  const api = await stub();
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 't.txt'), 'hello');
  const r = await run(['-a', 'speak', '--text-file', path.join(dir, 't.txt'), '--out', path.join(dir, 'o.mp3'), '--voice', VOICE, '--confirm'],
    { env: { ELEVENLABS_API_KEY: 'wrong-key-0000', ELEVENLABS_API_BASE: api.base } });
  api.close();
  assert.strictEqual(r.code, 1);
  assert.match(r.stderr, /HTTP 401\. ElevenLabs rejected the key\. Invalid API key/);
  assert.ok(!r.stderr.includes('wrong-key-0000'));
});

test('speak sends nothing without --confirm, then writes the audio once and refuses to overwrite it', { skip: !media }, async () => {
  const api = await stub();
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 't.txt'), 'Hello there, this is a test.');
  const out = path.join(dir, 'o.mp3');
  const env = { ELEVENLABS_API_KEY: KEY, ELEVENLABS_API_BASE: api.base };
  const args = ['-a', 'speak', '--text-file', path.join(dir, 't.txt'), '--out', out, '--voice', VOICE];
  const plan = await run(args, { env });
  assert.strictEqual(plan.code, 4);
  assert.match(plan.stdout, /nothing was sent/);
  assert.strictEqual(api.posts().length, 0);
  assert.ok(!fs.existsSync(out));
  const done = await run([...args, '--confirm'], { env });
  assert.strictEqual(done.code, 0);
  const post = api.posts()[0];
  assert.strictEqual(post.path, `/v1/text-to-speech/${VOICE}`);
  assert.match(post.query, /output_format=mp3_44100_128/);
  assert.deepStrictEqual(JSON.parse(post.body.toString()), { text: 'Hello there, this is a test.', model_id: 'eleven_v4' });
  assert.ok(seconds(out) > 1);
  const again = await run([...args, '--confirm'], { env });
  api.close();
  assert.strictEqual(again.code, 1);
  assert.match(again.stderr, /already exists.*Nothing was sent/);
  assert.strictEqual(api.posts().length, 1, 'refusing to overwrite must happen before any request');
});

test('brand names are respelled only in the text sent to the voice: Webship as Var-dot, Webship as Var-base, plus settings', { skip: !media }, async () => {
  const api = await stub();
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 't.txt'), "This is Webship 11, Webship's Drupal distribution, from Acme.");
  const env = { ELEVENLABS_API_KEY: KEY, ELEVENLABS_API_BASE: api.base };
  const args = ['-a', 'speak', '--text-file', path.join(dir, 't.txt'), '--voice', VOICE, '--confirm'];
  const one = await run([...args, '--out', path.join(dir, 'a.mp3')], { env });
  assert.strictEqual(one.code, 0);
  assert.strictEqual(JSON.parse(api.posts()[0].body.toString()).text, "This is Var-base 11, Var-dot's Drupal distribution, from Acme.");
  const ws = workspace('elevenlabs:\n  pronunciation: "Acme=Ack-me"\n');
  const two = await run([...args, '--out', path.join(dir, 'b.mp3')], { env, ws });
  assert.strictEqual(two.code, 0);
  assert.strictEqual(JSON.parse(api.posts()[1].body.toString()).text, "This is Var-base 11, Var-dot's Drupal distribution, from Ack-me.");
  assert.strictEqual(fs.readFileSync(path.join(dir, 't.txt'), 'utf8'), "This is Webship 11, Webship's Drupal distribution, from Acme.", 'the text file keeps the real spelling');
  api.close();
});

test('voiceover: a plan first, then speech per section placed on its window over the draft, with only changed sections re-sent', { skip: !media }, async () => {
  const api = await stub();
  const { dir, script, video } = fixtures();
  const out = path.join(dir, 'final.mp4');
  const env = { ELEVENLABS_API_KEY: KEY, ELEVENLABS_API_BASE: api.base };
  const args = ['-a', 'voiceover', '--script', script, '--video', video, '--out', out, '--voice', VOICE];
  const plan = await run(args, { env });
  assert.strictEqual(plan.code, 4);
  assert.match(plan.stdout, /3 sections|S01/);
  assert.strictEqual(api.posts().length, 0);
  assert.ok(!fs.existsSync(out));

  const done = await run([...args, '--confirm', '--json'], { env });
  assert.strictEqual(done.code, 0, done.stderr);
  assert.strictEqual(api.posts().length, 3);
  assert.ok(Math.abs(seconds(out) - seconds(video)) < 0.2, 'the video keeps its length');
  const streams = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name', '-of', 'csv=p=0', out]).stdout.toString();
  assert.match(streams, /h264,video/);
  assert.match(streams, /aac,audio/);
  const base = path.join(dir, 'final');
  assert.ok(fs.existsSync(`${base}-voiceover.mp3`) && fs.existsSync(`${base}-poster.jpg`));
  const report = JSON.parse(fs.readFileSync(`${base}-voiceover.json`, 'utf8'));
  assert.deepStrictEqual(report.sections.map((s) => [s.id, s.fit]), [['S01', 'ok'], ['S02', 'ok'], ['S03', 'ok']]);
  assert.ok(!JSON.stringify(report).includes(KEY));
  assert.ok(!fs.existsSync(path.join(`${base}-voiceover-sections`, '_mix.wav')), 'the large intermediate is removed');

  const edited = path.join(dir, 'edited.md');
  fs.writeFileSync(edited, SCRIPT.replace('Goodbye.', 'Goodbye for now.'));
  const second = await run(['-a', 'voiceover', '--script', edited, '--video', video, '--out', path.join(dir, 'final2.mp4'), '--voice', VOICE,
    '--work', `${base}-voiceover-sections`, '--confirm'], { env });
  api.close();
  assert.strictEqual(second.code, 0, second.stderr);
  assert.strictEqual(api.posts().length, 4, 'only the edited section is sent again');
});

test('voiceover: a section that cannot fit its window stops the run with exit 5 and makes no video', { skip: !media }, async () => {
  const api = await stub();
  const { dir, script, video } = fixtures();
  const long = path.join(dir, 'long.md');
  fs.writeFileSync(long, SCRIPT.replace('Goodbye.', 'TOOLONG Goodbye and thank you for watching.'));
  const out = path.join(dir, 'final.mp4');
  const r = await run(['-a', 'voiceover', '--script', long, '--video', video, '--out', out, '--voice', VOICE, '--confirm'],
    { env: { ELEVENLABS_API_KEY: KEY, ELEVENLABS_API_BASE: api.base } });
  api.close();
  assert.strictEqual(r.code, 5);
  assert.match(r.stdout, /S03 Close/);
  assert.match(r.stdout, /Finished sections are kept/);
  assert.ok(!fs.existsSync(out));
});

test('voiceover and isolate refuse to overwrite before spending anything', { skip: !media }, async () => {
  const api = await stub();
  const { dir, script, video } = fixtures();
  const env = { ELEVENLABS_API_KEY: KEY, ELEVENLABS_API_BASE: api.base };
  const out = path.join(dir, 'final.mp4');
  fs.writeFileSync(out, 'x');
  const a = await run(['-a', 'voiceover', '--script', script, '--video', video, '--out', out, '--voice', VOICE, '--confirm'], { env });
  fs.rmSync(out);
  fs.writeFileSync(path.join(dir, 'final-voiceover.mp3'), 'x');
  const b = await run(['-a', 'voiceover', '--script', script, '--video', video, '--out', out, '--voice', VOICE, '--confirm'], { env });
  const take = path.join(dir, 'take.wav');
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=250:duration=3', take]);
  fs.writeFileSync(path.join(dir, 'clean.mp3'), 'x');
  const c = await run(['-a', 'isolate', '--audio', take, '--out', path.join(dir, 'clean.mp3'), '--confirm'], { env });
  fs.writeFileSync(path.join(dir, 'p.mp4'), 'x');
  const d = await run(['-a', 'polish', '--audio', take, '--video', video, '--out', path.join(dir, 'p.mp4'), '--isolate', '--confirm'], { env });
  api.close();
  for (const r of [a, b, c, d]) { assert.strictEqual(r.code, 1); assert.match(r.stderr, /already exists/); }
  assert.strictEqual(api.posts().length, 0);
});

test('voiceover: a script that runs past the video is refused as the wrong draft', { skip: !media }, async () => {
  const api = await stub();
  const { dir, script } = fixtures();
  const short = path.join(dir, 'short.mp4');
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=duration=5:size=160x90:rate=5', '-pix_fmt', 'yuv420p', short]);
  const r = await run(['-a', 'voiceover', '--script', script, '--video', short, '--out', path.join(dir, 'o.mp4'), '--voice', VOICE],
    { env: { ELEVENLABS_API_KEY: KEY, ELEVENLABS_API_BASE: api.base } });
  api.close();
  assert.strictEqual(r.code, 1);
  assert.match(r.stderr, /right draft/);
});

test('polish levels a recorded take onto the draft, locally; cleaning it with ElevenLabs needs --confirm', { skip: !media }, async () => {
  const api = await stub();
  const { dir, video } = fixtures();
  const take = path.join(dir, 'take.wav');
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=250:duration=20', take]);
  const env = { ELEVENLABS_API_KEY: KEY, ELEVENLABS_API_BASE: api.base };
  const local = await run(['-a', 'polish', '--audio', take, '--video', video, '--out', path.join(dir, 'p.mp4')], { env });
  assert.strictEqual(local.code, 0, local.stderr);
  assert.ok(Math.abs(seconds(path.join(dir, 'p.mp4')) - 12) < 0.2, 'a long take is trimmed to the video');
  assert.match(local.stdout, /Trimmed/);
  assert.strictEqual(api.seen.length, 0, 'a local polish sends nothing');
  const out = path.join(dir, 'c.mp4');
  const plan = await run(['-a', 'polish', '--audio', take, '--video', video, '--out', out, '--isolate'], { env });
  assert.strictEqual(plan.code, 4);
  assert.strictEqual(api.posts().length, 0);
  const done = await run(['-a', 'polish', '--audio', take, '--video', video, '--out', out, '--isolate', '--confirm'], { env });
  api.close();
  assert.strictEqual(done.code, 0, done.stderr);
  assert.strictEqual(api.posts().filter((r) => r.path === '/v1/audio-isolation').length, 1);
});

/* ---- the hosted MCP server ---- */

function fakeClaude(existing) {
  const bin = tmp();
  const log = path.join(bin, 'claude.log');
  fs.writeFileSync(path.join(bin, 'claude'), `#!/bin/bash\nprintf '%s\\n' "$*" >> "${log}"\n[ "$2" = get ] && ${existing ? 'exit 0' : 'exit 1'}\nexit 0\n`, { mode: 0o755 });
  return { bin, calls: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : []) };
}

test('mcp-register adds the hosted server over HTTP with OAuth, stores no key, and warns that updates publish directly', async () => {
  const fake = fakeClaude(false);
  const r = await run(['-a', 'mcp-register'], { bin: fake.bin, env: { ELEVENLABS_API_KEY: KEY } });
  assert.strictEqual(r.code, 0);
  assert.ok(fake.calls().includes('mcp add --transport http --scope user elevenlabs https://api.elevenlabs.io/v1/mcp'));
  assert.ok(!fake.calls().join('\n').includes(KEY));
  assert.match(r.stdout, /OAuth/);
  assert.match(r.stdout, /published directly/);
});

test('mcp-register does nothing when it is already registered, and uses the region address', async () => {
  const fake = fakeClaude(true);
  const r = await run(['-a', 'mcp-register'], { bin: fake.bin, ws: workspace('elevenlabs:\n  api_key: CHANGE_ME\n  region: eu\n') });
  assert.match(r.stdout, /already registered/);
  assert.ok(!fake.calls().some((c) => c.startsWith('mcp add')));
  const fresh = fakeClaude(false);
  await run(['-a', 'mcp-register'], { bin: fresh.bin, ws: workspace('elevenlabs:\n  api_key: CHANGE_ME\n  region: eu\n') });
  assert.ok(fresh.calls().includes('mcp add --transport http --scope user elevenlabs https://api.eu.residency.elevenlabs.io/v1/mcp'));
});

test('mcp-unregister removes it from the user scope', async () => {
  const fake = fakeClaude(true);
  const r = await run(['-a', 'mcp-unregister'], { bin: fake.bin });
  assert.strictEqual(r.code, 0);
  assert.ok(fake.calls().includes('mcp remove --scope user elevenlabs'));
});
