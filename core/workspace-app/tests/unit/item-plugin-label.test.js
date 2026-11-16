/**
 * An AI item's row says which plugin it came with.
 *
 * Every plugin places its agents, skills, commands and prompts in the AI folders, beside the ones a
 * person wrote and the ones fetched from a repository. The folder pages listed them all alike: nothing
 * said that `wordpress-tester` is the WordPress plugin's and is updated with it. The record of what each
 * plugin placed (core/config/plugins.installed.yml) already knows.
 *
 * Against a real server over a temp workspace tree, like the row-menu test.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');

const APP = path.join(__dirname, '../..');
const REPO = path.join(APP, '../..');
const { copyConfig } = require('./_isolated-config');
const { placedBy } = require('../../plugin-install');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-item-plugin-'));
let proc;
let base;

const RECORD = {
  wordpress: { module: '@webship.co/workspace-wordpress', version: '1.0.9', placed: ['dev/cmd-wordpress-project.sh', 'ai-agents/wordpress-tester.md', 'ai-skills/wordpress-scenarios/SKILL.md', 'ai-skills/wordpress-scenarios/examples/a.feature', 'ai-commands/wordpress-test.md', 'ai-prompts/wordpress-build-and-test.md'] },
  upsun: { module: '@webship.co/workspace-upsun', version: '1.0.9', placed: ['ai-agents/upsun-deployer.md'] },
};

const free = () => new Promise((resolve) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

before(async () => {
  fs.mkdirSync(path.join(root, 'core'), { recursive: true });
  copyConfig(path.join(REPO, 'core/config'), path.join(root, 'core/config'));
  fs.symlinkSync(path.join(REPO, 'core/scripts'), path.join(root, 'core/scripts'));
  fs.symlinkSync(APP, path.join(root, 'core/workspace-app'));
  fs.writeFileSync(path.join(root, 'core/config/plugins.installed.yml'), require('js-yaml').dump(RECORD));
  const agent = (n) => `---\nname: ${n}\ndescription: Use this agent to be listed.\ntools:\n  - Read\n---\n\n# ${n}\n`;
  for (const k of ['ai-agents', 'ai-skills', 'ai-commands', 'ai-prompts']) fs.mkdirSync(path.join(root, k), { recursive: true });
  for (const n of ['wordpress-tester', 'upsun-deployer', 'my-own-agent']) fs.writeFileSync(path.join(root, 'ai-agents', `${n}.md`), agent(n));
  for (const n of ['wordpress-scenarios', 'my-own-skill']) {
    fs.mkdirSync(path.join(root, 'ai-skills', n), { recursive: true });
    fs.writeFileSync(path.join(root, 'ai-skills', n, 'SKILL.md'), `---\nname: ${n}\ndescription: What it does. Use when testing.\n---\n\n# ${n}\n`);
  }
  fs.writeFileSync(path.join(root, 'ai-commands/wordpress-test.md'), '---\ndescription: Test a site.\nargument-hint: \'<site>\'\n---\n\nTest: `$ARGUMENTS`\n');
  fs.writeFileSync(path.join(root, 'ai-prompts/wordpress-build-and-test.md'), 'Build and test a site.\n\n```\nclaude """\nBuild it.\n"""\n```\n');
  const port = await free();
  base = `http://127.0.0.1:${port}`;
  proc = spawn(process.execPath, ['server.js'], { cwd: APP, env: { ...process.env, PORT: String(port), WORKSPACE_ROOT: root, HOME: root, WORKSPACE_PLUGINS_NO_RESTART: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
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

const html = async (p) => { const r = await fetch(base + p); assert.strictEqual(r.status, 200, p); return r.text(); };
/** The row of one item: from its machine name to the next row. */
const rowOf = (page, name) => {
  const at = page.indexOf(`>${name}</span>`);
  assert.ok(at > 0, `no row for ${name}`);
  const end = page.indexOf('project-row', at);
  return page.slice(page.lastIndexOf('project-row', at), end < 0 ? undefined : end);
};

test('placedBy answers the plugin that placed a path, with its package and version, and null for the rest', () => {
  assert.deepStrictEqual(placedBy('ai-agents/wordpress-tester.md', RECORD), { name: 'wordpress', module: '@webship.co/workspace-wordpress', version: '1.0.9' });
  assert.deepStrictEqual(placedBy('ai-skills/wordpress-scenarios/SKILL.md', RECORD), { name: 'wordpress', module: '@webship.co/workspace-wordpress', version: '1.0.9' });
  assert.strictEqual(placedBy('ai-agents/upsun-deployer.md', RECORD).name, 'upsun');
  assert.strictEqual(placedBy('ai-agents/my-own-agent.md', RECORD), null);
  assert.strictEqual(placedBy('', RECORD), null);
  assert.strictEqual(placedBy('ai-agents/wordpress-tester.md', {}), null);
  assert.strictEqual(placedBy('ai-agents/wordpress-tester.md', { broken: null, other: { placed: 'not a list' } }), null);
});

test('the row of an item a plugin placed names the plugin; the row of a hand-written item does not', async () => {
  const agents = await html('/ai-agents');
  assert.match(rowOf(agents, 'wordpress-tester'), /<span class="uk-text-meta item-plugin" title="Placed by the plugin @webship\.co\/workspace-wordpress 1\.0\.9[^"]*">· plugin wordpress<\/span>/);
  assert.match(rowOf(agents, 'upsun-deployer'), /· plugin upsun</);
  assert.doesNotMatch(rowOf(agents, 'my-own-agent'), /item-plugin/);
  const skills = await html('/ai-skills');
  assert.match(rowOf(skills, 'wordpress-scenarios'), /· plugin wordpress</);
  assert.doesNotMatch(rowOf(skills, 'my-own-skill'), /item-plugin/);
  assert.match(rowOf(await html('/ai-commands'), 'wordpress-test'), /· plugin wordpress</);
  assert.match(rowOf(await html('/ai-prompts'), 'wordpress-build-and-test'), /· plugin wordpress</);
});

test('Sources and AI CLIs names the plugin under the item too', async () => {
  const panel = await html('/fragments/ai-agents/any-cli');
  const row = (n) => { const at = panel.indexOf(`data-item="${n}"`); return panel.slice(at, panel.indexOf('</tr>', at)); };
  assert.match(row('wordpress-tester'), /<span class="uk-text-meta any-cli-plugin" title="@webship\.co\/workspace-wordpress 1\.0\.9">plugin wordpress<\/span>/);
  assert.doesNotMatch(row('my-own-agent'), /any-cli-plugin/);
});
