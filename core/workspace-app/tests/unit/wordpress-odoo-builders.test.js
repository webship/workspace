const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { sortWith } = require('../../build-order');
const { suggestProjectName } = require('../../project-name');

const root = path.join(__dirname, '..', '..', '..', '..');
const BUILDERS = ['cmd-wordpress-project.sh', 'cmd-wpbedrock1-project.sh', 'cmd-odoo20-project.sh'];

test('dev, test and sandboxes carry the WordPress and Odoo examples, and no other folder does', () => {
  for (const ws of ['dev', 'test', 'sandboxes']) {
    for (const f of BUILDERS) assert.ok(fs.existsSync(path.join(root, ws, f)), `${ws}/${f}`);
  }
  for (const ws of ['demos', 'projects', 'site-templates']) {
    for (const f of BUILDERS) assert.ok(!fs.existsSync(path.join(root, ws, f)), `${ws}/${f}`);
  }
});

test('they come last in the Build list, WordPress before Odoo', () => {
  const dir = path.join(root, 'dev');
  const all = fs.readdirSync(dir).filter((f) => /^cmd-.*-project\.sh$/.test(f) && !/^cmd-tools?-/.test(f)).sort();
  assert.deepEqual(sortWith(all, []).slice(-3), BUILDERS);
});

test('each proposes a name of its own', () => {
  const dir = path.join(root, 'dev');
  const names = BUILDERS.map((f) => suggestProjectName(dir, f, { existing: [] }));
  assert.deepEqual(names, ['wordpress1', 'wpbedrock1x00b1', 'odoo20x00b1']);
});

test('Odoo runs on PostgreSQL through DDEV, and WordPress never writes database settings', () => {
  const odoo = fs.readFileSync(path.join(root, 'core/scripts/functions/fun-odoo.sh'), 'utf8');
  const wp = fs.readFileSync(path.join(root, 'core/scripts/functions/fun-wordpress.sh'), 'utf8');
  assert.match(odoo, /--database=postgres:16/);
  assert.match(odoo, /proxy_pass http:\/\/odoo:8069;/);
  assert.doesNotMatch(wp, /wp config create|define\(\s*'DB_/);
});
