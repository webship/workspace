/**
 * The automated-testing report, rendered for paper.
 *
 * Built from the run's JSON rather than from cucumber-html-reporter's page. Printing that page
 * produced an unreadable PDF and it was not fixable there: its feature and scenario bodies are
 * Bootstrap 3 collapsibles that open only once jQuery and Bootstrap have loaded from a CDN and
 * somebody has clicked, so a print is a list of closed headers — and offline it is unstyled on top
 * of that. The JSON carries everything the page shows, so this renders it directly.
 *
 * The audience is not the person who ran it. This goes to a product owner, a PMO and a QA lead, so
 * it opens with the verdict and the shape of the run, puts the failures first (that is the part
 * that gets acted on), and only then lists every scenario and step. It is a document, not a dump.
 *
 * Rendered by WeasyPrint, which honours @page, running footers, `break-inside: avoid` and inline
 * SVG. Chromium prints too, but ignores most of that and re-fetches the CDN assets.
 */

const fs = require('fs');
const path = require('path');

const { esc } = require('./html');
const { humanTime } = require('./format');
const { CONFIG_DIR } = require('./workspaces');

// Status colours are the one place this file names a colour outright: a PDF has no theme to
// follow, and green-for-passed has to be the same green in every report anybody compares.
const OK = '#1f8a4c';
const BAD = '#c0362c';
const WARN = '#b26a00';
const MUTED = '#8a8a8a';

const ms = (ns) => (ns ? `${(ns / 1e6).toFixed(0)} ms` : '—');

// Long runs are reported in the unit a person would say out loud.
function humanDuration(ns) {
  const s = ns / 1e9;
  if (!s) return '—';
  if (s < 60) return `${s.toFixed(1)} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${Math.round(s - m * 60)} s`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

function statusOf(steps) {
  const states = steps.map((st) => (st.result || {}).status);
  return states.includes('failed') ? 'failed'
    : states.includes('undefined') || states.includes('ambiguous') ? 'undefined'
      : states.some((x) => x === 'passed') ? 'passed' : 'skipped';
}

// A pass-rate ring, drawn as inline SVG rather than fetched from a chart library: it has to render
// with no network and inside WeasyPrint, and one arc is not worth a dependency.
function donut(passed, failed, skipped, total) {
  if (!total) return '';
  const R = 26, C = 2 * Math.PI * R;
  const seg = (n, colour, offset) => (n
    ? `<circle cx="34" cy="34" r="${R}" fill="none" stroke="${colour}" stroke-width="12"
         stroke-dasharray="${((n / total) * C).toFixed(2)} ${C.toFixed(2)}"
         stroke-dashoffset="${(-offset / total * C).toFixed(2)}" transform="rotate(-90 34 34)"/>`
    : '');
  const pct = Math.round((passed / total) * 100);
  return `<svg class="donut" width="68" height="68" viewBox="0 0 68 68" aria-hidden="true">
    <circle cx="34" cy="34" r="${R}" fill="none" stroke="#e8e8e8" stroke-width="12"/>
    ${seg(passed, OK, 0)}${seg(failed, BAD, passed)}${seg(skipped, MUTED, passed + failed)}
    <text x="34" y="38" text-anchor="middle" font-size="15" font-weight="700">${pct}%</text>
  </svg>`;
}

/**
 * @param {string} key       the workspace the project is in
 * @param {string} project   the project directory name
 * @param {object} report    the report record (json, html, mtime, rel, shots, videos)
 * @param {string} dir       the workspace directory
 */
function testReportPdfHtml(key, project, report, dir) {
  let data = [];
  try { data = JSON.parse(fs.readFileSync(path.join(dir, project, report.json), 'utf8')); } catch (_) { data = []; }
  const brand = (() => {
    try { return JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'brand-tokens.json'), 'utf8')).tokens || {}; } catch (_) { return {}; }
  })();
  const c = (name, fallback) => brand[name] || fallback;

  // A failed step's screenshot, inlined: a PDF that references a file on this machine shows
  // nothing to whoever it is sent to. Matched by the stem convention webship-js writes.
  const shotFor = (scenarioName) => {
    const stem = scenarioName.toLowerCase().replace(/[^a-z0-9]+/g, '');
    const hit = (report.shots || []).find((f) => f.name.toLowerCase().replace(/[^a-z0-9]+/g, '').includes(stem.slice(0, 24)));
    if (!hit) return null;
    try {
      const full = path.join(dir, project, hit.file);
      // A report of a bad run can carry a hundred of these. Above 1.5 MB the picture is a full-page
      // screenshot whose detail the PDF cannot show anyway, and ten of them make a file nobody can
      // email — the report says the screenshot exists and where, instead.
      if (fs.statSync(full).size > 1.5 * 1024 * 1024) return { oversize: hit.name };
      const b64 = fs.readFileSync(full).toString('base64');
      const type = /\.jpe?g$/i.test(hit.file) ? 'jpeg' : 'png';
      return { src: `data:image/${type};base64,${b64}`, name: hit.name };
    } catch (_) { return null; }
  };

  const shotHtml = (scenarioName) => {
    const s = shotFor(scenarioName);
    if (!s) return '';
    if (s.oversize) {
      return `<p class="shot-note">Screenshot too large to embed: <code>${esc(s.oversize)}</code> — see the run's screenshots directory.</p>`;
    }
    return `<figure class="shot"><img src="${s.src}" alt=""><figcaption>${esc(s.name)}</figcaption></figure>`;
  };

  // One pass over the JSON, collecting what both the summary and the detail need.
  let scenarios = 0, passed = 0, failed = 0, skipped = 0, stepCount = 0, totalNs = 0;
  const featureStats = [];
  const failures = [];

  const features = data.map((feat) => {
    const featName = feat.name || '(unnamed feature)';
    let fScen = 0, fPass = 0, fFail = 0, fSkip = 0, fNs = 0;

    const rows = (feat.elements || []).filter((sc) => !sc.type || sc.type === 'scenario').map((sc) => {
      const steps = (sc.steps || []).filter((st) => !st.hidden);
      const status = statusOf(steps);
      const scNs = steps.reduce((n, st) => n + ((st.result || {}).duration || 0), 0);
      scenarios += 1; stepCount += steps.length; totalNs += scNs;
      fScen += 1; fNs += scNs;
      if (status === 'passed') { passed += 1; fPass += 1; } else if (status === 'failed') { failed += 1; fFail += 1; } else { skipped += 1; fSkip += 1; }

      const tags = (sc.tags || []).map((t) => t.name).join(' ');
      const stepRows = steps.map((st) => {
        const r = st.result || {};
        const err = r.error_message
          ? `<tr class="err"><td colspan="3"><pre>${esc(String(r.error_message).slice(0, 4000))}</pre></td></tr>` : '';
        return `<tr class="s-${esc(r.status || 'unknown')}">
            <td class="kw">${esc(st.keyword || '')}</td>
            <td>${esc(st.name || '')}</td>
            <td class="num">${esc(ms(r.duration))}</td>
          </tr>${err}`;
      }).join('');

      if (status === 'failed') {
        const firstErr = steps.map((st) => (st.result || {}).error_message).find(Boolean) || '';
        const failedStep = steps.find((st) => (st.result || {}).status === 'failed');
        failures.push({
          feature: featName,
          name: sc.name || '(unnamed)',
          step: failedStep ? `${failedStep.keyword || ''}${failedStep.name || ''}`.trim() : '',
          error: String(firstErr).slice(0, 1200),
          shot: shotHtml(sc.name || ''),
        });
      }

      return `<section class="scenario ${status}">
        <h3><span class="pill ${status}">${status}</span> ${esc(sc.name || '(unnamed)')}</h3>
        ${tags ? `<p class="tags">${esc(tags)}</p>` : ''}
        <table class="steps"><tbody>${stepRows}</tbody></table>
        <p class="scenario-meta">${steps.length} steps · ${esc(ms(scNs))}</p>
      </section>`;
    }).join('');

    if (!rows) return '';
    featureStats.push({ name: featName, uri: feat.uri || '', scenarios: fScen, passed: fPass, failed: fFail, skipped: fSkip, ns: fNs });
    return `<section class="feature">
      <h2>${esc(featName)}</h2>
      <p class="feature-meta">${fScen} scenario${fScen === 1 ? '' : 's'} ·
        <span class="ok">${fPass} passed</span>${fFail ? ` · <span class="bad">${fFail} failed</span>` : ''}${fSkip ? ` · ${fSkip} skipped` : ''} ·
        ${esc(humanDuration(fNs))}${feat.uri ? ` · <span class="uri">${esc(feat.uri)}</span>` : ''}</p>
      ${rows}</section>`;
  }).join('');

  const pct = scenarios ? Math.round((passed / scenarios) * 100) : 0;
  const verdict = failed ? 'FAILED' : scenarios ? 'PASSED' : 'NO SCENARIOS';

  const featureTable = featureStats.length ? `
    <table class="glance">
      <thead><tr><th>Feature</th><th class="n">Scenarios</th><th class="n">Passed</th><th class="n">Failed</th><th class="n">Pass rate</th><th class="n">Time</th></tr></thead>
      <tbody>${featureStats.map((f) => `
        <tr class="${f.failed ? 'has-failures' : ''}">
          <td>${esc(f.name)}</td>
          <td class="n">${f.scenarios}</td>
          <td class="n ok">${f.passed}</td>
          <td class="n ${f.failed ? 'bad' : ''}">${f.failed || '—'}</td>
          <td class="n">${f.scenarios ? Math.round((f.passed / f.scenarios) * 100) : 0}%</td>
          <td class="n">${esc(humanDuration(f.ns))}</td>
        </tr>`).join('')}</tbody>
    </table>` : '';

  const failuresSection = failures.length ? `
    <section class="failures">
      <h2 class="failures-h">What failed <span class="count">${failures.length}</span></h2>
      <p class="section-lede">Every failing scenario, with the step it stopped on and the screenshot taken at that
        moment. The full run follows.</p>
      ${failures.map((f, i) => `
        <section class="failure">
          <h3><span class="idx">${i + 1}</span> ${esc(f.name)}</h3>
          <p class="failure-where">${esc(f.feature)}${f.step ? ` · stopped on <strong>${esc(f.step)}</strong>` : ''}</p>
          ${f.error ? `<pre class="failure-err">${esc(f.error)}</pre>` : ''}
          ${f.shot}
        </section>`).join('')}
    </section>` : '';

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(project)} — automated test report</title>
<style>
  @page {
    size: A4; margin: 20mm 16mm 18mm 16mm;
    @top-right { content: "${esc(project)}"; font-size: 7.5pt; color: ${c('text-subtle', '#4d4d4d')}; }
    @bottom-left { content: "Automated functional acceptance testing"; font-size: 7.5pt; color: ${c('text-subtle', '#4d4d4d')}; }
    @bottom-right { content: "Page " counter(page) " of " counter(pages); font-size: 7.5pt; color: ${c('text-subtle', '#4d4d4d')}; }
  }
  /* The cover carries the running header nowhere: a title page with a header on it reads as
     page two of something else. */
  @page :first { @top-right { content: ""; } }

  body { font-family: "DejaVu Sans", "Helvetica Neue", Arial, sans-serif; font-size: 9.5pt;
         color: ${c('text-default', '#000')}; line-height: 1.45; }

  /* ---- cover ---- */
  .cover { border-bottom: 3px solid ${c('brand-primary', '#0074e0')}; padding-bottom: 5mm; margin-bottom: 6mm; }
  .eyebrow { font-size: 8pt; letter-spacing: .10em; text-transform: uppercase;
             color: ${c('brand-primary', '#0074e0')}; margin: 0 0 1mm; font-weight: 600; }
  h1 { font-size: 22pt; margin: 0 0 2mm; color: ${c('brand-secondary', '#2b447c')}; line-height: 1.15; }
  .lede { color: ${c('text-subtle', '#4d4d4d')}; margin: 0; font-size: 9pt; }
  .verdict { display: inline-block; margin-top: 3mm; padding: 1.2mm 4mm; border-radius: 1mm;
             font-size: 10pt; font-weight: 700; letter-spacing: .06em; color: #fff; background: ${MUTED}; }
  .verdict.PASSED { background: ${OK}; } .verdict.FAILED { background: ${BAD}; }

  /* ---- summary ---- */
  .summary-row { display: flex; gap: 5mm; align-items: center; margin: 0 0 7mm; }
  .donut-wrap { flex: 0 0 auto; text-align: center; }
  .donut-wrap .cap { font-size: 7pt; text-transform: uppercase; letter-spacing: .04em;
                     color: ${c('text-subtle', '#4d4d4d')}; display: block; margin-top: 1mm; }
  .summary { display: flex; gap: 2.5mm; flex: 1; }
  .tile { flex: 1; border: 1px solid ${c('brand-light', '#ebe8e5')}; border-radius: 2mm;
          padding: 2.5mm 1mm; text-align: center; background: ${c('subtle-light', '#f5f3f2')}; }
  .tile .n { display: block; font-size: 15pt; font-weight: 700; line-height: 1.1; }
  .tile .l { font-size: 6.8pt; text-transform: uppercase; letter-spacing: .04em;
             color: ${c('text-subtle', '#4d4d4d')}; }
  .tile.ok .n { color: ${OK}; } .tile.bad .n { color: ${BAD}; }
  .tile.brand .n { color: ${c('brand-primary', '#0074e0')}; }

  h2 { font-size: 13pt; margin: 8mm 0 2mm; color: ${c('brand-primary', '#0074e0')};
       border-bottom: 2px solid ${c('subtle-brand', '#deedff')}; padding-bottom: 1.5mm;
       break-after: avoid; }
  h3 { font-size: 10.5pt; margin: 4mm 0 1.5mm; font-weight: 600; break-after: avoid; }
  .section-lede { color: ${c('text-subtle', '#4d4d4d')}; font-size: 8.5pt; margin: 0 0 4mm; }

  /* ---- features at a glance ---- */
  table.glance { width: 100%; border-collapse: collapse; font-size: 8.5pt; margin: 0 0 4mm; }
  table.glance th { text-align: left; font-size: 7.5pt; text-transform: uppercase; letter-spacing: .04em;
                    color: ${c('text-subtle', '#4d4d4d')}; border-bottom: 1pt solid ${c('brand-light', '#ebe8e5')};
                    padding: 1.5mm 1.5mm; }
  table.glance td { padding: 1.2mm 1.5mm; border-bottom: 0.3pt solid ${c('brand-light', '#ebe8e5')};
                    vertical-align: top; }
  table.glance th.n, table.glance td.n { text-align: right; white-space: nowrap; }
  table.glance tr.has-failures td:first-child { border-left: 2px solid ${BAD}; padding-left: 1mm; }
  .ok { color: ${OK}; } .bad { color: ${BAD}; font-weight: 600; }

  /* ---- what failed ---- */
  .failures-h .count { display: inline-block; background: ${BAD}; color: #fff; font-size: 8pt;
                       border-radius: 1mm; padding: 0.3mm 2mm; vertical-align: middle; margin-left: 1.5mm; }
  .failure { break-inside: avoid; margin: 0 0 5mm; padding: 2.5mm 3mm; border-radius: 2mm;
             background: #fdf6f5; border-left: 3px solid ${BAD}; }
  .failure h3 { margin: 0 0 1mm; }
  .failure .idx { display: inline-block; min-width: 5mm; color: ${BAD}; font-weight: 700; }
  .failure-where { font-size: 8pt; color: ${c('text-subtle', '#4d4d4d')}; margin: 0 0 2mm; }
  .failure-err { margin: 0 0 2mm; padding: 2mm; background: #fff; border: 0.3pt solid #e6cdc9;
                 font-family: "DejaVu Sans Mono", monospace; font-size: 7.2pt; white-space: pre-wrap;
                 max-height: 60mm; overflow: hidden; }

  /* ---- the full run ---- */
  .feature { break-inside: auto; }
  .feature-meta { font-size: 8pt; color: ${c('text-subtle', '#4d4d4d')}; margin: 0 0 2.5mm; }
  .uri { font-family: "DejaVu Sans Mono", monospace; }
  /* A scenario is the unit you read, so it is the unit that must not be split. */
  .scenario { break-inside: avoid; margin: 0 0 3.5mm; padding-left: 3mm;
              border-left: 2px solid ${c('subtle-brand', '#deedff')}; }
  .scenario.failed { border-left-color: ${BAD}; }
  .tags, .scenario-meta { font-size: 8pt; color: ${c('text-subtle', '#4d4d4d')}; margin: 0 0 1.5mm; }
  .tags { font-family: "DejaVu Sans Mono", monospace; }
  table.steps { width: 100%; border-collapse: collapse; margin: 1mm 0; }
  table.steps td { padding: 0.8mm 1.5mm; vertical-align: top;
                   border-bottom: 0.3pt solid ${c('brand-light', '#ebe8e5')}; }
  td.kw { width: 16mm; font-weight: 600; color: ${c('brand-secondary', '#2b447c')}; }
  td.num { width: 18mm; text-align: right; color: ${c('text-subtle', '#4d4d4d')}; font-size: 8pt; }
  tr.s-failed td { background: #fdf1f0; }
  tr.s-skipped td, tr.s-undefined td { color: ${MUTED}; }
  tr.err pre { margin: 1mm 0; padding: 2mm; background: #fdf1f0; border-left: 2px solid ${BAD};
               font-family: "DejaVu Sans Mono", monospace; font-size: 7.2pt; white-space: pre-wrap; }
  .pill { display: inline-block; font-size: 7pt; text-transform: uppercase; letter-spacing: .04em;
          padding: 0.4mm 1.6mm; border-radius: 1mm; color: #fff; background: ${MUTED}; margin-right: 1.5mm; }
  .pill.passed { background: ${OK}; } .pill.failed { background: ${BAD}; }
  .pill.undefined { background: ${WARN}; }
  .shot { margin: 2mm 0; break-inside: avoid; }
  .shot img { max-width: 100%; max-height: 90mm; border: 1px solid ${c('brand-light', '#ebe8e5')}; }
  .shot figcaption, .shot-note { font-size: 7.2pt; color: ${c('text-subtle', '#4d4d4d')}; }
  .legend { font-size: 7.5pt; color: ${c('text-subtle', '#4d4d4d')}; margin: 0 0 5mm; }
  .legend .key { display: inline-block; width: 2.5mm; height: 2.5mm; border-radius: .5mm;
                 margin: 0 1mm 0 3mm; vertical-align: middle; }
  .foot { margin-top: 8mm; padding-top: 2mm; font-size: 7.5pt; color: ${c('text-subtle', '#4d4d4d')};
          border-top: 1px solid ${c('brand-light', '#ebe8e5')}; }
</style></head><body>

  <header class="cover">
    <p class="eyebrow">Automated functional acceptance testing</p>
    <h1>${esc(project)}</h1>
    <p class="lede">${esc(key)} workspace · run of ${esc(humanTime(report.mtime))} · ${esc(humanDuration(totalNs))} of step time</p>
    <span class="verdict ${verdict.replace(/\s/g, '')}">${verdict}</span>
  </header>

  <div class="summary-row">
    <div class="donut-wrap">${donut(passed, failed, skipped, scenarios)}<span class="cap">pass rate</span></div>
    <div class="summary">
      <div class="tile brand"><span class="n">${scenarios}</span><span class="l">scenarios</span></div>
      <div class="tile ok"><span class="n">${passed}</span><span class="l">passed</span></div>
      <div class="tile ${failed ? 'bad' : ''}"><span class="n">${failed}</span><span class="l">failed</span></div>
      <div class="tile"><span class="n">${skipped}</span><span class="l">skipped</span></div>
      <div class="tile"><span class="n">${featureStats.length}</span><span class="l">features</span></div>
      <div class="tile"><span class="n">${stepCount}</span><span class="l">steps</span></div>
    </div>
  </div>

  <p class="legend"><span class="key" style="background:${OK}"></span>passed
    <span class="key" style="background:${BAD}"></span>failed
    <span class="key" style="background:${MUTED}"></span>skipped or undefined</p>

  ${featureTable ? `<h2>Features at a glance</h2>${featureTable}` : ''}
  ${failuresSection}

  <h2>The full run</h2>
  <p class="section-lede">Every scenario in the order it ran, with each step and how long it took.</p>
  ${features || '<p>This report contains no scenarios.</p>'}

  <p class="foot">${esc(report.rel)} · ${scenarios} scenarios · ${stepCount} steps · ${esc(humanDuration(totalNs))} of step time ·
  rendered by the Webship Workspace dashboard. Screenshots of failures are embedded, so this file is complete on its own.</p>
</body></html>`;
}

module.exports = { testReportPdfHtml, humanDuration, statusOf };
