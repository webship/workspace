/**
 * A newer version of a plugin on npm: asked a few packages at a time, remembered, and never claimed
 * when it is not known.
 */
const assert = require('node:assert');
const { test } = require('node:test');

const updates = require('../../plugin-updates');

const rows = [
  { name: 'git', module: '@webship.co/workspace-git', version: '1.0.8', manifest: { label: 'Git' } },
  { name: 'jira', module: '@webship.co/workspace-jira', version: '1.0.9', manifest: { label: 'Jira' } },
  { name: 'notes', module: '', version: '', manifest: {} },
];

test('only a version that is really greater is an update, and a plugin with no package is not asked about', async () => {
  updates.forget();
  const asked = [];
  const ask = async (name) => { asked.push(name); return '1.0.9'; };
  const got = await updates.refresh(rows.map((p) => p.module), { ask });
  assert.deepStrictEqual(asked.sort(), ['@webship.co/workspace-git', '@webship.co/workspace-jira']);
  assert.strictEqual(got.error, '');
  assert.deepStrictEqual(updates.outdated(rows), [{ name: 'git', label: 'Git', module: '@webship.co/workspace-git', version: '1.0.8', latest: '1.0.9' }]);
});

test('the answer is remembered: a second question within hours asks nobody', async () => {
  updates.forget();
  let calls = 0;
  const ask = async () => { calls += 1; return '2.0.0'; };
  await updates.refresh(['a', 'b'], { ask, now: 1000 });
  await updates.refresh(['b', 'a'], { ask, now: 1000 + updates.TTL - 1 });
  assert.strictEqual(calls, 2);
  await updates.refresh(['a', 'b'], { ask, now: 1000 + updates.TTL + 1 });
  assert.strictEqual(calls, 4, 'and after that it is asked again');
  await updates.refresh(['a', 'b', 'c'], { ask, now: 1000 + updates.TTL + 2 });
  assert.strictEqual(calls, 7, 'a plugin that was added since is a new question');
});

test('a registry that cannot be reached is an error that is said, never "up to date"; one package that fails does not lose the rest', async () => {
  updates.forget();
  const down = await updates.refresh(['a', 'b'], { ask: async () => { throw new Error('the registry did not answer in time'); } });
  assert.strictEqual(down.error, 'the registry did not answer in time');
  assert.deepStrictEqual(down.latest, {});
  assert.deepStrictEqual(updates.outdated([{ name: 'a', module: 'a', version: '1.0.0' }]), []);
  updates.forget();
  const partly = await updates.refresh(['a', 'b'], { ask: async (n) => { if (n === 'a') throw new Error('no'); return '1.0.1'; } });
  assert.strictEqual(partly.error, '');
  assert.deepStrictEqual(partly.latest, { b: '1.0.1' });
});

test('a package the registry does not have, and a name that is not a package name, give no answer', async () => {
  updates.forget();
  const asked = [];
  const got = await updates.refresh(['plugins/notes', '../x', 'github:webship/thing', 'local-only'], { ask: async (n) => { asked.push(n); return ''; } });
  assert.deepStrictEqual(asked, ['local-only']);
  assert.deepStrictEqual(got.latest, {});
  assert.deepStrictEqual(updates.peek().latest, {});
});

test('Settings says it in a line with a link to each plugin, says when npm could not be asked, and says nothing when there is nothing', () => {
  const home = require('../../settings-home');
  assert.strictEqual(home.updatesLineHtml([], ''), '');
  const one = home.updatesLineHtml([{ name: 'git', label: 'Git', version: '1.0.8', latest: '1.0.9' }]);
  assert.match(one, /A newer version is on npm: <a href="\/settings\/plugin\/git">Git 1\.0\.8 → 1\.0\.9<\/a>\./);
  assert.match(home.updatesLineHtml([], 'the registry did not answer in time'), /npm could not be asked for newer versions \(the registry did not answer in time\)\. The versions shown are the ones installed here\./);
  const html = home.homeHtml({ files: ['settings.yml'], plugins: [], groups: [], styles: { count: 1, wearing: 'x' } });
  assert.match(html, /<div class="settings-updates" hx-get="\/fragments\/settings\/updates" hx-trigger="load" hx-swap="innerHTML" role="status"><\/div>/, 'asked in a fragment: the page does not wait for the registry');
});

test('a plugin with a newer version shows it in its state and offers the update with the same command for a terminal', () => {
  const model = require('../../settings-model');
  const page = require('../../settings-plugin-page');
  const row = { name: 'git', module: '@webship.co/workspace-git', version: '1.0.8', manifest: { name: 'git', label: 'Git', settingsTemplate: 'c.yml' }, step: 3, wants: { needs: [], suggests: [], unmet: [], problems: [] }, placed: {} };
  const p = model.groupByFamily([row], { latest: { '@webship.co/workspace-git': '1.0.9' }, isNewer: updates.isNewer })[0].plugins[0];
  assert.strictEqual(p.state.update, '1.0.9');
  const html = page.statusHtml(p);
  assert.match(html, /<span>Update 1\.0\.9<\/span>/);
  assert.match(html, /<strong>Version 1\.0\.9 is on npm\.<\/strong> This workspace has 1\.0\.8\./);
  assert.match(html, /&quot;verb&quot;:&quot;require&quot;,&quot;spec&quot;:&quot;@webship\.co\/workspace-git@1\.0\.9&quot;/);
  assert.match(html, /plugins\.sh --require @webship\.co\/workspace-git@1\.0\.9</);
  assert.match(html, /Then Reinstall/);
  const same = model.groupByFamily([row], { latest: { '@webship.co/workspace-git': '1.0.8' }, isNewer: updates.isNewer })[0].plugins[0];
  assert.ok(!page.statusHtml(same).includes('is on npm'));
});
