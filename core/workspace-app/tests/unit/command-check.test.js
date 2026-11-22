/**
 * The commands the core and the plugins need on the machine: declared in the shape a manifest uses
 * (needs.commands, suggests.commands), reported by command-check.js as found, with the version, or
 * missing, with how to install it — by `webship-workspace doctor`, `plugins.sh --check`, `init`,
 * `--install` and Settings → Plugins. It reports; it never installs.
 *
 * PATH is a folder of stand-in commands made for the test, so what is "on this machine" is exactly
 * what the test put there.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const APP = path.join(__dirname, '..', '..');
const SCRIPTS = path.join(APP, '..', 'scripts');
const BIN = path.join(APP, '..', 'bin', 'workspace.js');
const check = require('../../command-check');

/** A folder of stand-in commands: name → what it prints for --version (or a function body of its own). */
function stubPath(commands) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-cmds-'));
  for (const [name, says] of Object.entries(commands)) {
    fs.writeFileSync(path.join(dir, name), says.startsWith('#!') ? says : `#!/bin/sh\necho "${says}"\n`, { mode: 0o755 });
  }
  return dir;
}
/** Every command the core declares for the host, as stand-ins, minus the ones left out. */
function coreStubs(without = []) {
  const core = JSON.parse(fs.readFileSync(check.CORE_NEEDS, 'utf8'));
  const names = [...core.needs.commands, ...core.suggests.commands].map((c) => c.command).filter((c) => !c.includes(':') && !without.includes(c));
  return stubPath(Object.fromEntries(names.map((n) => [n, `${n} version 1.2.3`])));
}
/** Run node itself by its full path, with PATH set to the stand-ins only. */
const run = (args, PATH, env = {}) => spawnSync(process.execPath, args, { cwd: APP, encoding: 'utf8', timeout: 60000,
  env: { HOME: os.tmpdir(), PATH, WORKSPACE_DASHBOARD_CONTAINER: '', WEBSHIP_WORKSPACE_SKIP_NPM: '1', WEBSHIP_WORKSPACE_SKIP_DDEV: '1', ...env } });

test('a command entry is a name, a list when any one will do, or { command, where, hint }; what is wrong is said', () => {
  const { entries, problems } = check.commandEntries(['curl', 'container:twg', ['curl', 'wget'], { command: 'upsun', hint: 'https://example.com/cli' },
    { anyOf: ['docker', 'podman'], where: 'host', for: 'x.sh' }, 'project:wp', 'bad name', { command: 'x', where: 'moon' }, 7]);
  assert.deepStrictEqual(entries.map((e) => [e.anyOf.join('|'), e.where, e.hint]), [
    ['curl', 'host', ''], ['twg', 'container', ''], ['curl|wget', 'host', ''], ['upsun', 'host', 'https://example.com/cli'], ['docker|podman', 'host', ''], ['wp', 'project', '']]);
  assert.strictEqual(problems.length, 3);
  assert.deepStrictEqual(check.commandEntries('curl').problems, ['commands must be a list']);
  // A list is the plugins; an object holds plugins and commands, and nothing else.
  assert.deepStrictEqual(check.split(['dev']), { plugins: ['dev'], commands: undefined, problems: [] });
  const s = check.split({ plugins: ['dev'], commands: ['curl'], colour: 'red' });
  assert.deepStrictEqual([s.plugins, s.commands], [['dev'], ['curl']]);
  assert.match(s.problems[0], /"colour" is not a kind of need/);
});

test('needs as an object keeps its plugins working, and a wrong command is a problem of the manifest', () => {
  const { normalize } = require('../../plugin-needs.mts');
  assert.deepStrictEqual(normalize({ plugins: [['dev', 'test'], 'ai-agents'], commands: ['upsun'] }).groups, [['dev', 'test'], ['ai-agents']]);
  assert.deepStrictEqual(normalize({ commands: ['upsun'] }), { groups: [], problems: [] });
  assert.strictEqual(normalize({ commands: ['not ok'] }).problems.length, 1);
  assert.strictEqual(normalize({ plugins: 'dev' }).problems.length, 1);
});

test('a command is found on PATH with the version it reports, however it reports it; it is looked for, never run through a shell', () => {
  const dir = stubPath({
    curl: 'curl 8.5.0 (x86_64-pc-linux-gnu) libcurl/8.5.0',
    oldtool: '#!/bin/sh\n[ "$1" = "-v" ] && echo "oldtool v2.7" && exit 0\nexit 1\n',
    silent: '#!/bin/sh\nexit 0\n',
  });
  fs.writeFileSync(path.join(dir, 'notexec'), 'x', { mode: 0o644 });
  assert.strictEqual(check.findOnPath('curl', dir), path.join(dir, 'curl'));
  assert.strictEqual(check.findOnPath('notexec', dir), '', 'a file that cannot be run is not a command');
  assert.strictEqual(check.findOnPath('curl; rm -rf x', dir), '', 'only a name is looked for');
  assert.strictEqual(check.versionOf(path.join(dir, 'curl')), '8.5.0');
  assert.strictEqual(check.versionOf(path.join(dir, 'oldtool')), '2.7', '-v when --version is not answered');
  assert.strictEqual(check.versionOf(path.join(dir, 'silent')), '', 'no version is still found');
});

test('the report: found with the version, missing with the install hint in plain words, the first alternative that is here, and what cannot be checked from here', () => {
  const dir = stubPath({ git: 'git version 2.43.0', wget: 'GNU Wget 1.21.4' });
  const code = `
    const c = require('./command-check');
    const r = c.checkOwner('demo', {
      needs: { plugins: ['dev'], commands: ['git', 'upsun', { command: 'acli', hint: 'https://example.com/acli' }, ['curl', 'wget'], 'container:twg', 'project:wp'] },
      suggests: { commands: ['pandoc', { command: 'jq', hint: 'your package manager has it as jq' }] } });
    console.log(JSON.stringify({ rows: r.rows, problems: r.problems, text: c.reportText([r]), short: c.missingText([r]) }));`;
  const r = run(['-e', code], dir);
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  const by = Object.fromEntries(out.rows.map((x) => [x.anyOf.join('|'), x]));
  assert.deepStrictEqual([by.git.state, by.git.version, by.git.path], ['found', '2.43.0', path.join(dir, 'git')]);
  assert.deepStrictEqual([by.upsun.state, by.upsun.kind], ['missing', 'needs']);
  assert.strictEqual(by.upsun.hint, 'Debian/Ubuntu: apt install upsun · Fedora: dnf install upsun · macOS (Homebrew): brew install upsun');
  assert.strictEqual(by.acli.hint, 'see https://example.com/acli', 'the hint its owner gave');
  assert.deepStrictEqual([by['curl|wget'].state, by['curl|wget'].name, by['curl|wget'].version], ['found', 'wget', '1.21.4'], 'one of them is enough');
  assert.deepStrictEqual([by.twg.state, by.wp.state], ['unchecked', 'unchecked']);
  assert.match(by.wp.why, /project's own container/);
  assert.deepStrictEqual([by.pandoc.state, by.pandoc.kind], ['missing', 'suggests']);
  assert.strictEqual(by.jq.hint, 'your package manager has it as jq');
  assert.match(out.text, /The plugin demo:\n needs\n {2}✓ git +2\.43\.0 +.*\/git\n {2}✗ upsun +missing — needed\n {6}install: Debian\/Ubuntu: apt install upsun/);
  assert.match(out.text, / a part of it uses\n {2}✗ pandoc +missing — suggested/);
  assert.match(out.text, /Missing and needed: upsun, acli\. Install them yourself; nothing is installed for you\./);
  assert.match(out.text, /Missing, used by a part only: pandoc, jq\./);
  assert.match(out.short, /✗ demo: upsun/);
  assert.doesNotMatch(out.short, /git/, 'the short form names only what is missing');
  // Inside the dashboard's container the host cannot be looked at, and it says where to look.
  const inside = run(['-e', `const c=require('./command-check'); console.log(JSON.stringify(c.checkOwner('d',{needs:{commands:['git','container:git']}}).rows.map((x)=>[x.where,x.state,x.why])))`], dir, { IS_DDEV_PROJECT: 'true' });
  const rows = JSON.parse(inside.stdout);
  assert.deepStrictEqual(rows[0].slice(0, 2), ['host', 'unchecked']);
  assert.match(rows[0][2], /webship-workspace doctor/);
  assert.deepStrictEqual(rows[1].slice(0, 2), ['container', 'found']);
});

test('the core declares its own commands, each with the file that calls it, and that file exists', () => {
  const core = JSON.parse(fs.readFileSync(check.CORE_NEEDS, 'utf8'));
  for (const kind of ['needs', 'suggests']) {
    const { entries, problems } = check.commandEntries(core[kind].commands);
    assert.deepStrictEqual(problems, []);
    assert.strictEqual(entries.length, core[kind].commands.length);
    for (const e of entries) {
      assert.ok(e.for, `${e.anyOf[0]} says what calls it`);
      // Every file a "for" names is in the core (a bare name is under core/scripts/functions or core/scripts).
      for (const f of e.for.match(/[A-Za-z0-9_./-]+\.(?:sh|js)/g) || []) {
        if (f.includes('*')) continue;
        const places = [path.join(APP, '..', '..', f), path.join(SCRIPTS, 'functions', f), path.join(SCRIPTS, f), path.join(APP, f)];
        assert.ok(places.some((p) => fs.existsSync(p)) || f.startsWith('cmd-'), `${f} (for ${e.anyOf[0]}) is a file of the core`);
      }
    }
  }
  const needed = core.needs.commands.map((c) => c.command);
  for (const must of ['bash', 'git', 'node', 'npm', 'docker', 'ddev', 'python']) assert.ok(needed.includes(must), `${must} is needed`);
});

test('doctor: everything found exits 0; a needed command missing exits 1 and says how to install it; a suggested one missing does not', () => {
  const all = coreStubs();
  let r = run([BIN, 'doctor', '/nowhere'], all);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /The core of Webship Workspace:\n needs\n {2}✓ bash +1\.2\.3/);
  assert.match(r.stdout, /· bash \(container\) +not checked/);
  assert.match(r.stdout, /Every command that could be checked from here is found\./);
  r = run([BIN, 'doctor', '/nowhere'], coreStubs(['python', 'ddev']));
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /✗ python +missing — needed for core\/scripts\/libs\/argparse\.sh[^\n]*\n {6}install: Debian\/Ubuntu: the package python-is-python3/);
  assert.match(r.stdout, /✗ ddev +missing — needed[^\n]*\n {6}install: see https:\/\/ddev\.readthedocs\.io/);
  assert.match(r.stdout, /Missing and needed: python, ddev\./);
  r = run([BIN, 'doctor', '/nowhere'], coreStubs(['jq', 'screen']));
  assert.strictEqual(r.status, 0, 'a part of the core is not the core');
  assert.match(r.stdout, /Missing, used by a part only: jq, screen\./);
});

test('doctor installs nothing: no package manager and no sudo is ever run, even when they are right there', () => {
  const marker = path.join(os.tmpdir(), `ws-doctor-ran-${process.pid}`);
  const dir = coreStubs(['curl', 'python']);
  for (const tool of ['sudo', 'apt', 'apt-get', 'dnf', 'brew', 'snap']) fs.writeFileSync(path.join(dir, tool), `#!/bin/sh\necho "$0 $*" >> "${marker}"\n`, { mode: 0o755 });
  const r = run([BIN, 'doctor', '/nowhere'], dir);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /install: Debian\/Ubuntu: apt install curl/);
  assert.ok(!fs.existsSync(marker), 'nothing was run to install anything');
  const src = fs.readFileSync(path.join(APP, 'command-check.js'), 'utf8');
  assert.doesNotMatch(src, /spawnSync\(['"](sudo|apt|apt-get|dnf|brew)/);
});

test('init says what is missing before it starts, and goes on', () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ws-init-doctor-')), 'workspace');
  const r = run([BIN, 'init', dir], coreStubs(['python', 'rsync']));
  assert.strictEqual(r.status, 0, r.stderr);
  const at = (re) => r.stdout.search(re);
  assert.ok(at(/commands this machine does not have/) > 0 && at(/commands this machine does not have/) < at(/settings\.yml written/), 'said first');
  assert.match(r.stdout, /✗ core: python +missing — needed/);
  assert.match(r.stdout, /✗ core: rsync +missing — suggested/);
  assert.ok(fs.existsSync(path.join(dir, 'core', 'scripts', 'needs.json')), 'the workspace is made, with the list');
  assert.ok(fs.existsSync(path.join(dir, 'commands', 'cmd-tools-commands.sh')), 'with the base\'s commands folder, which Run a tool calls');
  const quiet = run([BIN, 'init', path.join(path.dirname(dir), 'second')], coreStubs());
  assert.doesNotMatch(quiet.stdout, /commands this machine does not have/, 'nothing missing: nothing said');
});

/** A workspace tree with one fake plugin that declares commands. */
function tree(manifest) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-cmd-tree-'));
  const config = path.join(root, 'core', 'config');
  fs.mkdirSync(config, { recursive: true });
  fs.mkdirSync(path.join(root, 'core', 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(root, 'core', 'workspace-app', '.ddev'), { recursive: true });
  fs.writeFileSync(path.join(config, 'settings.yml'), 'workspaces: []\nplugins: {}\n');
  const dir = path.join(root, 'plugins', 'cloud');
  fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'config', 'plugin.cloud.settings.yml'), 'token: x\n');
  fs.writeFileSync(path.join(dir, 'index.js'), 'module.exports.register = () => {};');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: '@webship.co/workspace-cloud', version: '0.1.0',
    workspacePlugin: { name: 'cloud', label: 'Cloud', settingsFile: 'plugin.cloud.settings.yml', settingsTemplate: 'config/plugin.cloud.settings.yml', ...manifest } }));
  return { root, env: { ...process.env, WORKSPACE_ROOT: root, WORKSPACE_CONFIG: config, WORKSPACE_PLUGINS_DIR: path.join(root, 'plugins'), WORKSPACE_PLUGINS_NO_RESTART: '1', WORKSPACE_SCRIPTS: SCRIPTS, WORKSPACE_DASHBOARD_CONTAINER: '' } };
}
const sh = (t, ...args) => spawnSync('bash', [path.join(SCRIPTS, 'plugins.sh'), ...args], { cwd: t.root, env: t.env, encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] });

test('plugins.sh --check reports one plugin or everything; --install says what is missing first and still places the files', () => {
  const t = tree({ needs: { commands: ['bash', { command: 'cloudctl-not-here', hint: 'https://example.com/cloudctl' }] }, suggests: { commands: ['cloud-extra-not-here'] } });
  let r = sh(t, '--check', 'cloud');
  assert.strictEqual(r.status, 1, r.stdout);
  assert.match(r.stdout, /The plugin cloud:\n needs\n {2}✓ bash +\d[^\n]*\n {2}✗ cloudctl-not-here +missing — needed\n {6}install: see https:\/\/example\.com\/cloudctl/);
  assert.match(r.stdout, /✗ cloud-extra-not-here +missing — suggested/);
  r = sh(t, '--check');
  assert.match(r.stdout, /The core of Webship Workspace:[\s\S]*The plugin cloud:/, 'no name: the core and every plugin');
  assert.strictEqual(sh(t, '--check', 'nope').status, 2, 'an unknown plugin');
  // A missing command is said before the install starts; the install is not stopped by it.
  assert.strictEqual(sh(t, '--activate', 'cloud').status, 0);
  r = sh(t, '--install', 'cloud');
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  const said = r.stdout.indexOf('Commands cloud uses that are not on this machine');
  assert.ok(said >= 0 && said < r.stdout.indexOf('placed core/config/plugin.cloud.settings.yml'), 'said first');
  assert.match(r.stdout, /✗ cloud: cloudctl-not-here +missing — needed/);
  assert.match(r.stdout, /✗ cloud: cloud-extra-not-here +missing — suggested/);
  assert.ok(fs.existsSync(path.join(t.root, 'core', 'config', 'plugin.cloud.settings.yml')), 'the files are placed');
  // A plugin whose commands are all here says nothing.
  const fine = tree({ needs: { commands: ['bash'] } });
  sh(fine, '--activate', 'cloud');
  assert.doesNotMatch(sh(fine, '--install', 'cloud').stdout, /not on this machine/);
  assert.strictEqual(sh(fine, '--check', 'cloud').status, 0);
});

test('Settings → Plugins lists the core\'s commands and each plugin\'s, found or missing, with how to install what is missing', () => {
  const t = tree({ needs: { commands: ['bash', 'cloudctl-not-here'] }, suggests: { commands: ['container:twg'] } });
  const r = spawnSync(process.execPath, ['-e', 'require("./command-check").setLocalOnly(true);const p=require("./plugins-page"),m=require("./settings-model.mts"),pg=require("./settings-plugin-page");const g=m.groupByFamily(p.rows()).flatMap((f)=>f.plugins);console.log(p.pluginsPageHtml()+g.map((x)=>"PLUGIN-PAGE "+pg.pluginPageHtml(x,{files:[]})).join(""))'], { cwd: APP, env: t.env, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  const html = r.stdout;
  // A plugin's commands are on its own page in Settings.
  const card = html.split('PLUGIN-PAGE ').find((c) => c.includes('<h2 class="plugin-head-name">Cloud</h2>')) || '';
  assert.match(card, /Commands on this machine<\/h4>/);
  assert.match(card, /<code>bash<\/code>: found, \d/);
  assert.match(card, /is-unmet">[\s\S]{0,200}<code>cloudctl-not-here<\/code>: not on this machine\. Install: Debian\/Ubuntu: apt install cloudctl-not-here/);
  assert.match(card, /<code>twg \(container\)<\/code>: not checked from here/);
  // The base's commands: closed at the end of the page, every column with a heading.
  assert.match(html, /<details class="plugin-commands-section">\s*<summary><span class="plugin-commands-title">Commands on this machine<\/span>/);
  assert.match(html, /<th scope="col">Command<\/th><th scope="col">Needed<\/th><th scope="col">Here<\/th><th scope="col">Used for<\/th>/);
  assert.match(html, /<tr class="command-row is-found"><td><code>bash<\/code><\/td><td>Needed<\/td>/);
  assert.match(html, /A plugin's own commands are on its page\./);
  assert.match(html, /webship-workspace doctor/);
  assert.match(html, /Nothing is installed for you\./);
});

test('webship-workspace plugin check passes through to plugins.sh --check', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-cmd-bin-'));
  fs.mkdirSync(path.join(root, 'core', 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'core', 'scripts', 'plugins.sh'), '#!/usr/bin/env bash\necho "ARGS: $*"\n');
  const r = spawnSync(process.execPath, [BIN, 'plugin', 'check', 'upsun'], { encoding: 'utf8', env: { ...process.env, WORKSPACE_ROOT: root } });
  assert.strictEqual(r.stdout.trim(), 'ARGS: --check upsun');
});

test('plugins.sh --require takes a bare name as the plugin of that name, never as an npm package called that', () => {
  const t = tree({});
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-fake-npm-'));
  fs.writeFileSync(path.join(bin, 'npm'), '#!/bin/sh\necho "NPM: $*"\nexit 1\n', { mode: 0o755 });
  t.env = { ...t.env, PATH: `${bin}:${t.env.PATH}` };
  const asked = (spec) => { const r = sh(t, '--require', spec); return (r.stdout.match(/^NPM: .*$/m) || [''])[0]; };
  assert.match(asked('dev'), / @webship\.co\/workspace-dev$/);
  assert.match(asked('drupal-cms'), / @webship\.co\/workspace-drupal-cms$/);
  assert.match(asked('dev@1.0.9'), / @webship\.co\/workspace-dev@1\.0\.9$/);
  assert.match(asked('dev@latest'), / @webship\.co\/workspace-dev@latest$/);
  for (const spec of ['@webship.co/workspace-dev', '@webship.co/workspace-dev@1.0.9', 'github:webship/workspace-upsun', './plugins/cloud', 'cloud-1.0.0.tgz']) {
    assert.ok(asked(spec).endsWith(` ${spec}`), `${spec} is taken as written`);
  }
});

test('the dashboard\'s container is this workspace\'s own, and it is asked only when it has this workspace mounted (#628)', { skip: fs.existsSync('/.dockerenv') && 'inside a container, its own commands are looked at directly' }, () => {
  // A tree of its own: command-check.js beside a .ddev/config.yaml that names the DDEV project.
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ws-tree-')));
  const app = path.join(root, 'core', 'workspace-app');
  fs.mkdirSync(path.join(app, '.ddev'), { recursive: true });
  fs.copyFileSync(path.join(APP, 'command-check.js'), path.join(app, 'command-check.js'));
  const config = (text) => fs.writeFileSync(path.join(app, '.ddev', 'config.yaml'), text);
  const log = path.join(root, 'docker.log');
  // A docker that says which tree the container has mounted (null: there is no such container) and answers command -v.
  const docker = (mounted) => stubPath({ docker: `#!/bin/sh
echo "$*" >> "${log}"
case "$1" in
  inspect) ${mounted === null ? 'echo "Error: No such object: $2" >&2; exit 1' : `printf '%s\\n' /var/run/docker.sock "${mounted}"`} ;;
  exec) echo /usr/bin/found ;;
esac
` });
  const ask = (PATH, env = {}) => {
    fs.rmSync(log, { force: true });
    const code = `const c = require(${JSON.stringify(path.join(app, 'command-check.js'))}); console.log(JSON.stringify(c.checkOwner('d', { needs: { commands: ['container:git'] } }).rows[0]))`;
    const r = spawnSync(process.execPath, ['-e', code], { cwd: root, encoding: 'utf8', timeout: 60000, env: { HOME: os.tmpdir(), PATH, ...env } });
    assert.strictEqual(r.status, 0, r.stderr);
    const row = JSON.parse(r.stdout);
    return { state: row.state, path: row.path, why: row.why, calls: fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : [] };
  };

  config('name: second-ws\ntype: generic\n');
  // The container that is up serves another tree: its answers are not this workspace's.
  let a = ask(docker('/home/someone/another-workspace'));
  assert.deepStrictEqual([a.state, a.path], ['unchecked', '']);
  assert.match(a.why, /serves another workspace/);
  assert.match(a.calls[0], /^inspect ddev-second-ws-web /, 'named after this workspace\'s project, not ddev-workspace-web');
  assert.ok(!a.calls.some((c) => c.startsWith('exec ')), 'nothing is asked of it');

  // There is no such container: unchecked, not running.
  a = ask(docker(null));
  assert.deepStrictEqual([a.state, a.path], ['unchecked', '']);
  assert.match(a.why, /which is not running/);
  assert.ok(!a.calls.some((c) => c.startsWith('exec ')));

  // Its own container is asked.
  a = ask(docker(root));
  assert.deepStrictEqual([a.state, a.path], ['found', '/usr/bin/found']);
  assert.ok(a.calls.includes('exec ddev-second-ws-web sh -c command -v git'), a.calls.join('\n'));

  // No name in the config: DDEV's project is "workspace".
  config('type: generic\n');
  a = ask(docker(root));
  assert.match(a.calls[0], /^inspect ddev-workspace-web /);
  assert.strictEqual(a.state, 'found');

  // WORKSPACE_DASHBOARD_CONTAINER names it outright, and an empty value means there is none to ask.
  a = ask(docker('/home/someone/another-workspace'), { WORKSPACE_DASHBOARD_CONTAINER: 'my-box' });
  assert.deepStrictEqual(a.calls, ['exec my-box sh -c command -v git']);
  assert.strictEqual(a.state, 'found');
  a = ask(docker(root), { WORKSPACE_DASHBOARD_CONTAINER: '' });
  assert.deepStrictEqual([a.state, a.calls.length], ['unchecked', 0]);
  assert.match(a.why, /there is none to ask from here/);
});
