/**
 * Running commands, and the background jobs that stream them.
 *
 * Split out of server.js: a job is a process with output and a lifetime, and none of that needs
 * the router. The registry lives here, so nothing else can reach into it by accident.
 */

const { spawn } = require('child_process');

const { esc } = require('./html');

/* ---------------- process helpers ---------------- */

function run(cmd, args, cwd, { timeoutMs = 15 * 60 * 1000 } = {}) {
  return new Promise((resolve) => {
    // stdin must be closed ('ignore') — ddev wraps commands in `docker exec -i`,
    // which hangs indefinitely on an open-but-silent stdin pipe.
    const child = spawn(cmd, args, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ ok: code === 0, code, stdout, stderr }); });
    child.on('error', (err) => { clearTimeout(timer); resolve({ ok: false, code: -1, stdout, stderr: String(err.message) }); });
  });
}

// A project's real DDEV name (from its .ddev/config.yaml), or null if it
// isn't a DDEV project. The name usually equals the folder name (the build
// scripts pass --project-name=<folder>), but not necessarily.
function ddevProjectName(projectDir) {
  try {
    const cfg = fs.readFileSync(path.join(projectDir, '.ddev', 'config.yaml'), 'utf8');
    const m = cfg.match(/^name:\s*(\S+)/m);
    return m ? m[1] : null;
  } catch (_) {
    return null;
  }
}

/* Background jobs with live terminal output: long actions run detached while
 * the page polls /fragments/job/<id> every second, streaming the command's
 * real stdout/stderr into a terminal box until it exits. */
const jobs = new Map();
let jobSeq = 0;

// A job may claim a key. Testing a project takes minutes, and starting a second run against the
// same project while the first is still going interleaves two suites over one site.
function runningJobKey(key) {
  for (const job of jobs.values()) if (job.key === key && !job.done) return true;
  return false;
}

function startJob(title, cmd, args, cwd, { timeoutMs = 15 * 60 * 1000, echoLine = '', key = '' } = {}) {
  const id = `${++jobSeq}-${Math.random().toString(36).slice(2, 8)}`;
  const job = { title, key, buf: echoLine ? `$ ${echoLine}\n\n` : '', done: false, ok: null };
  jobs.set(id, job);
  // stdin 'ignore' — see run(): docker exec -i hangs on an open stdin pipe.
  const child = spawn(cmd, args, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  const append = (d) => { job.buf = (job.buf + d.toString()).slice(-30000); };
  child.stdout.on('data', append);
  child.stderr.on('data', append);
  const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
  child.on('close', (code) => { clearTimeout(timer); job.done = true; job.ok = code === 0; });
  child.on('error', (err) => { clearTimeout(timer); job.buf += `\n${err.message}`; job.done = true; job.ok = false; });
  setTimeout(() => jobs.delete(id), 30 * 60 * 1000);
  return id;
}

function jobFragment(id) {
  const job = jobs.get(id);
  if (!job) return { html: '<div class="msg error">Job not found (expired).</div>', done: true };
  const text = job.buf.replace(/\x1b\[[0-9;]*[mK]/g, '');
  const status = job.done ? (job.ok ? '✅ finished' : '❌ failed') : '<span uk-spinner="ratio: .5"></span> running…';
  const poll = job.done ? '' : ` hx-get="/fragments/job/${id}" hx-trigger="every 1s" hx-swap="outerHTML"`;
  // A job is a toast: it outlives the page area it was launched from, so a build survives
  // navigating elsewhere, and it can be collapsed while it runs. The element polls ITSELF and
  // replaces itself, which is what lets ui.js move it into the toast stack once and leave it
  // there — every later poll lands wherever the element currently is.
  const state = job.done ? (job.ok ? 'is-done' : 'is-failed') : 'is-running';
  const html = `
    <div class="msg ${job.done && !job.ok ? 'error' : 'assistant'} terminal job-toast ${state}" id="job-${id}"${poll}>
      <div class="job-toast-head">
        <span class="job-toast-title">${job.title}</span>
        <span class="job-toast-status">${status}</span>
        <button type="button" class="job-toast-btn job-toast-collapse" title="Collapse or expand this job"
                aria-expanded="true"><span uk-icon="icon: chevron-up; ratio: .7"></span></button>
        <button type="button" class="job-toast-btn job-toast-close" title="Dismiss${job.done ? '' : ' (the job keeps running)'}"
                aria-label="Dismiss"><span uk-icon="icon: close; ratio: .7"></span></button>
      </div>
      <pre class="terminal-pre">${esc(text) || '…'}</pre>
    </div>`;
  return { html, done: job.done };
}

module.exports = {
  run,
  jobs,
  runningJobKey,
  startJob,
  jobFragment,
};
