/**
 * Make an empty folder in a workspace, set it up, and optionally open a terminal or Claude Code in it.
 */

const fs = require('fs');
const path = require('path');

const { esc } = require('../html');
const { isValidWorkspace, loadWorkspaces, loadSettings, workspaceDir } = require('../workspaces');
const folders = require('../folders');
const notes = require('../notes');
const { startInScreen, screenStartedHtml } = require('../jobs');
const { pluginFolderSetups } = require('../plugin-loader');

/** What the plugins get to decide with: the actions this workspace's type allows. */
const setupCtx = (ws) => { const m = loadWorkspaces()[ws]; return { allowed: (m && m.typeActions) || new Set() }; };

const shq = (v) => `'${String(v).replace(/'/g, `'\\''`)}'`;

/** Whether this workspace offers New folder: project workspaces whose type allows it. */
function canMakeFolder(ws) {
  if (!isValidWorkspace(ws)) return false;
  const meta = loadWorkspaces()[ws];
  if (!meta || !(meta.typeActions && meta.typeActions.has('folder'))) return false;
  // A files workspace shows folders only when it is browsable; elsewhere a new folder would be invisible.
  return meta.kind !== 'files' || require('../files-browser').BROWSABLE.has(ws);
}

/** Whether the workspace is a files one, where a folder is made inside the folder being viewed. */
function isFilesWorkspace(ws) {
  const meta = loadWorkspaces()[ws];
  return !!meta && meta.kind === 'files';
}

const ships = (ws, script) => fs.existsSync(path.join(workspaceDir(ws), script));
const allows = (ws, action) => { const m = loadWorkspaces()[ws]; return !!(m && m.typeActions && m.typeActions.has(action)); };

/** Whether the workspace ships the testing command the webship-js setup runs. */
function canTest(ws) { return ships(ws, 'cmd-tools-testing.sh'); }

/** DDEV project types the form offers, the same list Configure DDEV uses. */
function projectTypes() {
  return require('../ddev-options').PROJECT_TYPES;
}

/** The setup shell line: DDEV, then the testing stack, then what the plugins add. Each step needs the one before. */
function setupLine(ws, name, form) {
  const steps = [];
  const wantE2e = form.e2e === '1' && canTest(ws);
  if (form.ddev === '1' || wantE2e) {
    const opts = require('../ddev-options');
    const chosen = { docroot: '', ...form };
    if (!opts.PROJECT_TYPES.includes(String(chosen.project_type))) chosen.project_type = 'php';
    const args = ['config', '--auto=false', `--project-name=${name}`, ...opts.configArgs(chosen)];
    steps.push(`( cd ${shq(name)} && ddev ${opts.shellArgs(args)} )`);
  }
  if (wantE2e) steps.push(`bash cmd-tools-testing.sh ${shq(name)}`);
  for (const s of pluginFolderSetups()) if (s.steps) steps.push(...(s.steps(ws, name, form, setupCtx(ws)) || []));
  return steps.join(' && ');
}

/** What the Claude Code session is asked to do: the AI tasks the form chose, then the user's own message. */
function claudePrompt(ws, name, form) {
  const parts = [];
  const what = String(form.note || '').trim();
  for (const s of pluginFolderSetups()) if (s.prompt) parts.push(...(s.prompt(ws, name, form, setupCtx(ws)) || []));
  const own = String(form.prompt || '').trim();
  if (own) parts.push(own);
  return parts.join('\n\n');
}

/** Why the form cannot be run as sent, or ''. */
function formProblem(ws, form) {
  for (const s of pluginFolderSetups()) if (s.problem) { const why = s.problem(ws, form, setupCtx(ws)); if (why) return why; }
  return '';
}

/** A folder in a files workspace: inside the folder being viewed, with its note, and nothing else to set up. */
function filesFolderNew({ ws, form, send, res }) {
  const where = require('../files-browser').safeSub(ws, String(form.sub || ''));
  if (!where.ok) return send('<div class="msg error">That folder is not in this workspace.</div>', 400);
  const name = String(form.name || '').trim();
  const made = folders.createFolder(where.abs, name, { files: true });
  if (!made.ok) return send(`<div class="msg error">${made.error}</div>`, made.status);
  const note = String(form.note || '').trim();
  if (note) notes.writeNote(made.dir, { title: '', body: note });
  const shown = [ws, where.rel, name].filter(Boolean).join('/');
  try { res.setHeader('HX-Trigger', JSON.stringify({ 'refresh-projects': true })); } catch (_) { /* headers already sent */ }
  return send(`<div class="msg assistant"><p>Made <strong>${esc(shown)}</strong>.</p></div>`);
}

async function folder_new({ form, send, res }) {
  const ws = String(form.workspace || '');
  if (!canMakeFolder(ws)) return send('<div class="msg error">This workspace does not take new folders.</div>', 400);
  if (isFilesWorkspace(ws)) return filesFolderNew({ ws, form, send, res });
  const problem = formProblem(ws, form);
  if (problem) return send(`<div class="msg error">${esc(problem)}</div>`, 400);
  const name = String(form.name || '').trim();
  const made = folders.createFolder(workspaceDir(ws), name);
  if (!made.ok) return send(`<div class="msg error">${made.error}</div>`, made.status);

  const note = String(form.note || '').trim();
  if (note) notes.writeNote(made.dir, { title: '', body: note });

  let setup = '';
  const line = setupLine(ws, name, form);
  if (line) {
    const label = 'set up the folder';
    const started = await startInScreen({ workspace: ws, project: name, projectDir: workspaceDir(ws), ownerDir: made.dir,
      verb: 'setup', cmdLine: line, label });
    setup = started.ok
      ? `<p>Setting it up in <code>${esc(started.session)}</code>: <a href="/screens">watch it on Screens</a>.</p>`
      : screenStartedHtml(started, label, name);
  }

  // An AI task needs Claude Code, so it is started even when Then said otherwise.
  const prompt = claudePrompt(ws, name, form);
  let then = Object.prototype.hasOwnProperty.call(folders.THEN, form.then) ? String(form.then) : 'none';
  if (prompt && then !== 'claude') then = 'claude';
  let started = '';
  const triggers = { 'refresh-projects': true };
  if (then !== 'none') {
    let out = null;
    await require('./screens')['/actions/screen-new']({
      form: { target: `p:${ws}:${name}`, kind: then, session: then === 'claude' ? 'claude' : 'shell',
              command: then === 'claude' ? prompt : '' },
      send: (html, status = 200) => { out = { html, status }; },
      res,
    });
    const session = `${ws}--${name}--${then === 'claude' ? 'claude' : 'shell'}`;
    started = out && out.status < 400
      ? `<p>${then === 'claude' ? 'Claude Code is' : 'A terminal is'} running in it as <code>${esc(session)}</code>.
          <a class="uk-button uk-button-primary uk-button-small" href="/terminal/${encodeURIComponent(session)}" target="_blank" rel="noopener">Open the terminal</a></p>`
      : `<div class="msg error">The folder is made, but the session did not start.</div>${out ? out.html : ''}`;
    triggers['screens-changed'] = { session };
  }
  try { res.setHeader('HX-Trigger', JSON.stringify(triggers)); } catch (_) { /* headers already sent */ }
  return send(`<div class="msg assistant">
      <p>Made <strong>${esc(ws)}/${esc(name)}</strong>. It is listed with the projects, and its Screens, IDE,
        GIT and command buttons work on it now.</p>${setup.startsWith('<p>') ? setup : ''}${started}</div>${setup.startsWith('<p>') ? '' : setup}`);
}

/**
 * The New folder form for a workspace. A files workspace gets the folder being viewed, read from the page address
 * htmx sends or the last one browsed; a project workspace gets the full form with its setup options.
 */
function folderFormFor(ws, req, { readPageState } = {}) {
  const meta = loadWorkspaces()[ws];
  if (isFilesWorkspace(ws)) {
    let sub = '';
    try { sub = new URL(String(req.headers['hx-current-url'] || ''), 'http://x').searchParams.get('path') || ''; } catch (_) { /* no page address */ }
    if (!sub && readPageState) sub = readPageState(req, `${ws}/items`).path || '';
    const where = require('../files-browser').safeSub(ws, sub);
    return folders.filesFolderFormHtml(ws, { label: meta.label, sub: where.ok ? where.rel : '',
      suggestion: folders.suggestName(where.ok ? where.abs : meta.dir, 'new-folder-') });
  }
  return folders.folderFormHtml(ws, { label: meta.label, suggestion: folders.suggestName(meta.dir),
    projectTypes: projectTypes(), canTest: canTest(ws),
    pluginSetups: pluginFolderSetups().map((s) => (s.html ? s.html(ws, setupCtx(ws)) : '')).filter(Boolean).join('') });
}

module.exports = {
  '/actions/folder-new': folder_new,
  canMakeFolder, isFilesWorkspace, folderFormFor, canTest, projectTypes, setupLine, claudePrompt, formProblem,
};
