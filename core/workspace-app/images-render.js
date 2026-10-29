/**
 * An SVG rendered to a PNG with headless Chrome or Chromium, whichever is on PATH. Animations are run to their end
 * first (a virtual time budget), so a drawing that animates in is captured drawn. No dependencies: the host-side
 * finish step of a Claude Code drawing uses it, and so does the dashboard container.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

/** The first Chrome on PATH, or null. */
function chrome() {
  for (const bin of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    for (const dir of String(process.env.PATH || '').split(':')) {
      const p = path.join(dir, bin);
      if (dir && fs.existsSync(p)) return p;
    }
  }
  return null;
}

/** Render an SVG to a PNG of the given size. Returns true when the PNG exists. */
function renderPng(svg, png, [w, h]) {
  const bin = chrome();
  if (!bin) return false;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'images-chrome-'));
  try {
    execFileSync(bin, ['--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars', `--user-data-dir=${profile}`,
      '--virtual-time-budget=6000', `--window-size=${w},${h}`, `--screenshot=${png}`, `file://${svg}`], { stdio: 'ignore', timeout: 60000 });
  } catch (_) { /* the caller checks the PNG */ }
  fs.rmSync(profile, { recursive: true, force: true });
  return fs.existsSync(png);
}

module.exports = { chrome, renderPng };
