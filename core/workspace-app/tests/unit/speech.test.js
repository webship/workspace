/**
 * The voice config the assistant panel is handed.
 *
 * Every case here guards a failure that is SILENT at runtime: deep-chat ignores a key it does not
 * recognise and accepts one it does, so a wrong shape produces no error, no warning and no visible
 * difference until someone dictates a sentence and the message sends itself.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { assistantSettings, assistantIdentity, speechToTextConfig, textToSpeechConfig, panelConfig } = require('../../speech');

const of = (assistant) => panelConfig({ assistant });

test('with nothing configured, the recogniser is pinned to en-US', () => {
  // en-US ships as the default rather than the browser's language: most dictation here is English,
  // and a browser set to something else was silently recognising the wrong one.
  const { speechToText } = of({});
  assert.deepStrictEqual(speechToText.webSpeech, { language: 'en-US' });
  assert.strictEqual(speechToText.displayInterimResults, true);
  assert.strictEqual(speechToText.stopAfterSubmit, true);
  assert.strictEqual(speechToText.submitAfterSilence, 2500);
});

test('a language pins the recogniser — the setting that decides whether dictation works at all', () => {
  // Left on the wrong language, web speech does not fail: it returns confident nonsense.
  const { speechToText, textToSpeech } = of({ speech_language: 'ar-JO' });
  assert.deepStrictEqual(speechToText.webSpeech, { language: 'ar-JO' });
  // And the reply is spoken in the language it was asked in, without setting it twice.
  assert.strictEqual(textToSpeech.lang, 'ar-JO');
});

test('no commands are sent when none are configured', () => {
  // The key must be ABSENT. An empty `commands` object is not "no commands" to deep-chat.
  assert.ok(!('commands' in of({}).speechToText));
});

test('only the commands actually given a phrase are sent', () => {
  const { speechToText } = of({ command_submit: 'send it', command_clear: '  ', command_stop: 'halt' });
  assert.deepStrictEqual(speechToText.commands, {
    submit: 'send it',
    stop: 'halt',
    settings: { substrings: false, caseSensitive: false },
  });
  // A whitespace-only phrase is not a command; it would arm on almost anything.
  assert.ok(!('removeAllText' in speechToText.commands));
});

test('substring matching is off, so a command word inside a sentence does not fire', () => {
  // deep-chat defaults this to true: "submit the form" would send the message mid-sentence.
  const { speechToText } = of({ command_submit: 'submit' });
  assert.strictEqual(speechToText.commands.settings.substrings, false);
});

test('submit-after-silence of 0 removes the key rather than sending zero', () => {
  // 0 means "never send for me". deep-chat wants the key absent for that; zero would be read as
  // "submit immediately", which sends a half-dictated sentence.
  assert.ok(!('submitAfterSilence' in of({ submit_after_silence: 0 }).speechToText));
});

test('voice off removes the microphone rather than leaving a dead button', () => {
  assert.strictEqual(of({ voice_input: false }).speechToText, false);
  assert.strictEqual(of({ voice_output: false }).textToSpeech, false);
});

test('a voice name is passed only when set, so an empty one cannot silence the reply', () => {
  assert.ok(!('voiceName' in of({}).textToSpeech));
  assert.strictEqual(of({ voice_name: 'Google US English' }).textToSpeech.voiceName, 'Google US English');
});

test('rate, pitch and volume carry through', () => {
  const { textToSpeech } = of({ speech_rate: 1.25, speech_pitch: 0.9, speech_volume: 0.5 });
  assert.strictEqual(textToSpeech.rate, 1.25);
  assert.strictEqual(textToSpeech.pitch, 0.9);
  assert.strictEqual(textToSpeech.volume, 0.5);
});

test('speech colours are tokens, so both themes follow', () => {
  const { textColor } = of({}).speechToText;
  assert.match(textColor.interim, /^var\(--/);
  assert.match(textColor.final, /^var\(--/);
});

test('the microphone button is styled in all three states', () => {
  const { button } = of({}).speechToText;
  for (const state of ['default', 'active', 'commandMode']) {
    assert.ok(button[state], `the ${state} microphone state has no styling`);
  }
});

test('Azure is never configured — its audio leaves the machine', () => {
  const all = JSON.stringify(of({ speech_language: 'ar-JO', command_submit: 'go' }));
  assert.ok(!/azure/i.test(all));
});

test('strings survive a YAML round trip as "false" and as numbers', () => {
  // parse_yaml hands values back as strings, so `voice_input: false` arrives as the STRING "false".
  assert.strictEqual(assistantSettings({ assistant: { voice_input: 'false' } }).voiceInput, false);
  assert.strictEqual(assistantSettings({ assistant: { speech_rate: '1.5' } }).speechRate, 1.5);
});

test('a nonsense number falls back rather than reaching the browser', () => {
  assert.strictEqual(assistantSettings({ assistant: { speech_rate: 'quickly' } }).speechRate, 1);
});

test('the two builders can be used on their own', () => {
  const cfg = assistantSettings({ assistant: { voice_name: 'X' } });
  assert.ok(speechToTextConfig(cfg).webSpeech);
  assert.strictEqual(textToSpeechConfig(cfg).voiceName, 'X');
});

test('the words for "not set" all resolve to nothing, so no row in settings.yml is empty', () => {
  // `speech_language: ""` reads as a setting somebody forgot to finish. The file says a word.
  for (const word of ['auto', 'default', 'off', 'none', 'browser', 'AUTO', 'Off']) {
    const { speechToText, textToSpeech } = of({
      speech_language: word, voice_name: word, command_submit: word,
    });
    assert.strictEqual(speechToText.webSpeech, true, `${word} pinned a language`);  // auto = browser
    assert.ok(!('commands' in speechToText), `${word} armed a voice command`);
    assert.ok(!('voiceName' in textToSpeech), `${word} was used as a voice name`);
  }
});

test('the field microphones get the same language as the assistant', () => {
  // Before this they were pinned to document.documentElement.lang and ignored the setting, so
  // 35 microphones stayed on English while the assistant moved.
  const { fieldMic, speechToText } = of({ speech_language: 'ar-JO' });
  assert.strictEqual(fieldMic.lang, 'ar-JO');
  assert.strictEqual(speechToText.webSpeech.language, 'ar-JO');
});

test('turning the microphone off removes the field mics too', () => {
  assert.strictEqual(of({ voice_input: false }).fieldMic, false);
});

test('every offered language is a usable BCP-47 tag, and "follow the browser" stays reachable', () => {
  const { LANGUAGES } = require('../../speech');
  assert.strictEqual(LANGUAGES[0][0], 'auto', 'the browser default must be the first option');
  for (const [code, label] of LANGUAGES.slice(1)) {
    assert.match(code, /^[a-z]{2}-[A-Z]{2}$/, `${code} is not a BCP-47 tag`);
    assert.ok(label.length > 3, `${code} has no readable label`);
  }
});

test('a voice command is a checkbox: true listens for the command\'s own word', () => {
  // A text box holding `off` asked people to type a phrase when what they wanted was to switch
  // something on. `true` means "listen for the obvious word".
  const { speechToText } = of({ command_stop: true, command_submit: true });
  assert.strictEqual(speechToText.commands.stop, 'stop');
  assert.strictEqual(speechToText.commands.submit, 'submit');
});

test('a phrase of your own still works — the only way to have one in another language', () => {
  const { speechToText } = of({ command_stop: 'توقف' });
  assert.strictEqual(speechToText.commands.stop, 'توقف');
});

test('false and off both mean no command, so the old spelling keeps working', () => {
  for (const v of [false, 'false', 'off', 'no']) {
    assert.ok(!('commands' in of({ command_stop: v }).speechToText), `${v} armed a command`);
  }
});

test('the language dropdown is fed from the module, so the form and the resolver cannot disagree', () => {
  // settings.labels.yml says `options: from:speech-languages` rather than repeating the list. A copy
  // there would drift from the one the resolver validates against, and the drift would be invisible.
  const fs = require('fs');
  const path = require('path');
  // CONFIG_DIR, not a relative walk: the app runs from /var/www/html inside its container, so
  // ../../.. lands outside the tree and the file is simply not found.
  const { CONFIG_DIR } = require('../../workspaces');
  const labels = fs.readFileSync(path.join(CONFIG_DIR, 'settings.labels.yml'), 'utf8');
  assert.match(labels, /options:\s*["']?from:speech-languages/,
    'the language options are spelled out in the labels file instead of coming from speech.js');
});

test('a command describes itself, and shell variables in that description are resolved', () => {
  // Read from the script, not from a list beside it: 218 of the 239 commands already carry an
  // ARGPARSE_DESCRIPTION, and a second copy would be wrong the first time somebody edited a command
  // without knowing the copy existed.
  const { commandDescription } = require('../../workspaces');
  const path = require('path');
  const { ROOT } = require('../../workspaces');

  const built = commandDescription(path.join(ROOT, 'dev'), 'cmd-webship11-0-x-project.sh');
  assert.ok(built, 'a builder with ARGPARSE_DESCRIPTION described itself as nothing');
  // `Build a ${distribution_title} ${site_version} project` must not reach a person raw.
  assert.ok(!/\$\{|\$[a-zA-Z_]/.test(built), `an unresolved variable is shown: "${built}"`);
});

test('a command with no description at all returns empty rather than throwing', () => {
  const { commandDescription } = require('../../workspaces');
  assert.strictEqual(commandDescription('/nonexistent', 'cmd-nope.sh'), '');
});

test('a command title is short, and a builder keeps its product name however long', () => {
  const { commandTitle, ROOT } = require('../../workspaces');
  const path = require('path');

  // Derived from the file name when nothing brief is declared: cmd-tools-reclaim.sh -> "Reclaim".
  assert.strictEqual(commandTitle(path.join(ROOT, 'products'), 'cmd-tools-reclaim.sh'), 'Reclaim');

  // A builder's `# workspace-name:` is a PRODUCT name, not a sentence, so it survives at any length.
  const builder = commandTitle(path.join(ROOT, 'site-templates'), 'cmd-website_starter-1-0-x-project.sh');
  assert.match(builder, /Website Starter/, `a builder lost its product name: "${builder}"`);

  // A tools command using that header as free text gets a short derived title instead, because the
  // declared one repeats the description underneath it.
  const tools = commandTitle(path.join(ROOT, 'products'), 'cmd-tools-graphify.sh');
  assert.ok(tools.split(/\s+/).length <= 4, `title is not short: "${tools}"`);
});

test('every command in every workspace folder has a description', () => {
  const { commandDescription, ROOT } = require('../../workspaces');
  const fs = require('fs');
  const path = require('path');
  const missing = [];
  for (const d of fs.readdirSync(ROOT)) {
    let files = [];
    try { files = fs.readdirSync(path.join(ROOT, d)).filter((f) => /^cmd-.*\.sh$/.test(f)); } catch (_) { continue; }
    for (const f of files) if (!commandDescription(path.join(ROOT, d), f)) missing.push(`${d}/${f}`);
  }
  assert.deepStrictEqual(missing, [], 'these commands describe themselves as nothing');
});


/* ---------- what the assistant is CALLED, and what its composer says ---------- */

// One dashboard, twenty-four workspaces, one assistant whose conversation follows you between them.
// The name and the placeholder are configuration at two levels: settings.yml for the home dashboard
// and everything unscoped, and a workspace's own file for its page. The rule is the same at each
// level — say nothing and you inherit — so shipping the keys in every workspace file costs nothing.

const id = (global, own) => assistantIdentity({ assistant: global }, own ? { assistant: own } : null);

test('with nothing configured it is the AI Assistant, and the composer says nothing', () => {
  assert.deepStrictEqual(assistantIdentity(), { name: 'AI Assistant', placeholder: '' });
  // An empty field with a cursor in it already says "type here", and a prompt that suggests what to
  // ask narrows what gets asked. The empty string still has to REACH deep-chat: left unset, the
  // component renders its own library placeholder about `connect` and the demo property.
  assert.strictEqual(panelConfig().placeholder, '');
  assert.strictEqual(panelConfig().name, 'AI Assistant');
});

test('a workspace renames its assistant for its own page and nowhere else', () => {
  assert.deepStrictEqual(id({ name: 'AI Assistant' }, { name: 'Design Assistant' }),
    { name: 'Design Assistant', placeholder: '' });
  // …and the global one is untouched by it, which is the half a per-page override gets wrong.
  assert.strictEqual(id({ name: 'AI Assistant' }).name, 'AI Assistant');
});

test('saying nothing means inherit, at either level', () => {
  // The whole reason every workspace file can ship `name: default`: twenty-four pinned copies of
  // the name would make a rename in settings.yml reach nothing.
  for (const unset of ['default', 'auto', 'none', 'off', '', undefined]) {
    assert.strictEqual(id({ name: 'Studio' }, { name: unset }).name, 'Studio', `own: ${unset}`);
    assert.strictEqual(id({ placeholder: 'Ask me…' }, { placeholder: unset }).placeholder, 'Ask me…');
  }
  // And an unset GLOBAL falls through to what ships, rather than to an empty heading.
  assert.strictEqual(id({ name: 'none' }).name, 'AI Assistant');
});

test('a placeholder is a real string, whichever level set it', () => {
  assert.strictEqual(id({ placeholder: 'Ask about the workspace…' }).placeholder, 'Ask about the workspace…');
  assert.strictEqual(id({}, { placeholder: 'Ask about the Penpot instances…' }).placeholder,
    'Ask about the Penpot instances…');
});

test('the identity travels with the panel config, so the page is handed one object', () => {
  const cfg = panelConfig({ assistant: { name: 'Studio', placeholder: 'Ask…' } });
  assert.strictEqual(cfg.name, 'Studio');
  assert.strictEqual(cfg.placeholder, 'Ask…');
  // Still the voice config it always was: the identity is added to it, not instead of it.
  assert.ok(cfg.speechToText, 'the microphone survives');
});

test('the avatar is Druplicon unless it is none, and the memory folder never leaves the workspace tree', () => {
  assert.strictEqual(assistantSettings({}).avatar, 'druplicon');
  assert.strictEqual(assistantSettings({ assistant: { avatar: 'none' } }).avatar, 'none');
  assert.strictEqual(assistantSettings({ assistant: { avatar: 'clippy' } }).avatar, 'druplicon');
  assert.strictEqual(panelConfig({ assistant: { avatar: 'none' } }).avatar, 'none');
  assert.strictEqual(assistantSettings({}).memory, 'core/workspace-app/.memory');
  assert.strictEqual(assistantSettings({ assistant: { memory: 'docs/team-memory' } }).memory, 'docs/team-memory');
  for (const bad of ['../outside', '/etc', 'docs/../../x', 'a b', '']) {
    assert.strictEqual(assistantSettings({ assistant: { memory: bad } }).memory, 'core/workspace-app/.memory', bad);
  }
});
