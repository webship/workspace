/**
 * Claude Code after a build: the shell step a build ends with, so the agent starts in the new project once
 * the build (and the install, when it was asked for) has finished.
 *
 * The prompt is free text, so it travels in a private file and reaches claude through `$(cat …)`, the same
 * way New screen does; the shell line holds only paths the server made.
 */

const fs = require('fs');
const path = require('path');

const { ROOT } = require('./workspaces');

const shq = (v) => `'${String(v).replace(/'/g, `'\\''`)}'`;
const MAX_PROMPT = 4000;

/** The session the agent runs in, named like every other session on the row. */
function sessionFor(ws, project) {
  return `${ws}--${project}--claude`.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').slice(0, 60);
}

/** The prompt claude opens with: what was just built, then the person's own words. */
function promptFor({ ws, project, label, installed, text }) {
  const said = String(text || '').trim().slice(0, MAX_PROMPT);
  const what = `The project ${ws}/${project} was just built here${label ? ` with ${label}` : ''}${installed ? ' and installed' : ''}.`;
  return said ? `${what}\n\n${said}` : `${what} Look around and tell me what is here and how to start it.`;
}

/**
 * Write the prompt and the runner payload, and return the shell step that starts the session.
 * `dir` is the workspace folder, `project` the folder the build makes in it.
 */
function afterBuildStep({ ws, dir, project, label, installed, text, flags = [] }) {
  const promptsDir = path.join(ROOT, '.screens', 'prompts');
  fs.mkdirSync(promptsDir, { recursive: true, mode: 0o700 });
  const session = sessionFor(ws, project);
  const projectDir = path.join(dir, project);
  const promptFile = path.join(promptsDir, `${session}.txt`);
  fs.writeFileSync(promptFile, promptFor({ ws, project, label, installed, text }), { mode: 0o600 });
  const vars = { WEBSHIP_WORKSPACE: ws, WEBSHIP_PROJECT: project, WEBSHIP_WORKSPACE_DIR: projectDir };
  const env = Object.entries(vars).map(([k, v]) => `${k}=${shq(v)}`).join(' ');
  const payloadFile = path.join(promptsDir, `${session}.start.json`);
  fs.writeFileSync(payloadFile, JSON.stringify({
    session, dir: projectDir, owner: projectDir,
    cmd: `exec env ${env} claude ${flags.length ? `${flags.join(' ')} ` : ''}"$(cat ${shq(promptFile)})"`,
  }), { mode: 0o600 });
  // From ROOT, not __dirname: the dashboard runs in its container at another path, and this line runs on the host.
  const helper = path.join(ROOT, 'core', 'workspace-app', 'scripts', 'screen-then.js');
  return { session, step: `node ${shq(helper)} ${shq(payloadFile)}` };
}

module.exports = { sessionFor, promptFor, afterBuildStep };
