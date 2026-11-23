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
  // The replies are read by the panel's own narrator, not by deep-chat (whose textToSpeech the panel
  // sets to false on purpose: it would speak the HTML). What must hold is that the panel was handed
  // narration that is switched on and resolved: a voice with a rate.
  const cfg = await this.page.evaluate(() => {
    const el = document.querySelector('deep-chat');
    if (!el) return null;
    try { return JSON.parse(el.dataset.settings || '{}'); } catch (_) { return {}; }
  });
  assert.ok(cfg, 'there is no deep-chat element on this page');
  assert.notStrictEqual(cfg.voiceOutput, false, 'voice output is switched off');
  assert.ok(cfg.narration && Number.isFinite(cfg.narration.rate), 'no narration voice with a speech rate, so the config is not the resolved one');
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

/* ---------------- the voice dock and voice input (#760) ---------------- */

const { Given, When, After } = require('@cucumber/cucumber');

const BASE = () => process.env.LAUNCH_URL || 'https://workspace.ddev.site';
const MIC_SWITCH = '.settings-row:has(> .settings-key > label:text-is("Microphone")) input.settings-switch';

Given(/^the browser counts the times it starts listening$/, async function () {
  // Before the page loads, so the dock finds it. It hears nothing, so a turn is never sent.
  await this.context.addInitScript(() => {
    window.wsListenStarts = 0;
    class Counted { start() { window.wsListenStarts += 1; } stop() { if (this.onend) setTimeout(() => this.onend(), 0); } }
    for (const name of ['SpeechRecognition', 'webkitSpeechRecognition']) Object.defineProperty(window, name, { value: Counted, configurable: true, writable: true });
  });
});

/** Turn the Microphone switch of settings.yml on or off through the Settings page, as a person does. Answers what it was. */
async function setVoiceInput(page, on) {
  await page.goto(`${BASE()}/settings/settings.yml`, { waitUntil: 'domcontentloaded' });
  const box = page.locator(MIC_SWITCH).first();
  await box.waitFor({ state: 'attached', timeout: 15000 });
  const was = await box.isChecked();
  if (was !== on) {
    await box.evaluate((el, want) => { el.checked = want; el.dispatchEvent(new Event('change', { bubbles: true })); }, on);
    const saved = page.waitForResponse((r) => r.url().endsWith('/actions/save-settings'), { timeout: 15000 });
    await page.locator('.settings-save button[type="submit"]').first().click();
    const res = await saved;
    assert.strictEqual(res.status(), 200, 'the settings were saved');
    assert.match(await res.text(), /Saved/);
  }
  return was;
}

Given(/^voice input is switched (on|off) in the settings$/, async function (state) {
  const was = await setVoiceInput(this.page, state === 'on');
  if (this.voiceInputWas === undefined) this.voiceInputWas = was;
});

// Put it back as it was, passed or failed.
After({ tags: '@switches-voice-input' }, async function () {
  if (this.voiceInputWas === undefined || !this.page) return;
  await setVoiceInput(this.page, this.voiceInputWas);
});

/** The dock's buttons as the page has them: 'shown', 'hidden' or 'gone'. */
async function dockButtons(page) {
  await page.waitForFunction(() => !!document.querySelector('.assistant-dock'), null, { timeout: 15000 }).catch(() => {});
  // The dock's script runs deferred: what it does to the buttons is done once the page has loaded.
  await page.waitForLoadState('load');
  return page.evaluate(() => {
    const state = (sel) => {
      const el = document.querySelector(`.assistant-dock ${sel}`);
      if (!el) return 'gone';
      return !el.hidden && getComputedStyle(el).display !== 'none' ? 'shown' : 'hidden';
    };
    return { dock: !!document.querySelector('.assistant-dock'), talk: state('.dock-talk'), keep: state('.dock-mic'), voice: state('.dock-voice') };
  });
}

Then(/^the voice dock should offer neither Hold to talk nor Keep listening$/, async function () {
  const d = await dockButtons(this.page);
  if (!d.dock) return 'skipped';   // no avatar here (assistant.avatar: none): there is no dock to check
  assert.notStrictEqual(d.talk, 'shown', 'Hold to talk is offered');
  assert.notStrictEqual(d.keep, 'shown', 'Keep listening is offered');
  return undefined;
});

Then(/^the voice dock should offer Hold to talk and Keep listening$/, async function () {
  const d = await dockButtons(this.page);
  if (!d.dock) return 'skipped';
  assert.deepStrictEqual([d.talk, d.keep], ['shown', 'shown']);
  return undefined;
});

Then(/^the voice dock should keep its voice button$/, async function () {
  assert.strictEqual((await dockButtons(this.page)).voice, 'shown', 'the voice (mute) button is voice out, and stays');
});

When(/^I hold the Space bar$/, async function () {
  // Nowhere to type: the page itself has the key.
  await this.page.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });
  await this.page.keyboard.down('Space');
  await this.page.waitForTimeout(300);
  await this.page.keyboard.up('Space');
  await this.page.waitForTimeout(200);
});

Then(/^the browser should have started listening (\d+) times?$/, async function (n) {
  assert.strictEqual(await this.page.evaluate(() => window.wsListenStarts), Number(n));
});
