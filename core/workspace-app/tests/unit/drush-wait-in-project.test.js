/**
 * The wait for `ddev drush` asks in the project's folder, so a tool run from the workspace folder does not wait a
 * minute on a DDEV site (webship/workspace#702).
 *
 * add_drush asked `ddev drush --version` from where the caller stood. The users tools stand in the workspace folder,
 * no DDEV project, so all ten attempts failed, six seconds apart, before the tool went on and worked.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPTS = path.join(__dirname, '..', '..', '..', 'scripts');

/** add_drush called from `from`, with a ddev that answers only inside the project folder. */
function run(from) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-drush-wait-'));
  const project = path.join(root, 'dev', 'site');
  fs.mkdirSync(path.join(project, 'vendor', 'drush', 'drush'), { recursive: true });
  fs.mkdirSync(path.join(project, '.ddev'), { recursive: true });
  fs.writeFileSync(path.join(project, '.ddev', 'config.yaml'), 'name: site\n');
  const script = `
source ${SCRIPTS}/functions/fun-drush.sh
WORKSPACE_ROOT=${root}; doc_name=dev; PROJECT_NAME=site
sleep() { echo "slept $1" ; }
ddev() { case "$PWD" in ${project}|${project}/*) return 0 ;; *) return 1 ;; esac ; }
cd ${from === 'workspace' ? `${root}/dev` : project}
add_drush
echo "status $?"`;
  const r = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
  fs.rmSync(root, { recursive: true, force: true });
  return r.stdout + r.stderr;
}

test('from the workspace folder, on a DDEV site: drush answers at once, no waiting', () => {
  const out = run('workspace');
  assert.match(out, /^status 0$/m);
  assert.doesNotMatch(out, /not available yet|slept/);
});

test('from the project folder, as a build stands: the same', () => {
  const out = run('project');
  assert.match(out, /^status 0$/m);
  assert.doesNotMatch(out, /not available yet|slept/);
});
