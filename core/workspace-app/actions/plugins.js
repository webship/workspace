/**
 * The Plugins page's buttons: each one is core/scripts/plugins.sh with a verb, run as a job so the
 * output streams to the page and the record of what happened is the same as on the command line.
 */

const path = require('path');

const { esc } = require('../html');
const { ROOT } = require('../workspaces');
const { jobFragment, runningJobKey, startJob } = require('../jobs');
const { pluginByName } = require('../plugin-manifest');

const VERBS = new Set(['require', 'activate', 'install', 'configure', 'deactivate', 'uninstall']);
const NAME_RE = /^[a-z0-9-]+$/;
// An npm spec: a package name, github:owner/repo[#ref], a git+https url, a tarball or a path. Nothing a shell could read as more than one word.
const SPEC_RE = /^[A-Za-z0-9@:/._#+~-]+$/;

module.exports = {
  '/actions/plugins': async ({ form, send }) => {
    const verb = String(form.verb || '');
    if (!VERBS.has(verb)) return send('<div class="msg error">Unknown plugin action.</div>', 400);
    let arg = '';
    if (verb === 'require') {
      arg = String(form.spec || '').trim();
      if (!SPEC_RE.test(arg)) return send('<div class="msg error">That is not a package spec: a name, github:owner/repo, a git url, a tarball or a path.</div>', 400);
    } else {
      arg = String(form.name || '');
      if (!NAME_RE.test(arg) || !pluginByName(arg)) return send('<div class="msg error">Unknown plugin.</div>', 400);
    }
    const key = `plugins:${verb}:${arg}`;
    if (runningJobKey(key)) return send('<div class="msg error">That is already running.</div>', 409);
    const id = startJob(`🧩 Plugin <strong>${esc(verb)}</strong> ${esc(arg)}`, 'bash', ['core/scripts/plugins.sh', `--${verb}`, arg], ROOT,
      { timeoutMs: 10 * 60 * 1000, echoLine: `bash core/scripts/plugins.sh --${verb} ${arg}`, key });
    return send(jobFragment(id).html);
  },
};
