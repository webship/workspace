/**
 * The assistant's avatar. What must never drift: every move the assistant is told it may write exists in
 * the avatar; the 3D part is fetched only when the avatar is on (an import map, a module loaded on
 * demand); `assistant.avatar: none` takes the control and the stage away; and the avatar's lines are
 * asked for only while it is shown.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const app = (f) => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');
const { AVATAR_GESTURES } = require('../../assistant');

test('every move the assistant may write is one the avatar can do', () => {
  const avatar = app('public/assistant-avatar.js');
  const moves = [...avatar.matchAll(/^ {2}([a-z]+): \{ duration:/gm)].map((m) => m[1]);
  for (const g of AVATAR_GESTURES) assert.ok(moves.includes(g), `[${g}] is offered but the avatar has no such move`);
});

test('the libraries and the model are vendored, and fetched only when the avatar is shown', () => {
  for (const f of ['public/vendor/three/three.module.min.js', 'public/vendor/three/three.core.min.js', 'public/vendor/three/LICENSE',
    'public/vendor/three/addons/loaders/GLTFLoader.js', 'public/vendor/three-vrm/three-vrm.module.min.js', 'public/vendor/three-vrm/LICENSE',
    'public/avatar/druplicon.vrm']) {
    assert.ok(fs.existsSync(path.join(__dirname, '../..', f)), f);
  }
  const ui = app('public/assistant-avatar-ui.js');
  assert.ok(ui.includes("import('/assistant-avatar.js')"), 'the 3D module is imported on demand');
  const server = app('server.js');
  assert.ok(server.includes('<script type="importmap">'), 'the import map that resolves three and three-vrm');
  assert.ok(/\$\{avatarOn \? `<script src="\$\{assetUrl\('\/assistant-avatar-ui\.js'\)\}" defer>/.test(server), 'the wiring loads only when the avatar is on');
});

test('the avatar lines are asked for only while it is shown, and never left in the reply', () => {
  const assistant = app('assistant.js');
  assert.ok(assistant.includes('...(avatar ? ['), 'the avatar instructions are conditional');
  for (const line of ['BOARD', 'DRAW', 'SHOW', 'VIDEO', 'BROWSE', 'SEARCH', 'MOVE', 'SIZE']) {
    assert.ok(assistant.includes(`/^\\s*${line}:\\s*`), `${line}: is taken out of the reply text`);
  }
  assert.ok(app('public/ui.js').includes("avatar: Boolean(window.wsAssistantAvatarOn && window.wsAssistantAvatarOn()), avatarName: window.wsAvatarName ? window.wsAvatarName() : '', avatarId: window.wsAvatarId ? window.wsAvatarId() : '', page: window.wsAvatarContext ? window.wsAvatarContext() : null"));
});

test('every control is on the assistant side, and nothing is drawn on the avatar itself', () => {
  const server = app('server.js');
  const stage = server.slice(server.indexOf('<div class="assistant-avatar-stage"'), server.indexOf('<div class="assistant-avatar-chips"'));
  assert.ok(stage.includes('<canvas'), 'the stage is the character');
  assert.ok(!/<button/.test(stage), 'and carries no button: they are all in the panel bar');
  for (const c of ['assistant-dock', 'dock-voice', 'dock-talk', 'dock-mic', 'data-kit="board"', 'data-pop="windows"', 'data-pop="settings"', 'assistant-avatar-chips']) {
    assert.ok(server.includes(c), c);
  }
  assert.ok(!server.includes('data-pop="moves"'), 'the moves are the reply\'s to choose, not a list in the menu');
  assert.ok(!server.includes('data-pop="open"'), 'no box for typing links in the panel: Druplicon opens pages when asked');
  const menu = server.slice(server.indexOf('<div class="uk-inline assistant-avatar-menu">'), server.indexOf('<div class="uk-inline assistant-menu">'));
  for (const c of ['assistant-avatar-toggle', 'data-kit="board"', 'data-pop="settings"', 'assistant-avatar-pops']) assert.ok(menu.includes(c), `${c} is in the robot button's menu`);
});

test('an empty saved volume never silences the voice', () => {
  const ui = app('public/ui.js');
  assert.ok(ui.includes("if (raw !== '' && raw !== null && Number.isFinite(v) && v >= min && v <= max) narrationParams[key] = v;"),
    'volume, speed and pitch: an empty cookie means not chosen, never 0');
});

test('every big move the assistant may write is one the page can do, and spin, walk and leap exist', () => {
  const { AVATAR_BIG_MOVES } = require('../../assistant');
  const ui = app('public/assistant-avatar-ui.js');
  const big = ui.slice(ui.indexOf('const BIG = {'), ui.indexOf('};', ui.indexOf('const BIG = {')));
  for (const m of Object.keys(AVATAR_BIG_MOVES)) assert.match(big, new RegExp(`(async )?${m}(\\(\\)|:)`), `[${m}] is offered but the page has no such big move`);
  const avatar = app('public/assistant-avatar.js');
  for (const m of ['walk', 'spin', 'leap']) assert.match(avatar, new RegExp(`^  ${m}: \\{ duration:`, 'm'), m);
  assert.ok(/if \(reduced\(\)\) return still/.test(big), 'reduced motion keeps it on the spot');
});

test('the avatar scripts parse: a clash in one leaves the page with no avatar at all', () => {
  for (const f of ['public/assistant-avatar.js', 'public/assistant-avatar-moves.js', 'public/assistant-avatar-ui.js']) {
    // Modules: their imports and exports taken off, the rest must compile as a function body.
    const body = app(f).replace(/^import .*$/gm, '').replace(/^export (const|function|async function|let|class) /gm, '$1 ');
    assert.doesNotThrow(() => new Function(body), f);
  }
});

test('every avatar may speak in an ElevenLabs voice, and none does by default', () => {
  const ui = app('public/assistant-avatar-ui.js');
  assert.ok(ui.includes("voice().set('voiceName', String(getPref(`ws-voice-name-${a.id}`, '') || ''))"), 'a voice per avatar, free until one is picked');
  assert.ok(app('public/ui.js').includes("if (/^elevenlabs:/i.test(String(narrationParams.voiceName || ''))) delete narrationParams.voiceName;"),
    'settings.yml cannot make a paid voice the default');
});

test('the Vardot icons from Figma are vendored and used, never a temporary Figma link', () => {
  const dir = path.join(__dirname, '../../public/vendor/vardot-icons');
  for (const f of ['ui/sound-on.svg', 'ui/sound-off.svg', 'ui/play.svg', 'ui/pause.svg', 'ui/stop.svg', 'ui/headset.svg', 'ui/share.svg', 'ui/menu.svg',
    'ui/bookmark-outlined.svg', 'service/design-primary-dark.svg', 'service/development-primary-dark.svg', 'service/strategy-primary-dark.svg',
    'value/improvement-primary.svg', 'value/sharing-primary.svg', 'value/respect-primary.svg', 'value/customer-primary.svg', 'value/mastery-primary.svg']) {
    const svg = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.match(svg, /^<svg[^>]*width="[\d.]+" height="[\d.]+"/, `${f} is an SVG with its own size`);
  }
  const ui = app('public/assistant-avatar-ui.js');
  for (const name of ['sound-on', 'sound-off', 'play', 'pause', 'stop', 'headset', 'share', 'bookmark-outlined']) assert.ok(ui.includes(`'${name}'`), `${name} is used`);
  for (const f of ['public/assistant-avatar-ui.js', 'server.js', 'public/css/components/assistant-avatar.css']) assert.ok(!/figma\.com\/api\/mcp\/asset/.test(app(f)), `${f} links no temporary Figma asset`);
});

test('while it works the avatar shows a status as the Claude Code CLI does, and acts each one out', () => {
  const ui = app('public/assistant-avatar-ui.js');
  const list = ui.slice(ui.indexOf('const STATUSES = ['), ui.indexOf('];', ui.indexOf('const STATUSES = [')));
  const moves = [...list.matchAll(/\['([A-Z][a-z]+)', '([a-z]+)'\]/g)];
  assert.ok(moves.length >= 6 && moves.some(([, v]) => v === 'Tempering'), 'Thinking, Tempering and the rest');
  const avatar = app('public/assistant-avatar.js');
  for (const [, , m] of moves) assert.match(avatar, new RegExp(`^  ${m}: \\{ duration:`, 'm'), `${m} is a shared move, so every avatar can do it`);
  assert.ok(ui.includes("avatar.gesture(failed ? 'shrug' : 'thumbsup')"), 'Done or Stopped, with a move');
  assert.ok(app('public/ui.js').includes("el.onError = () => setWorking(false, true);"), 'a failed request says so');
});
