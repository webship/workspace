/**
 * The worktree half of cmd-tools-clone.sh, tested where it is cheap to test: the
 * shell contract and the shape of the DDEV config it produces. The end-to-end run
 * (git worktree add, ddev start, import-db) needs Docker and a real project, so it
 * is exercised by hand and recorded in the PR; what is asserted here is everything
 * that can silently rot — the flags, the git detection that must work for a
 * worktree OF a worktree, and the one key whose removal is the whole feature.
 */

const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..', '..', '..');
const FUN = path.join(ROOT, 'core', 'scripts', 'functions', 'fun-clone-project.sh');
const ARGS = path.join(ROOT, 'core', 'scripts', 'args', 'arg-clone.sh');

/** Run a bash snippet with the clone functions sourced. */
function withFunctions(snippet) {
  return execFileSync('bash', ['-c', `source ${JSON.stringify(FUN)} ; ${snippet}`],
    { encoding: 'utf8' }).trim();
}

test('the function file is valid bash', () => {
  assert.strictEqual(spawnSync('bash', ['-n', FUN]).status, 0);
  assert.strictEqual(spawnSync('bash', ['-n', ARGS]).status, 0);
});

test('the worktree flags are all declared, and the worktree-only ones say so', () => {
  const args = fs.readFileSync(ARGS, 'utf8');
  for (const flag of ['--worktree', '--branch', '--no-build-copy', '--no-db']) {
    assert.ok(args.includes(`'${flag}'`), `${flag} is not declared`);
  }
  // A flag that quietly does nothing on the copying path is worse than one that
  // refuses, so each worktree-only flag has to be labelled in its own help.
  for (const flag of ['--branch', '--no-build-copy']) {
    const help = args.slice(args.indexOf(`'${flag}'`));
    assert.match(help.slice(0, 400), /Worktree only/, `${flag} does not say it is worktree only`);
  }
});

test('project_has_git is true for a checkout, a worktree of one, and false otherwise', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-'));
  try {
    const repo = path.join(tmp, 'repo');
    fs.mkdirSync(repo);
    const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' });
    execFileSync('git', ['init', '-q', '-b', 'main', repo]);
    git('config', 'user.email', 't@t'); git('config', 'user.name', 'T');
    fs.writeFileSync(path.join(repo, 'a'), 'a');
    git('add', '-A'); git('commit', '-qm', 'init');

    assert.strictEqual(withFunctions(`project_has_git ${JSON.stringify(repo)} && echo yes || echo no`), 'yes');

    // The case a `.git` directory test gets wrong: a worktree carries .git as a FILE.
    const wt = path.join(tmp, 'wt');
    git('worktree', 'add', '-q', '-b', 'side', wt);
    assert.ok(fs.statSync(path.join(wt, '.git')).isFile(), '.git in a worktree should be a file');
    assert.strictEqual(withFunctions(`project_has_git ${JSON.stringify(wt)} && echo yes || echo no`), 'yes');

    const plain = path.join(tmp, 'plain');
    fs.mkdirSync(plain);
    // Guard against the ambient repository: a plain dir under /tmp is outside one.
    assert.strictEqual(withFunctions(`project_has_git ${JSON.stringify(plain)} && echo yes || echo no`), 'no');
    assert.strictEqual(withFunctions('project_has_git && echo yes || echo no'), 'no');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('ddev_config_drop_name removes the top-level name and nothing else', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-'));
  try {
    const cfg = path.join(tmp, 'config.yaml');
    // A nested `name:` belongs to a service or a hook and must survive: dropping it
    // would silently break the project's own configuration.
    fs.writeFileSync(cfg, [
      'name: source-project',
      'docroot: web',
      'hooks:',
      '  post-start:',
      '    - exec: echo hi',
      'web_environment:',
      '  - name: KEEP_ME',
      ''].join('\n'));
    withFunctions(`ddev_config_drop_name ${JSON.stringify(cfg)}`);
    const out = fs.readFileSync(cfg, 'utf8');
    assert.ok(!/^name:/m.test(out), 'the top-level name: should be gone');
    assert.match(out, /- name: KEEP_ME/, 'a nested name: must survive');
    assert.match(out, /docroot: web/);
    // Absent file: a no-op, not a failure.
    withFunctions(`ddev_config_drop_name ${JSON.stringify(path.join(tmp, 'nope.yaml'))}`);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('project_ddev_docroot reads the declared docroot, quoted or bare', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-'));
  try {
    const dir = path.join(tmp, 'p'); fs.mkdirSync(path.join(dir, '.ddev'), { recursive: true });
    const cfg = path.join(dir, '.ddev', 'config.yaml');
    fs.writeFileSync(cfg, 'name: p\ndocroot: web\n');
    assert.strictEqual(withFunctions(`project_ddev_docroot ${JSON.stringify(dir)}`), 'web');
    fs.writeFileSync(cfg, 'name: p\ndocroot: "docroot"\n');
    assert.strictEqual(withFunctions(`project_ddev_docroot ${JSON.stringify(dir)}`), 'docroot');
    fs.writeFileSync(cfg, 'name: p\n');
    assert.strictEqual(withFunctions(`project_ddev_docroot ${JSON.stringify(dir)}`), '');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('the build copy never carries DDEV per-project generated state', () => {
  // wtsrc.crt copied into wtcopy makes every ddev start warn "unexpected
  // #ddev-generated", and DDEV regenerates all of it anyway. Found by running it.
  const fun = fs.readFileSync(FUN, 'utf8');
  const filter = fun.slice(fun.indexOf('git ls-files --others --ignored'));
  for (const excluded of ['\\.ddev/traefik', '\\.ddev/db_snapshots', '\\.ddev/\\.', '\\.tarballs']) {
    assert.ok(filter.includes(excluded), `the build copy does not exclude ${excluded}`);
  }
  // …and config.yaml must NOT be filtered out: in a project that git-ignores
  // .ddev/ it is the one file the clone cannot start without.
  assert.ok(!/-e '\^\\\.ddev\/\[\^\/\]\*\\\.yaml\$'/.test(filter), 'config.yaml must not be excluded');
});

test('every clone command documents the worktree option', () => {
  const folders = ['demos', 'dev', 'products', 'profiles', 'projects', 'sandboxes', 'site-templates', 'test'];
  for (const f of folders) {
    const p = path.join(ROOT, f, 'cmd-tools-clone.sh');
    if (!fs.existsSync(p)) continue;
    assert.match(fs.readFileSync(p, 'utf8'), /--worktree/, `${f}/cmd-tools-clone.sh does not mention --worktree`);
  }
});

test('the dashboard offers the worktree only for a git checkout', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');
  assert.match(server, /function projectHasGit/);
  assert.match(server, /rev-parse', '--git-dir'/);
  // The control is absent, not disabled, when there is no repository.
  assert.match(server, /projectHasGit\(srcDir\) \? `/);
  // And the endpoint refuses the flag rather than trusting the form.
  assert.match(server, /is not a git checkout, so there is no repository to add a worktree to/);
});

/* --- the removal guards ------------------------------------------------------
 * These are the destructive half. Deleting the main checkout takes the only copy
 * of the repository with it, and deleting a worktree can take commits nobody
 * pushed — so the refusals are asserted against real repositories rather than by
 * reading the script.
 */

const GUARDS = path.join(ROOT, 'core', 'scripts', 'functions', 'fun-git-worktrees.sh');

function withGuards(snippet) {
  return execFileSync('bash', ['-c', `source ${JSON.stringify(GUARDS)} ; ${snippet}`],
    { encoding: 'utf8' }).trim();
}

/** A repo with an optional linked worktree, in a temp dir. */
function makeRepo(withWorktree) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wtg-'));
  const main = path.join(tmp, 'main');
  fs.mkdirSync(main);
  const git = (...a) => execFileSync('git', ['-C', main, ...a], { encoding: 'utf8' });
  execFileSync('git', ['init', '-q', '-b', 'main', main]);
  git('config', 'user.email', 't@t'); git('config', 'user.name', 'T');
  fs.writeFileSync(path.join(main, 'a'), 'a');
  git('add', '-A'); git('commit', '-qm', 'init');
  let wt = '';
  if (withWorktree) {
    wt = path.join(tmp, 'side');
    git('worktree', 'add', '-q', '-b', 'side', wt);
  }
  return { tmp, main, wt };
}

test('git_worktree_role: plain, primary and linked are told apart', () => {
  const { tmp, main, wt } = makeRepo(true);
  try {
    assert.strictEqual(withGuards(`git_worktree_role ${JSON.stringify(main)}`), 'primary');
    assert.strictEqual(withGuards(`git_worktree_role ${JSON.stringify(wt)}`), 'linked');
    // Remove the dependent and the same folder is merely 'plain' — the role is
    // about what depends on it, not about what it is on disk.
    execFileSync('git', ['-C', main, 'worktree', 'remove', '--force', wt]);
    assert.strictEqual(withGuards(`git_worktree_role ${JSON.stringify(main)}`), 'plain');
    assert.strictEqual(withGuards(`git_worktree_role ${JSON.stringify(tmp)}`), 'none');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('git_worktree_others lists the dependents and excludes the folder itself', () => {
  const { tmp, main, wt } = makeRepo(true);
  try {
    const others = withGuards(`git_worktree_others ${JSON.stringify(main)}`).split('\n').filter(Boolean);
    assert.strictEqual(others.length, 1);
    assert.strictEqual(fs.realpathSync(others[0]), fs.realpathSync(wt));
    const back = withGuards(`git_worktree_others ${JSON.stringify(wt)}`).split('\n').filter(Boolean);
    assert.strictEqual(back.length, 1, 'a worktree should see the main checkout as its other');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('git_worktree_unpushed and _dirty count what a delete would destroy', () => {
  const { tmp, main } = makeRepo(false);
  try {
    // No remote at all: every commit is unpushed, which is the honest answer.
    assert.strictEqual(withGuards(`git_worktree_unpushed ${JSON.stringify(main)}`), '1');
    assert.strictEqual(withGuards(`git_worktree_dirty ${JSON.stringify(main)}`), '0');
    fs.writeFileSync(path.join(main, 'b'), 'b');
    // A single number, not two: `grep -c` prints 0 AND exits 1 on no match, so an
    // `|| echo 0` fallback printed a second zero and the caller read "0 0".
    const dirty = withGuards(`git_worktree_dirty ${JSON.stringify(main)}`);
    assert.strictEqual(dirty, '1');
    assert.ok(!dirty.includes('\n'), 'dirty must be one number');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('remove refuses the main checkout, and --force is the only way past', () => {
  const fun = fs.readFileSync(path.join(ROOT, 'core', 'scripts', 'functions', 'fun-remove-project.sh'), 'utf8');
  assert.match(fun, /REFUSING to remove \$\{project\}: it is the MAIN checkout/);
  assert.match(fun, /REFUSING to remove \$\{project\}: it holds work that is nowhere else/);
  // The guard runs BEFORE anything is deleted — after ddev delete would be too late.
  const guardAt = fun.indexOf('remove_project_worktree_guard "${workspace_dir}/${project}"');
  // The REAL call, not the `ddev delete` quoted in the file's header comment —
  // which is what the first version of this assertion matched, and it failed on
  // correct code.
  const deleteAt = fun.indexOf('( cd "${workspace_dir}/${project}" && ddev delete -y -O )');
  assert.ok(guardAt > 0 && guardAt < deleteAt, 'the guard must run before ddev delete');
  // FORCE may be unset entirely: remove_project is called from the dashboard and
  // from other scripts that know nothing about it.
  assert.ok(!/\[ "\$\{FORCE\}"/.test(fun), 'FORCE must be read as ${FORCE:-}');
  // And the stale registration is pruned afterwards, or a re-clone to the same
  // path is refused by git.
  assert.match(fun, /remove_project_worktree_after/);
});

test('every remove command offers --force', () => {
  for (const f of fs.readdirSync(ROOT)) {
    const p = path.join(ROOT, f, 'cmd-tools-remove.sh');
    if (!fs.existsSync(p)) continue;
    assert.match(fs.readFileSync(p, 'utf8'), /'-f', '--force'/, `${f}/cmd-tools-remove.sh has no --force`);
  }
});

test('the dashboard asks git the same questions the script does', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');
  assert.match(server, /function gitWorktreeInfo/);
  // The warning is shown before the confirm, and force is forwarded, never assumed.
  assert.match(server, /This is the main git checkout/);
  assert.match(server, /This holds work that is nowhere else/);
  assert.match(server, /form\.force === 'yes' \? ' --force' : ''/);
});
