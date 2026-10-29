/**
 * What a run left behind: the report, the failure screenshots, the DOM dumps and the recordings.
 *
 * A project can carry more than one report — a Drupal tree has a `tests/reports/` per module that
 * ships tests — so everything here is a list, and the row summarises the newest.
 */

const fs = require('fs');
const path = require('path');

const { esc } = require('./html');
const { humanSize, humanTime, VIDEO_RE } = require('./format');
const { workspaceDir } = require('./workspaces');

// A project's test report, if it ran the tests. varbase-e2e (Playwright + Cucumber) writes
// <module>/tests/reports/cucumber_report.{html,json}, so the search is bounded to that
// shape rather than walking a built Drupal site — a project has ~20k files under
// web/core alone.
//
// The JSON is what the row and the modal read. The HTML is a cucumber-html-reporter page
// that pulls Bootstrap, jQuery and moment from CDNs, so on an offline box it renders
// unstyled and its collapsibles do nothing; the summary is built from the JSON instead and
// works with no network at all.
function reportLabel(r) {
  const parts = r.rel.split(path.sep).filter((x) => x && x !== '.' && x !== 'tests' && x !== 'reports');
  return parts.length ? parts[parts.length - 1] : 'this project';
}

function testingStackOf(dir, project) {
  const root = path.join(dir, project);
  if (fs.existsSync(path.join(root, '.ddev', 'commands', 'web', 'init-full-automated-testing'))) return 'varbase';
  if (fs.existsSync(path.join(root, 'cucumber.js')) || fs.existsSync(path.join(root, 'tests', 'step-definitions'))) return 'varbase-e2e';
  return 'none';
}

/** Can this project actually start a suite right now? Three things have to be
 *  true, and each has a different fix, so the row says which one is missing
 *  rather than only "tests": a suite to run, the JS dependencies installed, and
 *  the shared libraries chromium links against baked into the web image (a
 *  container without them fails every scenario at browser launch with
 *  "libnspr4.so: cannot open shared object file"). */
function testingReadiness(dir, project) {
  const root = path.join(dir, project);
  const stack = testingStackOf(dir, project);
  const deps = fs.existsSync(path.join(root, 'node_modules', '@cucumber', 'cucumber'));
  const libs = fs.existsSync(path.join(root, '.ddev', 'web-build', 'Dockerfile.playwright'));
  const missing = [];
  if (stack === 'none') missing.push('a testing stack');
  if (!deps) missing.push('the JS dependencies');
  if (!libs) missing.push('the browser libraries');
  return { stack, deps, libs, ready: missing.length === 0, missing };
}

const REPORT_SEARCH_DIRS = ['packages', 'web/modules/custom', 'web/modules/contrib', 'tests', '.'];

function findTestReports(dir, project) {
  const root = path.join(dir, project);
  const found = [];
  for (const sub of REPORT_SEARCH_DIRS) {
    const base = path.join(root, sub);
    let entries = [];
    try { entries = fs.readdirSync(base, { withFileTypes: true }); } catch (_) { continue; }
    // <sub>/<module>/tests/reports/, plus <sub>/tests/reports/ for sub === '.'
    const candidates = entries.filter((e) => e.isDirectory()).map((e) => path.join(base, e.name, 'tests', 'reports'));
    candidates.push(path.join(base, 'reports'));
    for (const c of candidates) {
      const html = path.join(c, 'cucumber_report.html');
      const json = path.join(c, 'cucumber_report.json');
      if (!fs.existsSync(json) && !fs.existsSync(html)) continue;
      const rel = path.relative(root, c);
      // A run leaves more than the report: varbase-e2e writes a PNG and a DOM dump per
      // failed step into tests/screenshots/, and a recording per scenario into
      // tests/videos/. They are the evidence, so the modal links them rather than only
      // saying a scenario failed.
      const testsDir = path.dirname(c);
      // Empty artifacts are dropped, not listed. A crashed run can leave a 0-byte recording
      // or screenshot, and varbase-e2e writes a DOM dump for every failed step even when the
      // page never rendered — 81 of the 795 dumps in this tree are the literal empty
      // document `<html><head></head><body></body></html>`, 11 of the 21 in the one report
      // the test workspace shows. A link to a blank page is worse than no link.
      //
      // Judged exactly rather than by a size threshold: the smallest REAL dump here is 454
      // bytes of captured JSON, so a "too small to matter" cutoff would discard real
      // evidence. Only files small enough to be empty are opened, so this costs nothing on
      // the ones that matter.
      const isEmptyDocument = (full, size) => {
        if (size > 400) return false;
        try {
          return /<body[^>]*>\s*<\/body>/i.test(fs.readFileSync(full, 'utf8'));
        } catch (_) { return false; }
      };
      const sideFiles = (name, re) => {
        try {
          const base = path.join(testsDir, name);
          return fs.readdirSync(base)
            .filter((f) => re.test(f))
            .map((f) => {
              const full = path.join(base, f);
              let size = 0, mtimeMs = 0;
              try { const st = fs.statSync(full); size = st.size; mtimeMs = st.mtimeMs; } catch (_) { /* vanished */ }
              return { file: path.relative(root, full), name: f, size, mtimeMs, full };
            })
            .filter((f) => !(/\.html?$/i.test(f.name)
              ? (f.size === 0 || isEmptyDocument(f.full, f.size))
              : artifactIsEmpty(f.full, f.name, f.size, f.mtimeMs)))
            .map(({ full, ...rest }) => rest)
            .sort((a, b) => b.mtimeMs - a.mtimeMs || a.name.localeCompare(b.name));
        } catch (_) { return []; }
      };
      found.push({ rel, html: fs.existsSync(html) ? path.relative(root, html) : null,
        json: fs.existsSync(json) ? path.relative(root, json) : null,
        mtime: fs.statSync(fs.existsSync(json) ? json : html).mtime,
        shots: sideFiles('screenshots', /\.(png|jpe?g)$/i),
        doms: sideFiles('screenshots', /\.html?$/i),
        videos: sideFiles('videos', VIDEO_RE),
        pdfs: [...sideFiles('reports', /\.pdf$/i), ...sideFiles('.', /\.pdf$/i)],
        contrib: rel.includes(`web${path.sep}modules${path.sep}contrib`) });
    }
  }
  // The copy under web/modules/contrib is the installed one; the source copy is the one
  // to show when both exist, and they are usually byte-identical anyway.
  const seen = new Set();
  return found
    .sort((a, b) => Number(a.contrib) - Number(b.contrib) || b.mtime - a.mtime)
    .filter((r) => { const k = r.html || r.json; if (seen.has(path.basename(path.dirname(k)))) return false; return true; });
}

// Scenario tallies from the cucumber JSON. A scenario counts as failed if any step failed,
// skipped only if nothing in it ran — otherwise a partly-run scenario would be reported
// as a pass.
function testReportSummary(dir, project, report) {
  if (!report || !report.json) return null;
  let data;
  try { data = JSON.parse(fs.readFileSync(path.join(dir, project, report.json), 'utf8')); } catch (_) { return null; }
  if (!Array.isArray(data)) return null;
  const out = { features: [], scenarios: 0, passed: 0, failed: 0, skipped: 0, mtime: report.mtime };
  for (const feat of data) {
    const f = { name: feat.name || '(unnamed)', scenarios: [] };
    for (const sc of feat.elements || []) {
      if (sc.type && sc.type !== 'scenario') continue;
      const states = (sc.steps || []).map((st) => (st.result || {}).status);
      const status = states.includes('failed') ? 'failed'
        : states.some((x) => x === 'passed') ? 'passed' : 'skipped';
      const ms = (sc.steps || []).reduce((n, st) => n + ((st.result || {}).duration || 0), 0) / 1e6;
      f.scenarios.push({ name: sc.name || '(unnamed)', status, ms });
      out.scenarios += 1;
      out[status] += 1;
    }
    if (f.scenarios.length) out.features.push(f);
  }
  return out;
}

// Both are looked up per project row, and rows re-render on every job poll.
let _reportCache = new Map();
let _reportCacheAt = 0;
function invalidateTestReports() {
  _reportCache = new Map();
  _reportCacheAt = 0;
}

function testReportFor(dir, project) {
  const now = Date.now();
  if (now - _reportCacheAt > 2000) { _reportCache = new Map(); _reportCacheAt = now; }
  const k = `${dir}/${project}`;
  if (!_reportCache.has(k)) {
    const reports = findTestReports(dir, project);
    _reportCache.set(k, reports.length ? { report: reports[0], summary: testReportSummary(dir, project, reports[0]) } : null);
  }
  return _reportCache.get(k);
}

// One page of a report's screenshots or recordings. Shared by the fragment route and by the
// delete action, so a deletion re-renders byte-identical markup instead of a second copy of it.
//
// The report modal loads these lazily and paged, because 303 inline <img> and 240 links made
// "Tests" a multi-minute load.
function testMediaHtml(key, project, kind, wantPage) {
  const dir = workspaceDir(key);
  const t = testReportFor(dir, project);
  if (!t) return '<p class="uk-text-meta">No report.</p>';
  const items = kind === 'videos' ? t.report.videos : t.report.shots;   // already newest first
  if (!items.length) {
    // Reached both when a report never had any and when they have just been deleted.
    return `<p class="uk-text-meta">No ${kind === 'videos' ? 'recordings' : 'screenshots'} in this report — a run writes its own.</p>`;
  }
  const PER = 15;
  const pages = Math.max(1, Math.ceil(items.length / PER));
  const page = Math.min(pages, Math.max(1, wantPage || 1));
  const slice = items.slice((page - 1) * PER, page * PER);
  const fileUrl = (rel) => `/files/${encodeURIComponent(key)}/${encodeURIComponent(project)}/${rel.split(path.sep).map(encodeURIComponent).join('/')}`;
  const viewUrl = (name) => `/fragments/${encodeURIComponent(key)}/test-view/${encodeURIComponent(project)}?kind=${kind}&name=${encodeURIComponent(name)}`;
  // A screenshot and its DOM dump share a stem, so the row links the page it was taken from.
  const domFor = (name) => t.report.doms.find((d) => d.name.replace(/\.html?$/i, '') === name.replace(/\.(png|jpe?g)$/i, ''));
  // Deleting asks in the confirm dialog, targets this list, and never takes a path: the action looks
  // the name up in the report's own file list, exactly as the viewer does.
  const del = (extra) => `hx-post="/actions/test-media-delete" hx-vals='{"workspace":"${esc(key)}","projectName":"${esc(project)}","kind":"${kind}",${extra},"confirm":"yes"}' hx-target="#test-media-${kind}" hx-swap="innerHTML" hx-trigger="confirmed-remove"`;

  const rows = slice.map((f) => {
    const failed = /^failed_/i.test(f.name) || /FAILED/i.test(f.name);
    const dom = kind === 'shots' ? domFor(f.name) : null;
    const label = esc(f.name.replace(/^failed_/i, '').replace(/\.(png|jpe?g|webm|mp4|mov|mkv|ogv)$/i, ''));
    const meta = `${f.mtimeMs ? esc(humanTime(new Date(f.mtimeMs))) + ' · ' : ''}${esc(humanSize(f.size))}`;
    const deleteOne = `<button type="button" class="uk-button uk-button-danger uk-button-small arm-step test-media-del"
      title="${esc(`Delete ${f.name}${dom ? ' and its DOM dump' : ''}`)}" ${del(`"name":"${esc(f.name)}"`)}><span uk-icon="icon: trash; ratio: .6"></span></button>`;
    if (kind === 'shots') {
      return `
          <li class="test-shot-card">
            <button type="button" class="test-shot-thumb" title="${esc(f.name)}"
                    hx-get="${viewUrl(f.name)}" hx-target="#editor-modal-body" hx-swap="innerHTML">
              <img src="${fileUrl(f.file)}" alt="${esc(f.name)}" loading="lazy">
            </button>
            <span class="test-shot-caption uk-text-meta" title="${esc(f.name)}">${label}</span>
            <span class="test-shot-meta uk-text-meta">${meta}${failed ? ' <span class="uk-label uk-label-danger">failed</span>' : ''}
              ${dom ? `<a href="${fileUrl(dom.file)}" target="_blank" title="The DOM dump captured with this screenshot">DOM</a>` : ''}
              <a href="${fileUrl(f.file)}" target="_blank" title="Open the raw file in a new tab"><span uk-icon="icon: link-external; ratio: .55"></span></a>
              ${deleteOne}</span>
          </li>`;
    }
    return `
          <li class="test-media-row">
            <button type="button" class="test-media-name" title="${esc(f.name)}"
                    hx-get="${viewUrl(f.name)}" hx-target="#editor-modal-body" hx-swap="innerHTML">
              <span uk-icon="icon: play-circle; ratio: .8"></span>
              ${label}
            </button>
            <span class="test-media-meta uk-text-meta">${meta}${failed ? ' <span class="uk-label uk-label-danger">failed</span>' : ''}</span>
            <span class="test-media-actions">
              <a class="uk-button uk-button-default uk-button-small" href="${fileUrl(f.file)}" target="_blank" title="Open the raw file in a new tab"><span uk-icon="icon: link-external; ratio: .6"></span></a>
              ${deleteOne}
            </span>
          </li>`;
  }).join('');

  const pageUrl = (n) => `/fragments/${encodeURIComponent(key)}/test-media/${encodeURIComponent(project)}?kind=${kind}&page=${n}`;
  const pager = pages > 1 ? `
          <div class="test-media-pager uk-text-meta">
            <button type="button" class="uk-button uk-button-default uk-button-small" ${page <= 1 ? 'disabled' : `hx-get="${pageUrl(page - 1)}" hx-target="#test-media-${kind}" hx-swap="innerHTML"`}>‹</button>
            <span>${(page - 1) * PER + 1}–${Math.min(page * PER, items.length)} of ${items.length} · page ${page} of ${pages} · newest first</span>
            <button type="button" class="uk-button uk-button-default uk-button-small" ${page >= pages ? 'disabled' : `hx-get="${pageUrl(page + 1)}" hx-target="#test-media-${kind}" hx-swap="innerHTML"`}>›</button>
          </div>` : '';

  // Clearing the lot is one button, and it says how many and what else goes with them — the DOM
  // dumps are written per failed step and are useless once their screenshot is gone.
  const domCount = kind === 'shots' ? t.report.doms.length : 0;
  const bulk = `
          <div class="test-media-bulk">
            <button type="button" class="uk-button uk-button-danger uk-button-small arm-step"
                    title="${esc(`Delete all ${items.length} ${kind === 'videos' ? 'recordings' : 'screenshots'}${domCount ? ` and ${domCount} DOM dumps` : ''} of this report`)}"
                    ${del('"all":"yes"')}><span uk-icon="icon: trash; ratio: .7"></span> Delete all ${items.length} ${kind === 'videos' ? 'recordings' : 'screenshots'}${domCount ? ` + ${domCount} DOM dumps` : ''}</button>
            <span class="uk-text-meta">Evidence from a finished run — the next run writes its own.</span>
          </div>`;

  return `${bulk}<ul class="${kind === 'shots' ? 'test-shot-grid' : 'test-media-list'}">${rows}</ul>${pager}`;
}

module.exports = {
  findTestReports, testReportSummary, testReportFor, invalidateTestReports, testMediaHtml,
  reportLabel, testingStackOf, testingReadiness, REPORT_SEARCH_DIRS,
};
