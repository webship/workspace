/**
 * `cmd-tools-ragify.sh <project> --query` asks the server the rag settings name (webship/workspace#578).
 *
 * ragify_query_project resolved the server before it had read the default from the rag folder's settings, and
 * the fallback read its own empty `milvus_project`: an unbound project was always looked for on a server called
 * "milvus". In bash, against the real fun-milvus.sh, fun-rag.sh and fun-ragify.sh, with the parts that reach a
 * server replaced by stand-ins that note which server they were asked about.
 */

const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPTS = path.join(__dirname, '..', '..', '..', 'scripts');

function query({ bindings = '' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-ragify-query-'));
  const config = path.join(root, 'core', 'config');
  fs.mkdirSync(config, { recursive: true });
  fs.mkdirSync(path.join(root, 'rag'), { recursive: true });
  fs.writeFileSync(path.join(config, 'workspace.rag.settings.yml'), 'doc:\n  name: rag\nmilvus:\n  project: "other"\nrag:\n  collection_prefix: ws\n');
  if (bindings) fs.writeFileSync(path.join(root, 'rag', 'bindings.yml'), bindings);
  const log = path.join(root, 'asked.log');
  const script = `
WORKSPACE_ROOT=${root}; WORKSPACE_CONFIG=${config}; WORKSPACE_SCRIPTS=${SCRIPTS}
source ${SCRIPTS}/libs/bash-yaml.sh
source ${SCRIPTS}/functions/fun-milvus.sh; source ${SCRIPTS}/functions/fun-rag.sh; source ${SCRIPTS}/functions/fun-ragify.sh
milvus_uri() { echo "uri $1" >> ${log}; printf 'http://127.0.0.1:1'; }
milvus_require_running() { echo "running $1" >> ${log}; return 0; }
rag_python() { echo "search $*" >> ${log}; }
doc_name=dev; PROJECT_NAME=site1; QUERY="where is it"; LIMIT=5
ragify_query_project; echo "exit=$?"`;
  const r = spawnSync('bash', ['-c', script], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: root } });
  const asked = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
  fs.rmSync(root, { recursive: true, force: true });
  return { out: `${r.stdout}${r.stderr}`, asked };
}

test('an unbound project is asked of the server the rag settings name', () => {
  const { out, asked } = query();
  assert.match(out, /exit=0/, out);
  assert.match(asked, /^uri other$/m, asked);
  assert.match(asked, /^running other$/m);
  assert.match(asked, /--collection ws_dev_site1 --query where is it --limit 5/);
});

test('a bound project is still asked of the server it is bound to', () => {
  const { asked } = query({ bindings: 'dev/site1: bound1\n' });
  assert.match(asked, /^uri bound1$/m, asked);
});
