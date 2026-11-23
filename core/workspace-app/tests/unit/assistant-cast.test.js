/**
 * Who the avatar can be and which voices it speaks in (assistant-cast.js). What must never drift: the
 * avatars offered are the ones settings.yml names and the characters found in the avatars workspace, a
 * model is only ever served from inside its own avatar project, nothing about a character is written in
 * the dashboard, the ElevenLabs key stays a placeholder until a real one is set, and a sentence already
 * spoken is never paid for twice.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { avatarCast, avatarMind, discoverAvatars, findAvatar, ownMovesOf, voiceOf, serveAvatarMoves, elevenKey, elevenSpeak, elevenVoices } = require('../../assistant-cast');
const { assistantSettings, workspaceLanguage } = require('../../speech.mts');

function tree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cast-'));
  const p = path.join(root, 'avatars', 'scratch');
  fs.mkdirSync(path.join(p, 'characters'), { recursive: true });
  fs.mkdirSync(path.join(p, 'public', 'models'), { recursive: true });
  fs.writeFileSync(path.join(p, 'public', 'models', 'osa-coffee.vrm'), 'glTF');
  fs.writeFileSync(path.join(p, 'public', 'models', 'mascot.vrm'), 'glTF');
  fs.writeFileSync(path.join(p, 'characters', 'osa-coffee.json'), JSON.stringify({ name: 'Coffee', model: '/models/osa-coffee.vrm', credit: 'Coffee by Polygonal-Mind. CC0.' }));
  fs.writeFileSync(path.join(p, 'characters', 'escape.json'), JSON.stringify({ name: 'Out', model: '/models/../../../../etc/passwd' }));
  fs.writeFileSync(path.join(root, 'secret.vrm'), 'no');
  fs.symlinkSync(path.join(root, 'secret.vrm'), path.join(p, 'public', 'models', 'linked.vrm'));
  return root;
}

test('the avatars settings.yml names are offered first, each found in the avatars workspace', () => {
  const root = tree();
  const settings = { assistant: { avatars_discover: false, avatars: ['druplicon', 'coffee', 'mascot', 'missing', '../x', 'escape', 'linked'] } };
  const cast = avatarCast(settings, root);
  assert.deepStrictEqual(cast.map((a) => a.id), ['druplicon', 'coffee', 'mascot']);
  assert.strictEqual(cast[1].name, 'Coffee');
  assert.match(cast[1].credit, /CC0/);
  assert.match(cast[1].model, /^\/avatar\/model\/coffee\.vrm\?v=[0-9a-z]+$/, 'the link carries the file time, so a rebuilt model is fetched');
  assert.ok(cast[2].credit, 'a bare model still says where its licence is');
  assert.strictEqual(findAvatar('linked', root), null, 'a link out of its avatar project is never served');
  assert.deepStrictEqual(avatarCast({ assistant: { avatars_discover: false } }, root).map((a) => a.id), ['druplicon'], 'the built-in one by default');
  assert.ok(fs.existsSync(path.join(__dirname, '../../public/avatar/druplicon.vrm')), 'Druplicon ships with the dashboard');
});

/** An avatar project with two characters: one with moves, an agent and voices of its own, one plain. */
function project(root, name = 'my-avatar') {
  const p = path.join(root, 'avatars', name);
  fs.mkdirSync(path.join(p, 'characters'), { recursive: true });
  fs.mkdirSync(path.join(p, 'public', 'models'), { recursive: true });
  for (const m of ['ada', 'plain']) fs.writeFileSync(path.join(p, 'public', 'models', `${m}.vrm`), 'glTF');
  fs.writeFileSync(path.join(p, 'characters', 'ada.json'), JSON.stringify({
    id: 'ada', name: 'Ada', model: '/models/ada.vrm', credit: 'Ada, a free model. CC0.', agent: 'avatar-ada', moves: 'guide',
    voice: { engine: 'elevenlabs', voice: 'PAIDVOICEID0123456789' }, fallback: { engine: 'piper', voice: 'en_GB-alba-medium' },
  }));
  fs.writeFileSync(path.join(p, 'characters', 'plain.json'), JSON.stringify({ name: 'Plain', model: '/models/plain.vrm' }));
  fs.writeFileSync(path.join(p, 'characters', 'broken.json'), '{ not json');
  fs.writeFileSync(path.join(p, 'characters', 'nomodel.json'), JSON.stringify({ name: 'No model', model: '/models/gone.vrm' }));
  fs.writeFileSync(path.join(p, 'public', 'custom-moves.js'), '// moves of its own\nexport default {\n  twirl: { duration: 2, pose(t, p, o, h) { p.add(\'spine\', 0, Math.sin(t * Math.PI * 2) * h.ease(t), 0); } },\n};\n');
  fs.writeFileSync(path.join(p, 'public', 'custom-moves.json'), JSON.stringify({ version: 3, moves: [
    { name: 'twirl', en: 'Twirl', when: 'a happy turn on the spot' }, { name: 'Bad Name', when: 'x' }, { name: 'nod', en: 'A nod `with` <marks>' },
  ] }));
  return p;
}

test('every character found in the avatar projects is offered after the named ones, with what its own files say', () => {
  const root = tree();
  project(root);
  assert.deepStrictEqual(discoverAvatars(root), ['ada', 'plain', 'osa-coffee'], 'by project, then by file; a broken file and one without its model are left out');
  const cast = avatarCast({ assistant: { avatars: ['druplicon', 'coffee'] } }, root);
  assert.deepStrictEqual(cast.map((a) => a.id), ['druplicon', 'coffee', 'ada', 'plain', 'osa-coffee']);
  const ada = cast[2];
  assert.strictEqual(ada.name, 'Ada');
  assert.strictEqual(ada.moves, 'guide', 'the set its character file names');
  assert.match(ada.ownMoves, /^\/avatar\/moves\/ada\.js\?v=[0-9a-z]+$/, 'and the moves its project brings');
  assert.strictEqual(ada.voice, 'en_GB-alba-medium', 'its free local voice');
  assert.ok(!JSON.stringify(cast).includes('PAIDVOICEID'), 'a paid voice in a character file never reaches the page');
  assert.ok(!JSON.stringify(cast).includes(root), 'nor does a path of this machine');
  assert.strictEqual(cast[3].moves, '');
  assert.deepStrictEqual(avatarCast({ assistant: { avatars_discover: false } }, root).map((a) => a.id), ['druplicon'], 'the switch turns the finding off');
  assert.deepStrictEqual(avatarCast({ assistant: { avatars_discover: 'false' } }, root).map((a) => a.id), ['druplicon'], 'as a string too: bash reads the file');
  // settings.yml wins over the character file.
  assert.strictEqual(avatarCast({ assistant: { avatar_moves: { ada: 'clock', plain: 'guide' } } }, root).find((a) => a.id === 'ada').moves, 'clock');
  assert.strictEqual(avatarCast({ assistant: { avatar_moves: { plain: '../x' } } }, root).find((a) => a.id === 'plain').moves, '');
});

test('an avatar project that is a link the owner made is read where it is, and a model still may not leave its project', () => {
  const root = tree();
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'elsewhere-'));
  const real = project(elsewhere, 'kept-elsewhere');
  fs.mkdirSync(path.join(root, 'avatars'), { recursive: true });
  fs.symlinkSync(real, path.join(root, 'avatars', 'linked-project'));
  assert.ok(discoverAvatars(root).includes('ada'));
  assert.strictEqual(findAvatar('ada', root).project, 'linked-project');
  fs.writeFileSync(path.join(elsewhere, 'outside.vrm'), 'no');
  fs.symlinkSync(path.join(elsewhere, 'outside.vrm'), path.join(real, 'public', 'models', 'sneak.vrm'));
  fs.writeFileSync(path.join(real, 'characters', 'sneak.json'), JSON.stringify({ model: '/models/sneak.vrm' }));
  assert.strictEqual(findAvatar('sneak', root), null);
  assert.ok(!discoverAvatars(root).includes('sneak'));
});

test('the moves a project brings are checked before they are served: arithmetic only, small, inside the project', () => {
  const root = tree();
  const p = project(root);
  const own = ownMovesOf(findAvatar('ada', root));
  assert.deepStrictEqual(own.moves, { twirl: 'a happy turn on the spot', nod: 'A nod with marks' }, 'what each is for, as plain words; a bad name is left out');
  const served = (id) => { const out = {}; const res = { writeHead(s, h) { out.status = s; out.type = h && h['Content-Type']; }, end() {}, on() {}, once() {}, emit() {}, write() {} }; serveAvatarMoves(res, id, {}, root); return out; };
  assert.strictEqual(served('ada').status, 200);
  assert.match(served('ada').type, /^text\/javascript/);
  assert.strictEqual(served('plain').status, 200, 'the moves are the project\'s: every character of it has them');
  assert.strictEqual(served('coffee').status, 404, 'a project without the file brings none');
  assert.strictEqual(served('nobody').status, 404);
  const file = path.join(p, 'public', 'custom-moves.js');
  const good = fs.readFileSync(file, 'utf8');
  for (const bad of ['fetch("/x")', 'document.title', 'window.x = 1', 'import("x")', 'eval("1")', 'new Function("x")', 'localStorage.x', 'setTimeout(() => 0)', 'p.constructor', 'location.href', 'navigator.userAgent']) {
    fs.writeFileSync(file, `${good}\nconst x = () => ${bad};\n`);
    assert.strictEqual(ownMovesOf(findAvatar('ada', root)), null, `${bad} is refused`);
  }
  fs.writeFileSync(file, `${good}\n// fetch and document in a comment are words, not code\n`);
  assert.ok(ownMovesOf(findAvatar('ada', root)));
  fs.writeFileSync(file, 'const moves = {};\n');
  assert.strictEqual(ownMovesOf(findAvatar('ada', root)), null, 'not a module of moves');
  fs.writeFileSync(file, `${good}\n// ${'x'.repeat(61 * 1024)}\n`);
  assert.strictEqual(ownMovesOf(findAvatar('ada', root)), null, 'too large');
  assert.strictEqual(avatarCast({}, root).find((a) => a.id === 'ada').ownMoves, undefined, 'and then the page is not given the link');
  // The page adds them under their own names, never in place of a move that is there, and hands them the helpers.
  const page = fs.readFileSync(path.join(__dirname, '../../public/assistant-avatar.js'), 'utf8');
  assert.match(page, /if \(!\/\^\[a-z\]\{2,24\}\$\/\.test\(name\) \|\| gestures\[name\] \|\| !def \|\| typeof def\.pose !== 'function'\) continue;/);
  assert.match(page, /const helpers = \{ ease, envelope, reach: \(\) => \{\} \};/);
});

test('what the assistant is told about an avatar: its set, the moves its project brings, and its agent when installed', () => {
  const root = tree();
  project(root);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'home-'));
  fs.mkdirSync(path.join(home, '.claude', 'agents'), { recursive: true });
  assert.deepStrictEqual(avatarMind({}, root, 'ada', home), { moves: 'guide', ownMoves: { twirl: 'a happy turn on the spot', nod: 'A nod with marks' }, agent: '' }, 'an agent that is not installed is not used');
  fs.writeFileSync(path.join(home, '.claude', 'agents', 'avatar-ada.md'), '---\nname: avatar-ada\n---\n');
  assert.strictEqual(avatarMind({}, root, 'ada', home).agent, 'avatar-ada', 'the agent its character file names');
  assert.strictEqual(avatarMind({ assistant: { avatar_agents: { ada: 'missing' } } }, root, 'ada', home).agent, '', 'settings.yml wins');
  assert.deepStrictEqual(avatarMind({}, root, 'druplicon', home), { moves: '', ownMoves: {}, agent: '' });
  assert.deepStrictEqual(avatarMind({ assistant: { avatars_discover: false } }, root, 'ada', home), { moves: '', ownMoves: {}, agent: '' }, 'an avatar that is not offered brings nothing');
  assert.strictEqual(voiceOf({ voice: { engine: 'piper', voice: 'xx_XX-other-medium' } }), '', 'English only');
  assert.strictEqual(voiceOf({ voice: { engine: 'piper', voice: '../../x' } }), '');
  assert.strictEqual(voiceOf(null), '');
});

test('nothing about a particular character is written in the dashboard: its name, moves and mind come from its project', () => {
  const app = path.join(__dirname, '../..');
  // The sets of moves and the cast name no project of anyone's: a set is described by the build it suits.
  for (const f of ['assistant-cast.js', 'assistant.js', 'src/browser/assistant-avatar-moves.ts', 'public/assistant-avatar-moves.js']) {
    assert.ok(!/github\.com\//i.test(fs.readFileSync(path.join(app, f), 'utf8')), `${f} links to no repository`);
  }
  const cast = fs.readFileSync(path.join(app, 'assistant-cast.js'), 'utf8');
  assert.ok(!/moveSetOf = \(id\)/.test(cast), 'a set of moves is never chosen by an avatar\'s name');
  assert.deepStrictEqual(Object.keys(require('../../assistant-cast').BUILT_IN), ['druplicon'], 'Druplicon is the one avatar that ships');
});

test('the avatar it starts as is one of the list, or none', () => {
  assert.strictEqual(assistantSettings({ assistant: { avatar: 'coffee', avatars: ['druplicon', 'coffee'] } }).avatar, 'coffee');
  assert.strictEqual(assistantSettings({ assistant: { avatar: 'coffee' } }).avatar, 'druplicon', 'Druplicon when the one named is not listed');
  assert.strictEqual(assistantSettings({ assistant: { avatar: 'none', avatars: ['coffee'] } }).avatar, 'none');
});

test('the Workspace language sets the voice and the microphone unless they are pinned', () => {
  assert.strictEqual(workspaceLanguage({ language: 'ar-JO' }), 'ar-JO');
  assert.strictEqual(workspaceLanguage({ language: 'klingon' }), 'en-US');
  assert.strictEqual(assistantSettings({ language: 'ar-JO' }).speechLanguage, 'ar-JO');
  assert.strictEqual(assistantSettings({ language: 'ar-JO', assistant: { speech_language: 'en-GB' } }).speechLanguage, 'en-GB');
});

test('ElevenLabs stays off until a real key is set, and the key never reaches the page', async () => {
  assert.strictEqual(elevenKey({ elevenlabs: { api_key: 'sk-change-this' } }), '');
  assert.strictEqual(elevenKey({ elevenlabs: { api_key: 'CHANGE_ME' } }), '');
  assert.deepStrictEqual(await elevenVoices({}), { connected: false, voices: [] });
  const ui = fs.readFileSync(path.join(__dirname, '../../public/assistant-avatar-ui.js'), 'utf8');
  assert.ok(!/xi-api-key|api_key/.test(ui), 'the page only posts words to /actions/assistant/speak');
});

test('a sentence already spoken is played from the cache, never paid for twice', async () => {
  const settings = { elevenlabs: { api_key: 'a'.repeat(32) } };
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-'));
  let calls = 0;
  const fetchImpl = async (url, opts) => {
    calls += 1;
    assert.match(url, /\/v1\/text-to-speech\/EXAVITQu4vr4xnSDxMaL\?/);
    assert.strictEqual(opts.headers['xi-api-key'], 'a'.repeat(32));
    return { ok: true, status: 200, arrayBuffer: async () => Buffer.from('mp3') };
  };
  const ask = { voice: 'EXAVITQu4vr4xnSDxMaL', text: 'Hello team.' };
  assert.strictEqual(String(await elevenSpeak(settings, ask, { fetchImpl, cacheDir })), 'mp3');
  assert.strictEqual(String(await elevenSpeak(settings, ask, { fetchImpl, cacheDir })), 'mp3');
  assert.strictEqual(calls, 1);
  await assert.rejects(elevenSpeak(settings, { voice: '../v1/user', text: 'x' }, { fetchImpl, cacheDir }), /voice/);
});

test('the sets of moves exist, and the guide set is for work: nothing worn, nothing meant for children', async () => {
  const { AVATAR_MOVE_SETS } = require('../../assistant');
  const { moveSetOf } = require('../../assistant-cast');
  // The source, as written (src/browser/assistant-avatar-moves.ts, built into public/ by npm run build:browser).
  const src = fs.readFileSync(path.join(__dirname, '../../src/browser/assistant-avatar-moves.ts'), 'utf8');
  const defined = [...src.matchAll(/^ {4}([a-z]+): \{$/gm)].map((m) => m[1]);
  assert.deepStrictEqual(Object.keys(AVATAR_MOVE_SETS).sort(), ['clock', 'guide']);
  for (const m of ['kiss', 'hug', 'dab', 'peekaboo', 'love']) assert.ok(!defined.includes(m), `${m} is not a move for work`);
  assert.strictEqual(moveSetOf({ assistant: { avatar_moves: { mascot: 'guide' } } }, 'mascot'), 'guide', 'settings.yml gives an avatar a set');
  assert.strictEqual(moveSetOf({}, 'mascot', { moves: 'guide' }), 'guide', 'or its character file does');
  assert.strictEqual(moveSetOf({}, 'mascot'), '', 'never its name');
  assert.strictEqual(moveSetOf({}, 'druplicon'), '', 'Druplicon has the shared moves and no set of its own');
  for (const [set, moves] of Object.entries(AVATAR_MOVE_SETS)) {
    for (const m of Object.keys(moves)) assert.ok(defined.includes(m), `[${m}] is offered but the ${set} set has no such move`);
  }
});

test('hair colours and agents come from settings, checked', () => {
  const { hairOf, agentOf } = require('../../assistant-cast');
  assert.strictEqual(hairOf({ assistant: { avatar_hair: { mascot: '"#0074E0"' } } }, 'mascot'), '#0074e0');
  assert.strictEqual(hairOf({ assistant: { avatar_hair: { x: 'url(evil)' } } }, 'x'), '');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'home-'));
  fs.mkdirSync(path.join(home, '.claude', 'agents'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'agents', 'avatar-druplicon.md'), '---\nname: avatar-druplicon\n---\n');
  const s = { assistant: { avatar_agents: { druplicon: 'avatar-druplicon', coffee: 'not-installed', bot: '../../etc' } } };
  assert.strictEqual(agentOf(s, 'druplicon', home), 'avatar-druplicon');
  assert.strictEqual(agentOf(s, 'coffee', home), '', 'an agent that is not installed is not used');
  assert.strictEqual(agentOf(s, 'bot', home), '');
});
