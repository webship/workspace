/**
 * Steps for the page's own scripts (src/browser, built into public/): what each one does, read from the page.
 *
 * The spoken summary and the voice are the narrator's own functions on window. The card reorder is the keyboard
 * path of the home page's sortable list. The player is a recording card put in the editor window the way a swap
 * puts one there, so it needs no recording on the machine.
 */

'use strict';

const { When, Then } = require('@cucumber/cucumber');
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
