/**
 * webship-js (Playwright + Cucumber-js) against the running dashboard.
 *
 * The steps come from the package rather than from a copy in this repository: webship-js is the
 * workspace's own testing stack, so the dashboard is tested with the tool the dashboard scaffolds
 * for everything else.
 *
 * It runs against the LIVE site, not a copy stood up for the occasion. The dashboard is a DDEV
 * project with a job registry and real projects behind it, and a throwaway instance would be
 * testing something other than the thing that serves.
 */

const stepsFromPackage = 'node_modules/webship-js/tests/step-definitions/**/*.js';

module.exports = {
  default: {
    // Longer than Playwright's own 30s, so a Playwright failure surfaces as its own message rather
    // than as cucumber's "function timed out".
    timeout: 45000,
    require: [stepsFromPackage, 'tests/step-definitions/**/*.js'],
    paths: ['tests/features/**/*.feature'],
    format: ['progress', 'json:tests/reports/cucumber_report.json'],
    worldParameters: {
      launchUrl: process.env.LAUNCH_URL || 'https://workspace.ddev.site',
      // DDEV signs its own certificates, and a browser in the container has no reason to trust one.
      ignoreHTTPSErrors: true,
      // webship-js pauses around every scenario by these amounts. Required, not optional: it reads
      // them without a default and a missing block fails in its own Before hook, before any step
      // has run — which reads as "13 scenarios failed" with nothing to point at.
      minWaitTime: {
        before_scenario: 0,
        after_scenario: 0,
        // The dashboard is HTMX: a click swaps a fragment in rather than loading a page, so a step
        // that asserts on the result needs the swap to have landed.
        before_step: 0,
        after_step: 250,
      },
    },
    // One at a time: these run against ONE live dashboard with shared state, and two scenarios
    // filtering the same list at once would read each other's results.
    parallel: 0,
  },
};
