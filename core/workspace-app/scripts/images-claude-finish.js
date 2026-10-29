#!/usr/bin/env node
/**
 * The fixed step after Claude Code has drawn an image: sanitise the SVG, render its PNG with headless Chrome,
 * and write the records. Runs on the host, in the screen session, with the job file the dashboard wrote.
 * Usage: node images-claude-finish.js <job.json>
 */

const fs = require('fs');
const path = require('path');

const { sanitizeSvg, removedSummary } = require('../images-svg-sanitize');
const { writeRecords } = require('../images-records');
const { renderPng } = require('../images-render');

/** The summary and alt text Claude wrote, or empty ones. The file is removed either way. */
function words(file) {
  let out = {};
  try { out = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { /* missing or not JSON */ }
  fs.rmSync(file, { force: true });
  return { summary: String(out.summary || '').trim().slice(0, 600), alt: String(out.alt || '').trim().slice(0, 125) };
}

/** Generate SVG: the same checks as the API path; a refused drawing goes back to Claude with the reason. */
function finishSvg(job, jobFile, svgPath) {
  const core = require('../images-svg-core');
  const done = core.finish(fs.readFileSync(svgPath, 'utf8'), { style: job.style, motion: job.motion });
  job.tried = (job.tried || 0) + 1;
  if (!done.ok) {
    fs.rmSync(svgPath, { force: true });
    const promptFile = jobFile.replace(/\.job\.json$/, '.txt');
    if (job.tried < (job.attempts || 1)) {
      fs.writeFileSync(jobFile, JSON.stringify(job), { mode: 0o600 });
      fs.appendFileSync(promptFile, `\n\nYour last drawing was refused. ${done.why} Write ${job.name}.svg again.`);
      console.error(`Attempt ${job.tried} refused: ${done.why} Drawing again.`);
      return 3;
    }
    console.error(`No usable drawing after ${job.tried} attempt${job.tried === 1 ? '' : 's'}: ${done.why}`);
    for (const f of [jobFile, promptFile, path.join(job.dir, `${job.name}.claude.json`)]) fs.rmSync(f, { force: true });
    return 2;
  }
  fs.writeFileSync(svgPath, done.svg);
  if (done.note) console.log(`Sanitised: removed ${done.note}.`);
  const said = words(path.join(job.dir, `${job.name}.claude.json`));
  let png = '';
  if (job.png && renderPng(svgPath, svgPath.replace(/\.svg$/, '.png'), job.pixels || [960, 400])) png = `${job.name}.png`;
  const styles = core.STYLES;
  writeRecords(svgPath, { prompt: job.prompt, style: styles[job.style], provider: 'claude_code_cli', model: 'Claude Code (your login)',
    attempts: job.tried, palette: job.palette, size: (job.pixels || []).join('x'), created: job.created, png: png || undefined,
    motion: job.style === 'draw' ? job.motion : undefined, sanitised: done.note || undefined, cost: 'no API charge: your own Claude Code login',
    summary: said.summary, alt: said.alt, described_by: said.summary || said.alt ? 'Claude Code, while drawing' : undefined });
  for (const f of [jobFile, jobFile.replace(/\.job\.json$/, '.txt')]) fs.rmSync(f, { force: true });
  console.log(`Done: ${svgPath}${png ? ` and ${png}` : ''}, with its records.`);
  return 0;
}

function main(jobFile) {
  const job = JSON.parse(fs.readFileSync(jobFile, 'utf8'));
  const svgPath = path.join(job.dir, `${job.name}.svg`);
  if (!fs.existsSync(svgPath)) {
    console.error(`Claude Code did not write ${job.name}.svg.`);
    return 2;
  }
  if (job.kind === 'svg') return finishSvg(job, jobFile, svgPath);
  const clean = sanitizeSvg(fs.readFileSync(svgPath, 'utf8'));
  if (!clean.svg) {
    console.error(`${job.name}.svg holds no <svg> drawing; it was left as written.`);
    return 2;
  }
  fs.writeFileSync(svgPath, clean.svg);
  const note = removedSummary(clean);
  if (note) console.log(`Sanitised: removed ${note}.`);
  const said = words(path.join(job.dir, `${job.name}.claude.json`));
  const [w, h] = job.pixels || [1024, 1024];
  const base = {
    prompt: job.kind === 'edit' ? undefined : job.prompt,
    edit_prompt: job.kind === 'edit' ? job.prompt : undefined,
    source: job.source,
    provider: 'claude_code_cli',
    model: 'Claude Code (your login)',
    size: `${w}x${h}`,
    created: job.created || new Date().toISOString(),
    cost: 'no API charge: your own Claude Code login',
    described_by: said.summary || said.alt ? 'Claude Code, while drawing' : undefined,
    summary: said.summary,
    alt: said.alt,
    sanitised: note || undefined,
  };
  let png = '';
  if (job.png) {
    const pngPath = path.join(job.dir, `${job.name}.png`);
    if (renderPng(svgPath, pngPath, [w, h])) {
      png = `${job.name}.png`;
      fs.writeFileSync(`${pngPath}.json`, `${JSON.stringify({ ...JSON.parse(JSON.stringify(base)), from: `${job.name}.svg` }, null, 2)}\n`);
      console.log(`Rendered ${png}.`);
    } else {
      console.error('No PNG: Chrome is not on this machine, or it could not render the SVG. The SVG is kept.');
    }
  }
  writeRecords(svgPath, { ...base, png: png || undefined });
  for (const f of [jobFile, jobFile.replace(/\.job\.json$/, '.txt')]) fs.rmSync(f, { force: true });
  console.log(`Done: ${path.join(job.dir, `${job.name}.svg`)}${png ? ` and ${png}` : ''}, with its records.`);
  return 0;
}

if (require.main === module) process.exit(main(process.argv[2]));

module.exports = { main };
