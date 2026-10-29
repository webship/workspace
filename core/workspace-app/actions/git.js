/**
 * The GIT menu on a project row: the common git commands for that project.
 *
 * Every git command the menu runs goes to a SCREEN SESSION, like everything else the dashboard runs,
 * and the page shows nothing but the short toast at the top that links to it. Nothing is rendered at
 * the end of the page.
 *
 * A git command finishes in well under a second, and a session ends when its command does — so a
 * plain session would be gone before anyone opened it. Each one therefore stays open after the output,
 * waiting for Enter, and closes by itself after 15 minutes. Clicking the same command again stops the
 * session still open from last time and starts a fresh one, so what you open is always current.
 *
 * Two kinds of command, treated differently on purpose:
 *
 *   - READ-ONLY commands run from the menu.
 *   - Commands that CHANGE the repository or REACH A REMOTE — fetch, pull, switch, commit, push,
 *     stash push/pop — are only offered to copy, with a `cd <project> &&` in front so they paste
 *     straight into a terminal. A push from a dropdown is too easy to do by accident.
 *
 * The handler runs only what GIT_RUN_ACTIONS names (plus `git init`), so a hand-built request cannot
 * turn the menu into a way to push.
 *
 * A folder only gets those commands when it has its OWN `.git` — a directory, or the file a worktree
 * carries. Asking git instead (`rev-parse`) answers yes for any subfolder of a parent repository,
 * and the row would offer that parent's history as if it were the folder's. A folder with no `.git`
 * is offered `git init` instead, refused where a repository already exists.
 */

const fs = require('fs');
const path = require('path');

const { esc } = require('../html');
const { workspaceDir } = require('../workspaces');
const { startInScreen, screenStartedHtml, hostRunnerRequest } = require('../jobs');
const { NAME_RE } = require('../validate');

const GIT_RUN_ACTIONS = {
  '/actions/git-status':   { label: 'git status',        args: ['status'] },
  '/actions/git-log':      { label: 'git log (last 30)', args: ['log', '--oneline', '--graph', '--decorate', '-30'] },
  '/actions/git-diff':     { label: 'git diff --stat',   args: ['diff', '--stat'] },
  '/actions/git-branches': { label: 'git branch -a -vv', args: ['branch', '-a', '-vv'] },
  '/actions/git-remotes':  { label: 'git remote -v',     args: ['remote', '-v'] },
  '/actions/git-stashes':  { label: 'git stash list',    args: ['stash', 'list'] },
};

const GIT_COPY_COMMANDS = [
  { label: 'Fetch every remote',       line: 'git fetch --all --prune' },
  { label: 'Pull (fast-forward only)', line: 'git pull --ff-only' },
  { label: 'Switch branch',            line: 'git switch <branch>' },
  { label: 'New branch',               line: 'git switch -c <branch>' },
  { label: 'Stage and commit',         line: 'git add -A && git commit -m "<message>"' },
  { label: 'Push this branch',         line: 'git push -u origin HEAD' },
  { label: 'Stash changes',            line: 'git stash push -m "<message>"' },
  { label: 'Restore the last stash',   line: 'git stash pop' },
];

// How long a finished git session stays open to be read.
const LINGER_SECONDS = 900;

/** Does this folder have its own `.git`? A directory for a clone, a file for a worktree. */
function hasOwnGit(dir) {
  try { return fs.existsSync(path.join(dir, '.git')); } catch (_) { return false; }
}

/** Why `git init` must not run here, or '' when it may. */
function gitInitRefusal(dir) {
  let st = null;
  try { st = fs.statSync(dir); } catch (_) { return 'no such folder'; }
  if (!st.isDirectory()) return 'not a folder';
  if (hasOwnGit(dir)) return 'already a git repository';
  return '';
}

/**
 * The line a git session runs. The screen runner pipes only its OUTPUT to the log, so the wait at the
 * end reads the session's own terminal: the output stays on screen until Enter, or 15 minutes.
 * No prompts and no pager — nobody is typing a password or paging through `less` in there.
 *
 * The wait ignores end-of-file on purpose. A browser terminal attaches through `script … screen -x`
 * with the browser's messages as its stdin, and when the viewer leaves the page that stdin ends and a
 * Ctrl-D reaches the session. A plain `read` takes that as an answer, so the first version closed the
 * session the moment anyone stopped looking at it — measured: open while attached, gone two seconds
 * after the attach ended. `read` succeeding (Enter) ends the wait; failing (EOF) waits again after a
 * second, which also keeps a hung-up terminal from spinning; `timeout` ends it after 15 minutes.
 * `--foreground`, or the wait runs in a background process group and is stopped for reading the tty.
 *
 * No `$` anywhere in this line: the runner hands it to an outer `bash -lc "…"`, which would expand a
 * variable before screen started. Every piece is a constant from this file; nothing a request sends
 * reaches this string.
 */
function gitScreenCommand(label, args) {
  return `GIT_TERMINAL_PROMPT=0 git --no-pager ${args.join(' ')}; ${lingerTail(label)}`;
}

// The last line a lingering session prints. The COMPOSER menu reads it back from the log to tell a
// session that is only waiting to be read from one whose command is still running.
const LINGER_MARK = 'Press Enter to close this session';

/** The end of a lingering session's line: say it finished, then wait for Enter or 15 minutes. Shared with COMPOSER. */
function lingerTail(label) {
  return `echo; echo "${label} finished. ${LINGER_MARK}, or leave it: it closes by itself in 15 minutes."; `
    + `timeout --foreground ${LINGER_SECONDS} bash -c 'while :; do read -r _ && exit 0; sleep 1; done' || true`;
}

/** Start the session; if the same command's session is still open from last time, replace it. */
async function startFresh(opts) {
  let started = await startInScreen(opts);
  for (let i = 0; started.already && i < 3; i += 1) {
    await hostRunnerRequest('stop', { session: started.session });
    await new Promise((resolve) => setTimeout(resolve, 400));
    started = await startInScreen(opts);
  }
  return started;
}

/** The only thing the page shows: a toast at the top that opens the session. */
function openOutputToast(label, projectName, session, { reload = false } = {}) {
  return `<div class="msg assistant flash-now"${reload ? ' data-reload-on-close="1"' : ''}><code>${esc(label)}</code> on <strong>${esc(projectName)}</strong> — <a href="/terminal/${encodeURIComponent(session)}" target="_blank" rel="noopener">open the output</a></div>`;
}

async function git_run({ form, send, workspace, pathname }) {
  const act = GIT_RUN_ACTIONS[pathname];
  if (!act) return send('<div class="msg error">Unknown git command.</div>', 404);
  const projectName = String(form.projectName || '');
  if (!NAME_RE.test(projectName)) return send('<div class="msg error">Invalid project name.</div>', 400);
  const projectDir = path.join(workspaceDir(workspace), projectName);
  if (!hasOwnGit(projectDir)) {
    return send(`<div class="msg error">${esc(projectName)} has no .git of its own — start one with git init.</div>`, 400);
  }
  const started = await startFresh({ workspace, project: projectName, projectDir,
    verb: pathname.replace('/actions/', ''), cmdLine: gitScreenCommand(act.label, act.args), label: act.label });
  if (!started.ok) return send(screenStartedHtml(started, act.label, projectName), started.already ? 409 : 500);
  return send(openOutputToast(act.label, projectName, started.session));
}

async function git_init({ form, send, workspace }) {
  const projectName = String(form.projectName || '');
  if (!NAME_RE.test(projectName)) return send('<div class="msg error">Invalid project name.</div>', 400);
  const projectDir = path.join(workspaceDir(workspace), projectName);
  const refusal = gitInitRefusal(projectDir);
  if (refusal) return send(`<div class="msg error">Not running git init in ${esc(projectName)}: ${esc(refusal)}.</div>`, 400);
  const started = await startFresh({ workspace, project: projectName, projectDir,
    verb: 'git-init', cmdLine: gitScreenCommand('git init', ['init']), label: 'git init' });
  if (!started.ok) return send(screenStartedHtml(started, 'git init', projectName), started.already ? 409 : 500);
  // Reload as the toast leaves: by then the folder has its .git, and the row offers the commands.
  return send(openOutputToast('git init', projectName, started.session, { reload: true }));
}

module.exports = {
  GIT_RUN_ACTIONS,
  GIT_COPY_COMMANDS,
  hasOwnGit,
  gitInitRefusal,
  gitScreenCommand,
  lingerTail,
  LINGER_MARK,
  '/actions/git-init': git_init,
  ...Object.fromEntries(Object.keys(GIT_RUN_ACTIONS).map((route) => [route, git_run])),
};
