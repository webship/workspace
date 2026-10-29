/**
 * commandFlags feeds two surfaces that must not lie: the AI context's command
 * contract and the Run-a-tool flag hints. It resolves the args/arg-*.sh a
 * command sources — including through the `arg-${distribution_name}.sh`
 * indirection every builder uses — so these tests pin both paths against the
 * real shipped files.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { commandFlags, ROOT } = require('../../workspaces');

const dev = path.join(ROOT, 'dev');

test('a builder with a variable arg file resolves to the real contract', () => {
  const flags = commandFlags(dev, 'cmd-drupal11-recommended-project.sh').map((f) => f.long);
  for (const expected of ['--install', '--launch', '--dev']) {
    assert.ok(flags.includes(expected), `${expected} in ${flags}`);
  }
});

test('a site-template builder reports opt-in install and launch', () => {
  const flags = commandFlags(dev, 'cmd-educare1-0-x-project.sh');
  const longs = flags.map((f) => f.long);
  assert.ok(longs.includes('--install'));
  assert.ok(longs.includes('--launch'));
  // The help text travels with the flag — that is what the hints show.
  const install = flags.find((f) => f.long === '--install');
  assert.ok(install.short === '-i');
  assert.ok(install.help.length > 10);
});

test('a script with no arg file yields an empty contract, not a throw', () => {
  assert.deepStrictEqual(commandFlags(dev, 'no-such-script.sh'), []);
});
