/**
 * Installing, updating and removing a project's DDEV add-ons.
 *
 * All three change what is in `.ddev/` and need a restart before they take effect, and all three can
 * take a minute on a cold cache — so they run detached in the project's own screen session like the
 * other long DDEV verbs, and the row's SCREENS group lists them while they work.
 *
 * The one thing this module exists to be careful about: `ddev add-on get` accepts a URL or a local
 * path as readily as a repository, so it is a download-and-run from anywhere. A name that arrives
 * from a browser is therefore checked against the REGISTRY LISTING — not merely against a pattern —
 * and when the registry cannot be read nothing is installed at all.
 */

const path = require('path');

const { esc } = require('../html');
const { workspaceDir } = require('../workspaces');
const { ddevProjectName, startInScreen, screenStartedHtml } = require('../jobs');
const { NAME_RE } = require('../validate');
const addons = require('../ddev-addons');

// An installed add-on is removed and updated BY NAME (`adminer`), not by repository: that is the name
// DDEV recorded for it, and the only names accepted are the ones it recorded.
const INSTALLED_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

async function project(form, workspace) {
  const projectName = String(form.projectName || '');
  if (!NAME_RE.test(projectName)) return { error: 'Invalid project name.' };
  const projectDir = path.join(workspaceDir(workspace), projectName);
  if (!ddevProjectName(projectDir)) return { error: 'Not a DDEV project.' };
  return { projectName, projectDir };
}

async function addon_get({ form, send, workspace }) {
  const p = await project(form, workspace);
  if (p.error) return send(`<div class="msg error">${esc(p.error)}</div>`, 400);
  const repo = String(form.addon || '').trim();
  // The registry is the allowlist. A repository nobody publishes is not installed from here, and a
  // registry that could not be read means nothing is installed rather than anything being trusted.
  const known = await addons.isKnownAddon(repo);
  if (!known.ok) return send(`<div class="msg error">${esc(known.why)}</div>`, 400);
  addons.invalidateRegistry();
  const started = await startInScreen({
    workspace,
    project: p.projectName,
    projectDir: p.projectDir,
    verb: 'addon-get',
    cmdLine: `ddev add-on get ${repo} && echo "Installed. Run ddev restart to enable it."`,
    label: `ddev add-on get ${repo}`,
  });
  return send(screenStartedHtml(started, `ddev add-on get ${repo}`, p.projectName),
    started.ok ? 200 : (started.already ? 409 : 500));
}

async function addon_verb({ form, send, workspace, pathname }) {
  const p = await project(form, workspace);
  if (p.error) return send(`<div class="msg error">${esc(p.error)}</div>`, 400);
  const name = String(form.addon || '').trim();
  if (!INSTALLED_NAME_RE.test(name)) return send('<div class="msg error">Invalid add-on name.</div>', 400);
  // Only what DDEV has actually recorded in this project: removing or updating something that is not
  // installed is an error worth giving now rather than in a screen session.
  const installed = addons.installedAddons(p.projectDir);
  const found = installed.find((a) => a.name === name);
  if (!found) return send(`<div class="msg error"><strong>${esc(name)}</strong> is not installed in this project.</div>`, 404);
  const removing = pathname === '/actions/ddev-addon-remove';
  if (removing && form.confirm !== 'yes') {
    return send('<div class="msg error">Removing an add-on takes its files out of the project — it needs confirmation.</div>', 400);
  }
  addons.invalidateRegistry();
  const cmdLine = removing
    ? `ddev add-on remove ${name} && echo "Removed ${name}. Run ddev restart."`
    : `ddev add-on update ${name} && echo "Updated ${name}. Run ddev restart."`;
  const started = await startInScreen({
    workspace,
    project: p.projectName,
    projectDir: p.projectDir,
    verb: removing ? 'addon-remove' : 'addon-update',
    cmdLine,
    label: `ddev add-on ${removing ? 'remove' : 'update'} ${name}`,
  });
  return send(screenStartedHtml(started, `ddev add-on ${removing ? 'remove' : 'update'} ${name}`, p.projectName),
    started.ok ? 200 : (started.already ? 409 : 500));
}

module.exports = {
  '/actions/ddev-addon-get': addon_get,
  '/actions/ddev-addon-remove': addon_verb,
  '/actions/ddev-addon-update': addon_verb,
  INSTALLED_NAME_RE,
};
