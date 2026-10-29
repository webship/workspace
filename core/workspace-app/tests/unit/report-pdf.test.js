/**
 * The printable test report: what the document says, asserted on the document.
 *
 * The PDF goes to people who were not at the run — a product owner, a PMO, a QA lead — so what is
 * checked here is the shape they rely on: a verdict, the counts, a per-feature breakdown, and the
 * failures collected in one place instead of scattered through the run.
 *
 * WeasyPrint is not invoked: it renders this HTML, and rendering is its job to get right, not
 * something to re-assert per test. The route that calls it is exercised in the browser suite.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { testReportPdfHtml, humanDuration, statusOf } = require('../../report-pdf');

// A two-feature run: one clean, one with a failure carrying an error message — the two shapes the
// document has to handle. Durations are in nanoseconds, as cucumber writes them.
const RUN = [
  {
    name: 'Website Base Requirements - Front-end pages',
    uri: 'tests/features/01-website-base-requirements/01-06-front-end-pages.feature',
    elements: [
      { name: 'The Home page is healthy', tags: [{ name: '@check' }], steps: [
        { keyword: 'Given ', name: 'I am an anonymous user', result: { status: 'passed', duration: 1.2e9 } },
        { keyword: 'Then ', name: 'the page should have a working header', result: { status: 'passed', duration: 8e8 } },
      ] },
      { name: 'The Blog page is healthy', steps: [
        { keyword: 'Given ', name: 'I am an anonymous user', result: { status: 'passed', duration: 1e9 } },
        { keyword: 'Then ', name: 'the page should have a working header',
          result: { status: 'failed', duration: 5e9, error_message: 'Header is missing the "About Webship" link.' } },
      ] },
    ],
  },
  {
    name: 'User Management - Login',
    uri: 'tests/features/02-user-management/02-01-login.feature',
    elements: [
      { name: 'A webmaster can log in', steps: [
        { keyword: 'When ', name: 'I log in', result: { status: 'passed', duration: 2e9 } },
      ] },
      // A hidden step is cucumber's own scaffolding and is not part of what ran.
      { name: 'A hidden step is not counted', steps: [
        { keyword: 'Given ', name: 'internal', hidden: true, result: { status: 'passed', duration: 1e9 } },
        { keyword: 'Then ', name: 'I see the dashboard', result: { status: 'passed', duration: 1e9 } },
      ] },
    ],
  },
];

// A report as the dashboard records one, in a temp project directory.
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-report-'));
  fs.mkdirSync(path.join(dir, 'proj', 'tests', 'reports'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'proj', 'tests', 'reports', 'cucumber_report.json'), JSON.stringify(RUN));
  return {
    dir,
    report: {
      json: 'tests/reports/cucumber_report.json',
      html: 'tests/reports/cucumber_report.html',
      rel: 'tests/reports',
      mtime: new Date('2026-07-15T11:15:00Z'),
      shots: [],
      videos: [],
    },
  };
}

const build = () => { const f = fixture(); return testReportPdfHtml('dev', 'proj', f.report, f.dir); };

test('the document opens with what it is and how it went', () => {
  const html = build();
  assert.match(html, /Automated functional acceptance testing/);
  assert.match(html, /<h1>proj<\/h1>/);
  assert.match(html, /class="verdict FAILED">FAILED</, 'a run with a failure says so on the cover');
  assert.match(html, /dev workspace/);
});

test('a clean run says PASSED instead', () => {
  const f = fixture();
  const clean = JSON.parse(JSON.stringify(RUN));
  clean[0].elements[1].steps[1].result = { status: 'passed', duration: 5e9 };
  fs.writeFileSync(path.join(f.dir, 'proj', 'tests', 'reports', 'cucumber_report.json'), JSON.stringify(clean));
  const html = testReportPdfHtml('dev', 'proj', f.report, f.dir);
  assert.match(html, /class="verdict PASSED">PASSED</);
  assert.ok(!/What failed/.test(html), 'and carries no failures section');
});

test('the counts are the scenarios that ran, and hidden steps are not steps', () => {
  const html = build();
  // 4 scenarios: 3 passed, 1 failed. 6 steps — the hidden one is excluded.
  assert.match(html, /<span class="n">4<\/span><span class="l">scenarios/);
  assert.match(html, /<span class="n">3<\/span><span class="l">passed/);
  assert.match(html, /<span class="n">1<\/span><span class="l">failed/);
  assert.match(html, /<span class="n">6<\/span><span class="l">steps/);
  assert.match(html, /<span class="n">2<\/span><span class="l">features/);
});

test('every feature gets a row with its own pass rate', () => {
  const html = build();
  assert.match(html, /Features at a glance/);
  assert.match(html, /Website Base Requirements - Front-end pages/);
  assert.match(html, /User Management - Login/);
  // The feature with one of two scenarios failing is 50%, and its row is marked.
  assert.match(html, /class="has-failures"/);
  assert.match(html, />50%</);
  assert.match(html, />100%</);
});

test('the failures are collected before the detail, with the step that stopped', () => {
  const html = build();
  const failuresAt = html.indexOf('What failed');
  const fullRunAt = html.indexOf('The full run');
  assert.ok(failuresAt > 0 && fullRunAt > 0, 'both sections are present');
  assert.ok(failuresAt < fullRunAt, 'the failures come first — that is the part that gets acted on');
  assert.match(html, /stopped on <strong>Then the page should have a working header<\/strong>/);
  assert.match(html, /Header is missing the &quot;About Webship&quot; link\./);
});

test('an error message is escaped, not injected', () => {
  const f = fixture();
  const nasty = JSON.parse(JSON.stringify(RUN));
  nasty[0].elements[1].steps[1].result.error_message = '<script>alert(1)</script>';
  fs.writeFileSync(path.join(f.dir, 'proj', 'tests', 'reports', 'cucumber_report.json'), JSON.stringify(nasty));
  const html = testReportPdfHtml('dev', 'proj', f.report, f.dir);
  assert.ok(!html.includes('<script>alert(1)</script>'), 'the report renders text, not markup');
  assert.match(html, /&lt;script&gt;/);
});

test('the pass-rate ring is drawn inline, so it needs no network', () => {
  const html = build();
  assert.match(html, /<svg class="donut"/);
  assert.match(html, />75%<\/text>/, '3 of 4 scenarios passed');
  assert.ok(!/https?:\/\//.test(html.replace(/figma\.com|packages\.sury/g, '')) || !/<script/.test(html),
    'and the document runs no script at all');
});

test('a run with no scenarios still produces a document rather than a blank page', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-report-'));
  fs.mkdirSync(path.join(dir, 'proj', 'tests', 'reports'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'proj', 'tests', 'reports', 'cucumber_report.json'), '[]');
  const html = testReportPdfHtml('dev', 'proj',
    { json: 'tests/reports/cucumber_report.json', rel: 'tests/reports', mtime: new Date(), shots: [], videos: [] }, dir);
  assert.match(html, /This report contains no scenarios/);
  assert.match(html, /NO SCENARIOS/);
});

test('an unreadable report is a document that says so, not a crash', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-report-'));
  fs.mkdirSync(path.join(dir, 'proj'), { recursive: true });
  const html = testReportPdfHtml('dev', 'proj',
    { json: 'tests/reports/missing.json', rel: 'tests/reports', mtime: new Date(), shots: [], videos: [] }, dir);
  assert.match(html, /This report contains no scenarios/);
});

test('a duration is reported in the unit a person would say out loud', () => {
  assert.equal(humanDuration(0), '—');
  assert.equal(humanDuration(1.5e9), '1.5 s');
  assert.equal(humanDuration(90e9), '1 min 30 s');
  assert.equal(humanDuration(3900e9), '1 h 5 min');
});

test('a scenario is failed if any step failed, skipped if none ran', () => {
  assert.equal(statusOf([{ result: { status: 'passed' } }, { result: { status: 'failed' } }]), 'failed');
  assert.equal(statusOf([{ result: { status: 'passed' } }]), 'passed');
  assert.equal(statusOf([{ result: { status: 'skipped' } }]), 'skipped');
  assert.equal(statusOf([{ result: { status: 'undefined' } }]), 'undefined');
});
