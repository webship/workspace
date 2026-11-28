/**
 * The stop of a generic stack's server and of the project's tasks off DDEV (webship/workspace#983): setpriv starts them
 * (no watching parent that kills them 2 s after a stop, as runuser does), and start.sh and daemons.sh, their
 * container's first process, pass the stop on to their process groups, then end once those have ended.
 *
 * Stand-in docker, podman, ddev and kind on PATH record what is called; nothing is started. The scripts the runtime
 * layer writes are then run here, as a container would run them.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const SCRIPTS = path.join(__dirname, '..', '..', '..', 'scripts');
const STACKS = path.join(__dirname, '..', '..', '..', 'config', 'runtimes');

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-runtime-stop-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  for (const cli of ['docker', 'podman', 'ddev', 'kind', 'kubectl']) {
    fs.writeFileSync(path.join(bin, cli), `#!/usr/bin/env bash\necho "${cli} $*" >> "${dir}/calls.log"\n`, { mode: 0o755 });
  }
  return dir;
}

function run(dir, cwd, script, env = {}) {
  const r = spawnSync('bash', ['-c', `RT_STACKS=${STACKS}; source ${SCRIPTS}/functions/fun-runtime.sh; RT_STACKS=${STACKS}; ${script}`],
    { cwd, encoding: 'utf8', input: '', env: { ...process.env, PATH: `${dir}/bin:${process.env.PATH}`, HOME: dir, WORKSPACE_ROOT: path.join(SCRIPTS, '..', '..'), ...env } });
  return { out: r.stdout + r.stderr, status: r.status };
}

/** A project of the generic stack on Docker Compose, with no database (start.sh waits for none). */
function project(dir, name) {
  const p = path.join(dir, name); fs.mkdirSync(p);
  const r = run(dir, p, `ddev config --project-type=django --webserver-type=generic --docroot= --database=none --project-name=${name}`, { WORKSPACE_RUNTIME: 'docker' });
  assert.strictEqual(r.status, 0, r.out);
  return p;
}

/** The processes of a session, and SIGKILL to each: what a test started, and the groups of their own it started. */
function killSession(sid) {
  let left = 0;
  for (const pid of fs.readdirSync('/proc').filter((p) => /^\d+$/.test(p))) {
    try {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      const [state, , , session] = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      if (Number(session) !== sid || state === 'Z') continue;
      left += 1;
      process.kill(Number(pid), 'SIGKILL');
    } catch { /* ended meanwhile */ }
  }
  return left;
}

/**
 * Run a script of the project's runtime folder in a session of its own, send it `signal` once `ready` shows in its
 * output, and say how it ended, and how many of its processes were still there once it had (none, when the script
 * waits for everything it started). What is left is killed, so a failing test leaves nothing behind.
 */
function stopAfter(file, ready, signal = 'SIGTERM') {
  return new Promise((resolve) => {
    const child = spawn('bash', [file], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let out = ''; let sent = 0;
    const onData = (d) => {
      out += d;
      if (!sent && out.includes(ready)) { sent = Date.now(); setTimeout(() => child.kill(signal), 300); }
    };
    child.stdout.on('data', onData); child.stderr.on('data', onData);
    const guard = setTimeout(() => killSession(child.pid), 30000);
    child.on('exit', (code, sig) => {
      clearTimeout(guard);
      const left = killSession(child.pid);
      resolve({ out, code, signal: sig, left, seconds: sent ? (Date.now() - sent - 300) / 1000 : -1 });
    });
  });
}

// A process that takes 3 s to stop once it is asked to: past runuser's 2 s, within any runtime's grace.
const slow = (who) => `trap 'echo ${who} is asked to stop ; sleep 3 ; echo ${who} stopped cleanly ; exit 0' TERM ; echo ${who} runs ; while : ; do sleep 1 & wait $! ; done`;

test('start.sh passes the stop on to the server, which serve.sh started and which takes 3 s, and ends once it has ended', async () => {
  const dir = sandbox();
  try {
    const p = project(dir, 'slowstop');
    const start = path.join(p, '.webship', 'runtime', 'start.sh');
    const text = fs.readFileSync(start, 'utf8');
    assert.match(text, /\nset -m\nbash \.webship\/runtime\/serve\.sh &\nserver=\$!\nset \+m\nfor sig in TERM INT QUIT WINCH ; do trap "kill -\$\{sig\} -- -\$\{server\} 2> \/dev\/null" "\$\{sig\}" ; done\n/, 'the server in a process group of its own (job control), which the stop reaches as it came');
    assert.doesNotMatch(text, /exec bash \.webship\/runtime\/serve\.sh/, 'not exec\'d any more: start.sh stays the first process');
    assert.match(text, /\nexport USER="\$\{me\}" LOGNAME="\$\{me\}" HOME="\$\{home:-\/var\/www\}"\n/, 'the user\'s own names and home, which runuser set and setpriv does not');
    assert.match(text, /\ntrap 'exit 143' TERM INT QUIT WINCH\n/, 'a stop while it waits for the database');
    // The server is serve.sh's child, not exec'd: the stop has to reach a process start.sh did not start itself.
    fs.writeFileSync(path.join(p, '.webship', 'runtime', 'serve.sh'), `#!/usr/bin/env bash\ncd "$(dirname "$0")/../.." || exit 1\nbash -c ${JSON.stringify(slow('the server'))}\n`);
    const r = await stopAfter(start, 'the server runs');
    assert.match(r.out, /the server is asked to stop\n[^]*the server stopped cleanly/, r.out);
    assert.ok(r.seconds >= 2.5 && r.seconds < 10, `start.sh ended once the server had, ${r.seconds} s after the stop`);
    assert.strictEqual(r.signal, null, 'it ended on its own, not killed');
    assert.strictEqual(r.left, 0, 'nothing of the server was left once start.sh ended');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('start.sh passes an image\'s own stop signal on as it came: QUIT reaches a server that stops on QUIT', async () => {
  const dir = sandbox();
  try {
    const p = project(dir, 'quitstop');
    const server = "trap 'echo the server is asked to stop with QUIT ; sleep 3 ; echo the server stopped cleanly ; exit 0' QUIT ; echo the server runs ; while : ; do sleep 1 & wait $! ; done";
    fs.writeFileSync(path.join(p, '.webship', 'runtime', 'serve.sh'), `#!/usr/bin/env bash\nbash -c ${JSON.stringify(server)}\n`);
    const r = await stopAfter(path.join(p, '.webship', 'runtime', 'start.sh'), 'the server runs', 'SIGQUIT');
    assert.match(r.out, /the server is asked to stop with QUIT\n[^]*the server stopped cleanly/, r.out);
    assert.ok(r.seconds >= 2.5 && r.seconds < 10, `${r.seconds} s`);
    assert.strictEqual(r.left, 0, 'nothing of the server was left once start.sh ended');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('start.sh ends with the server\'s own code when the server ends on its own', () => {
  const dir = sandbox();
  try {
    const p = project(dir, 'crash');
    fs.writeFileSync(path.join(p, '.webship', 'runtime', 'serve.sh'), '#!/usr/bin/env bash\necho "the server runs, then fails"\nexit 3\n');
    const r = spawnSync('bash', [path.join(p, '.webship', 'runtime', 'start.sh')], { encoding: 'utf8', timeout: 20000 });
    assert.strictEqual(r.status, 3, r.stdout + r.stderr);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the server and the tasks start with setpriv on Docker Compose and Kubernetes; daemons.sh passes the stop on to every task and ends once they have ended', async () => {
  const dir = sandbox();
  try {
    const p = project(dir, 'tasks');
    for (const who of ['one', 'two']) {
      const r = run(dir, p, `rt_daemon ${who} ${JSON.stringify(slow(`task ${who}`))}`, { WORKSPACE_RUNTIME: 'docker' });
      assert.strictEqual(r.status, 0, r.out);
    }
    const runner = path.join(p, '.webship', 'runtime', 'daemons.sh');
    assert.ok(fs.existsSync(runner), 'the runner is written with the files that start it');
    const compose = fs.readFileSync(path.join(p, 'compose.yaml'), 'utf8');
    assert.match(compose, /\n {4}command: \["setpriv", "--reuid=www-data", "--regid=www-data", "--init-groups", "--", "bash", "\/var\/www\/html\/\.webship\/runtime\/daemons\.sh"\]\n/);
    assert.match(compose, /\n {4}command: \["setpriv", "--reuid=www-data", "--regid=www-data", "--init-groups", "--", "bash", "\/var\/www\/html\/\.webship\/runtime\/start\.sh"\]\n/);
    assert.doesNotMatch(compose, /command: \["runuser"/, 'no runuser as the first process of a container');
    // Apache's php image stops its containers with WINCH: the tasks stop with TERM all the same.
    const r = await stopAfter(runner, 'task two runs', 'SIGWINCH');
    assert.match(r.out, /task one stopped cleanly/, r.out);
    assert.match(r.out, /task two stopped cleanly/, r.out);
    assert.ok(r.seconds >= 2.5 && r.seconds < 10, `daemons.sh ended once both tasks had, ${r.seconds} s after the stop`);
    assert.strictEqual(r.left, 0, 'nothing of the tasks was left once daemons.sh ended');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
