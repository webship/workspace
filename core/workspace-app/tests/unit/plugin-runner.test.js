/**
 * Who runs a command: a plugin's runner first, the host runner next, the page last.
 *
 * The host runner is not up in a test (no published list in the workspace), so what is seen here
 * is the plugin's turn and the page's. A command is never refused because the machine has no runner.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-runner-'));
fs.mkdirSync(path.join(root, 'core', 'config'), { recursive: true });
fs.writeFileSync(path.join(root, 'core', 'config', 'settings.yml'), 'workspaces: dev\n');
fs.mkdirSync(path.join(root, 'dev'), { recursive: true });
process.env.WORKSPACE_ROOT = root;
process.env.WORKSPACE_CONFIG = path.join(root, 'core', 'config');

const jobs = require('../../jobs');

const opts = (verb, extra = {}) => ({ workspace: 'dev', project: 'demo', projectDir: path.join(root, 'dev'), verb, cmdLine: 'echo ran-here', label: `the ${verb}`, ...extra });
const finished = async (id) => { for (let i = 0; i < 100 && !jobs.jobs.get(id).done; i += 1) await new Promise((r) => setTimeout(r, 50)); return jobs.jobs.get(id); };

test('with no runner at all the command runs in the page, as a job toast', async () => {
  const started = await jobs.startInScreen(opts('page-run'));
  assert.strictEqual(started.ok, true);
  assert.strictEqual(started.where, 'page');
  assert.strictEqual(started.session, 'dev--demo--page-run');
  const job = await finished(started.job);
  assert.strictEqual(job.ok, true);
  assert.match(job.buf, /ran-here/);
  assert.match(jobs.screenStartedHtml(started, 'the page-run', 'demo'), /job-toast/);
});

test('a run in the page does not wait for an Enter nobody can press', async () => {
  const { lingerTail, withoutLingerWait } = require('../../linger');
  const line = `echo quick; ${lingerTail('quick')}`;
  assert.match(line, /timeout --foreground 900/);
  assert.doesNotMatch(withoutLingerWait(line), /timeout --foreground/);
  const t0 = Date.now();
  const started = await jobs.startInScreen(opts('lingers', { cmdLine: line }));
  const job = await finished(started.job);
  assert.strictEqual(job.ok, true);
  assert.match(job.buf, /quick finished\./);
  assert.ok(Date.now() - t0 < 4000, 'it ended with the command, not fifteen minutes later');
});

test('a caller that follows the session itself is told the runner is missing, not run in the page', async () => {
  const started = await jobs.startInScreen(opts('needs-session', { page: false }));
  assert.deepStrictEqual({ ok: started.ok, needsRunner: started.needsRunner }, { ok: false, needsRunner: true });
  assert.match(jobs.screenStartedHtml(started, 'x', 'demo'), /screen-host\.sh --start/);
});

test('a plugin runner is asked first, with the session name, and its answer is the answer', async () => {
  const seen = [];
  jobs.addRunner(async (req) => {
    seen.push(req);
    if (req.verb === 'declined') return null;
    if (req.verb === 'throws') throw new Error('broken runner');
    if (req.verb === 'refused') return { ok: false, already: true };
    return { ok: true, where: 'elsewhere', html: '<div class="msg assistant">run by the plugin</div>' };
  });
  const taken = await jobs.startInScreen(opts('taken'));
  assert.deepStrictEqual({ ok: taken.ok, where: taken.where, session: taken.session, job: taken.job }, { ok: true, where: 'elsewhere', session: 'dev--demo--taken', job: undefined });
  assert.strictEqual(seen[0].session, 'dev--demo--taken');
  assert.strictEqual(seen[0].cmdLine, 'echo ran-here');
  assert.strictEqual(jobs.screenStartedHtml(taken, 'x', 'demo'), '<div class="msg assistant">run by the plugin</div>');

  // Declined, or broken: the dashboard runs it (here: in the page).
  for (const verb of ['declined', 'throws']) {
    const fell = await jobs.startInScreen(opts(verb));
    assert.strictEqual(fell.where, 'page', `${verb} falls through`);
    await finished(fell.job);
  }

  // A runner's refusal is a refusal: the dashboard's own answer for "already running" is drawn.
  const refused = await jobs.startInScreen(opts('refused'));
  assert.deepStrictEqual({ ok: refused.ok, already: refused.already }, { ok: false, already: true });
  assert.match(jobs.screenStartedHtml(refused, 'the refused', 'demo'), /already running/);
});

test('the api offers addRunner and addScreensPanel, and names both as capabilities', () => {
  const loader = require('../../plugin-loader');
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'plugin-loader.js'), 'utf8');
  assert.match(src, /addRunner\(fn\) \{/);
  assert.match(src, /addScreensPanel\(fn\) \{/);
  assert.match(src, /new Set\(\['row-menu-body', 'runner', 'screens-panel'\]\)/);
  assert.strictEqual(loader.pluginScreensPanelsHtml(), '', 'no plugin, no panel');
  assert.match(fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8'), /pluginScreensPanelsHtml\(\)/, 'the Screens page draws the panels');
  const doc = fs.readFileSync(path.join(__dirname, '..', '..', 'PLUGINS.md'), 'utf8');
  assert.match(doc, /`api\.addRunner\(fn\)`/);
  assert.match(doc, /`api\.addScreensPanel\(fn\)`/);
  assert.match(doc, /## Who runs a command/);
});
