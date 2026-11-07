/**
 * The GIT menu on a project row.
 *
 * What must never drift: the menu RUNS only read-only commands (and git init), in screen sessions,
 * with nothing rendered at the end of the page; everything that changes the repository or reaches a
 * remote is a copy entry; the handler refuses anything outside its table; and GIT sits right after IDE.
 */

const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const git = require('../../actions/git');
const { GIT_RUN_ACTIONS, GIT_COPY_COMMANDS, hasOwnGit, gitInitRefusal, gitScreenCommand } = git;

const READ_ONLY = new Set(['status', 'log', 'diff', 'branch', 'remote', 'stash']);
const MUTATING = /\b(push|pull|fetch|commit|add|reset|checkout|switch|merge|rebase|clean|rm|mv|tag|restore|cherry-pick|revert)\b/;

test('every command the menu runs is read-only', () => {
  const routes = Object.entries(GIT_RUN_ACTIONS);
  assert.ok(routes.length >= 5, 'the menu should offer the common read-only commands');
  for (const [route, act] of routes) {
    assert.match(route, /^\/actions\/git-[a-z]+$/);
    assert.ok(READ_ONLY.has(act.args[0]), `${route} runs "${act.args[0]}", which is not on the read-only list`);
    assert.ok(!MUTATING.test(act.args.join(' ')), `${route} would change the repository: ${act.args.join(' ')}`);
    if (act.args[0] === 'stash') assert.deepStrictEqual(act.args, ['stash', 'list'], 'only `stash list` is read-only');
    if (act.args[0] === 'branch' || act.args[0] === 'remote') {
      // `branch -d/-D/-m`, `remote add/remove/set-url` all write.
      assert.ok(act.args.slice(1).every((a) => ['-a', '-vv', '-v'].includes(a)), `${route} passes a writing flag: ${act.args.join(' ')}`);
    }
    assert.strictEqual(typeof git[route], 'function', `${route} has no handler exported`);
  }
});

test('what changes the repository or reaches a remote is copy-only', () => {
  const copyLines = GIT_COPY_COMMANDS.map((c) => c.line).join('\n');
  for (const verb of ['push', 'pull', 'fetch', 'commit', 'switch']) {
    assert.match(copyLines, new RegExp(`git ${verb}\\b`), `expected a copy entry for git ${verb}`);
  }
  const runVerbs = Object.values(GIT_RUN_ACTIONS).map((a) => a.args[0]);
  for (const c of GIT_COPY_COMMANDS) {
    const verb = c.line.split(/\s+/)[1];
    if (verb === 'stash') continue; // `stash list` runs; `stash push`/`pop` are copies
    assert.ok(!runVerbs.includes(verb), `git ${verb} is both a copy entry and a command the menu runs`);
  }
});

test('the handler refuses anything outside its table, a bad name, and a folder with no .git', async () => {
  const handler = git['/actions/git-status'];
  const call = async (form, pathname) => {
    const out = {};
    await handler({ form, send: (html, code = 200) => { out.html = html; out.code = code; }, workspace: 'test', pathname });
    return out;
  };
  let r = await call({ projectName: 'anything' }, '/actions/git-push');
  assert.strictEqual(r.code, 404, 'a route outside GIT_RUN_ACTIONS must not run');
  r = await call({ projectName: '../etc' }, '/actions/git-status');
  assert.strictEqual(r.code, 400);
  r = await call({ projectName: 'no-such-project-for-git-menu-test' }, '/actions/git-status');
  assert.strictEqual(r.code, 400);
  assert.match(r.html, /no \.git of its own/);
});

test('git init is refused where a repository already exists, and for anything but a folder', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gitmenu-init-'));
  try {
    const empty = path.join(tmp, 'empty'); fs.mkdirSync(empty);
    const repo = path.join(tmp, 'repo'); fs.mkdirSync(repo); execFileSync('git', ['init', '-q', repo]);
    const file = path.join(tmp, 'a-file'); fs.writeFileSync(file, 'x');
    assert.strictEqual(gitInitRefusal(empty), '');
    assert.strictEqual(gitInitRefusal(repo), 'already a git repository');
    assert.strictEqual(gitInitRefusal(file), 'not a folder');
    assert.strictEqual(gitInitRefusal(path.join(tmp, 'missing')), 'no such folder');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  const out = {};
  await git['/actions/git-init']({ form: { projectName: '../etc' }, send: (h, c = 200) => { out.code = c; }, workspace: 'test' });
  assert.strictEqual(out.code, 400, 'a bad name must be refused before anything runs');
});

test('hasOwnGit: a clone and a worktree count, a subfolder of a repository does not', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gitmenu-'));
  try {
    const repo = path.join(tmp, 'repo');
    fs.mkdirSync(repo);
    execFileSync('git', ['init', '-q', '-b', 'main', repo]);
    execFileSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=T', 'commit', '-q', '--allow-empty', '-m', 'init']);
    const wt = path.join(tmp, 'wt');
    execFileSync('git', ['-C', repo, 'worktree', 'add', '-q', '-b', 'side', wt]);
    assert.strictEqual(hasOwnGit(repo), true);
    assert.strictEqual(hasOwnGit(wt), true, 'a worktree carries .git as a file');
    // The reason for the rule: git itself would say yes here, and the row would then offer the
    // parent repository's commands for a folder that is not one.
    const sub = path.join(repo, 'web', 'modules'); fs.mkdirSync(sub, { recursive: true });
    assert.strictEqual(hasOwnGit(sub), false);
    const plain = path.join(tmp, 'plain'); fs.mkdirSync(plain);
    assert.strictEqual(hasOwnGit(plain), false);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('a git session prints its output, then stays open to be read', () => {
  for (const act of Object.values(GIT_RUN_ACTIONS)) {
    // Labels go into the session's closing echo, so they must stay shell-safe constants.
    assert.match(act.label, /^[\w .()-]+$/, `label is not shell-safe: ${act.label}`);
    const line = gitScreenCommand(act.label, act.args);
    assert.ok(line.startsWith(`GIT_TERMINAL_PROMPT=0 git --no-pager ${act.args.join(' ')};`), line);
    // A git command ends in well under a second, and a session ends with its command: without
    // this wait the session was gone before anyone could open it.
    assert.match(line, /timeout --foreground 900 bash -c 'while :; do read -r _ && exit 0; sleep 1; done' \|\| true$/,
      'the wait must end on Enter or the time limit, and survive a viewer detaching (EOF)');
    // The runner wraps this in an outer `bash -lc "…"`: any $ would be expanded there, too early.
    assert.ok(!line.includes('$'), `a $ would be expanded by the runner's outer shell: ${line}`);
  }
});

test('git commands run in screen sessions, and nothing is rendered at the end of the page', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'actions', 'git.js'), 'utf8');
  assert.match(src, /startInScreen\(/, 'git commands must run in a screen session');
  assert.match(src, /hostRunnerRequest\('stop'/, 'a second click must replace the session still open from last time');
  // No output card in the page: the only response is a toast at the top linking to the session.
  assert.ok(!/<pre\b|git-output|terminal-pre/.test(src), 'git output must not be rendered in the page');
  assert.match(src, /class="msg assistant flash-now"/);
  assert.match(src, /href="\/terminal\/\$\{encodeURIComponent\(session\)\}"/);
});

test('the row puts IDE then GIT right after DDEV, shares one git read, and copies carry a cd', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');
  assert.match(src, /\.\.\.require\('\.\/actions\/git'\)/, 'the git routes are not merged');
  // Where the buttons sit is Commands → Buttons now (row-layout.js); by default IDE then GIT come right after DDEV
  // (JIRA is a plugin's slot now, registered between them when the plugin is on).
  const { DEFAULT_LINES } = require('../../row-layout');
  assert.deepStrictEqual(DEFAULT_LINES[0].slice(DEFAULT_LINES[0].indexOf('ddev'), DEFAULT_LINES[0].indexOf('ddev') + 3), ['ddev', 'ide', 'git'],
    'IDE then GIT must come right after DDEV by default');
  // …and only once: handed to the layout a single time, so a row never carries two IDE or two GIT buttons.
  assert.strictEqual((src.match(/\bide: openWithMenu\b/g) || []).length, 1);
  assert.strictEqual((src.match(/\bgit: gitMenu\b/g) || []).length, 1);
  assert.ok(!/\$\{openWithMenu\}|\$\{gitMenu\}/.test(src), 'IDE and GIT are drawn only through the layout');
  assert.match(src, /const gitInfo = gitWorktreeInfo\(projectPath\);/);
  assert.match(src, /const g = gitInfo;/, "IDE should reuse the row's git read");
  const fn = src.slice(src.indexOf('function gitMenuHtml'), src.indexOf('function openWithMenuHtml'));
  assert.match(fn, /class="copy-cmd"/);
  assert.match(fn, /`cd \$\{cdPath\} && \$\{c\.line\}`/, 'a copied command must start in the project folder');
  assert.match(fn, /hx-post="\/actions\/git-init"/, 'a folder without .git must be offered git init');
  assert.match(fn, /hasOwnGit\(projectPath\)/, "the menu must decide on the folder's own .git");
});

test('a repository with no commits is named by its branch, not called detached', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');
  const fn = src.slice(src.indexOf('function gitWorktreeInfo'), src.indexOf('function gitWorktreeInfo') + 2500);
  assert.match(fn, /symbolic-ref', '--short', '-q', 'HEAD'/, 'an unborn branch must be named through symbolic-ref');
  assert.match(fn, /out\.unborn/);
});
