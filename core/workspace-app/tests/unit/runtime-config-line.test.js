/**
 * What `ddev config` says it wrote on Docker Compose and Podman (webship/workspace#890): the stack and the database as
 * they are. A generic stack has no PHP; a database is PostgreSQL, MariaDB or none. The line used to name PHP and
 * MariaDB whatever the project was ("generic, PHP 8.3, MariaDB postgres:17").
 *
 * Stand-in docker, podman and ddev on PATH: nothing runs, the config step only writes compose.yaml and says so.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-runtime-config-line-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  for (const name of ['docker', 'podman', 'podman-compose', 'ddev']) fs.writeFileSync(path.join(bin, name), '#!/usr/bin/env bash\ntrue\n', { mode: 0o755 });
  return dir;
}

function config(dir, runtime, name, args) {
  const p = path.join(dir, `${runtime}-${name}`);
  fs.mkdirSync(p);
  const r = spawnSync('bash', ['-c', `RT_STACKS=${STACKS}; source ${SCRIPTS}/functions/fun-runtime.sh; RT_STACKS=${STACKS}; ddev config ${args} --project-name=${name}`],
    { cwd: p, encoding: 'utf8', input: '', env: { ...process.env, PATH: `${dir}/bin:${process.env.PATH}`, HOME: dir, WORKSPACE_ROOT: path.join(SCRIPTS, '..', '..'), WORKSPACE_RUNTIME: runtime } });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  return (r.stdout.match(/^Wrote compose\.yaml for .*$/m) || [''])[0];
}

test('the config line says the stack and the database as they are, on Docker Compose and on Podman', () => {
  const dir = sandbox();
  try {
    for (const runtime of ['docker', 'podman']) {
      assert.match(config(dir, runtime, 'gen-pg', '--project-type=generic --webserver-type=generic --database=postgres:17'),
        new RegExp(`^Wrote compose\\.yaml for ${runtime} \\(generic, PostgreSQL 17\\): http://127\\.0\\.0\\.1:\\d+$`), 'a generic stack on PostgreSQL: no PHP, no MariaDB');
      assert.match(config(dir, runtime, 'gen-none', '--project-type=generic --webserver-type=generic --omit-containers=db'),
        new RegExp(`^Wrote compose\\.yaml for ${runtime} \\(generic, no database\\): `), 'a generic stack with no database');
      assert.match(config(dir, runtime, 'php-maria', '--project-type=php --docroot=web'),
        new RegExp(`^Wrote compose\\.yaml for ${runtime} \\(php, PHP 8\\.3, MariaDB 10\\.11\\): `), 'the php stack as before');
      assert.match(config(dir, runtime, 'php-pg', '--project-type=php --docroot=web --database=postgres:16'),
        new RegExp(`^Wrote compose\\.yaml for ${runtime} \\(php, PHP 8\\.3, PostgreSQL 16\\): `), 'the php stack on PostgreSQL');
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
