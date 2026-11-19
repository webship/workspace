/**
 * The Plugins page's buttons: each one is core/scripts/plugins.sh with a verb, started in a screen
 * session like every other command, so the record of what happened is the same as on the command
 * line and nothing is drawn as a terminal in the page. The session stays open to be read when the
 * step is done; a step that restarts the dashboard is not lost with it.
 */

const path = require('path');

const { ROOT } = require('../workspaces');
const { screenStartedHtml } = require('../jobs');
const { shWords } = require('../shell-quote');
const { startUnlessRunning } = require('./composer');
const { lingerTail } = require('../linger');
const { pluginByName } = require('../plugin-manifest');

const VERBS = new Set(['require', 'activate', 'install', 'configure', 'deactivate', 'uninstall', 'remove']);
const WITH_NEEDS = new Set(['require', 'activate', 'install']);
const NAME_RE = /^[a-z0-9-]+$/;
// An npm spec: a package name, github:owner/repo[#ref], a git+https url, a tarball or a path. Nothing a shell could read as more than one word.
// Never a leading dash: npm would read `--dry-run` or `-g` in the spec's place as an option of its own.
const SPEC_RE = /^[A-Za-z0-9@./~][A-Za-z0-9@:/._#+~-]*$/;

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
    // The card asked "add what it needs too?" and the answer was yes: the script adds it in the same run.
    // Without it the script stops at an unmet need and says the exact commands.
    const withNeeds = WITH_NEEDS.has(verb) && String(form.withNeeds || '') === '1';
    const args = ['core/scripts/plugins.sh', `--${verb}`, arg, ...(withNeeds ? ['--with-needs'] : [])];
    // One session per plugin and step: pressing it twice answers "already running".
    const what = verb === 'require' ? (arg.match(/workspace-([a-z-]+?)(?:-\d|[@#.]|$)/) || [])[1] || 'package' : arg;
    const label = `plugin ${verb} ${arg}`;
    // A session left open from the last time (its step done, waiting to be read) is replaced; one still at work is left alone.
    const started = await startUnlessRunning({ workspace: 'plugins', project: what, projectDir: ROOT, verb,
      cmdLine: `bash ${shWords(args)}; ${lingerTail(label)}`, label });
    // The page that asked shows the plugin's state: it is told when the step is done (refresh-projects), not reloaded.
    const answer = started.stillRunning ? { ...started, already: true } : { ...started, watch: true };
    return send(screenStartedHtml(answer, label, what), answer.ok ? 200 : (answer.already ? 409 : 500));
  },
};
