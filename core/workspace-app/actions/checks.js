/**
 * Running the checks a project already declares, from the dashboard.
 *
 * Two handlers. `/actions/checks-plan` answers instantly and starts nothing — it is the same
 * `--list` the command prints, so you can see what a package covers before deciding to run it.
 * `/actions/checks` starts the real thing as a job, because a full set on a large package is
 * minutes of work and belongs in a toast rather than in a request.
 *
 * Neither ever passes a writing flag. The command has one (`--fix`); the dashboard does not send it,
 * because a button that rewrites source files on a click is not a button anybody should press by
 * accident.
 */

const fs = require('fs');
const path = require('path');

const { esc } = require('../html');
const { workspaceDir } = require('../workspaces');
const { jobFragment, runningJobKey, startJob, listProjects , startInScreen, screenStartedHtml } = require('../jobs');
const { NAME_RE } = require('../validate');
const { checksDeclaredOf } = require('../checks');

const SCRIPT = 'cmd-tools-checks.sh';

// The guards every handler here repeats: a real workspace folder that ships the command, a project
// name that is a name, and a project that is actually in that folder.
function target(form, workspace) {
  const dir = workspaceDir(workspace);
  const projectName = String(form.projectName || '');
  if (!fs.existsSync(path.join(dir, SCRIPT))) return { error: 'This workspace has no checks command.' };
  if (!NAME_RE.test(projectName) || !listProjects(dir).includes(projectName)) return { error: 'Unknown project.' };
  return { dir, projectName };
}

// The plan, rendered as the table the command prints. No job: this is filesystem work.
async function checks_plan({ form, send, workspace }) {
  const t = target(form, workspace);
  if (t.error) return send(`<div class="msg error">${esc(t.error)}</div>`, 400);

  const { resolvePlan } = require(path.join(require('../workspaces').ROOT, 'core', 'scripts', 'libs', 'checks_plan'));
  let plan;
  try {
    plan = resolvePlan(path.join(t.dir, t.projectName));
  } catch (e) {
    return send(`<div class="msg error">Could not read that package: ${esc(e.message)}</div>`, 500);
  }

  const symbol = { ready: '✅', masked: '⛔', refused: '🚫', skipped: '⏭', 'deps-missing': '⏭', 'unresolved-runner': '⏭', none: '➖' };
  const rows = plan.rows.map((r) => `
      <tr class="checks-row is-${esc(r.status)}">
        <td>${symbol[r.status] || '➖'}</td>
        <td><code>${esc(r.id)}</code></td>
        <td>${r.script ? `<code>${esc(r.script)}</code>` : '<span class="uk-text-meta">—</span>'}</td>
        <td class="uk-text-meta">${esc(r.status === 'ready' ? r.command : r.reason)}</td>
      </tr>`).join('');

  return send(`
    <div class="checks-plan">
      <p class="uk-text-meta uk-margin-remove-bottom">
        ${plan.hasPackageJson
          ? `${esc(plan.runner || 'no package manager')} · ${esc(plan.runnerReason)} · dependencies ${plan.deps.installed ? 'installed' : `<strong>not installed</strong> (${esc(plan.deps.evidence)})`}`
          : 'This project has no package.json — only the checks a DDEV add-on provides can apply.'}
      </p>
      <table class="uk-table uk-table-small uk-table-divider checks-table"><tbody>${rows}</tbody></table>
      <p class="uk-text-meta">Every check this project declares, and the script behind it. Nothing has been run.</p>
    </div>`);
}

// The real run, as a job.
async function checks_run({ form, send, workspace }) {
  const t = target(form, workspace);
  if (t.error) return send(`<div class="msg error">${esc(t.error)}</div>`, 400);

  const declared = checksDeclaredOf(t.dir, t.projectName);
  if (!declared.declared) {
    return send('<div class="msg error">This project declares no check this command can run — open the plan to see why.</div>', 409);
  }

  const jobKey = `checks:${workspace}/${t.projectName}`;
  if (runningJobKey(jobKey)) {
    return send('<div class="msg error">The checks are already running for this project.</div>', 409);
  }

  // --only rides through when the row asked for one check; otherwise the whole declared set runs.
  const only = String(form.only || '').trim();
  const args = [SCRIPT, t.projectName, ...(only && /^[a-z,]+$/.test(only) ? ['--only', only] : [])];
  const started = await startInScreen({ workspace, project: t.projectName, projectDir: t.dir, verb: 'checks',
    cmdLine: `bash ${args.map((a) => JSON.stringify(a)).join(' ')}`, label: 'checks' });
  return send(screenStartedHtml(started, 'checks', t.projectName), started.ok ? 200 : (started.already ? 409 : 500));
}

module.exports = {
  '/actions/checks': checks_run,
  '/actions/checks-plan': checks_plan,
};
