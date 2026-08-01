/**
 * The DDEV verbs a project row offers, and the status of every project on the machine.
 *
 * One module per area of the dashboard, each exporting the handlers it owns keyed by the path
 * that reaches them. server.js merges the maps and dispatches; nothing here knows about routing,
 * and adding an action is adding an entry rather than another branch in a 650-line function.
 *
 * Every handler takes the same context: the parsed form, the response, a `send` that writes an
 * HTML fragment, and the workspace the request named.
 */

const fs = require('fs');
const path = require('path');

const { ROOT, ddevProjectName, loadWorkspaces, workspaceDir } = require('../workspaces');
const { esc } = require('../html');
const { jobFragment, run, startJob } = require('../jobs');
const { NAME_RE, ddevStatusMap } = require('../views');
const { DDEV_ACTIONS } = require('../ddev');
const handlers = {
  '/actions/ddev-start': async ({ form, res, send, workspace, req, pathname }) => {
    const projectName = String(form.projectName || '');
    if (!NAME_RE.test(projectName)) return send('<div class="msg error">Invalid project name.</div>', 400);
    const projectDir = path.join(workspaceDir(workspace), projectName);
    if (!ddevProjectName(projectDir)) return send('<div class="msg error">Not a DDEV project.</div>', 400);
    const verb = pathname === '/actions/ddev-start' ? 'start' : 'stop';
    // `ddev start` accepts -y (skip confirmation); `ddev stop` has no such flag.
    const args = verb === 'start' ? ['start', '-y'] : ['stop'];
    const id = startJob(`${verb === 'start' ? '▶️' : '⏹️'} <code>ddev ${verb}</code> on <strong>${esc(projectName)}</strong>`, 'ddev', args, projectDir, { timeoutMs: 5 * 60 * 1000 });
    return send(jobFragment(id).html);
  },
  '/actions/ddev-stop': null, // set below to the same handler as /actions/ddev-start,
  // Every remaining DDEV verb shares one handler, driven by the table in ddev.js.
  ...Object.fromEntries(Object.keys(DDEV_ACTIONS).map((p) => [p, async ({ form, res, send, workspace }) => {
    // The rest of the DDEV verbs, from a row's DDEV dropdown. Every one is per-project and runs
    // `ddev` in the project directory, exactly like Start and Stop — so the workspace's rule holds
    // throughout: no host composer, drush or mysql, ever.
      const act = DDEV_ACTIONS[p];
      const projectName = String(form.projectName || '');
      if (!NAME_RE.test(projectName)) return send('<div class="msg error">Invalid project name.</div>', 400);
      const projectDir = path.join(workspaceDir(workspace), projectName);
      if (!ddevProjectName(projectDir)) return send('<div class="msg error">Not a DDEV project.</div>', 400);
      let args = act.args;
      if (act.needsRunning) {
        // Asked rather than assumed: `ddev drush` on a stopped project prints a docker error that
        // says nothing about the actual problem, which is that the site is not up.
        const statuses = await ddevStatusMap();
        if (statuses[ddevProjectName(projectDir)]?.status !== 'running') {
          return send(`<div class="msg error">${esc(projectName)} is not running — start it first.</div>`, 400);
        }
      }
      if (act.toBackups) {
        // A dump belongs in the workspace's backups folder, beside the archives — never in the home
        // directory, and never inside the project it came from.
        const outDir = loadWorkspaces()[workspace].backupsDir;
        try { fs.mkdirSync(outDir, { recursive: true }); } catch (_) { /* ddev reports it */ }
        const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
        args = [...args, '--gzip', '--file', path.join(outDir, `${projectName}--db--${stamp}.sql.gz`)];
      }
      const id = startJob(`${act.icon} <code>${esc(act.label)}</code> on <strong>${esc(projectName)}</strong>`,
        'ddev', args, projectDir, { timeoutMs: act.ms });
      return send(jobFragment(id).html);
  }])),
  '/actions/status': async ({ form, res, send, workspace, req, pathname }) => {
    const result = await run('ddev', ['list', '--json-output'], ROOT, { timeoutMs: 60 * 1000 });
    let lines = '';
    try {
      const parsed = JSON.parse(result.stdout);
      lines = (parsed.raw || [])
        .map((p) => `${p.status === 'running' ? '🟢' : '⚪'} ${p.name} — ${p.status}${p.status === 'running' ? ` — ${p.primary_url}` : ''}`)
        .join('\n') || 'No DDEV projects registered.';
    } catch (_) {
      lines = (result.stdout + '\n' + result.stderr).replace(/\x1b\[[0-9;]*m/g, '').trim();
    }
    return send(`
      <div class="msg ${result.ok ? 'assistant' : 'error'}">
        <p>💚 <strong>DDEV status:</strong></p>
        <pre>${esc(lines)}</pre>
      </div>`);
  },
};

// The same handler, reached by a second path.
handlers['/actions/ddev-stop'] = handlers['/actions/ddev-start'];

module.exports = handlers;
