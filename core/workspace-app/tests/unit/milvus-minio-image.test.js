/**
 * A new Milvus instance starts again, and a failed start is said (webship/workspace#577).
 *
 * The compose file cmd-milvus-project.sh writes named minio/minio, which left Docker Hub: on a machine without
 * the image cached `ddev start` failed, and build_milvus still printed "is ready" and exited 0. The object
 * store is now the same MinIO release from milvusdb/minio, an instance built before is moved to it when the
 * command is run for it, and a failed start or a database that never answers ends the run with a failure.
 *
 * In bash, against core/scripts/functions/fun-milvus.sh, with ddev and docker replaced by stand-ins.
 */

const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const FUN = path.join(__dirname, '..', '..', '..', 'scripts', 'functions', 'fun-milvus.sh');

function bash(script, cwd) {
  const r = spawnSync('bash', ['-c', script], { cwd, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: cwd } });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

test('the compose file of a new instance names milvusdb/minio, never minio/minio', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-milvus-'));
  const r = bash(`source ${FUN}; milvus_write_compose ${dir}/m1 v2.6.21 v2.6.5 19530 false`, dir);
  assert.strictEqual(r.status, 0, r.out);
  const compose = fs.readFileSync(path.join(dir, 'm1', '.ddev', 'docker-compose.milvus.yaml'), 'utf8');
  assert.match(compose, /^ {4}image: "milvusdb\/minio:RELEASE\.2024-12-18T13-15-44Z"$/m);
  assert.doesNotMatch(compose, /minio\/minio:/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('an instance built before is moved to that image in place, and another release is left alone and said', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-milvus-'));
  const old = path.join(dir, 'old', '.ddev');
  fs.mkdirSync(old, { recursive: true });
  const before = 'services:\n  milvus-minio:\n    image: "minio/minio:RELEASE.2024-12-18T13-15-44Z"\n    volumes:\n      - milvus_minio:/minio_data\n';
  fs.writeFileSync(path.join(old, 'docker-compose.milvus.yaml'), before);
  let r = bash(`source ${FUN}; milvus_compose_minio_image ${dir}/old`, dir);
  assert.strictEqual(r.status, 0, r.out);
  assert.match(r.out, /Moved its object store to milvusdb\/minio:RELEASE\.2024-12-18T13-15-44Z/);
  assert.strictEqual(fs.readFileSync(path.join(old, 'docker-compose.milvus.yaml'), 'utf8'), before.replace('minio/minio:', 'milvusdb/minio:'), 'that line alone, the volumes untouched');
  r = bash(`source ${FUN}; milvus_compose_minio_image ${dir}/old`, dir);
  assert.strictEqual(r.out, '', 'once moved, nothing more to say');
  const other = path.join(dir, 'other', '.ddev');
  fs.mkdirSync(other, { recursive: true });
  fs.writeFileSync(path.join(other, 'docker-compose.milvus.yaml'), 'image: "minio/minio:RELEASE.2023-03-20T20-16-18Z"\n');
  r = bash(`source ${FUN}; milvus_compose_minio_image ${dir}/other`, dir);
  assert.match(r.out, /names a minio\/minio image, which is no longer on Docker Hub: change it to milvusdb\/minio/);
  assert.match(fs.readFileSync(path.join(other, 'docker-compose.milvus.yaml'), 'utf8'), /minio\/minio:RELEASE\.2023/, 'not rewritten to a release it was not built with');
  fs.rmSync(dir, { recursive: true, force: true });
});

/** build_milvus with stand-ins: `start` is what `ddev start` returns, `healthy` what the health wait returns. */
function build({ start, healthy }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-milvus-'));
  fs.mkdirSync(path.join(dir, 'rag'));
  const script = `
WORKSPACE_ROOT=${dir}; doc_name=rag; PROJECT_NAME=m1; MILVUS_VERSION=v2.6.21; ATTU_VERSION=v2.6.5; PUBLIC_URI=canonical
GRPC_PORT=19530; AUTHORIZATION=; FORCE=; LAUNCH=
source ${FUN}
ddev() { if [ "$1" = start ]; then return ${start}; fi; return 0; }
docker() { return 0; }
milvus_wait_healthy() { return ${healthy}; }
build_milvus; echo "exit=$?"`;
  const r = bash(script, dir);
  fs.rmSync(dir, { recursive: true, force: true });
  return r.out;
}

test('a start that fails ends the run with a failure, and never says it is ready', () => {
  const out = build({ start: 1, healthy: 0 });
  assert.match(out, /Milvus m1 did not start: ddev start failed/);
  assert.doesNotMatch(out, /is ready/);
  assert.match(out, /exit=1$/m);
});

test('a database that never answers is not ready either', () => {
  const out = build({ start: 0, healthy: 1 });
  assert.doesNotMatch(out, /is ready/);
  assert.match(out, /exit=1$/m);
});

test('a start that works is ready, as before', () => {
  const out = build({ start: 0, healthy: 0 });
  assert.match(out, /Milvus v2\.6\.21 is ready\./);
  assert.match(out, /exit=0$/m);
});
