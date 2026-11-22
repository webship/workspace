/**
 * Steps for the page's own scripts (src/browser, built into public/): what each one does, read from the page.
 *
 * The spoken summary and the voice are the narrator's own functions on window. The card reorder is the keyboard
 * path of the home page's sortable list. The player is a recording card put in the editor window the way a swap
 * puts one there, so it needs no recording on the machine.
 */

'use strict';

const { Given, When, Then } = require('@cucumber/cucumber');
const assert = require('assert');

const CARDS = '[data-sortable=".ws-card-wrap"] > .ws-card-wrap';
const cardOrder = (page) => page.$$eval(CARDS, (els) => els.map((e) => e.dataset.ws));

Then(/^the spoken summary of "([^"]*)" should be "([^"]*)"$/, async function (html, said) {
  const got = await this.page.evaluate((h) => window.wsNarration && window.wsNarration.summaryFromHtml(h), html);
  assert.strictEqual(got, said);
});

Then(/^the voice chosen from "([^"]*)" should be "([^"]*)"$/, async function (names, want) {
  const voices = names.split(',').map((n) => ({ name: n.trim(), lang: 'en-US' }));
  const got = await this.page.evaluate((v) => {
    const best = window.wsNarration && window.wsNarration.bestVoice(v, 'en-US');
    return best ? best.name : null;
  }, voices);
  assert.strictEqual(got, want);
});

When(/^I move the first workspace card one place on with the keyboard$/, async function () {
  if (!this.cardsAtStart) this.cardsAtStart = await cardOrder(this.page);
  assert.ok(this.cardsAtStart.length >= 2, `the home page has ${this.cardsAtStart.length} workspace card(s), two are needed`);
  const saved = this.page.waitForResponse((r) => r.url().endsWith('/actions/list-order'));
  await this.page.focus(`${CARDS}:first-child a.workspace-card`);
  await this.page.keyboard.press('Alt+ArrowRight');
  const res = await saved;
  assert.strictEqual(res.status(), 200, 'the new order was saved');
});

Then(/^the first two workspace cards should have changed places$/, async function () {
  const now = await cardOrder(this.page);
  const [a, b] = this.cardsAtStart;
  assert.deepStrictEqual(now.slice(0, 2), [b, a]);
});

Then(/^the workspace cards should be in the order they had$/, async function () {
  assert.deepStrictEqual(await cardOrder(this.page), this.cardsAtStart);
});

When(/^a recording opens in the editor window$/, async function () {
  await this.page.evaluate(() => {
    const body = document.getElementById('editor-modal-body');
    body.innerHTML = '<div class="media-card"><audio preload="none"></audio><span data-speed-label></span>'
      + '<button type="button" data-sound-speed="2">2×</button><label><input type="checkbox" data-sound-loop> Loop</label>'
      + '<div data-chapters=\'[{"start":0,"end":5,"title":"One"},{"start":5,"end":9,"title":"Two"}]\'></div><span data-chapter hidden></span></div>';
    if (window.UIkit && window.UIkit.modal) window.UIkit.modal('#editor-modal').show();
    document.body.dispatchEvent(new CustomEvent('htmx:after:swap', { detail: { target: body } }));
  });
  await this.page.waitForSelector('#editor-modal-body .media-card[data-ready]', { state: 'attached' });
});

const player = (page) => page.evaluate(() => {
  const media = document.querySelector('#editor-modal-body .media-card audio');
  return media ? { rate: media.playbackRate, loop: media.loop, label: document.querySelector('#editor-modal-body [data-speed-label]').textContent } : null;
});

Then(/^the recording should play at ([0-9.]+) times its speed$/, async function (rate) {
  const p = await player(this.page);
  assert.ok(p, 'there is no recording in the editor window');
  assert.strictEqual(p.rate, Number(rate));
  assert.strictEqual(p.label, `${Number(rate)}×`, 'the speed label says it');
});

Then(/^the recording should show (\d+) chapters$/, async function (n) {
  assert.strictEqual(await this.page.$$eval('#editor-modal-body .chapter-seg', (s) => s.length), Number(n));
});

Then(/^the speed ([0-9.]+) should be kept for the next recording$/, async function (rate) {
  assert.strictEqual(await this.page.evaluate(() => localStorage.getItem('ws-media-speed')), String(Number(rate)));
});

Then(/^the recording should loop$/, async function () {
  const p = await player(this.page);
  assert.ok(p && p.loop, 'the recording does not loop');
});

/* ---------------- the field microphones ---------------- */

const FIELDS = '.field-mic-wrap > input[type="text"], .field-mic-wrap > input:not([type])';

Given(/^the browser hears "([^"]*)" when it listens$/, async function (phrase) {
  // Before the page loads, so mic.js finds it. The browser's own recogniser is not writable as a plain property.
  await this.context.addInitScript((said) => {
    class Heard {
      start() {
        const result = Object.assign([{ transcript: said }], { isFinal: true });
        setTimeout(() => { if (this.onresult) this.onresult({ resultIndex: 0, results: [result] }); if (this.onend) this.onend(); }, 50);
      }
    }
    for (const name of ['SpeechRecognition', 'webkitSpeechRecognition']) Object.defineProperty(window, name, { value: Heard, configurable: true, writable: true });
  }, phrase);
});

Then(/^every text field should have a microphone named after it$/, async function () {
  const labels = await this.page.$$eval('.field-mic', (b) => b.map((x) => x.getAttribute('aria-label') || ''));
  assert.ok(labels.length > 0, 'no field microphone on this page');
  for (const l of labels) assert.match(l, /^Dictate into \S/);
  assert.strictEqual(await this.page.$$eval(FIELDS, (f) => f.length), await this.page.$$eval('.field-mic-wrap > input, .field-mic-wrap > textarea', (f) => f.length));
});

When(/^I press the microphone of the first text field$/, async function () {
  // The field may be in a folded section: the button is pressed as a click on it, the way a person's would land.
  await this.page.$eval(FIELDS, (f) => { f.value = ''; f.nextElementSibling.click(); });
});

Then(/^the first text field should read "([^"]*)"$/, async function (text) {
  await this.page.waitForFunction(([sel, want]) => document.querySelector(sel).value === want, [FIELDS, text], { timeout: 5000 }).catch(() => {});
  assert.strictEqual(await this.page.$eval(FIELDS, (f) => f.value), text);
});

/* ---------------- the palette ---------------- */

Then(/^the palette should be open$/, async function () {
  await this.page.waitForSelector('#palette:not([hidden])', { timeout: 5000 });
});

Then(/^the palette should be closed$/, async function () {
  assert.ok(await this.page.$eval('#palette', (p) => p.hidden), 'the palette is still open');
});

When(/^I type "([^"]*)" in the palette$/, async function (text) {
  await this.page.type('#palette .palette-input', text);
});

Then(/^the first result of the palette should be "([^"]*)"$/, async function (label) {
  await this.page.waitForFunction((want) => {
    const first = document.querySelector('#palette-list [role=option] .palette-label');
    return first && first.textContent === want;
  }, label, { timeout: 5000 }).catch(() => {});
  assert.strictEqual(await this.page.$eval('#palette-list [role=option] .palette-label', (l) => l.textContent), label);
});

Then(/^the palette should announce "([^"]*)"$/, async function (said) {
  assert.strictEqual(await this.page.textContent('.palette-live'), said);
});

Then(/^the palette should show the keyboard shortcuts$/, async function () {
  await this.page.waitForSelector('#palette:not([hidden]) .palette-shortcut', { timeout: 5000 });
  const keys = await this.page.$$eval('#palette-list .palette-shortcut kbd', (k) => k.map((x) => x.textContent));
  assert.ok(keys.includes('?') && keys.some((k) => /^g /.test(k)), `the sheet: ${keys.join(', ')}`);
});

/* ---------------- the suggestions ---------------- */

Then(/^"([^"]*)" should ask for "([^"]*)" names, and "([^"]*)" should not$/, async function (asks, trigger, not) {
  const [yes, no] = await this.page.evaluate(([a, b]) => [window.wsSuggest.tokenAt(a, a.length), window.wsSuggest.tokenAt(b, b.length)], [asks, not]);
  assert.ok(yes && yes.trigger === trigger && yes.at === 0, `"${asks}": ${JSON.stringify(yes)}`);
  assert.strictEqual(no, null, `"${not}" is an address, not a name`);
});

When(/^a field asks for suggestions from "([^"]*)"$/, async function (url) {
  await this.page.evaluate((u) => {
    const t = document.createElement('textarea');
    t.id = 'suggest-probe';
    t.setAttribute('aria-label', 'Suggestions probe');
    t.dataset.suggest = u;
    document.body.appendChild(t);
    window.wsSuggest.attachAll(document.body);
  }, url);
  this.suggestUrl = url;
});

When(/^I type "([^"]*)" in that field$/, async function (text) {
  this.suggestAsked = this.page.waitForRequest((r) => r.url().includes(this.suggestUrl) && r.url().includes(`trigger=${encodeURIComponent(text[0])}`), { timeout: 5000 })
    .then(() => true).catch(() => false);
  await this.page.focus('#suggest-probe');
  await this.page.keyboard.type(text);
});

Then(/^the dashboard should be asked for "([^"]*)" names$/, async function (trigger) {
  assert.ok(await this.suggestAsked, `no request for "${trigger}" names was made`);
});
