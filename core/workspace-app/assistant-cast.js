/**
 * Who the assistant's avatar can be, and which voices it can speak in.
 *
 * Avatars. Only the ones named in settings.yml `assistant.avatars:` are offered, so a machine shows
 * what its owner chose and nothing else. `druplicon` ships with the dashboard; any other name is looked
 * up in the avatars workspace (`<root>/avatars/<project>/`): a character file there
 * (`characters/<name>.json` or `characters/osa-<name>.json`) gives its model, display name and credit,
 * and a bare model (`public/models/<name>.vrm`) is enough on its own. The models stay where they are and
 * are served from there, never copied into this repository: their licences are their own, and some
 * (fan-made ones) are for personal use only.
 *
 * Voices. Besides the browser's own voices, the ElevenLabs voices of the account in settings.yml
 * `elevenlabs:`, once a real key is there. Listing them is free; speaking with one spends credits, which
 * is why it happens only when someone picks an ElevenLabs voice. The key never leaves this server: the
 * page posts the words and gets the audio back. What was spoken is kept in `.voice-cache/`, so a
 * sentence heard again costs nothing.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_MODEL = 'eleven_multilingual_v2';
const CACHE_DIR = path.join(__dirname, '.voice-cache');
const CACHE_MAX = 400;
const MAX_TEXT = 600;
const BASES = {
  us: 'https://api.us.elevenlabs.io',
  eu: 'https://api.eu.residency.elevenlabs.io',
  in: 'https://api.in.residency.elevenlabs.io',
  sg: 'https://api.sg.residency.elevenlabs.io',
};

const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,62}$/;
// The avatars that ship with the dashboard, in public/avatar/.
const BUILT_IN = {
  druplicon: { name: 'Druplicon', model: '/avatar/druplicon.vrm',
    credit: 'Druplicon, the Drupal drop, built in code. Druplicon is licensed under the GPL; Drupal is a registered trademark of Dries Buytaert.' },
};
const titleOf = (id) => id.replace(/^osa-/, '').split(/[-_]/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

/** The set of moves an avatar does beyond the shared ones (public/assistant-avatar-moves.js), or ''. */
const moveSetOf = (id) => (/^labiba/.test(String(id || '')) ? 'labiba' : '');

/** The hair colour an avatar starts with (settings.yml assistant.avatar_hair.<id>), as #rrggbb, or ''. */
function hairOf(settings, id) {
  const v = String(((settings.assistant || {}).avatar_hair || {})[id] || '').trim().replace(/^['"]|['"]$/g, '');
  return /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : '';
}

/**
 * The Claude Code agent an avatar brings (settings.yml assistant.avatar_agents.<id>), when it is
 * installed for this user; '' keeps the assistant's own agent.
 */
function agentOf(settings, id, home = process.env.HOME || '') {
  const name = String(((settings.assistant || {}).avatar_agents || {})[id] || '').trim();
  return /^[a-z0-9][a-z0-9-]{0,62}$/.test(name) && fs.existsSync(path.join(home, '.claude', 'agents', `${name}.md`)) ? name : '';
}

/** The avatars settings.yml names, with what the page needs to show each one. Unknown names are left out. */
function avatarCast(settings = {}, root = '') {
  const a = settings.assistant || {};
  const named = Array.isArray(a.avatars) && a.avatars.length ? a.avatars : ['druplicon'];
  const out = [];
  for (const raw of named) {
    const id = String(raw || '').trim().toLowerCase();
    if (!NAME_RE.test(id) || id === 'none' || out.some((x) => x.id === id)) continue;
    const more = { moves: moveSetOf(id), hair: hairOf(settings, id) };
    // The model's link carries its file's time, so a rebuilt model is fetched at once rather than after
    // the hour a browser may keep it.
    if (BUILT_IN[id]) { out.push({ id, ...BUILT_IN[id], model: `${BUILT_IN[id].model}?v=${stamp(path.join(__dirname, 'public', BUILT_IN[id].model))}`, ...more }); continue; }
    const found = findAvatar(id, root);
    if (found) out.push({ id, name: found.name, model: `/avatar/model/${id}.vrm?v=${stamp(found.file)}`, credit: found.credit, ...more });
  }
  return out;
}

const stamp = (file) => { try { return Math.round(fs.statSync(file).mtimeMs).toString(36); } catch (_) { return '0'; } };

/** The model file of an avatar, inside `<root>/avatars`, or null. */
function findAvatar(id, root) {
  if (!NAME_RE.test(id) || !root) return null;
  const base = path.join(root, 'avatars');
  let projects = [];
  try { projects = fs.readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name).sort(); } catch (_) { return null; }
  const inside = (file) => {
    try {
      const real = fs.realpathSync(file);
      return real.startsWith(fs.realpathSync(base) + path.sep) && /\.vrm$/i.test(real) && fs.statSync(real).isFile() ? real : null;
    } catch (_) { return null; }
  };
  for (const p of projects) {
    for (const stem of [id, `osa-${id}`]) {
      let c = null;
      try { c = JSON.parse(fs.readFileSync(path.join(base, p, 'characters', `${stem}.json`), 'utf8')); } catch (_) { continue; }
      const rel = String((c && c.model) || '').replace(/^\/+/, '');
      if (!/^models\/[\w.-]+\.vrm$/i.test(rel)) continue;
      const file = inside(path.join(base, p, 'public', rel));
      if (file) return { file, name: String(c.name || titleOf(id)).slice(0, 40), credit: String(c.credit || '').slice(0, 400) };
    }
  }
  for (const p of projects) {
    for (const stem of [id, `osa-${id}`]) {
      const file = inside(path.join(base, p, 'public', 'models', `${stem}.vrm`));
      if (file) return { file, name: titleOf(id), credit: `From the ${p} avatar project; its README states the model's licence.` };
    }
  }
  return null;
}

/** GET /avatar/model/<id>.vrm: only a model of an avatar settings.yml names. */
function serveAvatarModel(res, id, settings, root) {
  const listed = avatarCast(settings, root).some((a) => a.id === id && !BUILT_IN[a.id]);
  const found = listed ? findAvatar(id, root) : null;
  if (!found) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('No such avatar.'); }
  res.writeHead(200, { 'Content-Type': 'model/gltf-binary', 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' });
  fs.createReadStream(found.file).pipe(res);
}

// ---- ElevenLabs ----------------------------------------------------------------------------------

/** The account's key from settings.yml, or '' while it is a placeholder or missing. */
function elevenKey(settings = {}) {
  const k = String((settings.elevenlabs && settings.elevenlabs.api_key) || '').trim();
  return /^[A-Za-z0-9_.-]{20,}$/.test(k) && !/change/i.test(k) ? k : '';
}
const elevenBase = (settings = {}) => process.env.ELEVENLABS_API_BASE
  || BASES[String((settings.elevenlabs && settings.elevenlabs.region) || '').toLowerCase()] || 'https://api.elevenlabs.io';

let voicesMemo = { at: 0, sig: '', list: null };

/** The account's voices, `{ id, name, label }`, kept ten minutes. Free: it lists, it does not speak. */
async function elevenVoices(settings = {}, { fetchImpl = fetch } = {}) {
  const key = elevenKey(settings);
  if (!key) return { connected: false, voices: [] };
  const sig = crypto.createHash('sha256').update(key + elevenBase(settings)).digest('hex');
  if (voicesMemo.sig === sig && voicesMemo.list && Date.now() - voicesMemo.at < 600000) return { connected: true, voices: voicesMemo.list };
  const r = await fetchImpl(`${elevenBase(settings)}/v2/voices?page_size=100`, { headers: { 'xi-api-key': key }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) return { connected: true, voices: [], error: r.status === 401 ? 'ElevenLabs rejected the key.' : `ElevenLabs answered ${r.status}.` };
  const body = await r.json();
  const list = (body.voices || []).filter((v) => /^[A-Za-z0-9]{16,32}$/.test(String(v.voice_id || ''))).map((v) => {
    const l = v.labels || {};
    return { id: v.voice_id, name: String(v.name || v.voice_id).slice(0, 60), label: [l.accent, l.gender, l.age].filter(Boolean).join(', ').slice(0, 60) };
  });
  voicesMemo = { at: Date.now(), sig, list };
  return { connected: true, voices: list };
}

/** The audio of `text` in an ElevenLabs voice, as an mp3 Buffer; from the cache when it was spoken before. */
async function elevenSpeak(settings = {}, { voice, text }, { fetchImpl = fetch, cacheDir = CACHE_DIR } = {}) {
  const key = elevenKey(settings);
  if (!key) throw Object.assign(new Error('ElevenLabs is not connected.'), { status: 409 });
  const id = String(voice || '');
  const words = String(text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
  if (!/^[A-Za-z0-9]{16,32}$/.test(id) || !words) throw Object.assign(new Error('A voice and some words, please.'), { status: 400 });
  const model = String((settings.elevenlabs && (settings.elevenlabs.model_id || settings.elevenlabs.model)) || DEFAULT_MODEL).replace(/[^\w.-]/g, '') || DEFAULT_MODEL;
  const file = path.join(cacheDir, `${crypto.createHash('sha256').update(`${id}\n${model}\n${words}`).digest('hex')}.mp3`);
  try { return fs.readFileSync(file); } catch (_) { /* not spoken yet */ }
  const r = await fetchImpl(`${elevenBase(settings)}/v1/text-to-speech/${id}?output_format=mp3_44100_128`, {
    method: 'POST', signal: AbortSignal.timeout(30000),
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({ text: words, model_id: model }),
  });
  if (!r.ok) throw Object.assign(new Error(r.status === 401 ? 'ElevenLabs rejected the key.' : `ElevenLabs answered ${r.status}.`), { status: 502 });
  const audio = Buffer.from(await r.arrayBuffer());
  try {
    fs.mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, audio, { mode: 0o600 });
    const kept = fs.readdirSync(cacheDir).filter((f) => f.endsWith('.mp3'))
      .map((f) => ({ f, t: fs.statSync(path.join(cacheDir, f)).mtimeMs })).sort((a, b) => b.t - a.t);
    for (const old of kept.slice(CACHE_MAX)) fs.unlinkSync(path.join(cacheDir, old.f));
  } catch (_) { /* spoken, just not kept */ }
  return audio;
}

module.exports = { BUILT_IN, avatarCast, moveSetOf, hairOf, agentOf, findAvatar, serveAvatarModel, elevenKey, elevenVoices, elevenSpeak };
