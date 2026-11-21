/**
 * A run records its scenarios when asked, into tests/videos/, and says only what it did (webship/workspace#681).
 *
 * The command said "each scenario leaves a recording" after every failed suite, and none was made: webship-js records
 * only when asked (WEBSHIP_VIDEO, or video.mode in the suite's config), and into ./videos, while the report reads
 * tests/videos/. Now --video on|on-failure|off asks for it, every run from the Workspace points the recordings at
 * tests/videos/, the closing lines say what was recorded or how to record, and the Tests menu can run the suite
 * recording the failures.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn, spawnSync } = require('child_process');
const { copyConfig } = require('./_isolated-config');

const APP = path.join(__dirname, '..', '..');
const REPO = path.join(APP, '..', '..');
const SCRIPTS = path.join(REPO, 'core', 'scripts');

/** testing_run on a throwaway project whose suite fails; its output, and every `ddev exec` it made. */
function run(video) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-testing-video-'));
  fs.mkdirSync(path.join(root, 'dev', 'site'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dev', 'site', 'package.json'), '{"scripts":{"test":"cucumber-js"}}');
  const log = path.join(root, 'exec.log');
  const script = `
source ${SCRIPTS}/functions/fun-testing.sh
WORKSPACE_ROOT=${root}; doc_name=dev; PROJECT_NAME=site
BROWSER=chromium; HEADED=no; DRY_RUN=no; RETRY=_none_; TAGS=_none_; TESTING_PATH=_none_; VIDEO=${video}
testing_require_project() { return 0 ; }
testing_stack() { printf 'webship-js' ; }
testing_ensure_browser_libs() { return 0 ; }
testing_install_browsers() { return 0 ; }
ddev() {
  if [ "$1 $2 $3" = "exec printenv LAUNCH_URL" ]; then echo https://site.ddev.site ; return 0 ; fi
  if [ "$1" = "exec" ]; then shift ; printf '%s\\n' "$*" >> '${log}' ; printf '1 scenario (1 failed)\\n' ; return 1 ; fi
  return 0
}
testing_run
echo "status $?"`;
  const r = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
  const execs = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : [];
  fs.rmSync(root, { recursive: true, force: true });
  return { out: r.stdout + r.stderr, suite: execs.find((l) => / run test:chromium$/.test(l)) || '' };
}

test('a run from the Workspace points the recordings at tests/videos/, and asks for none unless told', () => {
  const r = run('_none_');
  assert.match(r.suite, /(^| )WEBSHIP_VIDEO_DIR=tests\/videos( |$)/, r.out);
  assert.doesNotMatch(r.suite, /WEBSHIP_VIDEO=/);
  // A failed suite says what it left, and how to record next time; no promise of a recording.
  assert.match(r.out, /Every failed step leaves a screenshot and a DOM dump in tests\/screenshots\/\./);
  assert.match(r.out, /run it again with --video on-failure: it records them into tests\/videos\//);
  assert.doesNotMatch(r.out, /left a recording|each scenario leaves a recording|Recordings:/);
  assert.match(r.out, /The dashboard's Tests menu shows both, newest first\./);
});

test('--video on-failure is passed to webship-js, and the run says where the recordings are', () => {
  const r = run('on-failure');
  assert.match(r.suite, /(^| )WEBSHIP_VIDEO_DIR=tests\/videos( |$)/);
  assert.match(r.suite, /(^| )WEBSHIP_VIDEO=on-failure( |$)/);
  assert.match(r.out, /Every failed scenario left a recording in tests\/videos\//);
  assert.match(r.out, /Recordings: {2}dev\/site\/tests\/videos\//);
  assert.doesNotMatch(r.out, /run it again with --video/);
});

test('--video on records every scenario; the option takes on, on-failure or off', () => {
  const r = run('on');
  assert.match(r.suite, /(^| )WEBSHIP_VIDEO=on( |$)/);
  assert.match(r.out, /Every scenario left a recording in tests\/videos\//);
  const args = fs.readFileSync(path.join(SCRIPTS, 'args', 'arg-testing.sh'), 'utf8');
  assert.match(args, /parser\.add_argument\('--video',\s*dest='VIDEO',\s*default="_none_",\s*choices=\['on', 'on-failure', 'off'\],/);
});

// The Tests menu, from a real server over a throwaway workspace with a site that has a suite.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-testing-video-menu-'));
let proc;
let base;
const free = () => new Promise((resolve) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});
before(async () => {
  fs.mkdirSync(path.join(root, 'core'), { recursive: true });
  copyConfig(path.join(REPO, 'core/config'), path.join(root, 'core/config'));
  for (const f of ['row-actions.yml', 'row-actions.seen.json']) fs.rmSync(path.join(root, 'core/config', f), { force: true });
  fs.symlinkSync(SCRIPTS, path.join(root, 'core/scripts'));
  fs.symlinkSync(APP, path.join(root, 'core/workspace-app'));
  const site = path.join(root, 'dev', 'site');
  fs.mkdirSync(path.join(site, '.ddev'), { recursive: true });
  fs.writeFileSync(path.join(site, '.ddev', 'config.yaml'), 'name: site\ntype: wordpress\n');
  fs.writeFileSync(path.join(site, 'cucumber.js'), 'module.exports = {};\n');
  fs.writeFileSync(path.join(site, 'package.json'), '{"name":"site"}');
  fs.writeFileSync(path.join(root, 'dev', 'cmd-tools-testing.sh'), '#!/usr/bin/env bash\n');
  const port = await free();
  base = `http://127.0.0.1:${port}`;
  proc = spawn(process.execPath, ['server.js'], { cwd: APP, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port), WORKSPACE_ROOT: root, WORKSPACE_PLUGINS_NO_RESTART: '1' } });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start')), 20000);
    proc.stdout.on('data', (d) => { if (/listening/.test(String(d))) { clearTimeout(t); resolve(); } });
    proc.on('exit', (c) => { clearTimeout(t); reject(new Error(`server exited ${c}`)); });
  });
});
after(() => {
  if (proc) proc.kill();
  fs.rmSync(root, { recursive: true, force: true });
});

test('the Tests menu runs the suite recording the failures, beside the plain run', async () => {
  const html = await (await fetch(`${base}/fragments/row-menu/tests/dev/site`)).text();
  const entry = html.slice(html.indexOf('<li data-entry="run recording">'));
  assert.ok(html.includes('<li data-entry="run recording">'), html.slice(0, 600));
  assert.match(entry, /hx-post="\/actions\/testing-run" hx-vals='\{"workspace":"dev","projectName":"site","video":"on-failure"\}'/);
  assert.match(entry, /Run the tests, recording the failures<\/a><\/li>/);
  assert.ok(html.indexOf('Run the tests</a>') > 0 || /Run the tests(\s|<)/.test(html), 'the plain run is still there');
});

test('the run action passes only on, on-failure or off on to the command', () => {
  const a = fs.readFileSync(path.join(APP, 'actions', 'testing.js'), 'utf8');
  assert.match(a, /const video = isRun && \['on', 'on-failure', 'off'\]\.includes\(String\(form\.video \|\| ''\)\) \? String\(form\.video\) : '';/);
  assert.match(a, /cmdLine: `bash \$\{shWords\(\[script, projectName\]\)\}\$\{isRun \? ' --run' : ''\}\$\{video \? ` --video \$\{video\}` : ''\}`/);
});
