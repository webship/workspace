/**
 * Generate a voice: the engines the form offers follow the keys the machine holds.
 *
 * The real server and the real `audio/cmd-tools-voice.sh` run here, against a stub of the ElevenLabs
 * API and a home with a fake voice-narration catalog, so nothing is spent and nothing depends on what
 * is installed on the machine running the tests.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { promisify } = require('util');
const run = promisify(execFile);

const APP = path.join(__dirname, '../..');
const REPO = path.join(APP, '../..');
const { copyConfig } = require('./_isolated-config');

// The workspace root is read when the app's modules first load, so it is made and named before they do.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-voice-root-'));
process.env.WORKSPACE_ROOT = root;
const voice = require('../../audio-voice');

const SAYS = `#!/usr/bin/env bash
echo "claude-say voices (use:  claude-say -v <number>  or  -v <basename>):"
echo "   1) en_US-lessac-high            American English — high (default)"
echo "  !2) en_GB-cori-high              British English — female, high"
`;

const TIMED = `# Demo

## S01 Opening (00:00.0 to 00:10.0)

> This is the opening.
> *(optional)* It has a spare sentence.

## S02 Close (00:10.0 to 00:20.0)

> Thank you for watching.
`;

const calls = [];
let home; let stub; let stubBase; let voicesAllowed = true; let modelsAllowed = false; const servers = [];

const free = () => new Promise((resolve) => {
  const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});

before(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-voice-home-'));
  // ffmpeg and ffprobe are made visible and nothing else from the machine's own PATH: Piper must stay hidden.
  fs.mkdirSync(path.join(home, 'bin'), { recursive: true });
  for (const tool of ['ffmpeg', 'ffprobe']) {
    const found = (process.env.PATH || '').split(path.delimiter).map((d) => path.join(d, tool)).find((f) => fs.existsSync(f));
    if (found) fs.symlinkSync(found, path.join(home, 'bin', tool));
  }
  fs.mkdirSync(path.join(home, '.claude/skills/voice-narration/scripts'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude/skills/voice-narration/scripts/claude-say'), SAYS);
  fs.mkdirSync(path.join(root, 'core'), { recursive: true });
  copyConfig(path.join(REPO, 'core/config'), path.join(root, 'core/config'));
  fs.symlinkSync(path.join(REPO, 'core/scripts'), path.join(root, 'core/scripts'));
  fs.symlinkSync(APP, path.join(root, 'core/workspace-app'));
  fs.mkdirSync(path.join(root, 'audio'), { recursive: true });
  fs.mkdirSync(path.join(root, 'videos'), { recursive: true });
  fs.copyFileSync(path.join(REPO, 'videos/cmd-tools-elevenlabs.sh'), path.join(root, 'videos/cmd-tools-elevenlabs.sh'));
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'videos/demo.mp4'), Buffer.alloc(100, 1));
  fs.writeFileSync(path.join(root, 'docs/demo-voiceover-script.md'), TIMED);
  fs.writeFileSync(path.join(root, 'docs/notes.md'), 'not a script');
  fs.copyFileSync(path.join(REPO, 'audio/cmd-tools-voice.sh'), path.join(root, 'audio/cmd-tools-voice.sh'));
  stub = http.createServer((req, res) => {
    const json = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.headers['xi-api-key'] !== 'testkey') return json(401, { detail: { message: 'bad key' } });
    if (req.method === 'POST' && /^\/v1\/(sound-generation|music|text-to-speech\/)/.test(req.url)) {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => { calls.push({ url: req.url, body: JSON.parse(raw || '{}') }); res.writeHead(200, { 'Content-Type': 'audio/mpeg' }); res.end(Buffer.alloc(900, 7)); });
      return undefined;
    }
    if (req.url.startsWith('/v1/user/subscription')) return json(200, { tier: 'creator', status: 'active', character_count: 100, character_limit: 1100, next_character_count_reset_unix: 1800000000 });
    if (req.url.startsWith('/v1/models')) {
      if (!modelsAllowed) return json(401, { detail: { message: 'missing the permission models_read' } });
      return json(200, [{ model_id: 'eleven_flash_v2_5', name: 'Flash', can_do_text_to_speech: true },
        { model_id: 'eleven_new_v9', name: 'New v9', can_do_text_to_speech: true }, { model_id: 'eleven_stt', name: 'Speech to text', can_do_text_to_speech: false }]);
    }
    if (req.url.startsWith('/v2/voices')) {
      if (!voicesAllowed) return json(403, { detail: { message: 'missing the permission voices_read' } });
      return json(200, { voices: [{ voice_id: 'voiceAAAAAAAAAAAAAAAA', name: 'Alice', category: 'premade', labels: { gender: 'female', accent: 'british' } },
        { voice_id: 'voiceBBBBBBBBBBBBBBBB', name: 'Bob', category: 'premade', labels: {} }] });
    }
    return json(404, {});
  });
  await new Promise((r) => stub.listen(0, '127.0.0.1', r));
  stubBase = `http://127.0.0.1:${stub.address().port}`;
});

after(() => {
  for (const s of servers) s.kill();
  stub.close();
  for (const d of [root, home]) fs.rmSync(d, { recursive: true, force: true });
});

const baseEnv = (extra = {}) => ({ PATH: `/usr/bin:/bin:${path.dirname(process.execPath)}:${path.join(home, 'bin')}`, HOME: home, WORKSPACE_ROOT: root, ELEVENLABS_API_BASE: stubBase, ...extra });

// Asynchronous on purpose: the stub API answers from this process, which a synchronous call would block.
async function engines(extra) {
  const { stdout } = await run('bash', [path.join(root, 'audio/cmd-tools-voice.sh'), '-a', 'engines', '--json'], { env: baseEnv(extra) });
  return JSON.parse(stdout).engines;
}

async function serve(extra) {
  const port = await free();
  const proc = spawn(process.execPath, ['server.js'], { cwd: APP, env: { ...baseEnv(extra), PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  servers.push(proc);
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start')), 15000);
    proc.stdout.on('data', (d) => { if (/listening/.test(String(d))) { clearTimeout(t); resolve(); } });
    proc.on('exit', (c) => { clearTimeout(t); reject(new Error(`server exited ${c}`)); });
  });
  return `http://127.0.0.1:${port}`;
}

const post = (base, p, form) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form) });

test('with a key the command offers ElevenLabs, its voices and its credits; without one it says why not', async () => {
  voicesAllowed = true;
  const [piper, eleven] = await engines({ ELEVENLABS_API_KEY: 'testkey' });
  assert.strictEqual(eleven.available, true);
  assert.strictEqual(eleven.can_list_voices, true);
  assert.deepStrictEqual(eleven.voices.map((v) => v.id), ['voiceAAAAAAAAAAAAAAAA', 'voiceBBBBBBBBBBBBBBBB']);
  assert.strictEqual(eleven.remaining, 1000);
  assert.strictEqual(eleven.plan, 'creator');
  assert.ok(eleven.models.some((m) => m.id === 'eleven_v4'));
  assert.strictEqual(piper.reason_code, 'no-binary');
  assert.deepStrictEqual(piper.voices.map((v) => [v.id, v.number]), [['en_US-lessac-high', 1], ['en_GB-cori-high', 2]]);

  const bare = (await engines({ ELEVENLABS_API_KEY: '' }))[1];
  assert.strictEqual(bare.available, false);
  assert.match(bare.reason, /No ElevenLabs key/);
  const bad = (await engines({ ELEVENLABS_API_KEY: 'wrongkey' }))[1];
  assert.strictEqual(bad.available, false);
  assert.match(bad.reason, /rejected the key/);
});

test('a voice given by name is resolved to its id, and the settings accept voice and model', async () => {
  const eleven = (await engines({ ELEVENLABS_API_KEY: 'testkey', ELEVENLABS_VOICE: 'alice' }))[1];
  assert.strictEqual(eleven.default_voice, 'voiceAAAAAAAAAAAAAAAA');
  const text = path.join(home, 'name.txt');
  fs.writeFileSync(text, 'Hello');
  const cli = path.join(root, 'audio/cmd-tools-voice.sh');
  const plan = await run('bash', [cli, '-a', 'speak', '--engine', 'elevenlabs', '--text-file', text, '--out', path.join(home, 'n.mp3'), '--voice', 'Alice'], { env: baseEnv({ ELEVENLABS_API_KEY: 'testkey' }) }).catch((e) => e);
  assert.strictEqual(plan.code, 4);
  assert.match(plan.stdout, /Voice voiceAAAAAAAAAAAAAAAA,/);
  const unknown = await run('bash', [cli, '-a', 'speak', '--engine', 'elevenlabs', '--text-file', text, '--out', path.join(home, 'n.mp3'), '--voice', 'Nobody'], { env: baseEnv({ ELEVENLABS_API_KEY: 'testkey' }) }).catch((e) => e);
  assert.match(unknown.stderr, /No voice named "Nobody"/);
  // The shorter key names some settings files use.
  const file = path.join(root, 'core/config/settings.yml');
  const original = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, original.replace(/^ {2}voice_id: .*\n/m, '  voice: Alice\n').replace(/^ {2}model_id: .*\n/m, '  model: eleven_v3\n'));
  try {
    const status = (await run('bash', [path.join(root, 'videos/cmd-tools-elevenlabs.sh'), '-a', 'status'], { env: baseEnv({ ELEVENLABS_API_KEY: 'testkey' }) })).stdout;
    assert.match(status, /model: {3}eleven_v3/);
    assert.match(status, /voice: {3}Alice/);
  } finally { fs.writeFileSync(file, original); }
});

test('a key that cannot list voices is still offered, and asks for a voice id', async () => {
  voicesAllowed = false;
  const eleven = (await engines({ ELEVENLABS_API_KEY: 'testkey' }))[1];
  voicesAllowed = true;
  assert.strictEqual(eleven.available, true);
  assert.strictEqual(eleven.can_list_voices, false);
  assert.strictEqual(eleven.can_read_account, true);
  assert.match(eleven.voices_note, /voices_read/);
});

test('Piper is offered from the host catalog even where its binary cannot be seen', async () => {
  const found = voice.offered(await engines({ ELEVENLABS_API_KEY: 'testkey' }));
  const piper = found.find((e) => e.id === 'piper');
  assert.strictEqual(piper.available, true);
  assert.strictEqual(piper.hostOnly, true);
});

test('a request is checked against the engines on offer before anything is written or run', async () => {
  const found = await engines({ ELEVENLABS_API_KEY: 'testkey' });
  const good = { text: 'Hello there', engine: 'elevenlabs', el_voice: 'voiceAAAAAAAAAAAAAAAA', el_model: 'eleven_v4' };
  const p = voice.plan(good, found);
  assert.deepStrictEqual([p.engine, p.voice, p.model, p.ext, p.characters], ['elevenlabs', 'voiceAAAAAAAAAAAAAAAA', 'eleven_v4', 'mp3', 11]);
  assert.match(p.file, /^hello-there-elevenlabs\.mp3$/);
  const err = (form) => voice.plan({ ...good, ...form }, found).error;
  assert.match(err({ text: '  ' }), /Type what/);
  assert.match(err({ text: 'x'.repeat(5001) }), /at most 5000/);
  assert.match(err({ engine: 'other' }), /Choose a voice/);
  assert.match(err({ el_voice: 'nobody' }), /not on this account/);
  assert.match(err({ el_voice: 'a b; rm' }), /Choose a voice/);
  assert.match(err({ el_model: 'eleven_nope' }), /Choose one of the models/);
  assert.match(voice.plan({ text: 'Hi', engine: 'piper', piper_voice: 'nope' }, found).error, /Piper voices/);
  const piper = voice.plan({ text: 'Hi', engine: 'piper', piper_voice: 'en_US-lessac-high', piper_format: 'mp3', name: 'My Greeting!' }, found);
  assert.deepStrictEqual([piper.ext, piper.file], ['mp3', 'my-greeting.mp3']);
  const noKey = await engines({ ELEVENLABS_API_KEY: '' });
  assert.match(voice.plan(good, noKey).error, /not available/);
});

test('the line the host runs holds no shell expansion, and only ElevenLabs carries --confirm', async () => {
  const found = await engines({ ELEVENLABS_API_KEY: 'testkey' });
  const eleven = voice.commandLine(voice.plan({ text: 'Hi', engine: 'elevenlabs', el_voice: 'voiceAAAAAAAAAAAAAAAA' }, found), '/tmp/ws-voice-x/text.txt', true);
  const piper = voice.commandLine(voice.plan({ text: 'Hi', engine: 'piper', piper_voice: 'en_US-lessac-high' }, found), '/tmp/ws-voice-x/text.txt', true);
  for (const line of [eleven, piper]) {
    assert.ok(!/[$`]/.test(line), line);
    assert.match(line, /rm -rf "\/tmp\/ws-voice-x"/);
  }
  assert.match(eleven, /"--confirm"/);
  assert.match(eleven, /"--model" "eleven_v4"/);
  assert.ok(!/--confirm/.test(piper));
});

test('the form offers what the keys allow, and the spending button asks first', async () => {
  const base = await serve({ ELEVENLABS_API_KEY: 'testkey' });
  const html = await (await fetch(`${base}/fragments/audio/new`)).text();
  assert.match(html, /Generate a voice/);
  assert.match(html, /<select class="uk-select" id="voice_choice" name="voice_choice">/, 'one dropdown for every voice');
  assert.match(html, /<optgroup label="ElevenLabs — uses credits · 1,000 left on the creator plan">[\s\S]*<optgroup label="Piper — free, on this machine">/, 'ElevenLabs first, then Piper');
  assert.match(html, /<option value="elevenlabs:voiceAAAAAAAAAAAAAAAA">Alice — female, british<\/option>/);
  assert.match(html, /<option value="elevenlabs:voiceBBBBBBBBBBBBBBBB">Bob<\/option>/);
  assert.match(html, /<option value="piper:en_US-lessac-high" selected>/, 'with no default voice set, the first Piper voice');
  assert.ok(!/name="engine"/.test(html), 'the engine follows the voice, so there is no separate choice');
  assert.match(html, /<option value="eleven_v4" selected>/);
  assert.match(html, /host runner/);
  assert.match(html, /arm-step" data-engine-button="elevenlabs" data-mode-button="text" hidden/);
  assert.match(html, /hx-vals='\{"confirm":"yes"\}'[\s\S]*hx-trigger="confirmed-remove"/);
  assert.match(html, /data-engine-pane="elevenlabs" hidden/);
});

test('without a key the ElevenLabs option is disabled with its reason, and Piper still works', async () => {
  const base = await serve({ ELEVENLABS_API_KEY: '' });
  const html = await (await fetch(`${base}/fragments/audio/new`)).text();
  assert.match(html, /<strong>ElevenLabs<\/strong> is not available: No ElevenLabs key is set/);
  assert.ok(!/<optgroup label="ElevenLabs/.test(html), 'no ElevenLabs voices to pick');
  assert.ok(!/data-engine-button="elevenlabs"/.test(html));
  assert.match(html, /data-engine-button="piper"/);
});

test('more models are offered, any model id can be typed, and a key that may read models adds its own', async () => {
  modelsAllowed = false;
  const [, eleven] = await engines({ ELEVENLABS_API_KEY: 'testkey' });
  const ids = eleven.models.map((m) => m.id);
  for (const id of ['eleven_v4', 'eleven_v3', 'eleven_multilingual_v2', 'eleven_flash_v2_5', 'eleven_turbo_v2_5', 'eleven_flash_v2', 'eleven_turbo_v2']) assert.ok(ids.includes(id), id);
  assert.ok(!eleven.can_list_models && !ids.includes('eleven_new_v9'), 'without models_read, the built-in list');
  assert.match(eleven.models.find((m) => m.id === 'eleven_flash_v2_5').label, /half the credits/, 'a label says what it costs');
  modelsAllowed = true;
  const [, listed] = await engines({ ELEVENLABS_API_KEY: 'testkey' });
  modelsAllowed = false;
  assert.strictEqual(listed.can_list_models, true);
  assert.ok(listed.models.some((m) => m.id === 'eleven_new_v9' && m.label === 'New v9'), 'a speech model the key lists is added');
  assert.ok(!listed.models.some((m) => m.id === 'eleven_stt'), 'one that cannot speak is not');
  assert.strictEqual(listed.models.filter((m) => m.id === 'eleven_flash_v2_5').length, 1, 'and nothing is listed twice');
  const found = [{ ...(await engines({ ELEVENLABS_API_KEY: 'testkey' }))[0] }, eleven];
  const plan = (extra) => voice.plan({ text: 'Hi', voice_choice: 'elevenlabs:voiceAAAAAAAAAAAAAAAA', ...extra }, found);
  assert.strictEqual(plan({ el_model: 'eleven_flash_v2_5' }).model, 'eleven_flash_v2_5');
  assert.strictEqual(plan({ el_model: 'eleven_v3', el_model_other: 'eleven_brand_new' }).model, 'eleven_brand_new', 'a typed model wins over the list');
  assert.match(plan({ el_model_other: 'bad model; rm' }).error, /not a model id/);
  assert.match(plan({ el_model: 'eleven_nope' }).error, /Choose one of the models/, 'the list itself stays closed');
  const html = voice.formHtml({ engines: found }, 'voice');
  assert.match(html, /<option value="eleven_flash_v2_5">Flash v2\.5: fastest/);
  assert.match(html, /name="el_model_other"/);
  assert.match(voice.commandLine(plan({ el_model_other: 'eleven_brand_new' }), '/tmp/ws-voice-x/text.txt', true), /"--model" "eleven_brand_new"/);
});

test('the configured default voice is the one selected, and the dropdown alone names the engine', async () => {
  const base = await serve({ ELEVENLABS_API_KEY: 'testkey', ELEVENLABS_VOICE: 'voiceBBBBBBBBBBBBBBBB' });
  const html = await (await fetch(`${base}/fragments/audio/new`)).text();
  assert.match(html, /<option value="elevenlabs:voiceBBBBBBBBBBBBBBBB" selected>/, 'the default voice is chosen');
  assert.ok(!/<option value="piper:[^"]*" selected>/.test(html));
  assert.match(html, /<div data-engine-pane="elevenlabs">/, 'so its model and cost note show');
  assert.match(html, /data-engine-pane="piper" hidden/);
  assert.match(html, /arm-step" data-engine-button="elevenlabs" data-mode-button="text"(?! hidden)/, 'and its button, which asks first');
  const found = await engines({ ELEVENLABS_API_KEY: 'testkey' });
  const el = voice.plan({ text: 'Hi', voice_choice: 'elevenlabs:voiceAAAAAAAAAAAAAAAA', el_model: 'eleven_v4' }, found);
  assert.deepStrictEqual([el.engine, el.voice, el.model], ['elevenlabs', 'voiceAAAAAAAAAAAAAAAA', 'eleven_v4']);
  const pp = voice.plan({ text: 'Hi', voice_choice: 'piper:en_US-lessac-high' }, found);
  assert.deepStrictEqual([pp.engine, pp.voice], ['piper', 'en_US-lessac-high']);
  assert.match(voice.plan({ text: 'Hi', voice_choice: 'elevenlabs:nobody' }, found).error, /not on this account/);
  assert.match(voice.plan({ text: 'Hi', voice_choice: 'nonsense:x' }, found).error, /Choose a voice/);
});

test('the generate action refuses what the form should never send', async () => {
  const base = await serve({ ELEVENLABS_API_KEY: 'testkey' });
  const send = (form) => post(base, '/actions/generate-voice', { workspace: 'audio', ...form });
  assert.strictEqual((await send({ text: '', engine: 'piper' })).status, 400);
  assert.strictEqual((await send({ text: 'Hi', engine: 'nope' })).status, 400);
  const spend = await send({ text: 'Hi', engine: 'elevenlabs', el_voice: 'voiceAAAAAAAAAAAAAAAA' });
  assert.strictEqual(spend.status, 400);
  assert.match(await spend.text(), /needs your confirmation/);
  assert.strictEqual((await post(base, '/actions/generate-voice', { workspace: 'dev', text: 'Hi', engine: 'piper' })).status, 400);
  const leftovers = () => { const d = path.join(root, '.screens', 'voice-text'); return fs.existsSync(d) ? fs.readdirSync(d) : []; };
  const before = leftovers().length;
  const ok = await send({ text: 'Hi', engine: 'elevenlabs', el_voice: 'voiceAAAAAAAAAAAAAAAA', confirm: 'yes' });
  assert.ok([200, 409, 500].includes(ok.status));
  assert.match(await ok.text(), /voice|runner/i);
  if (ok.status === 500) assert.strictEqual(leftovers().length, before, 'the text is not left behind when nothing started');
  // And where it is written is a place the host can read: under the workspace, not the container's /tmp.
  const made = voice.writeText('Hi');
  assert.ok(made.startsWith(path.join(root, '.screens', 'voice-text')), made);
  assert.strictEqual(fs.readFileSync(made, 'utf8'), 'Hi\n');
  assert.strictEqual(fs.statSync(path.dirname(made)).mode & 0o077, 0, 'private to its owner');
  fs.rmSync(path.dirname(made), { recursive: true, force: true });
});

test('the video mode picks from the videos and scripts already in the workspace', () => {
  const have = voice.choices();
  assert.deepStrictEqual(have.videos, ['demo.mp4']);
  assert.deepStrictEqual(have.scripts, ['demo-voiceover-script.md']);
});

test('a timed script is read by section, and a plain transcript as one block', () => {
  const timed = voice.parseScript(TIMED);
  assert.strictEqual(timed.timed, true);
  assert.deepStrictEqual(timed.sections.map((x) => [x.id, x.window, x.chars]), [['S01', 10, 45], ['S02', 10, 23]]);
  const plain = voice.parseScript('- First point.\n2. Second point.\n# A heading\n');
  assert.deepStrictEqual([plain.timed, plain.characters], [false, 'First point. Second point.'.length]);
});

test('a video voiceover is planned from a chosen script, or from pasted text, before anything runs', async () => {
  const found = await engines({ ELEVENLABS_API_KEY: 'testkey' });
  const form = { kind: 'video', engine: 'elevenlabs', el_voice: 'voiceAAAAAAAAAAAAAAAA', video: 'demo.mp4', script_file: 'demo-voiceover-script.md' };
  const p = voice.plan(form, found);
  assert.deepStrictEqual([p.kind, p.file, p.characters, p.parsed.timed], ['video', 'demo-elevenlabs-voice.mp4', 68, true]);
  const line = voice.commandLine(p, null, true);
  assert.match(line, /"-a" "voiceover" "--engine" "elevenlabs" "--script" "[^"]*docs\/demo-voiceover-script\.md" "--video" "[^"]*videos\/demo\.mp4" "--out" "[^"]*videos\/demo-elevenlabs-voice\.mp4"/);
  assert.match(line, /"--confirm"/);
  assert.ok(!/[$`]/.test(line) && !/rm -rf/.test(line), 'a script read in place is never deleted');

  const pasted = voice.plan({ ...form, script_file: '', text: 'One plain sentence.', name: 'My cut' }, found);
  assert.deepStrictEqual([pasted.file, pasted.parsed.timed, pasted.scriptLabel], ['my-cut.mp4', false, 'pasted text']);
  const both = voice.plan({ ...form, text: 'Typed earlier, in text mode.' }, found);
  assert.deepStrictEqual([both.scriptLabel, both.parsed.timed, both.characters], ['demo-voiceover-script.md', true, 68], 'a chosen script wins over typed text');
  assert.match(voice.commandLine(pasted, '/tmp/ws-voice-x/text.txt', true), /"--script" "\/tmp\/ws-voice-x\/text\.txt".*rm -rf "\/tmp\/ws-voice-x"/);

  const err = (f) => voice.plan({ ...form, ...f }, found).error;
  assert.match(err({ video: 'other.mp4' }), /Choose a video/);
  assert.match(err({ script_file: '' }), /Choose a script, or paste one/);
  assert.match(err({ script_file: 'notes.md' }), /Choose a script, or paste one/);
  assert.match(err({ script_file: '', text: '#### only a heading' }), /nothing to say/);
  assert.match(err({ script_file: '', text: 'x'.repeat(voice.MAX_SCRIPT + 1) }), /limit is/);
});

test('the plan shows the sections and the credits, and the spending button asks first', async () => {
  const base = await serve({ ELEVENLABS_API_KEY: 'testkey' });
  const send = (form) => post(base, '/actions/voiceover-plan', { workspace: 'audio', video: 'demo.mp4', script_file: 'demo-voiceover-script.md', ...form });
  const html = await (await send({ engine: 'elevenlabs', el_voice: 'voiceAAAAAAAAAAAAAAAA' })).text();
  assert.match(html, /script <code>demo-voiceover-script\.md<\/code>/);
  assert.match(html, /<td>S01<\/td><td>Opening<\/td>/);
  assert.match(html, /68<\/strong> characters of the 1,000 left on the creator plan/);
  assert.match(html, /arm-step[\s\S]*hx-vals='\{"confirm":"yes"\}'[\s\S]*hx-trigger="confirmed-remove"/);
  const local = await (await send({ engine: 'piper', piper_voice: 'en_US-lessac-high' })).text();
  assert.match(local, /Piper is free/);
  assert.ok(!/arm-step/.test(local));
  assert.strictEqual((await send({ engine: 'piper', piper_voice: 'en_US-lessac-high', video: 'gone.mp4' })).status, 400);
  const form = await (await fetch(`${base}/fragments/audio/new?mode=video`)).text();
  assert.match(form, /<input type="hidden" name="kind" value="video">/);
  assert.match(form, /<option value="demo\.mp4" selected>/);
  assert.match(form, /<option value="demo-voiceover-script\.md">/);
  assert.match(form, /data-plan-button hx-post="\/actions\/voiceover-plan"/);
});

test('Piper speaks a script over a video, and spreads a plain transcript across it', { skip: !hasFfmpeg() }, async () => {
  const bin = path.join(home, 'fakepiper');
  fs.writeFileSync(bin, '#!/usr/bin/env bash\nwhile [ $# -gt 0 ]; do [ "$1" = --output_file ] && out="$2"; shift; done\ncat > /dev/null\nffmpeg -y -loglevel error -f lavfi -i "sine=frequency=440:duration=1.5" "$out"\n', { mode: 0o755 });
  fs.mkdirSync(path.join(home, '.local/share/piper-voices'), { recursive: true });
  fs.writeFileSync(path.join(home, '.local/share/piper-voices/en_US-lessac-high.onnx'), 'x');
  const clip = path.join(root, 'videos/clip.mp4');
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=duration=6:size=160x120:rate=10', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-shortest',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', clip]);
  const transcript = path.join(home, 'transcript.txt');
  fs.writeFileSync(transcript, 'A plain transcript.\nTwo short lines.\n');
  const out = path.join(root, 'videos/clip-voiced.mp4');
  const env = baseEnv({ PIPER_BIN: bin, ELEVENLABS_API_KEY: '' });
  const go = (extra) => run('bash', [path.join(root, 'audio/cmd-tools-voice.sh'), '-a', 'voiceover', '--engine', 'piper', '--script', transcript, '--video', clip, '--out', out,
    '--voice', 'en_US-lessac-high', ...extra], { env }).catch((e) => e);
  const plan = await go([]);
  assert.strictEqual(plan.code, 4, 'without --confirm it only plans');
  assert.ok(!fs.existsSync(out));
  const done = await go(['--confirm']);
  assert.ok(!done.code, String(done.stderr));
  const probe = (await run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type:format=duration', '-of', 'compact', out])).stdout;
  assert.match(probe, /codec_type=video/);
  assert.match(probe, /codec_type=audio/);
  assert.ok(Math.abs(parseFloat(probe.match(/duration=([\d.]+)/)[1]) - 6) < 0.3);
  assert.deepStrictEqual(fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('ws-voice-script-')), [], 'the temporary script is removed');
  const again = await go(['--confirm']);
  assert.notStrictEqual(again.code, undefined, 'an existing output is refused');
});

function hasFfmpeg() {
  try { require('child_process').execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch (_) { return false; }
}


// ---- sounds, music, and what belongs to a generated file ----------------------------------------

const cli = () => path.join(root, 'audio/cmd-tools-voice.sh');
const say = (args, extra) => run('bash', [cli(), ...args], { env: baseEnv({ ELEVENLABS_API_KEY: 'testkey', ...extra }) }).catch((e) => e);

test('a sound is planned first, made only with --confirm, and kept with its text and record', async () => {
  const text = path.join(home, 'sound.txt');
  fs.writeFileSync(text, 'Rain on a tin roof');
  const out = path.join(home, 'rain.mp3');
  const base = ['-a', 'sound', '--text-file', text, '--out', out, '--duration', '4', '--loop'];
  const before = calls.length;
  const plan = await say(base);
  assert.strictEqual(plan.code, 4);
  assert.match(plan.stdout, /Plan only, nothing was sent\./);
  assert.strictEqual(calls.length, before, 'nothing was sent');
  const done = await say([...base, '--confirm']);
  assert.ok(!done.code, String(done.stderr));
  const sent = calls[calls.length - 1];
  assert.strictEqual(sent.url.split('?')[0], '/v1/sound-generation');
  assert.deepStrictEqual(sent.body, { text: 'Rain on a tin roof', prompt_influence: 0.3, duration_seconds: 4, loop: true });
  assert.strictEqual(fs.statSync(out).size, 900);
  assert.strictEqual(fs.readFileSync(path.join(home, 'rain.txt'), 'utf8'), 'Rain on a tin roof\n');
  const record = JSON.parse(fs.readFileSync(path.join(home, 'rain.json'), 'utf8'));
  assert.deepStrictEqual([record.kind, record.engine, record.duration, record.loop, record.file], ['sound', 'elevenlabs', 4, true, 'rain.mp3']);
  assert.match(record.created_utc, /^\d{4}-\d\d-\d\dT/);
  assert.match((await say([...base, '--confirm'])).stderr, /already exists/);
  assert.match((await say(['-a', 'sound', '--text-file', text, '--out', path.join(home, 'x.mp3'), '--duration', '99'])).stderr, /0\.5 to 30/);
});

test('music asks for its length and whether it may have vocals', async () => {
  const text = path.join(home, 'music.txt');
  fs.writeFileSync(text, 'A calm piano loop');
  const out = path.join(home, 'calm.mp3');
  const done = await say(['-a', 'music', '--text-file', text, '--out', out, '--length', '12', '--instrumental', '--confirm']);
  assert.ok(!done.code, String(done.stderr));
  const sent = calls[calls.length - 1];
  assert.strictEqual(sent.url.split('?')[0], '/v1/music');
  assert.deepStrictEqual(sent.body, { prompt: 'A calm piano loop', music_length_ms: 12000, force_instrumental: true });
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(home, 'calm.json'), 'utf8')).instrumental, true);
  assert.match((await say(['-a', 'music', '--text-file', text, '--out', path.join(home, 'y.mp3'), '--length', '1'])).stderr, /3 to 600/);
});

test('a spoken voice also keeps its text and a record beside it', async () => {
  const text = path.join(home, 'voice.txt');
  fs.writeFileSync(text, 'Hello there');
  const out = path.join(home, 'hello.mp3');
  const done = await say(['-a', 'speak', '--engine', 'elevenlabs', '--text-file', text, '--out', out, '--voice', 'voiceAAAAAAAAAAAAAAAA', '--confirm']);
  assert.ok(!done.code, String(done.stderr));
  const record = JSON.parse(fs.readFileSync(path.join(home, 'hello.json'), 'utf8'));
  assert.deepStrictEqual([record.kind, record.engine, record.voice], ['voice', 'elevenlabs', 'voiceAAAAAAAAAAAAAAAA']);
  assert.strictEqual(fs.readFileSync(path.join(home, 'hello.txt'), 'utf8'), 'Hello there\n');
});

test('sounds and music are planned from the form, into audio/sounds', async () => {
  const found = await engines({ ELEVENLABS_API_KEY: 'testkey' });
  const sound = voice.plan({ kind: 'sound', text: 'A door creaks', duration: '3', influence: '0.7', loop: 'yes' }, found);
  assert.deepStrictEqual([sound.kind, sound.duration, sound.influence, sound.loop, sound.file], ['sound', 3, 0.7, true, 'a-door-creaks-sound.mp3']);
  const music = voice.plan({ kind: 'music', text: 'Calm', length: '60', instrumental: 'yes', name: 'Theme' }, found);
  assert.deepStrictEqual([music.kind, music.length, music.instrumental, music.file], ['music', 60, true, 'theme.mp3']);
  const auto = voice.plan({ kind: 'sound', text: 'A bell', duration: 'auto' }, found);
  assert.deepStrictEqual([auto.duration, auto.influence, auto.loop], [null, 0.3, false]);
  assert.match(voice.plan({ kind: 'sound', text: '' }, found).error, /Describe the sound/);
  assert.match(voice.plan({ kind: 'music', text: 'x', length: '2' }, found).error, /3 to 600/);
  assert.match(voice.plan({ kind: 'sound', text: 'x', duration: '60' }, found).error, /0\.5 to 30/);
  assert.match(voice.plan({ kind: 'sound', text: 'x'.repeat(voice.MAX_PROMPT + 1) }, found).error, /at most/);
  assert.match(voice.plan({ kind: 'sound', text: 'A bell' }, await engines({ ELEVENLABS_API_KEY: '' })).error, /not available/);
  const line = voice.commandLine(sound, '/tmp/x/text.txt', true);
  assert.match(line, /"-a" "sound" "--text-file" "[^"]*" "--out" "[^"]*audio\/sounds\/a-door-creaks-sound\.mp3" "--influence" "0\.7" "--duration" "3" "--loop" "--confirm"/);
  assert.ok(!/[$`]/.test(line));
  assert.match(voice.commandLine(music, '/tmp/x/text.txt', true), /"-a" "music"[^]*"--length" "60" "--instrumental" "--confirm"/);
});

test('each action opens its own modal: voice, voice over a video, a sound, music', async () => {
  const base = await serve({ ELEVENLABS_API_KEY: 'testkey' });
  const page = await (await fetch(`${base}/audio`)).text();
  for (const mode of ['voice', 'video', 'sound', 'music']) assert.ok(page.includes(`hx-get="/fragments/audio/new?mode=${mode}"`), mode);
  for (const label of ['Generate voice', 'Voice over a video', 'Generate a sound', 'Generate music']) assert.ok(page.includes(label), label);
  // One stroke down the whole rail: every entry is drawn from the Tabler sprite, one icon per meaning.
  for (const icon of ['microphone', 'video', 'wave-sine', 'music']) assert.ok(page.includes(`tabler-sprite.svg#${icon}"`), `the ${icon} icon`);
  assert.ok(!/uk-icon="icon: tabler:/.test(page.slice(page.indexOf('action-btn'))), 'no Tabler name in a UIkit icon slot');
  for (const mode of ['voice', 'video', 'sound', 'music']) {
    assert.match(page, new RegExp(`hx-get="/fragments/audio/new\\?mode=${mode}" hx-target="#editor-modal-body" hx-swap="innerHTML"`), `${mode} opens in the modal, not in the page`);
  }
  const form = async (mode) => (await fetch(`${base}/fragments/audio/new?mode=${mode}`)).text();
  const voiceForm = await form('voice');
  assert.match(voiceForm, /Generate a voice/);
  assert.match(voiceForm, /<input type="hidden" name="kind" value="text">/);
  assert.ok(!/name="video"|data-plan-button|name="kind" value="video"/.test(voiceForm));
  const videoForm = await form('video');
  assert.match(videoForm, /Voice over a video/);
  assert.match(videoForm, /<input type="hidden" name="kind" value="video">/);
  assert.match(videoForm, /name="video"/);
  assert.match(videoForm, /data-plan-button/);
  assert.match(videoForm, /data-engine-button="piper" data-mode-button="text" hidden/);
  const soundForm = await form('sound');
  assert.match(soundForm, /Generate a sound/);
  assert.match(soundForm, /name="kind" value="sound"/);
  assert.match(soundForm, /name="duration"[\s\S]*name="influence"[\s\S]*name="loop"/);
  assert.match(soundForm, /arm-step[^>]*hx-post="\/actions\/generate-voice"[\s\S]*hx-vals='\{"confirm":"yes"\}'/);
  assert.match(soundForm, /1,000 credits left/);
  const musicForm = await form('music');
  assert.match(musicForm, /name="length"[\s\S]*name="instrumental" value="yes" checked/);
  assert.strictEqual(await form('nonsense').then((h) => /Generate a voice/.test(h)), true, 'an unknown mode is the voice form');
  const bare = await serve({ ELEVENLABS_API_KEY: '' });
  const refused = await (await fetch(`${bare}/fragments/audio/new?mode=sound`)).text();
  assert.match(refused, /Sounds come from ElevenLabs, which is not available/);
  assert.ok(!/arm-step/.test(refused));
});

test('a sound or music request without confirmation is refused', async () => {
  const base = await serve({ ELEVENLABS_API_KEY: 'testkey' });
  const r = await post(base, '/actions/generate-voice', { workspace: 'audio', kind: 'sound', text: 'A bell', engine: 'elevenlabs' });
  assert.strictEqual(r.status, 400);
  assert.match(await r.text(), /needs your confirmation/);
});

// ---- generating inside the modal -----------------------------------------------------------------

const screens = () => path.join(root, '.screens');
function hostSays(sessions) {
  fs.mkdirSync(screens(), { recursive: true });
  fs.writeFileSync(path.join(screens(), 'host-sessions.json'), JSON.stringify({ at: Date.now(), host: 'test', sessions: sessions.map((session) => ({ session })) }));
}
const gen = (base, q) => fetch(`${base}/fragments/audio/generation?${new URLSearchParams(q)}`);

test('the forms keep the work in the modal: their results go to #voice-result', async () => {
  const base = await serve({ ELEVENLABS_API_KEY: 'testkey' });
  for (const mode of ['voice', 'video', 'sound', 'music']) {
    const html = await (await fetch(`${base}/fragments/audio/new?mode=${mode}`)).text();
    assert.ok(html.includes('<div id="voice-result"'), `${mode} has a place for the result`);
    assert.ok(!html.includes('#webship-workspace-output'), `${mode} no longer answers in a toast`);
  }
});

test('while a voice is made the modal says so and asks again; when the file is there it shows it', async () => {
  const base = await serve({ ELEVENLABS_API_KEY: '' });
  const q = { kind: 'text', file: 'modal-test.wav', session: 'audio--modal-test--voice', t0: String(Date.now()), engine: 'piper' };
  hostSays(['audio--modal-test--voice']);
  const running = await (await gen(base, q)).text();
  assert.match(running, /class="voice-progress" hx-get="\/fragments\/audio\/generation\?kind=text&amp;file=modal-test\.wav/);
  assert.match(running, /hx-trigger="load delay:1s" hx-swap="outerHTML"/);
  assert.match(running, /Making <strong>modal-test\.wav<\/strong> with Piper/);
  fs.mkdirSync(path.join(root, '.screens'), { recursive: true });
  fs.writeFileSync(path.join(screens(), 'audio--modal-test--voice.log'), '\x1b[32mloading\x1b[0m the voice\r\nspeaking\n');
  assert.match(await (await gen(base, q)).text(), /<pre class="voice-log">loading the voice\nspeaking<\/pre>/, 'the log, without terminal escapes');
  const dir = path.join(root, 'audio/voices');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'modal-test.wav'), Buffer.alloc(100, 1));
  assert.match(await (await gen(base, q)).text(), /voice-progress/, 'the file alone is not enough while the record is still being written');
  fs.writeFileSync(path.join(dir, 'modal-test.txt'), 'Hello from the modal\n');
  fs.writeFileSync(path.join(dir, 'modal-test.json'), JSON.stringify({ kind: 'voice', engine: 'piper', voice: 'en_GB-cori-high' }));
  const done = await gen(base, q);
  assert.strictEqual(done.headers.get('hx-trigger'), 'refresh-projects', 'the list behind the modal refreshes');
  const html = await done.text();
  assert.match(html, /<strong>modal-test\.wav<\/strong> is ready, in <code>audio\/voices\/<\/code>/);
  assert.match(html, /<audio class="sound-player" controls preload="metadata" src="\/files\/audio\/voices\/modal-test\.wav">/);
  assert.match(html, /Hello from the modal/);
  assert.match(html, /With<\/span> piper/);
  assert.match(html, /hx-get="\/fragments\/audio\/new\?mode=voice" hx-target="#editor-modal-body"/);
  assert.ok(!/voice-progress/.test(html));
});

test('a generation whose session is gone and left no file says why', async () => {
  const base = await serve({ ELEVENLABS_API_KEY: '' });
  const q = { kind: 'sound', file: 'never.mp3', session: 'audio--never--sound', t0: String(Date.now() - 20000), engine: 'elevenlabs' };
  hostSays([]);
  fs.mkdirSync(screens(), { recursive: true });
  fs.writeFileSync(path.join(screens(), 'audio--never--sound.log'), 'Sound generation failed. HTTP 401. ElevenLabs rejected the key.\n');
  const r = await gen(base, q);
  assert.notStrictEqual(r.headers.get('hx-trigger'), 'refresh-projects');
  const html = await r.text();
  assert.match(html, /msg error voice-failed/);
  assert.match(html, /<strong>never\.mp3<\/strong> was not made/);
  assert.match(html, /ElevenLabs rejected the key\./);
  // The session is still listed, or it only just started: not a failure yet.
  hostSays(['audio--never--sound']);
  assert.match(await (await gen(base, q)).text(), /voice-progress/);
  hostSays([]);
  assert.match(await (await gen(base, { ...q, t0: String(Date.now()) })).text(), /voice-progress/, 'a grace period before it is called failed');
});

test('what the modal asks for is checked: a kind, a plain file name, a session name', async () => {
  const base = await serve({ ELEVENLABS_API_KEY: '' });
  const ok = { kind: 'text', file: 'a.wav', session: 'audio--a--voice', t0: String(Date.now()), engine: 'piper' };
  hostSays(['audio--a--voice']);
  assert.strictEqual((await gen(base, ok)).status, 200);
  for (const bad of [{ kind: 'dir' }, { kind: 'text', file: '../secret.wav' }, { file: 'a/b.wav' }, { file: '.hidden.wav' }, { session: 'Audio--A' }, { session: '../x' }, { file: '' }]) {
    assert.strictEqual((await gen(base, { ...ok, ...bad })).status, 400, JSON.stringify(bad));
  }
});

test('pressing Generate answers with the progress, once the host runner has started the session', async () => {
  fs.mkdirSync(path.join(screens(), 'queue'), { recursive: true });
  fs.mkdirSync(path.join(screens(), 'results'), { recursive: true });
  const asked = [];
  const runner = setInterval(() => {
    hostSays([]);
    for (const f of fs.readdirSync(path.join(screens(), 'queue'))) {
      if (!f.endsWith('.json')) continue;
      const req = JSON.parse(fs.readFileSync(path.join(screens(), 'queue', f), 'utf8'));
      fs.unlinkSync(path.join(screens(), 'queue', f));
      asked.push(req);
      fs.writeFileSync(path.join(screens(), 'results', `${req.id}.json`), JSON.stringify({ ok: true }));
    }
  }, 80);
  try {
    const base = await serve({ ELEVENLABS_API_KEY: '' });
    const found = await engines({ ELEVENLABS_API_KEY: '' });
    const piper = found[0].voices[0].id;
    const r = await post(base, '/actions/generate-voice', { workspace: 'audio', kind: 'text', engine: 'piper', piper_voice: piper, text: 'Hello from a test', name: 'press-test' });
    assert.strictEqual(r.status, 200);
    const html = await r.text();
    assert.match(html, /class="voice-progress" hx-get="\/fragments\/audio\/generation\?kind=text&amp;file=press-test\.wav&amp;session=audio--press-test--voice&amp;t0=\d+&amp;engine=piper&amp;edit="/);
    assert.match(html, /Making <strong>press-test\.wav<\/strong> with Piper/);
    assert.strictEqual(asked.length, 1);
    assert.match(asked[0].cmd, /"-a" "speak" "--engine" "piper"/);
    assert.ok(!/<div class="msg/.test(html), 'a progress card, not a toast');
  } finally { clearInterval(runner); }
});

test('the tests run on placeholder ElevenLabs settings, whatever the machine\'s own settings.yml holds', () => {
  const { withoutElevenlabs, PLACEHOLDERS } = require('./_isolated-config');
  const machine = '# settings\nworkspaces:\n  - dev\nelevenlabs:\n  api_key: sk_realkey\n  voice: Brian\n  model: eleven_multilingual_v2\n\nstyle:\n  mode: light\n';
  const clean = withoutElevenlabs(machine);
  assert.ok(!/sk_realkey|Brian|multilingual/.test(clean), 'the machine\'s values are gone');
  assert.match(clean, /workspaces:\n {2}- dev\n/);
  assert.match(clean, /style:\n {2}mode: light/, 'what follows the block is kept');
  const used = fs.readFileSync(path.join(root, 'core/config/settings.yml'), 'utf8');
  assert.ok(used.includes(PLACEHOLDERS), 'the copy the tests use carries the placeholders');
  assert.ok(!/api_key: sk_/.test(used.slice(used.indexOf('elevenlabs:'))), 'and no key');
});
