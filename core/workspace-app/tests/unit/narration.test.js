const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { cleanSpoken, summaryFromHtml, createNarrator } = require('../../public/narration');
const { panelConfig } = require('../../speech');

const app = (f) => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');

function fakes(pref) {
  const store = new Map(pref ? Object.entries(pref) : []);
  const spoken = [];
  const synth = {
    spoken, cancelled: 0,
    speak: (u) => spoken.push(u), cancel() { this.cancelled += 1; },
    getVoices: () => [{ name: 'Google US English' }],
  };
  return {
    store, synth, spoken,
    opts: {
      synth, Utterance: function (t) { this.text = t; },
      getPref: (n) => (store.has(n) ? store.get(n) : null),
      setPref: (n, v) => store.set(n, v),
    },
  };
}

test('a summary is the first sentences, without code blocks, tables, buttons or the plan card', () => {
  const html = '<p>Started the build. It takes about <code>5 min</code>. See https://x.test/a for more.</p>'
    + '<pre>ddev start\nddev drush cr</pre><table><tr><td>a</td></tr></table>'
    + '<div class="plan-card"><p class="plan-summary">Run it</p><button>Run it</button></div>';
  assert.strictEqual(summaryFromHtml(html), 'Started the build. It takes about 5 min.');
  assert.ok(!/ddev|Run it|a link|https/.test(summaryFromHtml(html)));
});

test('a summary reads entities, lists and headings as sentences, and is bounded', () => {
  assert.strictEqual(summaryFromHtml('<h2>Done</h2><ul><li>One &amp; two</li><li>Three</li></ul>'), 'Done. One & two.');
  assert.ok(summaryFromHtml(`<p>${'word '.repeat(200)}</p>`).length <= 240);
  assert.strictEqual(summaryFromHtml(''), '');
  assert.strictEqual(summaryFromHtml(undefined), '');
});

test('spoken text loses markdown marks and URLs', () => {
  assert.strictEqual(cleanSpoken('**Done** — see https://a.test/x now'), 'Done — see a link now');
  assert.ok(cleanSpoken('x '.repeat(400)).length <= 300);
});

test('it starts as settings.yml says, and the saved choice wins', () => {
  assert.strictEqual(createNarrator({ ...fakes().opts, defaultOn: true }).isOn(), true);
  assert.strictEqual(createNarrator({ ...fakes().opts, defaultOn: false }).isOn(), false);
  assert.strictEqual(createNarrator({ ...fakes({ 'ws-voice': '0' }).opts, defaultOn: true }).isOn(), false);
  assert.strictEqual(createNarrator({ ...fakes({ 'ws-voice': '1' }).opts, defaultOn: false }).isOn(), true);
});

test('turning it off is remembered and stops what is being said', () => {
  const f = fakes();
  const n = createNarrator({ ...f.opts, defaultOn: true });
  n.setOn(false);
  assert.strictEqual(f.store.get('ws-voice'), '0');
  assert.strictEqual(f.synth.cancelled, 1);
  assert.strictEqual(n.isOn(), false);
  n.setOn(true);
  assert.strictEqual(f.store.get('ws-voice'), '1');
  assert.strictEqual(n.isOn(), true);
});

test('with voice on, the assistant\'s own summary is spoken; without one, the first sentences are', () => {
  const f = fakes();
  const n = createNarrator({ ...f.opts, defaultOn: true });
  assert.strictEqual(n.narrate({ spoken: 'The project is running.', html: '<p>Long reply here.</p>' }), true);
  assert.strictEqual(f.spoken.at(-1).text, 'The project is running.');
  n.narrate({ html: '<p>First one. Second one. Third one.</p>' });
  assert.strictEqual(f.spoken.at(-1).text, 'First one. Second one.');
});

test('with voice off, or nothing to say, nothing is spoken', () => {
  const f = fakes({ 'ws-voice': '0' });
  const off = createNarrator({ ...f.opts, defaultOn: true });
  assert.strictEqual(off.narrate({ spoken: 'Hello there.' }), false);
  assert.strictEqual(f.spoken.length, 0);
  const on = createNarrator({ ...fakes().opts, defaultOn: true });
  assert.strictEqual(on.narrate({ html: '<pre>only code</pre>' }), false);
});

test('a new utterance replaces the one being said, and carries the configured voice', () => {
  const f = fakes();
  const n = createNarrator({ ...f.opts, defaultOn: true, params: { rate: 1.2, pitch: 0.9, volume: 0.5, lang: 'ar-JO', voiceName: 'google us english' } });
  n.speak('Hello there.');
  const u = f.spoken[0];
  assert.deepStrictEqual([u.rate, u.pitch, u.volume, u.lang], [1.2, 0.9, 0.5, 'ar-JO']);
  assert.strictEqual(u.voice.name, 'Google US English');
  assert.strictEqual(f.synth.cancelled, 1, 'the previous one is cancelled first');
});

test('a browser without speech has the control hidden, not a switch that does nothing', () => {
  const n = createNarrator({ getPref: () => null, setPref: () => {}, defaultOn: true });
  assert.strictEqual(n.supported, false);
  assert.strictEqual(n.isOn(), false);
  assert.strictEqual(n.narrate({ spoken: 'Hi there.' }), false);
  assert.ok(app('public/ui.js').includes('show: narrator.supported'));
});

test('the page is given where the switch starts and the voice to use, even when the setting is off', () => {
  const on = panelConfig({ assistant: { voice_output: true, speech_rate: 1.1 } });
  assert.strictEqual(on.voiceOutput, true);
  assert.strictEqual(on.narration.rate, 1.1);
  const off = panelConfig({ assistant: { voice_output: false, speech_rate: 1.1 } });
  assert.strictEqual(off.voiceOutput, false);
  assert.strictEqual(off.textToSpeech, false);
  assert.strictEqual(off.narration.rate, 1.1, 'turning the switch on still speaks in the configured voice');
});

test('the checkbox is in the assistant options, and the helper loads before ui.js', () => {
  const server = app('server.js');
  const menu = server.slice(server.indexOf('function assistantMenuItemsHtml'), server.indexOf('const AI_MARK'));
  assert.ok(menu.includes('class="uk-checkbox assistant-switch" type="checkbox" data-switch="${key}"'));
  assert.ok(menu.includes("['voice', 'Voice summary'"));
  assert.ok(server.indexOf("assetUrl('/narration.js')") > 0);
  assert.ok(server.indexOf("assetUrl('/narration.js')") < server.indexOf("assetUrl('/ui.js')"));
});

test('the flag reaches the server, and the summary line is asked for only when it is on', () => {
  const ui = app('public/ui.js');
  assert.ok(ui.includes('voice: narrator.isOn()'));
  assert.ok(ui.includes('narrator.narrate({ spoken: d && d.spoken, html: response.html })'));
  assert.ok(ui.includes('el.textToSpeech = false;'));
  assert.ok(app('server.js').includes('{ voice: parsed.voice === true, avatar: parsed.avatar === true, avatarName: parsed.avatarName, avatarId: parsed.avatarId, page: parsed.page }'));
  const assistant = app('assistant.js');
  assert.ok(assistant.includes('...(voice ? ['), 'the SUMMARY instruction is conditional');
  assert.ok(assistant.includes('/^\\s*SUMMARY:\\s*(.+)$/'), 'and the line never reaches the reply text');
});

test('the voice tells whoever listens when it starts, each word, and when it stops', () => {
  const f = fakes();
  const heard = [];
  const n = createNarrator({ ...f.opts, onSpeech: (d) => heard.push(d) });
  assert.ok(n.speak('Two projects are running.'));
  const u = f.spoken[0];
  u.onstart();
  u.onboundary({ name: 'word', charIndex: 4 });
  u.onboundary({ name: 'sentence', charIndex: 0 });
  u.onend();
  assert.deepStrictEqual(heard.map((d) => d.word || d.type), ['end', 'start', 'projects', 'end'],
    'speaking first cancels what was being said, then start, the word, and the end; a sentence boundary is not a word');
  n.cancel();
  assert.strictEqual(heard[heard.length - 1].type, 'end', 'a cancel is an end too, so a mouth never stays open');
});

test('with no voice configured, the best free voice in the language is chosen, and a named one always wins', () => {
  const { bestVoice } = require('../../public/narration');
  const voices = [
    { name: 'eSpeak English', lang: 'en-US' },
    { name: 'Google US English', lang: 'en-US' },
    { name: 'Microsoft Aria Online (Natural) - English (United States)', lang: 'en-US' },
    { name: 'Microsoft Hamed Online (Natural) - Arabic', lang: 'ar-SA' },
  ];
  assert.match(bestVoice(voices, 'en-US').name, /Aria Online \(Natural\)/);
  assert.match(bestVoice(voices, 'ar-SA').name, /Hamed/);
  assert.strictEqual(bestVoice([{ name: 'eSpeak English', lang: 'en-US' }], 'en-US'), null, 'nothing better than the default: leave the default');
  const f = fakes();
  f.synth.getVoices = () => voices;
  createNarrator({ ...f.opts, params: { voiceName: 'Google US English', lang: 'en-US' } }).speak('Hello there.');
  assert.strictEqual(f.spoken[0].voice.name, 'Google US English');
  createNarrator({ ...f.opts, params: { lang: 'en-US' } }).speak('Hello there.');
  assert.match(f.spoken[1].voice.name, /Natural/);
});

test('an ElevenLabs voice speaks through the server, and falls back to the browser when it cannot', () => {
  const f = fakes();
  const sent = [];
  let stopped = 0;
  let fallback = null;
  const remote = (text, id, params, onSpeech, fb) => { sent.push([text, id]); fallback = fb; return () => { stopped += 1; }; };
  const n = createNarrator({ ...f.opts, remote, params: { voiceName: 'elevenlabs:EXAVITQu4vr4xnSDxMaL' } });
  assert.strictEqual(n.speak('Hello team.'), true);
  assert.deepStrictEqual(sent, [['Hello team.', 'EXAVITQu4vr4xnSDxMaL']]);
  assert.strictEqual(f.spoken.length, 0, 'the browser stays quiet while the server speaks');
  n.cancel();
  assert.strictEqual(stopped, 1, 'muting stops the audio');
  fallback();
  assert.strictEqual(f.spoken.length, 1, 'the same words in the browser voice when the server cannot');
  const plain = createNarrator({ ...fakes().opts, remote, params: { voiceName: 'Google US English' } });
  plain.speak('Hi.');
  assert.strictEqual(sent.length, 1, 'a browser voice never goes to the server');
});
