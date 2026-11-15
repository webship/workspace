/**
 * Who runs a command: a plugin's runner first, the host runner next, screen where the dashboard
 * runs last — and never the page.
 *
 * The host runner is not up in a test (no published list in the workspace), so what is seen here
 * is the plugin's turn, the dashboard's own screen (a stand-in `screen` on the PATH that writes
 * down what it was asked), and the answer when there is no screen at all.
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

// A stand-in for screen(1): it writes down its arguments, and lists the sessions a file names.
const bin = path.join(root, 'bin');
const asked = path.join(root, 'screen-asked.txt');
const lsFile = path.join(root, 'screen-ls.txt');
fs.mkdirSync(bin);
fs.writeFileSync(path.join(bin, 'screen'), `#!/bin/sh
printf '%s\\n' "$*" >> ${JSON.stringify(asked)}
case "$1" in
  --version) echo "Screen version 4.09.01 (a stand-in)" ;;
  -ls) [ -f ${JSON.stringify(lsFile)} ] && cat ${JSON.stringify(lsFile)} ;;
esac
exit 0
`, { mode: 0o755 });
const empty = path.join(root, 'no-bin');
fs.mkdirSync(empty);
const PATH = process.env.PATH;
const withScreen = () => { process.env.PATH = `${bin}${path.delimiter}${PATH}`; fs.rmSync(asked, { force: true }); fs.rmSync(lsFile, { force: true }); };
const withoutScreen = () => { process.env.PATH = empty; };
const askedLines = () => (fs.existsSync(asked) ? fs.readFileSync(asked, 'utf8').trim().split('\n') : []);

const jobs = require('../../jobs');
const { lingerTail, withoutLinger } = require('../../linger');

const opts = (verb, extra = {}) => ({ workspace: 'dev', project: 'demo', projectDir: path.join(root, 'dev'), verb, cmdLine: 'echo ran-here', label: `the ${verb}`, ...extra });
const noTerminal = (html) => { for (const gone of ['job-', 'terminal-pre', 'class="msg assistant terminal', 'hx-get="/fragments/job']) assert.ok(!html.includes(gone), `the answer draws no ${gone}`); };

test('with no plugin runner and no host runner the command starts in screen where the dashboard runs', async () => {
  withScreen();
  const started = await jobs.startInScreen(opts('own'));
  assert.deepStrictEqual(started, { ok: true, session: 'dev--demo--own', label: 'the own', where: 'dashboard' });
  const start = askedLines().find((l) => l.includes('-dmS'));
  assert.match(start, /^-c \S*screenrc -dmS dev--demo--own bash -lc \{ echo ran-here ; \} 2>&1 \| tee -a "[^"]*\/\.screens\/dev--demo--own\.log"$/,
    "under the dashboard's own screenrc, the whole line logged");
  assert.strictEqual(fs.readFileSync(path.join(root, '.screens', 'dev--demo--own.cwd'), 'utf8').trim(), path.join(root, 'dev'));
  const html = jobs.screenStartedHtml(started, 'the own', 'demo');
  assert.match(html, /<code>the own<\/code> started on <strong>demo<\/strong> — <a href="\/screens\?session=dev--demo--own">Open in Screens<\/a>/);
  assert.match(html, /class="msg assistant flash-now"/, 'a short notice');
  noTerminal(html);
});

test('a session of that name already running is said, with its link; one that only starts alike is not it', async () => {
  withScreen();
  fs.writeFileSync(lsFile, 'There are screens on:\n\t4242.dev--demo--twice\t(11/15/2026 01:00:00 PM)\t(Detached)\n\t4243.dev--demo--alike-2\t(11/15/2026 01:00:00 PM)\t(Detached)\n');
  const again = await jobs.startInScreen(opts('twice'));
  assert.deepStrictEqual(again, { ok: false, session: 'dev--demo--twice', already: true, where: 'dashboard' });
  assert.ok(!askedLines().some((l) => l.includes('-dmS')), 'nothing was started');
  const html = jobs.screenStartedHtml(again, 'the twice', 'demo');
  assert.match(html, /already running on <strong>demo<\/strong> — <a href="\/screens\?session=dev--demo--twice">Open in Screens<\/a>/);
  noTerminal(html);
  const other = await jobs.startInScreen(opts('alike'));
  assert.strictEqual(other.ok, true, 'dev--demo--alike is not dev--demo--alike-2');
});

test('with no screen anywhere the command is not started, and never run in the page: what is missing, the fix, the line to copy', async () => {
  withoutScreen();
  try {
    const before = jobs.jobs.size;
    const line = `echo "it's"; ${lingerTail('the none')}`;
    const refused = await jobs.startInScreen(opts('none', { cmdLine: line }));
    assert.deepStrictEqual(refused, { ok: false, session: 'dev--demo--none', noScreen: true, cmdLine: line, dir: path.join(root, 'dev') });
    assert.strictEqual(jobs.jobs.size, before, 'no job was started in its place');
    const html = jobs.screenStartedHtml(refused, 'the none', 'demo');
    assert.match(html, /<strong>the none<\/strong> was not started/);
    assert.match(html, /<code>screen<\/code> is not installed where the dashboard runs, and no runner is up/);
    assert.match(html, /core\/scripts\/install\.sh<\/code> installs it/);
    assert.match(html, /screen-host\.sh --start/);
    // The line to run by hand: in the folder, the command alone — no notice, no wait for Enter.
    assert.ok(html.includes(`data-copy="cd ${root}/dev &amp;&amp; echo &quot;it&#39;s&quot;"`), html);
    assert.doesNotMatch(html, /timeout --foreground|Press Enter/);
    assert.match(html, /class="msg error flash-now flash-stay no-screen"/, 'it stays until it is closed');
    noTerminal(html);
  } finally { withScreen(); }
});

test('with no host runner a request is answered at once, and a stop reaches screen where the dashboard runs', async () => {
  withScreen();
  fs.writeFileSync(lsFile, 'There is a screen on:\n\t4242.dev--demo--lingers\t(11/15/2026 01:00:00 PM)\t(Detached)\n');
  const t0 = Date.now();
  assert.strictEqual(await jobs.hostRunnerRequest('start', { session: 'x', dir: root, cmd: 'true' }), null, 'nobody to ask');
  assert.deepStrictEqual(await jobs.hostRunnerRequest('stop', { session: 'dev--demo--lingers' }), { ok: true });
  assert.ok(askedLines().includes('-S 4242.dev--demo--lingers -X quit'), 'by pid and whole name');
  assert.deepStrictEqual(await jobs.hostRunnerRequest('stop', { session: 'dev--demo' }), { ok: false, error: 'no such session' });
  assert.ok(Date.now() - t0 < 5000, 'not after the thirty seconds a missing runner used to cost');
});

test('a step the page must hear the end of leaves a watcher, and the watcher knows when the session is done', async () => {
  withScreen();
  const html = jobs.screenStartedHtml({ ok: true, session: 'plugins--demo--install', watch: true }, 'plugin install demo', 'demo');
  assert.match(html, /<span hidden class="session-watch" hx-get="\/fragments\/session-done\/plugins--demo--install" hx-trigger="every 2s" hx-swap="outerHTML"><\/span>$/);
  assert.doesNotMatch(html, /data-reload-on-close/, 'told when it is done, not reloaded six seconds in');
  assert.match(jobs.screenStartedHtml({ ok: true, session: 'x' }, 'x', 'demo'), /data-reload-on-close="1"/, 'every other start keeps the reload');

  const { sessionDone } = require('../../screens');
  const log = path.join(root, '.screens', 'plugins--demo--install.log');
  fs.mkdirSync(path.dirname(log), { recursive: true });
  fs.writeFileSync(lsFile, 'There is a screen on:\n\t4242.plugins--demo--install\t(11/15/2026 01:00:00 PM)\t(Detached)\n');
  fs.writeFileSync(log, 'placing files\n');
  assert.strictEqual(await sessionDone('plugins--demo--install'), false, 'still at work');
  fs.appendFileSync(log, `Installed.\n\n${lingerTail('plugin install demo').match(/echo "([^"]+)"/)[1]}\n`);
  assert.strictEqual(await sessionDone('plugins--demo--install'), true, 'only waiting to be read');
  fs.rmSync(lsFile);
  assert.strictEqual(await sessionDone('plugins--demo--install'), true, 'gone');
  const server = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');
  assert.match(server, /if \(done\) res\.setHeader\('HX-Trigger', 'refresh-projects'\);/);
});

test('the session a notice linked to is the first thing on the Screens page, above a plugin\'s panel', () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'ui.js'), 'utf8');
  assert.match(ui, /box\.id = 'screen-asked';\n[^\n]*\n\s+list\.parentElement\.prepend\(box\);/);
  assert.doesNotMatch(ui, /list\.before\(box\)/);
  // The page draws the plugins' panels before the list, inside the same card.
  assert.match(fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8'), /pluginScreensPanelsHtml\(\)\}\s+<div id="webship-workspace-projects"/);
});

test('the line for a terminal of your own drops only the linger tail', () => {
  assert.strictEqual(withoutLinger(`git status; ${lingerTail('git status')}`), 'git status');
  assert.strictEqual(withoutLinger('bash cmd-x.sh; echo done'), 'bash cmd-x.sh; echo done');
  assert.match(`x; ${lingerTail('x')}`, /timeout --foreground 900/);
});

test('a plugin runner is asked first, with the session name, and its answer is the answer', async () => {
  withScreen();
  const seen = [];
  jobs.addRunner(async (req) => {
    seen.push(req);
    if (req.verb === 'declined') return null;
    if (req.verb === 'throws') throw new Error('broken runner');
    if (req.verb === 'refused') return { ok: false, already: true };
    return { ok: true, where: 'elsewhere', html: '<div class="msg assistant">run by the plugin</div>' };
  });
  const taken = await jobs.startInScreen(opts('taken'));
  assert.deepStrictEqual({ ok: taken.ok, where: taken.where, session: taken.session }, { ok: true, where: 'elsewhere', session: 'dev--demo--taken' });
  assert.strictEqual(seen[0].session, 'dev--demo--taken');
  assert.strictEqual(seen[0].cmdLine, 'echo ran-here');
  assert.strictEqual(jobs.screenStartedHtml(taken, 'x', 'demo'), '<div class="msg assistant">run by the plugin</div>');
  assert.ok(!askedLines().some((l) => l.includes('-dmS')), 'the dashboard started nothing beside it');

  // Declined, or broken: the dashboard runs it, in its own screen.
  for (const verb of ['declined', 'throws']) {
    const fell = await jobs.startInScreen(opts(verb));
    assert.deepStrictEqual({ ok: fell.ok, where: fell.where }, { ok: true, where: 'dashboard' }, `${verb} falls through`);
  }

  // A runner's refusal is a refusal: the dashboard's own answer for "already running" is drawn.
  const refused = await jobs.startInScreen(opts('refused'));
  assert.deepStrictEqual({ ok: refused.ok, already: refused.already }, { ok: false, already: true });
  assert.match(jobs.screenStartedHtml(refused, 'the refused', 'demo'), /already running/);
});

test('nothing is left that could draw a terminal at the bottom of the page', () => {
  const read = (...p) => fs.readFileSync(path.join(__dirname, '..', '..', ...p), 'utf8');
  assert.doesNotMatch(read('jobs.js'), /startInPage|where: 'page'/, 'no run in the page');
  for (const file of [['server.js'], ['public', 'ui.js'], ['jobs.js']]) {
    assert.doesNotMatch(read(...file), /job-toasts|jobs\/running|job-toast/, `${file.join('/')} has no stack`);
  }
  assert.ok(!fs.existsSync(path.join(__dirname, '..', '..', 'public', 'css', 'components', 'running-commands-as-toasts.css')));
  // A job view a plugin still answers a page button with is moved into the modal: a window, not the foot of the page.
  assert.match(read('public', 'ui.js'), /querySelectorAll\('#webship-workspace-output \.job-view, #settings-output \.job-view'\)\.forEach\(\(view\) => \{\s+body\.replaceChildren\(view\);/);
  // The steps of Settings → Plugins and a navigation entry's command start the way every command does.
  assert.match(read('actions', 'plugins.js'), /startUnlessRunning\(\{ workspace: 'plugins'/);
  assert.doesNotMatch(read('actions', 'plugins.js'), /startJob|jobFragment/);
  assert.doesNotMatch(read('actions', 'navigation.js'), /startJob|jobFragment/);
});

test('the api offers addRunner and addScreensPanel, and names them and screens-only as capabilities', () => {
  const loader = require('../../plugin-loader');
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'plugin-loader.js'), 'utf8');
  assert.match(src, /addRunner\(fn\) \{/);
  assert.match(src, /addScreensPanel\(fn\) \{/);
  assert.match(src, /new Set\(\['row-menu-body', 'runner', 'screens-panel'[^\]]*'screens-only'\]\)/);
  assert.strictEqual(loader.pluginScreensPanelsHtml(), '', 'no plugin, no panel');
  assert.match(fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8'), /pluginScreensPanelsHtml\(\)/, 'the Screens page draws the panels');
  const doc = fs.readFileSync(path.join(__dirname, '..', '..', 'PLUGINS.md'), 'utf8');
  assert.match(doc, /`api\.addRunner\(fn\)`/);
  assert.match(doc, /`api\.addScreensPanel\(fn\)`/);
  assert.match(doc, /## Who runs a command/);
  assert.match(doc, /There is no run in the page/);
});
