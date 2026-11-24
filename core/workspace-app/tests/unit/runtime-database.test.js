/**
 * The database of a project on the runtimes is DDEV's, whatever the MariaDB version (webship/workspace#827):
 * DDEV's character set and collation on Docker Compose, Podman and Kubernetes, where MariaDB 11.x would otherwise
 * take its own default collation (utf8mb4_uca1400_ai_ci, which Moodle's installer refuses); and on Docksal the image
 * of each version that exists (11.x is only in release 1.5 of Docksal's MariaDB images).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPTS = path.join(__dirname, '..', '..', '..', 'scripts');
const STACKS = path.join(__dirname, '..', '..', '..', 'config', 'runtimes');

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-runtime-db-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  for (const cli of ['docker', 'podman', 'ddev', 'kind', 'lando', 'fin']) {
    fs.writeFileSync(path.join(bin, cli), `#!/usr/bin/env bash\necho "${cli} $*" >> "${dir}/calls.log"\n[ -t 0 ] || cat > /dev/null\n`, { mode: 0o755 });
  }
  fs.writeFileSync(path.join(bin, 'kubectl'), `#!/usr/bin/env bash\ncase "$*" in *"get nodes"*) printf 172.18.0.2 ;; esac\n`, { mode: 0o755 });
  return dir;
}

/** `ddev config` with a MariaDB version, in a new folder, on a runtime; the files it wrote. */
function configured(dir, runtime, name, db) {
  const p = path.join(dir, name); fs.mkdirSync(p);
  const r = spawnSync('bash', ['-c', `RT_STACKS=${STACKS}; source ${SCRIPTS}/functions/fun-runtime.sh; RT_STACKS=${STACKS}; ddev config --project-type=php --docroot=public --database=mariadb:${db} --project-name=${name}`],
    { cwd: p, encoding: 'utf8', env: { ...process.env, PATH: `${dir}/bin:${process.env.PATH}`, HOME: dir, WORKSPACE_ROOT: path.join(SCRIPTS, '..', '..'), WORKSPACE_RUNTIME: runtime } });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  return p;
}

const read = (...f) => fs.readFileSync(path.join(...f), 'utf8');

test('Docker Compose and Podman: the db service starts MariaDB with DDEV\'s character set and collation, for every version', () => {
  const dir = sandbox();
  for (const runtime of ['docker', 'podman']) {
    for (const db of ['10.11', '11.4']) {
      const compose = read(configured(dir, runtime, `c${runtime}${db.replace('.', '')}`, db), 'compose.yaml');
      const svc = compose.slice(compose.indexOf('\n  db:\n'), compose.indexOf('\n  mail:\n'));
      assert.match(svc, new RegExp(`\\n {4}image: mariadb:${db.replace('.', '\\.')}\\n {4}# [^\\n]+\\n {4}# [^\\n]+\\n {4}command: \\["--character-set-server=utf8mb4", "--collation-server=utf8mb4_general_ci"\\]\\n {4}environment:\\n`), `${runtime} ${db}`);
    }
  }
});

test('Kubernetes: the db container is given the same arguments', () => {
  const dir = sandbox();
  const stack = read(configured(dir, 'kubernetes', 'k114', '11.4'), 'k8s', 'stack.yaml');
  assert.match(stack, /\n {8}- name: db\n {10}image: mariadb:11\.4\n {10}# [^\n]+\n {10}args: \["--character-set-server=utf8mb4", "--collation-server=utf8mb4_general_ci"\]\n {10}env:\n/);
});

test('Docksal: the image of the version that exists, 1.5 for 11.x and 1.4 as before for 10.x', () => {
  const dir = sandbox();
  assert.match(read(configured(dir, 'docksal', 'd1011', '10.11'), '.docksal', 'docksal.env'), /^DB_IMAGE=docksal\/mariadb:10\.11-1\.4$/m);
  assert.match(read(configured(dir, 'docksal', 'd114', '11.4'), '.docksal', 'docksal.env'), /^DB_IMAGE=docksal\/mariadb:11\.4-1\.5$/m);
});
