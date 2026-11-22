/**
 * A verb on a screen session, wherever the session runs: interrupt it, type into it, detach its clients, end it (#591).
 *
 * screen's verbs signal the session's own process, so screen reaches only the sessions of the process space it runs
 * in. The dashboard's container has a process space of its own (webship/workspace#564: it shared the machine's, and
 * DDEV ends a web container with `kill -- -1`, which from there reached the other containers). So:
 *
 *   - a session screen here lists (one the dashboard's own screen started, or every session when the dashboard runs
 *     on the machine) is reached here, as before;
 *   - a session only the host runner lists is reached through the runner, the way a terminal on it attaches since
 *     #558: over its unix socket in .screens/, else through the mailbox in the same folder (jobs.hostRunnerAsk);
 *   - a session the runner listed and no longer refreshes cannot be reached while it is away: `runnerDown`, so the
 *     page says the runner is not up instead of trying screen here, which cannot see it.
 *
 * A session is addressed by its whole name, `<pid>.<name>`, here as in the runner: screen's `-S <name>` takes any
 * session whose name starts with it, so a verb on a session that had just ended reached another one.
 */

const { run, hostSessionsFile, hostRunnerAsk } = require('./jobs');

const VERBS = ['stop', 'stuff', 'detach'];

/** The runner's row for a session in a published list, or undefined. */
const listedIn = (data, session) => (data && Array.isArray(data.sessions)
  ? data.sessions.find((s) => s && s.session === session) : undefined);

/**
 * Where a session can be reached from here: { where: 'here' | 'runner' | 'runner-down' | 'none', row, published }.
 * Screen here first, the way a terminal attaches (runner-attach.mts): what it lists, it can reach.
 */
async function reachOf(session) {
  const own = await require('./screens').readContainerScreens();
  const here = own.rows.find((s) => s.session === session);
  if (here) return { where: 'here', row: here };
  const published = hostSessionsFile();
  const row = listedIn(published, session);
  if (row) return { where: 'runner', row, published };
  if (listedIn(hostSessionsFile({ anyAge: true }), session)) return { where: 'runner-down' };
  return { where: 'none' };
}

/** screen's arguments for a verb on the session called `target` (`<pid>.<name>`). */
function screenArgs(target, verb, text) {
  if (verb === 'stop') return ['-S', target, '-X', 'quit'];
  if (verb === 'detach') return ['-S', target, '-X', 'detach'];
  return ['-S', target, '-X', 'stuff', text];
}

/**
 * Do `verb` ('stop', 'stuff' with `text`, 'detach') on a session. The answer is run()'s shape, { ok, stdout, stderr },
 * and says why when it is not done: `runnerDown` (the session is on the machine and its runner is not up), `runnerOld`
 * (the runner is from a release that does not do this verb yet), `gone` (no session of that name runs).
 */
async function screenVerb(session, verb, { text } = {}) {
  if (!VERBS.includes(verb)) return { ok: false, stdout: '', stderr: `screen-verbs: no verb called ${verb}` };
  if (verb === 'stuff' && (typeof text !== 'string' || !text)) return { ok: false, stdout: '', stderr: 'nothing to type' };
  const reach = await reachOf(session);
  if (reach.where === 'here') {
    return run('screen', screenArgs(`${reach.row.pid}.${session}`, verb, text), process.env.HOME, { timeoutMs: 10 * 1000 });
  }
  if (reach.where === 'runner-down') return { ok: false, runnerDown: true, stdout: '', stderr: 'the runner on this machine is not up' };
  if (reach.where === 'none') return { ok: false, gone: true, stdout: '', stderr: `No session called ${session} is running.` };
  // A runner from an older release has no stuff or detach: it says which verbs it does, and stop is in every one.
  if (verb !== 'stop' && !(Array.isArray(reach.published.verbs) && reach.published.verbs.includes(verb))) {
    return { ok: false, runnerOld: true, stdout: '', stderr: `the runner on this machine is from an older release and does not ${verb}` };
  }
  const answer = await hostRunnerAsk(verb, verb === 'stuff' ? { session, text } : { session });
  if (!answer) return { ok: false, runnerDown: true, stdout: '', stderr: 'the runner on this machine did not answer' };
  if (answer.status === 404 || /unknown action|no such endpoint/.test(String(answer.error || ''))) {
    return { ok: false, runnerOld: true, stdout: '', stderr: `the runner on this machine is from an older release and does not ${verb}` };
  }
  if (answer.gone) return { ok: false, gone: true, stdout: '', stderr: String(answer.error || `No session called ${session} is running.`) };
  return { ok: !!answer.ok, stdout: '', stderr: answer.ok ? '' : String(answer.error || 'the runner could not do it') };
}

/**
 * `screen -wipe`, here and on the machine: the sockets of sessions that are gone, wherever they were. The runner is
 * asked only when it is up and does it; when it is not, screen here still wipes its own.
 */
async function wipeEverywhere() {
  const here = await run('screen', ['-wipe'], process.env.HOME, { timeoutMs: 10 * 1000 });
  const published = hostSessionsFile();
  let machine = null;
  if (published && Array.isArray(published.verbs) && published.verbs.includes('wipe')) machine = await hostRunnerAsk('wipe', {});
  return { here, machine };
}

module.exports = { reachOf, screenVerb, wipeEverywhere, screenArgs };
