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

const shq = (v) => `'${String(v).replace(/'/g, `'\\''`)}'`;
const JIRA_PROJECT_RE = /^[A-Z][A-Z0-9]+$/;
const UPSUN_ID_RE = /^[a-z0-9]{8,20}$/;

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

/** Whether the workspace links projects to Upsun. */
function canUpsun(ws) { return allows(ws, 'upsun') && ships(ws, 'cmd-tools-upsun.sh'); }

/** The Jira project new workitems go to, or '' when this workspace has no Jira. */
function jiraProject(ws) {
  if (!allows(ws, 'jira')) return '';
  try { return String((loadSettings().jira || {}).default_project || '').trim().toUpperCase(); } catch (_) { return ''; }
}

/** DDEV project types the form offers, the same list Configure DDEV uses. */
function projectTypes() {
  return require('../ddev-options').PROJECT_TYPES;
}

/** The setup shell line: DDEV, then the testing stack, then the Upsun link. Each step needs the one before. */
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
  if (form.upsun === 'link' && canUpsun(ws)) {
    steps.push(`( cd ${shq(name)} && { git rev-parse --git-dir >/dev/null 2>&1 || git init -q; } )`);
    steps.push(`bash cmd-tools-upsun.sh ${shq(name)} --link ${shq(form.upsun_id)}`);
  }
  return steps.join(' && ');
}

/** What the Claude Code session is asked to do: the AI tasks the form chose, then the user's own message. */
function claudePrompt(ws, name, form) {
  const parts = [];
  const what = String(form.note || '').trim();
  if (form.jira === '1') {
    const key = String(form.jira_project || '').trim().toUpperCase();
    parts.push(`Use the jira-workitem-manager agent to create one workitem in the Jira project ${key} for the work in this folder (${ws}/${name}): "${what}". `
      + `Follow its house shape, with no AI-mention lines. Then write ${key} into the file .jira-project here, and tell me the new key and its link.`);
  }
  if (form.upsun === 'create') {
    parts.push(`Create a new Upsun project for this folder and deploy it. Before creating anything billed, ask me which organization, region and plan to use, and wait for my answer. `
      + 'If a setup session is configuring DDEV here, wait until .ddev/config.yaml exists. Then: git init if needed, upsun project:create, link it with upsun project:set-remote, '
      + 'write .upsun/config.yaml to match .ddev/config.yaml (PHP version, database, docroot), commit, and push to main. Never put a secret or key in git. Report the project id and the site URL.');
  }
  const own = String(form.prompt || '').trim();
  if (own) parts.push(own);
  return parts.join('\n\n');
}

/** Why the form cannot be run as sent, or ''. */
function formProblem(ws, form) {
  if (form.jira === '1') {
    if (!jiraProject(ws)) return 'This workspace has no Jira project to create a workitem in.';
    if (!JIRA_PROJECT_RE.test(String(form.jira_project || '').trim().toUpperCase())) return 'The Jira project key is letters and digits, starting with a letter.';
    if (!String(form.note || '').trim()) return 'Say what the folder is for: the Jira workitem is written from it.';
  }
  if (form.upsun === 'link' || form.upsun === 'create') {
    if (!canUpsun(ws)) return 'This workspace does not link projects to Upsun.';
    if (form.upsun === 'link' && !UPSUN_ID_RE.test(String(form.upsun_id || ''))) return 'An Upsun project id is 8 to 20 lowercase letters and digits.';
  }
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
    projectTypes: projectTypes(), canTest: canTest(ws), jiraProject: jiraProject(ws), canUpsun: canUpsun(ws) });
}

module.exports = {
  '/actions/folder-new': folder_new,
  canMakeFolder, isFilesWorkspace, folderFormFor, canTest, canUpsun, jiraProject, projectTypes, setupLine, claudePrompt, formProblem,
};
