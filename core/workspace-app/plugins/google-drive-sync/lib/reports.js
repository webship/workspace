/**
 * Where a project's test runs left their evidence: <module>/tests/reports (the cucumber report), with the
 * failure screenshots and recordings beside it in tests/screenshots and tests/videos.
 *
 * The same search as the dashboard's test-reports.js, kept here so the command line and the MCP server need
 * nothing from the dashboard. Bounded to that shape on purpose: a built Drupal site has ~20,000 files under
 * web/core alone.
 */

const fs = require('fs');
const path = require('path');

const SEARCH_DIRS = ['packages', 'web/modules/custom', 'web/modules/contrib', 'tests', '.'];

/** [{ reportsDir, testsDir, label, contrib }] for one project, the source copies before the installed ones. */
function findReportDirs(root, project) {
  const projectRoot = path.join(root, project);
  const found = [];
  for (const sub of SEARCH_DIRS) {
    const base = path.join(projectRoot, sub);
    let entries = [];
    try { entries = fs.readdirSync(base, { withFileTypes: true }); } catch (_) { continue; }
    const candidates = entries.filter((e) => e.isDirectory()).map((e) => path.join(base, e.name, 'tests', 'reports'));
    candidates.push(path.join(base, 'reports'));
    for (const reportsDir of candidates) {
      const marker = ['cucumber_report.json', 'cucumber_report.html'].map((f) => path.join(reportsDir, f)).find((f) => fs.existsSync(f));
      if (!marker) continue;
      const testsDir = path.dirname(reportsDir);
      // <module>/tests/reports names the module; a bare <project>/reports is the project itself.
      const label = path.basename(testsDir) === 'tests' ? path.basename(path.dirname(testsDir)) : path.basename(testsDir);
      found.push({ reportsDir, testsDir, label, contrib: reportsDir.includes(`web${path.sep}modules${path.sep}contrib`), mtime: fs.statSync(marker).mtimeMs });
    }
  }
  return found.sort((a, b) => Number(a.contrib) - Number(b.contrib) || b.mtime - a.mtime).map(({ mtime, ...rest }) => rest);
}

module.exports = { findReportDirs, SEARCH_DIRS };
