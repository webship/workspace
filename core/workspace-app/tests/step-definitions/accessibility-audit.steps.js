/**
 * An axe-core audit of every workspace page and of every tab of the Settings modal, in the light style and
 * the dark one.
 *
 * webship-js's own step ("the page should have no accessibility violations") audits the page it is on.
 * These two walk what a person can reach instead of a list kept here: the workspace pages the home links to,
 * and the tabs the Settings modal draws. A workspace or a plugin added later is audited without a line here.
 *
 * Every rule axe has is run, as webship-js's step runs them: WCAG 2.0, 2.1 and 2.2 at A and AA, and the best
 * practices. What fails is listed in full (page or tab, style, rule, the first nodes), not counted.
 */

const assert = require('node:assert');
const { Then } = require('@cucumber/cucumber');
const AxeBuilder = require('@axe-core/playwright').default;

// A walk of every page or tab, twice: far longer than one step's 45 seconds.
const WALK = { timeout: 20 * 60 * 1000 };

async function violations(page, include) {
  let builder = new AxeBuilder({ page });
  if (include) builder = builder.include(include);
  const result = await builder.analyze();
  return result.violations.map((v) => `[${v.impact}] ${v.id}: ${v.help} (${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')})`);
}

/** Runs `walk(style)` in the light style, then the dark one; the style is the dashboard's own switch. */
async function inBothStyles(world, walk) {
  const found = [];
  for (const style of ['light', 'dark']) {
    await world.page.evaluate((s) => { localStorage.setItem('ws-theme', s); }, style);
    found.push(...await walk(style));
  }
  return found;
}

const report = (found) => `${found.length} violation(s):\n  ${found.join('\n  ')}`;

Then(/^every workspace page should have no accessibility violations, in the light style and the dark one$/, WALK, async function () {
  const origin = new URL(this.page.url()).origin;
  const pages = await this.page.$$eval('#workspace-cards a[href]', (links) => [...new Set(links
    .map((a) => new URL(a.getAttribute('href'), location.href))
    .filter((u) => u.origin === location.origin && /^\/[a-z0-9-]+$/.test(u.pathname))
    .map((u) => u.pathname))]);
  assert.ok(pages.length > 0, 'the home links to no workspace page');
  const found = await inBothStyles(this, async (style) => {
    const out = [];
    for (const p of pages) {
      await this.page.goto(origin + p, { waitUntil: 'networkidle' });
      out.push(...(await violations(this.page)).map((v) => `${p}, ${style}: ${v}`));
    }
    return out;
  });
  assert.deepStrictEqual(found, [], report(found));
});

Then(/^every tab of the Settings modal should have no accessibility violations, in the light style and the dark one$/, WALK, async function () {
  const origin = new URL(this.page.url()).origin;
  const found = await inBothStyles(this, async (style) => {
    await this.page.goto(`${origin}/`, { waitUntil: 'networkidle' });
    // The rail's Settings opens the modal over the page (a collapsed rail shows it as an icon).
    await this.page.evaluate(() => document.querySelector('a[data-tabmodal-open="/fragments/settings/modal"]').click());
    await this.page.waitForSelector('#editor-modal [role="tab"]', { state: 'visible' });
    // The content is in and the modal is named by its heading (#811), before anything is checked.
    await this.page.waitForFunction(() => {
      const dialog = document.querySelector('#editor-modal .uk-modal-dialog');
      const id = dialog && dialog.getAttribute('aria-labelledby');
      const h = id && document.getElementById(id);
      return !!(h && h.textContent.trim());
    }, null, { timeout: 20000 });
    const tabs = await this.page.$$eval('#editor-modal [role="tab"]', (all) => all.map((t) => t.dataset.tab));
    assert.ok(tabs.length > 1, 'the Settings modal drew no tabs');
    const out = [];
    for (const id of tabs) {
      const tab = this.page.locator(`#editor-modal [role="tab"][data-tab="${id}"]`);
      await tab.scrollIntoViewIfNeeded();
      await tab.click();
      // The pane is busy until the tab's content has arrived (tab-modal.mts, ui.js).
      await this.page.waitForFunction(() => {
        const pane = document.querySelector('#editor-modal .tabmodal-pane');
        return pane && pane.getAttribute('aria-busy') !== 'true';
      }, null, { timeout: 20000 });
      await this.page.waitForLoadState('networkidle');
      out.push(...(await violations(this.page, '#editor-modal')).map((v) => `Settings → ${id}, ${style}: ${v}`));
    }
    return out;
  });
  assert.deepStrictEqual(found, [], report(found));
});
