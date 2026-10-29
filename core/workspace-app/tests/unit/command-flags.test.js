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

test('a site-template builder reports no flags, because its parser takes a name and nothing else', () => {
  // arg-site-template.sh declares only PROJECT_NAME. A hint offering --install here would be a
  // hint for a flag the build exits on.
  const templates = path.join(ROOT, 'site-templates');
  assert.deepStrictEqual(commandFlags(templates, 'cmd-byte-project.sh'), []);
  assert.deepStrictEqual(commandFlags(templates, 'cmd-website_starter-project.sh'), []);
});

test('a distribution builder reports its opt-in install, with the help text that travels with it', () => {
  const flags = commandFlags(dev, 'cmd-webship11-0-x-project.sh');
  const longs = flags.map((f) => f.long);
  assert.ok(longs.includes('--install'));
  assert.ok(longs.includes('--add-users'));
  // The help text travels with the flag — that is what the hints show.
  const install = flags.find((f) => f.long === '--install');
  assert.ok(install.short === '-i');
  assert.ok(install.help.length > 10);
});

test('a script with no arg file yields an empty contract, not a throw', () => {
  assert.deepStrictEqual(commandFlags(dev, 'no-such-script.sh'), []);
});
