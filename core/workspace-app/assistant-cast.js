/**
 * Who the assistant's avatar can be, and which voices it can speak in.
 *
 * Avatars. `druplicon` ships with the dashboard. Every other one is a character of an avatar project in
 * the avatars workspace (`<root>/avatars/<project>/`): a character file there (`characters/<id>.json`)
 * gives its model, display name and credit, and may name a set of moves, a Claude Code agent and a free
 * local voice; a bare model (`public/models/<name>.vrm`) is enough on its own for a name settings.yml
 * lists. The ones named in settings.yml `assistant.avatars:` come first, in that order; after them every
 * character found in the avatars workspace is offered too, unless `assistant.avatars_discover: false`.
 * A project may bring moves of its own (`public/custom-moves.js`), loaded by the page at run time.
 *
 * Everything stays where it is and is served from there, never copied into this repository: a model's
 * licence is its own, and some (fan-made ones) are for personal use only. Nothing about a character is
 * written here: what it is called, how it moves and who it is are read from its project.
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

const SET_RE = /^[a-z][a-z0-9-]{0,30}$/;
const AGENT_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const VOICE_RE = /^en_[A-Z]{2}-[a-z0-9_]+-(x_low|low|medium|high)$/;
const OWN_MOVES_MAX = 60 * 1024;
// What a file of moves may not name: it is given numbers and answers with angles, nothing else.
const OWN_MOVES_BANNED = /\b(fetch|XMLHttpRequest|WebSocket|EventSource|document|window|globalThis|self|top|parent|frames|eval|Function|import|require|setTimeout|setInterval|requestAnimationFrame|localStorage|sessionStorage|indexedDB|navigator|location|history|postMessage|Worker|constructor|__proto__|prototype|process|cookie)\b/;

/**
 * The set of moves an avatar does beyond the shared ones (public/assistant-avatar-moves.js), or '':
 * settings.yml `assistant.avatar_moves.<id>`, else the `moves` its character file names.
 */
function moveSetOf(settings, id, character = null) {
  const named = String((((settings || {}).assistant || {}).avatar_moves || {})[id] || (character && typeof character.moves === 'string' ? character.moves : '') || '').trim().replace(/^['"]|['"]$/g, '').toLowerCase();
  return SET_RE.test(named) ? named : '';
}

/** The hair colour an avatar starts with (settings.yml assistant.avatar_hair.<id>), as #rrggbb, or ''. */
function hairOf(settings, id) {
  const v = String(((settings.assistant || {}).avatar_hair || {})[id] || '').trim().replace(/^['"]|['"]$/g, '');
  return /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : '';
}

/**
 * The Claude Code agent an avatar brings (settings.yml assistant.avatar_agents.<id>, else the `agent`
 * its character file names), when it is installed for this user; '' keeps the assistant's own agent.
 */
function agentOf(settings, id, home = process.env.HOME || '', character = null) {
  const name = String(((settings.assistant || {}).avatar_agents || {})[id] || (character && typeof character.agent === 'string' ? character.agent : '') || '').trim();
  return AGENT_RE.test(name) && fs.existsSync(path.join(home, '.claude', 'agents', `${name}.md`)) ? name : '';
}

/**
 * The free local voice a character asks for, or '': an English Piper voice, by name. A paid engine's
 * voice in a character file is never read here: speaking with one spends credits, so it is only ever
 * picked by a person in the panel.
 */
function voiceOf(character) {
  for (const key of ['voiceEn', 'voice', 'fallback']) {
    const v = character && character[key];
    if (v && typeof v === 'object' && String(v.engine).toLowerCase() === 'piper' && VOICE_RE.test(String(v.voice || ''))) return String(v.voice);
  }
  return '';
}

/**
 * The moves a character's project brings (`public/custom-moves.js`, with what each is for in
 * `public/custom-moves.json`), or null: `{ file, moves: { name: 'what it is for' } }`. The file is a
 * module the page loads, so it is checked first: inside the project, small, and naming nothing but arithmetic.
 */
function ownMovesOf(found) {
  if (!found || !found.dir) return null;
  let file;
  try {
    file = fs.realpathSync(path.join(found.dir, 'public', 'custom-moves.js'));
    if (!file.startsWith(found.dir + path.sep)) return null;
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > OWN_MOVES_MAX) return null;
    const code = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
    if (OWN_MOVES_BANNED.test(code) || !/export\s+default\b/.test(code)) return null;
  } catch (_) { return null; }
  const moves = {};
  try {
    const list = JSON.parse(fs.readFileSync(path.join(found.dir, 'public', 'custom-moves.json'), 'utf8')).moves;
    for (const m of (Array.isArray(list) ? list : []).slice(0, 60)) {
      const name = String((m && m.name) || '');
      // English only: what the move is for, as plain words.
      const what = String((m && (m.when || m.en)) || '').replace(/[^\x20-\x7e]/g, ' ').replace(/[`\[\]<>{}]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
      if (/^[a-z]{2,24}$/.test(name)) moves[name] = what || 'a move of its own';
    }
  } catch (_) { /* no list: the page still has the moves, the assistant is not told of them */ }
  return { file, moves };
}

const stamp = (file) => { try { return Math.round(fs.statSync(file).mtimeMs).toString(36); } catch (_) { return '0'; } };

/** The project folders of the avatars workspace, by name: `{ name, dir }`, `dir` resolved (a project may be a link the owner made). */
function avatarProjects(root) {
  if (!root) return [];
  const base = path.join(root, 'avatars');
  let names = [];
  try { names = fs.readdirSync(base, { withFileTypes: true }).filter((e) => (e.isDirectory() || e.isSymbolicLink()) && !e.name.startsWith('.')).map((e) => e.name).sort(); } catch (_) { return []; }
  const out = [];
  for (const name of names) {
    try { const dir = fs.realpathSync(path.join(base, name)); if (fs.statSync(dir).isDirectory()) out.push({ name, dir }); } catch (_) { /* a broken link */ }
  }
  return out;
}

/** A model file, when it really is inside its own project folder; null for a link or a path that leaves it. */
function modelInside(file, dir) {
  try {
    const real = fs.realpathSync(file);
    return real.startsWith(dir + path.sep) && /\.vrm$/i.test(real) && fs.statSync(real).isFile() ? real : null;
  } catch (_) { return null; }
}

/** An avatar in the avatars workspace: `{ file, name, credit, project, dir, character }`, or null. */
function findAvatar(id, root) {
  if (!NAME_RE.test(id) || !root) return null;
  const projects = avatarProjects(root);
  for (const p of projects) {
    for (const stem of [id, `osa-${id}`]) {
      let c = null;
      try { c = JSON.parse(fs.readFileSync(path.join(p.dir, 'characters', `${stem}.json`), 'utf8')); } catch (_) { continue; }
      const rel = String((c && c.model) || '').replace(/^\/+/, '');
      if (!/^models\/[\w.-]+\.vrm$/i.test(rel)) continue;
      const file = modelInside(path.join(p.dir, 'public', rel), p.dir);
      if (file) return { file, name: String(c.name || titleOf(id)).slice(0, 40), credit: String(c.credit || '').slice(0, 400), project: p.name, dir: p.dir, character: c };
    }
  }
  for (const p of projects) {
    for (const stem of [id, `osa-${id}`]) {
      const file = modelInside(path.join(p.dir, 'public', 'models', `${stem}.vrm`), p.dir);
      if (file) return { file, name: titleOf(id), credit: `From the ${p.name} avatar project; its README states the model's licence.`, project: p.name, dir: p.dir, character: null };
    }
  }
  return null;
}

/** The id of every character the avatar projects hold (a `characters/<id>.json` with a model inside its project). */
function discoverAvatars(root) {
  const out = [];
  for (const p of avatarProjects(root)) {
    let files = [];
    try { files = fs.readdirSync(path.join(p.dir, 'characters')).filter((f) => f.endsWith('.json')).sort(); } catch (_) { continue; }
    for (const f of files.slice(0, 50)) {
      const id = f.slice(0, -5).toLowerCase();
      if (NAME_RE.test(id) && id !== 'none' && !BUILT_IN[id] && !out.includes(id) && findAvatar(id, root)) out.push(id);
    }
  }
  return out;
}

/**
 * The avatars the panel offers, with what the page needs to show each one: the ones settings.yml names,
 * then every character found in the avatars workspace (unless `assistant.avatars_discover: false`).
 * Unknown names are left out.
 */
function avatarCast(settings = {}, root = '') {
  const a = settings.assistant || {};
  const named = Array.isArray(a.avatars) && a.avatars.length ? a.avatars : ['druplicon'];
  const discover = !(a.avatars_discover === false || String(a.avatars_discover).toLowerCase() === 'false');
  const out = [];
  for (const raw of [...named, ...(discover ? discoverAvatars(root) : [])]) {
    const id = String(raw || '').trim().toLowerCase();
    if (!NAME_RE.test(id) || id === 'none' || out.some((x) => x.id === id)) continue;
    // The model's link carries its file's time, so a rebuilt model is fetched at once rather than after
    // the hour a browser may keep it.
    if (BUILT_IN[id]) { out.push({ id, ...BUILT_IN[id], model: `${BUILT_IN[id].model}?v=${stamp(path.join(__dirname, 'public', BUILT_IN[id].model))}`, moves: moveSetOf(settings, id), hair: hairOf(settings, id) }); continue; }
    const found = findAvatar(id, root);
    if (!found) continue;
    const own = ownMovesOf(found);
    const voice = voiceOf(found.character);
    out.push({
      id, name: found.name, model: `/avatar/model/${id}.vrm?v=${stamp(found.file)}`, credit: found.credit,
      moves: moveSetOf(settings, id, found.character), hair: hairOf(settings, id),
      ...(own ? { ownMoves: `/avatar/moves/${id}.js?v=${stamp(own.file)}` } : {}),
      ...(voice ? { voice } : {}),
    });
  }
  return out;
}

/** What the assistant is told about one avatar: its set of moves, the moves its project brings, and its agent. */
function avatarMind(settings, root, id, home = process.env.HOME || '') {
  const key = String(id || '').trim().toLowerCase();
  const found = BUILT_IN[key] ? null : findAvatar(key, root);
  const listed = avatarCast(settings, root).some((a) => a.id === key);
  if (!listed) return { moves: '', ownMoves: {}, agent: '' };
  const own = found ? ownMovesOf(found) : null;
  return { moves: moveSetOf(settings, key, found && found.character), ownMoves: own ? own.moves : {}, agent: agentOf(settings, key, home, found && found.character) };
}

/** GET /avatar/model/<id>.vrm: only a model of an avatar the panel offers. */
function serveAvatarModel(res, id, settings, root) {
  const listed = avatarCast(settings, root).some((a) => a.id === id && !BUILT_IN[a.id]);
  const found = listed ? findAvatar(id, root) : null;
  if (!found) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('No such avatar.'); }
  res.writeHead(200, { 'Content-Type': 'model/gltf-binary', 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' });
  fs.createReadStream(found.file).pipe(res);
}

/** GET /avatar/moves/<id>.js: the moves an offered avatar's project brings, once they passed the check. */
function serveAvatarMoves(res, id, settings, root) {
  const listed = avatarCast(settings, root).some((a) => a.id === id && a.ownMoves);
  const own = listed ? ownMovesOf(findAvatar(id, root)) : null;
  if (!own) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('No moves.'); }
  res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' });
  fs.createReadStream(own.file).pipe(res);
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

module.exports = { BUILT_IN, avatarCast, avatarMind, discoverAvatars, moveSetOf, hairOf, agentOf, voiceOf, ownMovesOf, findAvatar, serveAvatarModel, serveAvatarMoves, elevenKey, elevenVoices, elevenSpeak };
