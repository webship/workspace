/**
 * Claude Code in a screen session: end it the way a person would, with /exit, and pick the conversation up again
 * with `claude --resume <id>` in the same folder.
 */

const fs = require('fs');
const path = require('path');

const { esc } = require('../html');
const { hostRunnerUp, hostRunnerRequest } = require('../jobs');
const { ROOT, isValidWorkspace, workspaceDir } = require('../workspaces');
const claudeSessions = require('../claude-sessions');

const SESSION_RE = /^[a-z0-9][a-zA-Z0-9_.-]*$/;
const NAME_RE = /^[a-zA-Z0-9_-]+$/;

/** The folder a session runs in, from the record the runner keeps beside its log. */
function sessionDir(session) {
  try {
    const dir = fs.readFileSync(path.join(ROOT, '.screens', `${session}.cwd`), 'utf8').trim();
    return dir && dir.startsWith(ROOT) && fs.existsSync(dir) ? dir : '';
  } catch (_) { return ''; }
}

/** The newest conversation in a folder that `--resume` can open, or null. */
function lastConversation(dir) {
  return claudeSessions.sessionsFor(dir, { limit: 1, resumableOnly: true })[0] || null;
}

/** Whether a live session is running Claude Code. */
async function isClaudeSession(session) {
  const screens = require('../screens');
  const live = (await screens.listScreens()).filter((s) => s.session === session && !/dead/i.test(s.state || ''));
  return live.length > 0 && screens.agentSessions(live).has(session);
}

const resumeButton = (attrs, label = 'Resume it') => `<button type="button" class="uk-button uk-button-primary uk-button-small"
  hx-post="/actions/claude-resume" hx-vals='${JSON.stringify(attrs)}' hx-target="#webship-workspace-output" hx-swap="innerHTML">${esc(label)}</button>`;

async function claude_exit({ form, send, res }) {
  const session = String(form.session || '');
  if (!SESSION_RE.test(session)) return send('<div class="msg error">Not a screen session name.</div>', 400);
  if (form.confirm !== 'yes') return send('<div class="msg error">Exiting needs confirmation.</div>', 400);
  if (!(await isClaudeSession(session))) return send(`<div class="msg error">Claude Code is not running in <strong>${esc(session)}</strong>.</div>`, 409);
  // Typed the way a person types it. Escape first closes a question or menu that is open (the trust prompt of a new
  // folder, a permission ask), then the command, then Enter on its own, so the prompt does not take it as a paste.
  const { onHostScreen } = require('./screens');
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  await onHostScreen(session, ['-S', session, '-X', 'stuff', '\x1b']);
  await pause(500);
  const typed = await onHostScreen(session, ['-S', session, '-X', 'stuff', '/exit']);
  if (typed.ok) await pause(300);
  const entered = typed.ok ? await onHostScreen(session, ['-S', session, '-X', 'stuff', '\r']) : typed;
  if (!entered.ok) return send(`<div class="msg error">Could not reach ${esc(session)}: ${esc(String(entered.stderr || entered.stdout).slice(-200))}</div>`, 500);
  try { res.setHeader('HX-Trigger', JSON.stringify({ 'screens-changed': { session } })); } catch (_) { /* headers already sent */ }
  return send(`<div class="msg assistant"><p>Sent <code>/exit</code> to Claude Code in <strong>${esc(session)}</strong>. The conversation is kept.</p>
    <p>${resumeButton({ session })}</p></div>`);
}

async function claude_resume({ form, send, res }) {
  let session = String(form.session || '');
  let dir = '';
  if (session) {
    if (!SESSION_RE.test(session)) return send('<div class="msg error">Not a screen session name.</div>', 400);
    dir = sessionDir(session);
  } else {
    const ws = String(form.workspace || '');
    const project = String(form.project || '');
    if (!isValidWorkspace(ws) || !NAME_RE.test(project)) return send('<div class="msg error">Unknown project.</div>', 400);
    dir = path.join(workspaceDir(ws), project);
    if (!fs.existsSync(dir)) return send('<div class="msg error">No such folder.</div>', 404);
    session = `${ws}--${project}--claude`.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').slice(0, 60);
  }
  if (!dir) return send(`<div class="msg error">The folder of <strong>${esc(session)}</strong> is not known, so there is nothing to resume there.</div>`, 404);
  const last = lastConversation(dir);
  if (!last || !claudeSessions.isSessionId(last.id)) return send('<div class="msg error">No Claude Code conversation in this folder to resume.</div>', 404);
  if (!(await hostRunnerUp())) return send('<div class="msg error">The screen runner on this machine is not up.</div>', 503);
  const answer = await hostRunnerRequest('start', { session, dir, owner: dir, cmd: `exec claude --resume ${last.id}` });
  if (!answer) return send('<div class="msg error">The screen runner on this machine is not up.</div>', 503);
  if (answer.already) return send(`<div class="msg error"><strong>${esc(session)}</strong> is still running. Exit it first, or open it from Screens.</div>`, 409);
  if (!answer.ok) return send(`<div class="msg error">Could not resume it: ${esc(String(answer.error || '').slice(-200))}</div>`, 500);
  try { res.setHeader('HX-Trigger', JSON.stringify({ 'screens-changed': { session } })); } catch (_) { /* headers already sent */ }
  return send(`<div class="msg assistant"><p>Resumed${last.title ? ` <em>${esc(last.title.slice(0, 80))}</em>` : ''} in <strong>${esc(session)}</strong>.</p>
    <p><a class="uk-button uk-button-primary uk-button-small" href="/terminal/${encodeURIComponent(session)}" target="_blank" rel="noopener">Open the terminal</a></p></div>`);
}

/** The menu entries for a project's SCREENS menu: exit for each live Claude session, resume when none runs. */
function menuItems({ ws, project, sessions, agents, dir }) {
  const live = sessions.filter((s) => agents.has(s.session) && !/dead/i.test(s.state || ''));
  const exits = live.map((s) => `
    <li><a href class="arm-step" title="Exit Claude Code in ${esc(s.session)} (/exit)"
      hx-post="/actions/claude-exit" hx-vals='${JSON.stringify({ session: s.session, confirm: 'yes' })}'
      hx-trigger="confirmed-remove" hx-target="#webship-workspace-output" hx-swap="innerHTML"><span uk-icon="icon: sign-out; ratio: .7"></span> Exit Claude Code (/exit)</a></li>`);
  const resume = !live.length && dir && lastConversation(dir) ? `
    <li><a href title="Resume the last Claude Code conversation in this folder" hx-post="/actions/claude-resume" hx-vals='${JSON.stringify({ workspace: ws, project })}'
      hx-target="#webship-workspace-output" hx-swap="innerHTML"><span uk-icon="icon: history; ratio: .7"></span> Resume Claude Code</a></li>` : '';
  return exits.join('') + resume;
}

module.exports = {
  '/actions/claude-exit': claude_exit,
  '/actions/claude-resume': claude_resume,
  sessionDir, lastConversation, menuItems,
};
