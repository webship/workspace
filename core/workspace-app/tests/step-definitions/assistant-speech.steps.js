/**
 * Steps for the assistant's voice configuration.
 *
 * These read the LIVE properties off the deep-chat element rather than the page source, because the
 * page source cannot tell you whether the component accepted anything. deep-chat is configured with
 * JavaScript properties (the objects cannot survive an HTML attribute), and it silently ignores keys
 * it does not recognise — so "the config is in ui.js" and "the component is using it" are different
 * facts, and only the second one matters.
 *
 * Nothing here speaks or listens. An automated browser is not granted a microphone, and a scenario
 * cannot talk. What CAN break without anyone noticing is the microphone being absent, or present
 * with a configuration deep-chat quietly dropped, and that is what these assert.
 */

'use strict';

const { Then } = require('@cucumber/cucumber');
const assert = require('assert');

/** The properties deep-chat is actually holding, read from inside the page. */
async function speechConfig(page) {
  return page.evaluate(() => {
    const el = document.querySelector('deep-chat');
    if (!el) return null;
    return {
      speechToText: el.speechToText === undefined ? 'unset' : el.speechToText,
      textToSpeech: el.textToSpeech === undefined ? 'unset' : el.textToSpeech,
      placeholder: (el.textInput && el.textInput.placeholder && el.textInput.placeholder.text) || '',
    };
  });
}

Then(/^the assistant should offer voice input$/, async function () {
  const cfg = await speechConfig(this.page);
  assert.ok(cfg, 'there is no deep-chat element on this page');
  assert.notStrictEqual(cfg.speechToText, 'unset', 'deep-chat was never given a speechToText config');
  assert.notStrictEqual(cfg.speechToText, false, 'voice input is switched off');
  assert.ok(cfg.speechToText.webSpeech, 'no speech backend is configured, so the microphone does nothing');
});

Then(/^the assistant should read its replies aloud$/, async function () {
  const cfg = await speechConfig(this.page);
  assert.ok(cfg, 'there is no deep-chat element on this page');
  assert.notStrictEqual(cfg.textToSpeech, 'unset', 'deep-chat was never given a textToSpeech config');
  assert.notStrictEqual(cfg.textToSpeech, false, 'voice output is switched off');
  // Its presence IS the read-aloud behaviour; there is no separate switch to check.
  assert.ok(Number.isFinite(cfg.textToSpeech.rate), 'no speech rate, so the config is not the resolved one');
});

/**
 * What the composer LOOKS like, from inside deep-chat's shadow root.
 *
 * Its input lives in that shadow root, and so does the microphone, so neither is reachable from the
 * page's own DOM — and the placeholder is drawn as a pseudo-element, which has no node at all. The
 * only honest way to ask "is anything drawn there" is the computed `content`, which is why this
 * reads styles rather than text.
 */
async function composer(page) {
  return page.evaluate(() => {
    const el = document.querySelector('deep-chat');
    const root = el && el.shadowRoot;
    if (!root) return null;
    const input = root.querySelector('#text-input');
    const mic = root.querySelector('#microphone-button');
    return {
      drawn: input ? getComputedStyle(input, '::before').content : null,
      name: input ? input.getAttribute('aria-label') : null,
      mic: !!mic,
      micName: mic ? (mic.getAttribute('aria-label') || '') : '',
    };
  });
}

Then(/^the assistant should show a named microphone button$/, async function () {
  const c = await composer(this.page);
  assert.ok(c, 'there is no deep-chat element on this page');
  assert.ok(c.mic, 'there is no microphone in the composer, so nothing says voice is available');
  // deep-chat's own buttons are role="button" with an SVG inside and no accessible name, so this is
  // a name ui.js puts on. Without it a screen reader announces an unnamed button.
  assert.ok(c.micName.trim(), 'the microphone has no accessible name');
});

Then(/^the assistant composer should draw no placeholder$/, async function () {
  const c = await composer(this.page);
  assert.ok(c, 'there is no deep-chat element on this page');
  // An empty `content` is the only thing that means nothing is drawn. "none" would mean the
  // pseudo-element is absent, which is also fine; a string means deep-chat's "Ask me anything!" is
  // back, which is what an empty placeholder.text silently restores.
  assert.ok(c.drawn === '""' || c.drawn === 'none' || c.drawn === '',
    `the composer is drawing a placeholder: ${c.drawn}`);
});

Then(/^the assistant composer should have an accessible name$/, async function () {
  const c = await composer(this.page);
  assert.ok(c, 'there is no deep-chat element on this page');
  assert.ok(c.name && c.name.trim(),
    'the composer has no accessible name, so a screen reader announces an unlabelled text box');
});

Then(/^the assistant speech language should be pinned$/, async function () {
  const cfg = await speechConfig(this.page);
  // A pinned language is the shipped default (en-US), because a recogniser left on the browser's
  // language does not fail on the wrong one — it returns confident nonsense. `true` here would mean
  // nothing is pinned, which is a valid choice but not what ships.
  const ws = cfg.speechToText.webSpeech;
  assert.ok(ws && typeof ws === 'object' && ws.language,
    `no language is pinned (webSpeech is ${JSON.stringify(ws)}); the shipped default is en-US`);
  assert.match(ws.language, /^[a-z]{2}-[A-Z]{2}$/, `"${ws.language}" is not a BCP-47 tag`);
});

Then(/^the assistant should have no voice commands$/, async function () {
  const cfg = await speechConfig(this.page);
  // Absent, not empty. An empty phrase is not a disabled command — it is one that fires on anything.
  assert.ok(!('commands' in cfg.speechToText),
    `voice commands are armed with nothing configured: ${JSON.stringify(cfg.speechToText.commands)}`);
});

Then(/^the assistant speech colours should be design tokens$/, async function () {
  const cfg = await speechConfig(this.page);
  const { textColor } = cfg.speechToText;
  assert.ok(textColor, 'interim and final speech text have no colours set');
  for (const key of ['interim', 'final']) {
    assert.match(textColor[key], /^var\(--/,
      `speech ${key} colour is "${textColor[key]}", a literal that cannot follow the theme`);
  }
});

Then(/^the voice list should report what this browser has$/, async function () {
  // The reading voice is a dropdown the server cannot fill in: which voices exist belongs to the
  // browser and the OS. Either it gained real options, or it says there are none — an empty select
  // with no explanation is the failure this guards, because that reads as "still loading" forever.
  const state = await this.page.evaluate(async () => {
    const select = document.querySelector('select[data-voice-name]');
    const note = document.querySelector('[data-voice-list]');
    if (!select) return { missing: true };
    for (let i = 0; i < 20 && select.dataset.done !== '1'; i += 1) {
      await new Promise((r) => setTimeout(r, 200));
    }
    return {
      resolved: select.dataset.done === '1',
      options: select.options.length,
      hasDefault: [...select.options].some((o) => o.value === 'default'),
      warns: !!(note && note.querySelector('.uk-text-danger')),
      note: (note ? note.textContent : '').trim().slice(0, 80),
    };
  });
  assert.ok(!state.missing, 'the reading voice is not a dropdown');
  assert.ok(state.resolved, 'the voice list never resolved — it waits for voiceschanged with a timeout');
  assert.ok(state.hasDefault, 'there is no "default" option, so the browser default is unreachable');
  assert.ok(state.options > 1 || state.warns,
    `only the default option and no explanation of why: "${state.note}"`);
});
