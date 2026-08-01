/**
 * The browser webship-js drives.
 *
 * Not a Playwright test-runner config: webship-js reads `browser`, `launchOptions` and
 * `contextOptions` from here and launches the browser itself — cucumber-js is the runner.
 */

module.exports = {
  // Chromium only. The suite asserts behaviour, not rendering differences between engines, and
  // three browsers is three downloads for no extra answer.
  browser: 'chromium',
  launchOptions: {
    // Headless unless something asks otherwise: `HEADLESS=false ddev test-dashboard browser` shows
    // the run, which is the only time watching it is worth the window.
    headless: process.env.HEADLESS !== 'false',
    slowMo: Number(process.env.SLOW_MO || 0),
  },
  contextOptions: {
    viewport: { width: 1440, height: 900 },
    // DDEV signs its own certificates, and a browser launched here has no reason to trust one.
    ignoreHTTPSErrors: true,
  },
};
