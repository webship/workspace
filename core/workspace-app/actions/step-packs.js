/**
 * The Extra steps panel's buttons, and the run picker's.
 *
 * Each one runs `cmd-tools-testing.sh <project> …` in the project's screen session, the way the Tests
 * menu runs the setup and the suite: adding a pack ends in `npm install` in the container, which takes a
 * minute, and nothing installs from the dashboard process.
 *
 * Nothing from the browser reaches the command line as it was sent. A pack is the canonical
 * `@webship-js/<name>-steps` of a pack the list holds (or, to remove or copy from, one the project
 * has); a feature is one the project's own tests/features/ lists. Anything else is refused with the reason.
 */

const fs = require('fs');
const path = require('path');

const { esc } = require('../html');
const { shWords } = require('../shell-quote');
const { workspaceDir, ROOT } = require('../workspaces');
const { listProjects, startInScreen, screenStartedHtml } = require('../jobs');
const { NAME_RE } = require('../validate');
const { projectFeatures } = require('../step-packs-page');

const stepPacks = require(path.join(ROOT, 'core', 'scripts', 'libs', 'step_packs'));

const SCRIPT = 'cmd-tools-testing.sh';

function project(form, workspace) {
  const dir = workspaceDir(workspace);
  const projectName = String(form.projectName || '');
  if (!dir || !fs.existsSync(path.join(dir, SCRIPT))) return { error: 'No testing script in this workspace.', status: 400 };
  if (!NAME_RE.test(projectName) || !listProjects(dir).includes(projectName)) return { error: 'Unknown project.', status: 400 };
  return { dir, projectName, projectDir: path.join(dir, projectName) };
}

const VERBS = {
  '/actions/steps-add': { flag: '--add-steps', label: (p) => `add ${p}` },
  '/actions/steps-remove': { flag: '--remove-steps', label: (p) => `remove ${p}` },
  '/actions/steps-examples': { flag: '--examples', label: (p) => `copy the examples of ${p}` },
};

async function steps_verb({ form, send, workspace, pathname }) {
  const p = project(form, workspace);
  if (p.error) return send(`<div class="msg error">${esc(p.error)}</div>`, p.status);
  const verb = VERBS[pathname];
  const name = stepPacks.packName(form.pack);
  if (!name) return send('<div class="msg error">A step pack is named @webship-js/&lt;name&gt;-steps.</div>', 400);
  if (pathname === '/actions/steps-remove' && form.confirm !== 'yes') {
    return send('<div class="msg error">Removing a step pack changes package.json and cucumber.js: it needs confirmation.</div>', 400);
  }
  // The list is the allowlist for adding; removing and copying also take a pack the project already has.
  const list = await stepPacks.listPacks({ root: ROOT });
  const has = stepPacks.projectState(p.projectDir).packs[name];
  if (!list.packs.some((x) => x.name === name) && !(has && pathname !== '/actions/steps-add')) {
    return send(`<div class="msg error"><strong>${esc(name)}</strong> is not in the list of webship-js step packs.</div>`, 404);
  }
  const label = `${verb.label(name)} on ${p.projectName}`;
  const started = await startInScreen({
    workspace,
    project: p.projectName,
    projectDir: p.dir,
    ownerDir: p.projectDir,
    verb: 'steps',
    cmdLine: `bash ${shWords([SCRIPT, p.projectName, verb.flag, name])}`,
    label,
  });
  return send(screenStartedHtml(started, verb.label(name), p.projectName), started.ok ? 200 : (started.already ? 409 : 500));
}

/** Run one feature: the run picker's Run. The same session as the Tests menu's run, so the two never overlap. */
async function run_feature({ form, send, workspace }) {
  const p = project(form, workspace);
  if (p.error) return send(`<div class="msg error">${esc(p.error)}</div>`, p.status);
  const wanted = String(form.feature || '');
  const known = projectFeatures(p.projectDir).flatMap((g) => g.files.filter((f) => f.runnable).map((f) => f.rel));
  if (!known.includes(wanted)) return send('<div class="msg error">That feature is not in this project\'s tests/features/.</div>', 404);
  if (stepPacks.projectState(p.projectDir).stack === 'none') {
    return send('<div class="msg error">No testing stack in this project yet — set the environment up first.</div>', 409);
  }
  const started = await startInScreen({
    workspace,
    project: p.projectName,
    projectDir: p.dir,
    ownerDir: p.projectDir,
    verb: 'tests',
    cmdLine: `bash ${shWords([SCRIPT, p.projectName, '--run', '--path', wanted])}`,
    label: `run ${wanted}`,
  });
  return send(screenStartedHtml(started, `run ${wanted}`, p.projectName), started.ok ? 200 : (started.already ? 409 : 500));
}

module.exports = {
  '/actions/steps-add': steps_verb,
  '/actions/steps-remove': steps_verb,
  '/actions/steps-examples': steps_verb,
  '/actions/testing-run-feature': run_feature,
};
