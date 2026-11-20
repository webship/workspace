/**
 * drop_database (#527): DDEV 1.24.7 leaves an empty .ddev/addon-metadata/ in the folder it runs from when it is
 * asked to delete a project it does not know. The builders call drop_database from the sites folder, so dev/.ddev/
 * appeared out of nowhere. ddev and docker are stubbed; the stub ddev does what 1.24.7 does.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const FUNCTION = path.join(__dirname, '..', '..', '..', 'scripts', 'functions', 'fun-database.sh');

function drop({ known }) {
  const sites = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-sites-'));
  const log = path.join(sites, '..', path.basename(sites) + '.log');
  const script = `
ddev() { printf '%s @ %s\\n' "$*" "$PWD" >> ${log}; mkdir -p .ddev/addon-metadata;
  if [ "$1" = describe ]; then return ${known ? 0 : 1}; fi; return 0; }
docker() { return 1; }
source ${FUNCTION}
cd ${sites} && PROJECT_NAME=site1 drop_database`;
  const r = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
  const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : [];
  return { r, sites, calls };
}

test('an unknown project: nothing is deleted and the sites folder stays clean', () => {
  const { r, sites, calls } = drop({ known: false });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(!fs.existsSync(path.join(sites, '.ddev')), 'no .ddev/ in the sites folder');
  assert.ok(calls.every((c) => !c.startsWith('delete')), calls.join('\n'));
  assert.ok(calls.every((c) => !c.endsWith(`@ ${sites}`)), 'ddev never ran in the sites folder');
});

test('a known project is deleted, from a folder of its own', () => {
  const { r, sites, calls } = drop({ known: true });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(calls.some((c) => c.startsWith('delete site1 -y -O @ ')), calls.join('\n'));
  assert.ok(!fs.existsSync(path.join(sites, '.ddev')), 'no .ddev/ in the sites folder');
});
