/**
 * The Upsun bridge: environments, live URLs, and getting a database and files into the local site.
 *
 * A factory over the dashboard's `api`: everything it needs comes through `api.lib` and
 * `api.settings`, so this file requires nothing outside the package.
 */

const fs = require('fs');
const path = require('path');

const { upsunLinkOf } = require('./link');

module.exports = function environments(api) {
  const { esc, cliError, ROOT, workspaceDir, run, listProjects, startInScreen, screenStartedHtml, NAME_RE, commandBlock } = api.lib;
  const settings = () => api.settings.read() || {};
  const post = (name) => `/actions/p/${api.name}/${name}`;

  // The Upsun branch-and-data commands, shown rather than run.
  //
  // The dashboard container has the upsun CLI but no session — the credentials live in the
  // host's own upsun profile, which is not bind-mounted, and they are cloud credentials for
  // client projects, which is not something to hand a web request. A pull is also destructive
  // locally (the DDEV database is replaced) and touches client data, so the honest thing is the
  // exact command, with the environment list beside it.
async function upsun_environments({ form, res, send, workspace, pathname }) {
    const dir = workspaceDir(workspace);
    const projectName = String(form.projectName || '');
    if (!NAME_RE.test(projectName) || !listProjects(dir).includes(projectName)) {
      return send('<div class="msg error">Unknown project.</div>', 400);
    }
    const u = upsunLinkOf(dir, projectName);
    if (!u || !u.id) return send('<div class="msg error">This project is not linked to an Upsun project.</div>', 409);
    const cd = `cd ${ROOT}/${workspace}`;
    const env = u.env;
    return send(commandBlock(
      `Branch and data for ${projectName} on Upsun ${u.id}`,
      [`${cd} && bash cmd-tools-upsun.sh ${projectName} --environments`,
        `${cd} && bash cmd-tools-upsun.sh ${projectName} --select <environment>`,
        `${cd} && bash cmd-tools-upsun.sh ${projectName} --pull-db`,
        `${cd} && bash cmd-tools-upsun.sh ${projectName} --pull-files`],
      `${env ? `Currently working against <strong>${esc(env)}</strong>. ` : 'No environment selected yet — a pull refuses to guess which branch it takes data from. '}`
      + 'Run these <strong>on the host</strong>: the upsun CLI here has no session, and these are cloud '
      + 'credentials for client projects. <code>--pull-db</code> REPLACES the local database (the current '
      + 'one is exported to <code>backups/</code> first) and <code>--pull-files</code> adds and overwrites '
      + 'the public files mount. Both bring client data onto this machine — sanitize before sharing.'));
}


// The env the upsun CLI needs in this container: the API token from settings
// (upsun.cli_token). Injected per job, never into the app environment.
function upsunJobEnv() {
  try {
    const t = String(settings().cli_token || '').trim();
    if (t && t !== 'CHANGE_ME') return { ...process.env, UPSUN_CLI_TOKEN: t };
  } catch (_) { /* fall through */ }
  return null;
}

// "Unable to authenticate the provided API token" has one overwhelmingly likely cause
// here, and the message does not say it: the field holds a token of the wrong KIND.
// An Atlassian token in upsun.cli_token is refused with exactly this wording, which
// reads like an expiry — so the hint is attached where the field is known.
function upsunError(out) {
  const msg = cliError(out.stderr || out.stdout);
  // The CLI hard-wraps its error box at a fixed width and splits words across lines —
  // the real output is "provided AP\n  I token." — so "API token" never appears as a
  // contiguous string. Match on what survives the wrap.
  if (/could not be authorized|authenticate the provided/i.test(msg)) {
    return msg + '\n\nThat token is cli_token in core/config/plugin.upsun.settings.yml. It must be an '
      + 'UPSUN API token (Upsun console \u2192 My profile \u2192 API tokens) \u2014 an Atlassian '
      + 'token, which starts ATATT, is refused with this exact message.';
  }
  return msg;
}

// The environments and their live URLs, cached: a project row cannot pay for
// two upsun CLI calls per render, and the answer changes rarely.
const _envCache = new Map();
async function upsunEnvironments(dir, projectName) {
  const u = upsunLinkOf(dir, projectName);
  if (!u || !u.id) return null;
  const hit = _envCache.get(u.id);
  if (hit && hit.rows) return hit;
  const env = upsunJobEnv();
  if (!env) return { id: u.id, rows: [], why: 'no token' };
  const out = await run('upsun', ['environment:list', '-p', u.id, '--format', 'csv', '--columns', 'title,id,status', '--no-header'],
    process.env.HOME, { timeoutMs: 60 * 1000, env });
  if (!out.ok) return { id: u.id, rows: [], why: 'list failed' };
  const rows = String(out.stdout).split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const parts = l.split(',');
    return { title: parts[0], envId: parts[1], status: parts[2] || '' };
  }).filter((r) => r.envId && /^[a-zA-Z0-9._\/-]+$/.test(r.envId));
  await Promise.all(rows.map(async (r) => {
    if (!/^active$/i.test(r.status)) return;
    const res = await run('upsun', ['url', '--primary', '--pipe', '-p', u.id, '-e', r.envId],
      process.env.HOME, { timeoutMs: 60 * 1000, env });
    const url = String(res.stdout || '').trim().split('\n')[0];
    if (res.ok && /^https?:\/\//.test(url)) r.url = url;
  }));
  const answer = { id: u.id, rows, branch: u.branch, env: u.env };
  _envCache.set(u.id, answer);
  // Five minutes is long enough to render a page many times, short enough that a
  // new branch shows up without a restart.
  setTimeout(() => _envCache.delete(u.id), 5 * 60 * 1000).unref?.();
  return answer;
}

// Every environment with its HUMAN name and its own live site link — resolved
// in parallel for the active ones, rendered into the modal.
// Every environment with its HUMAN name and its own live site link — resolved
// in parallel for the active ones, rendered into the modal.
async function upsun_envs({ form, send, workspace }) {
  const dir = workspaceDir(workspace);
  const projectName = String(form.projectName || '');
  if (!NAME_RE.test(projectName) || !listProjects(dir).includes(projectName)) {
    return send('<div class="msg error">Unknown project.</div>', 400);
  }
  const u = upsunLinkOf(dir, projectName);
  if (!u || !u.id) return send('<div class="msg error">This project is not linked to an Upsun project.</div>', 409);
  const env = upsunJobEnv();
  if (!env) return send('<div class="msg error">No Upsun API token configured (cli_token in core/config/plugin.upsun.settings.yml).</div>', 409);
  const out = await run('upsun', ['environment:list', '-p', u.id, '--format', 'csv', '--columns', 'title,id,status', '--no-header'],
    process.env.HOME, { timeoutMs: 60 * 1000, env });
  if (!out.ok) return send(`<div class="msg error">Could not list the environments: <pre>${esc(upsunError(out))}</pre></div>`, 502);
  const rows = String(out.stdout).split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const parts = l.split(',');
    return { title: parts[0], envId: parts[1], status: parts[2] || '' };
  }).filter((r) => r.envId && /^[a-zA-Z0-9._\/-]+$/.test(r.envId));
  // One url call per ACTIVE environment, in parallel — a paused one has no route.
  await Promise.all(rows.map(async (r) => {
    if (!/^active$/i.test(r.status)) return;
    const res = await run('upsun', ['url', '--primary', '--pipe', '-p', u.id, '-e', r.envId],
      process.env.HOME, { timeoutMs: 60 * 1000, env });
    const url = String(res.stdout || '').trim().split('\n')[0];
    if (res.ok && /^https?:\/\//.test(url)) r.url = url;
  }));
  const list = rows.map((r) => `
    <div class="uk-margin-small-bottom">
      ${/^active$/i.test(r.status) ? '<span class="uk-label uk-label-success">active</span>' : `<span class="uk-label">${esc(r.status.toLowerCase())}</span>`}
      <strong>${esc(r.title)}</strong>${r.title !== r.envId ? ` <span class="uk-text-meta">(${esc(r.envId)})</span>` : ''}
      ${r.envId === u.branch ? '<span class="uk-text-meta">· the local code is on this branch</span>' : ''}
      ${r.url ? `· <a href="${esc(r.url)}" target="_blank">${esc(r.url)}</a>` : ''}
    </div>`).join('');
  return send(`
    <div class="editor-card">
      <h3 class="uk-margin-small-bottom">Environments — ${esc(projectName)}</h3>
      <p class="uk-text-meta">Upsun project <code>${esc(u.id)}</code>. Each active environment with its live site.</p>
      ${list || '<div class="msg error">No environments.</div>'}
    </div>`);
}

// The live URL of the environment the local code is on (or the selected one):
// one upsun call, answered as a clickable link.
async function upsun_site_url({ form, send, workspace }) {
  const dir = workspaceDir(workspace);
  const projectName = String(form.projectName || '');
  if (!NAME_RE.test(projectName) || !listProjects(dir).includes(projectName)) {
    return send('<div class="msg error">Unknown project.</div>', 400);
  }
  const u = upsunLinkOf(dir, projectName);
  if (!u || !u.id) return send('<div class="msg error">This project is not linked to an Upsun project.</div>', 409);
  const environment = u.branch || u.env || 'main';
  const env = upsunJobEnv();
  if (!env) return send('<div class="msg error">No Upsun API token configured (cli_token in core/config/plugin.upsun.settings.yml).</div>', 409);
  const out = await run('upsun', ['url', '--primary', '--pipe', '-p', u.id, '-e', environment], process.env.HOME,
    { timeoutMs: 60 * 1000, env });
  const url = String(out.stdout || '').trim().split('\n')[0];
  if (!out.ok || !/^https?:\/\//.test(url)) {
    return send(`<div class="msg error">Could not resolve the URL of ${esc(environment)}: <pre>${esc(String(out.stderr || out.stdout).slice(-250))}</pre></div>`, 502);
  }
  return send(`<div class="msg assistant">🌐 <strong>${esc(projectName)}</strong> · ${esc(environment)} on Upsun:
    <a href="${esc(url)}" target="_blank">${esc(url)}</a></div>`);
}

// The pull modal: pick the environment (live list), choose database and/or
// files, see exactly what a pull replaces before confirming.
async function upsun_pull_form({ form, send, workspace }) {
  const dir = workspaceDir(workspace);
  const projectName = String(form.projectName || '');
  if (!NAME_RE.test(projectName) || !listProjects(dir).includes(projectName)) {
    return send('<div class="msg error">Unknown project.</div>', 400);
  }
  const u = upsunLinkOf(dir, projectName);
  if (!u || !u.id) return send('<div class="msg error">This project is not linked to an Upsun project.</div>', 409);
  const env = upsunJobEnv();
  if (!env) {
    return send('<div class="msg error">No Upsun API token configured — set <code>cli_token</code> in plugin.upsun.settings.yml (Settings page; create a token in the Upsun console under My profile → API tokens). The host commands in "Branch and data…" work meanwhile.</div>', 409);
  }
  const out = await run('upsun', ['environment:list', '--project', u.id, '--format', 'csv', '--columns', 'id,status', '--no-header'], process.env.HOME,
    { timeoutMs: 60 * 1000, env });
  if (!out.ok) {
    return send(`<div class="msg error">Could not list the environments: <pre>${esc(upsunError(out))}</pre></div>`, 502);
  }
  // Only ACTIVE environments are offered: a paused environment has no running
  // services to dump from, and a pull against it just fails slower.
  const all = String(out.stdout).split('\n').map((l) => l.trim().split(','))
    .filter((p) => p.length >= 2 && /^[a-zA-Z0-9._\/-]+$/.test(p[0]));
  const envs = all.filter((p) => /^active$/i.test(p[1])).map((p) => p[0]);
  const inactive = all.length - envs.length;
  if (!envs.length) return send(`<div class="msg error">No ACTIVE environments on this project${all.length ? ` (${all.length} inactive/paused)` : ''} — activate one in the Upsun console first.</div>`, 409);
  return send(`
    <div class="editor-card">
      <h3 class="uk-margin-small-bottom">Get database &amp; files — ${esc(projectName)}</h3>
      <p class="uk-text-meta">From Upsun project <code>${esc(u.id)}</code> into the local DDEV site.
        The local database is REPLACED (the current one is exported to <code>backups/</code> first);
        files are added and overwritten, never deleted. Client data lands on this machine.</p>
      <form hx-post="${post('pull')}" hx-target="#editor-modal-body" hx-swap="innerHTML">
        <!-- Two ticks, the shape the Remove flow already uses: the destructive choice is
             made in the form, visibly, rather than in a browser dialog that adds no field
             and leaves no record of what was agreed to. -->
        <input type="hidden" name="workspace" value="${esc(workspace)}">
        <input type="hidden" name="projectName" value="${esc(projectName)}">
        <label class="uk-form-label">Active environment (branch) to sync from
          <select class="uk-select uk-margin-small-bottom" name="environment">
            ${envs.map((e) => `<option value="${esc(e)}"${e === (u.env || 'main') ? ' selected' : ''}>${esc(e)}</option>`).join('')}
          </select>
          ${inactive ? `<span class="uk-text-meta">${inactive} inactive environment${inactive > 1 ? 's' : ''} not offered — a paused environment has nothing running to dump from.</span>` : ''}
        </label>
        <label><input class="uk-checkbox" type="checkbox" name="db" checked> Database</label>
        <label class="uk-margin-left"><input class="uk-checkbox" type="checkbox" name="files" checked> Files</label>
        ${fs.existsSync(path.join(dir, projectName, '.git'))
          ? `<label class="uk-margin-left"><input class="uk-checkbox" type="checkbox" name="switch" checked> Switch the local code to this branch</label>
             <div class="uk-text-meta">Uncommitted local changes are stashed first (recover with <code>git stash pop</code>), then the code switches. After the pull, caches are rebuilt (drush cr) and the local site is checked.</div>`
          : `<div class="uk-text-meta">Not a git clone — the code stays as it is; caches are rebuilt and the local site checked after the pull.</div>`}
        <label class="uk-margin-small uk-display-block">
          <input class="uk-checkbox" type="checkbox" name="backup" value="yes" checked>
          Back up the local database into <code>backups/${esc(workspace)}/${esc(projectName)}/</code> first
        </label>
        <label class="uk-margin-small uk-display-block">
          <input class="uk-checkbox" type="checkbox" name="confirm" value="yes" required>
          I confirm: data from <strong>Upsun</strong> replaces this local DDEV site's
          <strong>database</strong>, <strong>files</strong> and <strong>code</strong>
        </label>
        <div class="uk-margin-small-top">
          <button type="submit" class="uk-button uk-button-primary"><span uk-icon="icon: cloud-download; ratio: .8"></span> Get it</button>
        </div>
      </form>
    </div>`);
}

// The pull itself: the workspace tool, in an inline job with honest phases.
async function upsun_pull({ form, send, workspace }) {
  const dir = workspaceDir(workspace);
  const projectName = String(form.projectName || '');
  const environment = String(form.environment || '').trim();
  const wantDb = form.db !== undefined;
  const wantFiles = form.files !== undefined;
  if (!NAME_RE.test(projectName) || !listProjects(dir).includes(projectName)) {
    return send('<div class="msg error">Unknown project.</div>', 400);
  }
  if (!/^[a-zA-Z0-9._\/-]+$/.test(environment)) return send('<div class="msg error">Not an environment name.</div>', 400);
  {
    const u2 = upsunLinkOf(dir, projectName);
    const chk = await run('upsun', ['environment:info', 'status', '--project', u2 ? u2.id : '', '--environment', environment], process.env.HOME,
      { timeoutMs: 30 * 1000, env: upsunJobEnv() || process.env });
    if (chk.ok && !/active/i.test(String(chk.stdout))) {
      return send(`<div class="msg error">${esc(environment)} is not active — nothing running to sync from.</div>`, 409);
    }
  }
  if (!wantDb && !wantFiles) return send('<div class="msg error">Pick the database, the files, or both.</div>', 400);
  // querystring.parse gives an ARRAY when a key appears twice, and a strict
  // comparison then fails however many 'yes' values arrive. Normalise before
  // checking: the guard is about intent, not about arity.
  const confirmed = [].concat(form.confirm || '').includes('yes');
  if (!confirmed) return send('<div class="msg error">Syncing replaces local data — it requires confirmation.</div>', 400);
  const env = upsunJobEnv();
  if (!env) return send('<div class="msg error">No Upsun API token configured (cli_token in core/config/plugin.upsun.settings.yml).</div>', 409);
  const wantSwitch = form.switch !== undefined && fs.existsSync(path.join(dir, projectName, '.git'));
  const parts = [
    `echo "Starting DDEV for ${projectName}…" && (cd ${projectName} && ddev start -y > /dev/null && ddev describe > /dev/null) && echo "DDEV is up and healthy."`,
  ];
  if (wantSwitch) {
    // Refuse a dirty tree rather than eating changes; ff-only so a diverged
    // local branch stops the job instead of silently merging.
    parts.push([
      `cd ${projectName}`,
      // A dirty tree is CLEANED into a named stash, not a dead end: the switch
      // proceeds, and the work stays recoverable with git stash pop.
      `if [ -n "$(git status --porcelain)" ]; then STASH_NAME="upsun-pull $(date +%Y-%m-%d-%H%M%S)" && git stash push --include-untracked -m "$STASH_NAME" && echo "Local changes stashed as: $STASH_NAME (recover with: git stash pop)"; fi`,
      `echo "Switching the code to ${environment}…"`,
      `git fetch upsun ${environment}`,
      `(git checkout ${environment} 2>/dev/null || git checkout -b ${environment} upsun/${environment})`,
      `git pull --ff-only upsun ${environment}`,
      `echo "Code is on ${environment}."`,
      `cd ..`,
    ].join(' && '));
  }
  // The safety export is now the person's call, not an assumption. Unticking it is a
  // deliberate "I do not want the current local data kept".
  const noSafety = form.backup === undefined ? ' --no-safety-backup' : '';
  if (wantDb) parts.push(`bash cmd-tools-upsun.sh ${projectName} --environment ${environment} --pull-db${noSafety}`);
  if (wantFiles) parts.push(`bash cmd-tools-upsun.sh ${projectName} --environment ${environment} --pull-files`);
  // The point of the pull is a WORKING local site: rebuild caches, then ask it.
  parts.push([
    `cd ${projectName}`,
    `echo "Rebuilding caches (drush cr)…"`,
    `ddev drush cr > /dev/null 2>&1 || echo "drush cr failed — not a Drupal site, or the codebase does not match the database"`,
    // Retry, because this races the container. drush cr and the import leave the web
    // service briefly unreachable, and a single curl then returns an EMPTY code — which
    // read as "the sync failed" on two syncs that had in fact succeeded completely.
    `for i in 1 2 3 4 5 6 7 8 9 10; do code=$(curl -sk -o /dev/null -w "%{http_code}" "https://${projectName}.ddev.site/"); case "$code" in 200|301|302|303) break ;; esac; sleep 3; done`,
    `echo "Local site check: https://${projectName}.ddev.site/ answered $code"`,
    `case "$code" in 200|301|302|303) echo "✅ The local site is working." ;; *) echo "⚠️ The local site did not answer cleanly ($\{code:-no response after 30s}) — check ddev logs."; exit 1 ;; esac`,
  ].join(' && '));
  const shellLine = parts.join(' && ');
  const phases = ['DDEV is up and healthy'];
  if (wantSwitch) phases.push('Code is on');
  if (wantDb) phases.push('Exporting the current database', 'Importing');
  if (wantFiles) phases.push('files');
  phases.push('Rebuilding caches', 'Local site check');
  // projectDir is WHERE THE COMMAND RUNS, ownerDir is the project it belongs to — see
  // startInScreen. This shellLine is written for the workspace folder: it does
  // `cd <project>` and calls `bash cmd-tools-upsun.sh`, which lives there. Running it in
  // the project directory made every session die on its first line with
  // "cd: <project>: No such file or directory", so nothing was ever fetched.
  const started = await startInScreen({ workspace, project: projectName,
    projectDir: dir, ownerDir: path.join(dir, projectName),
    verb: `upsun-pull-${environment}`, cmdLine: shellLine, label: `get ${wantDb ? 'database' : ''}${wantDb && wantFiles ? ' + ' : ''}${wantFiles ? 'files' : ''} from ${environment}` });
  return send(screenStartedHtml(started, `upsun pull from ${environment}`, projectName), started.ok ? 200 : (started.already ? 409 : 500));
}

  return { upsunEnvironments, upsunJobEnv, actions: { envs: upsun_envs, 'pull-form': upsun_pull_form, pull: upsun_pull, environments: upsun_environments, 'site-url': upsun_site_url } };
};
