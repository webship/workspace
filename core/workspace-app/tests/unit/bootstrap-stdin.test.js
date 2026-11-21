/**
 * A cmd-*.sh run from a shell whose stdin is a pipe that stays open does not hang (webship/workspace#489).
 *
 * ddev's `docker exec -i` waits for ever on such a pipe, so a build started from a CI step or an AI agent's
 * background shell hung at its first `ddev composer create-project`, with no output. bootstrap.sh, which every
 * cmd-*.sh sources, now closes a stdin that is not a terminal, as the dashboard does for every command it starts.
 * Here `cat` stands in for ddev: it reads its stdin to the end, as `docker exec -i` does.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { spawn } = require('child_process');

const SCRIPTS = path.join(__dirname, '..', '..', '..', 'scripts');

/** A script that sources bootstrap.sh, then reads its stdin; the pipe is written to and never closed. */
function run(env = {}) {
  return new Promise((resolve) => {
    const script = `WORKSPACE_SCRIPTS=${JSON.stringify(SCRIPTS)}; source "$WORKSPACE_SCRIPTS/bootstrap.sh" >/dev/null 2>&1; got="$(timeout 5 cat)"; echo "exit=$? got=[$got]"`;
    const child = spawn('bash', ['-c', script], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    // A script that closed its stdin already makes this write fail (EPIPE): that is the point, not an error here.
    child.stdin.on('error', () => {});
    child.stdin.write('from the pipe\n');   // and left open
    const t = setTimeout(() => child.kill('SIGKILL'), 15000);
    child.on('close', () => { clearTimeout(t); child.stdin.destroy(); resolve(out.trim()); });
  });
}

test('a stdin pipe that stays open is closed: what reads it ends at once, with nothing', async () => {
  // Without the fix, cat waits on the open pipe until its 5 s limit (exit 124).
  assert.strictEqual(await run(), 'exit=0 got=[]');
});

test('WORKSPACE_KEEP_STDIN=1 keeps the pipe for a script that reads it', async () => {
  assert.strictEqual(await run({ WORKSPACE_KEEP_STDIN: '1' }), 'exit=124 got=[from the pipe]');
});
