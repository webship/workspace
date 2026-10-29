/**
 * Who the avatar can be and which voices it speaks in (assistant-cast.js). What must never drift: only
 * the avatars settings.yml names are offered, a model is only ever served from inside the avatars
 * workspace, the ElevenLabs key stays a placeholder until a real one is set, and a sentence already
 * spoken is never paid for twice.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { avatarCast, findAvatar, elevenKey, elevenSpeak, elevenVoices } = require('../../assistant-cast');
const { assistantSettings, workspaceLanguage } = require('../../speech');

function tree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cast-'));
  const p = path.join(root, 'avatars', 'scratch');
  fs.mkdirSync(path.join(p, 'characters'), { recursive: true });
  fs.mkdirSync(path.join(p, 'public', 'models'), { recursive: true });
  fs.writeFileSync(path.join(p, 'public', 'models', 'osa-coffee.vrm'), 'glTF');
  fs.writeFileSync(path.join(p, 'public', 'models', 'labiba-meme.vrm'), 'glTF');
  fs.writeFileSync(path.join(p, 'characters', 'osa-coffee.json'), JSON.stringify({ name: 'Coffee', model: '/models/osa-coffee.vrm', credit: 'Coffee by Polygonal-Mind. CC0.' }));
  fs.writeFileSync(path.join(p, 'characters', 'escape.json'), JSON.stringify({ name: 'Out', model: '/models/../../../../etc/passwd' }));
  fs.writeFileSync(path.join(root, 'secret.vrm'), 'no');
  fs.symlinkSync(path.join(root, 'secret.vrm'), path.join(p, 'public', 'models', 'linked.vrm'));
  return root;
}

test('only the avatars settings.yml names are offered, each found in the avatars workspace', () => {
  const root = tree();
  const cast = avatarCast({ assistant: { avatars: ['druplicon', 'coffee', 'labiba-meme', 'missing', '../x', 'escape', 'linked'] } }, root);
  assert.deepStrictEqual(cast.map((a) => a.id), ['druplicon', 'coffee', 'labiba-meme']);
  assert.strictEqual(cast[1].name, 'Coffee');
  assert.match(cast[1].credit, /CC0/);
  assert.match(cast[1].model, /^\/avatar\/model\/coffee\.vrm\?v=[0-9a-z]+$/, 'the link carries the file time, so a rebuilt model is fetched');
  assert.ok(cast[2].credit, 'a bare model still says where its licence is');
  assert.strictEqual(findAvatar('linked', root), null, 'a link out of the avatars workspace is never served');
  assert.deepStrictEqual(avatarCast({}, root).map((a) => a.id), ['druplicon'], 'the built-in one by default');
  assert.ok(fs.existsSync(path.join(__dirname, '../../public/avatar/druplicon.vrm')), 'Druplicon ships with the dashboard');
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

test("an avatar's own moves exist, and the set is for work: no headscarf, nothing meant for children", async () => {
  const { AVATAR_MOVE_SETS } = require('../../assistant');
  const src = fs.readFileSync(path.join(__dirname, '../../public/assistant-avatar-moves.js'), 'utf8');
  const defined = [...src.matchAll(/^ {4}([a-z]+): \{$/gm)].map((m) => m[1]);
  for (const m of Object.keys(AVATAR_MOVE_SETS.labiba)) assert.ok(defined.includes(m), `[${m}] is offered but Labiba has no such move`);
  for (const m of ['hijab', 'kiss', 'hug', 'dab', 'peekaboo', 'love']) assert.ok(!defined.includes(m), `${m} is not a move for work`);
  assert.strictEqual(require('../../assistant-cast').moveSetOf('labiba-meme'), 'labiba');
  assert.strictEqual(require('../../assistant-cast').moveSetOf('druplicon'), '', 'Druplicon has the shared moves and no set of its own');
  for (const [set, moves] of Object.entries(AVATAR_MOVE_SETS)) {
    for (const m of Object.keys(moves)) assert.ok(defined.includes(m), `[${m}] is offered but the ${set} set has no such move`);
  }
});

test('hair colours and agents come from settings, checked', () => {
  const { hairOf, agentOf } = require('../../assistant-cast');
  assert.strictEqual(hairOf({ assistant: { avatar_hair: { 'labiba-meme': '"#0074E0"' } } }, 'labiba-meme'), '#0074e0');
  assert.strictEqual(hairOf({ assistant: { avatar_hair: { x: 'url(evil)' } } }, 'x'), '');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'home-'));
  fs.mkdirSync(path.join(home, '.claude', 'agents'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'agents', 'avatar-druplicon.md'), '---\nname: avatar-druplicon\n---\n');
  const s = { assistant: { avatar_agents: { druplicon: 'avatar-druplicon', coffee: 'not-installed', bot: '../../etc' } } };
  assert.strictEqual(agentOf(s, 'druplicon', home), 'avatar-druplicon');
  assert.strictEqual(agentOf(s, 'coffee', home), '', 'an agent that is not installed is not used');
  assert.strictEqual(agentOf(s, 'bot', home), '');
});
