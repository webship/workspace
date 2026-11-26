/**
 * A platform plugin keeps its project's database (webship/workspace#937): <platform>_export_db, <platform>_import_db and
 * <platform>_is_project (with <platform>_db_extension for its own dumps). The runtime layer's `ddev export-db` and
 * `ddev import-db` ask it first, on every runtime, and export_project_db / import_project_db (the backup scripts, a
 * clone) use it. Without a hook everything is as it was; a project with no database is backed up without one.
 *
 * A stand-in ddev and docker on PATH record what each verb becomes; a fake platform ("fakep") is a few functions in
 * the script, as a plugin's fun-*.sh would declare them.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPTS = path.join(__dirname, '..', '..', '..', 'scripts');
const STACKS = path.join(__dirname, '..', '..', '..', 'config', 'runtimes');

// The fake platform: a project is one of its own when .ddev/config.fakep.yaml (DDEV) or `platform: fakep` (another
// runtime) says so; its dumps say where they came from; its import says what it reads.
const FAKEP = `
fakep_is_project() { [ -f "$1/.ddev/config.fakep.yaml" ] || grep -q '^  platform: fakep' "$1/compose.yaml" 2> /dev/null ; }
fakep_export_db() { echo "fake export $1" >> "\${CALLS}" ; echo "FAKE DUMP of $(basename "$(pwd)")" > "$1" ; }
fakep_import_db() { echo "fake import $1" >> "\${CALLS}" ; grep -q '^FAKE DUMP' "$1" || { echo "not a whole fake dump: $1" >&2 ; return 1 ; } ; }
fakep_db_extension() { echo .fakedump ; }
`;

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-project-db-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  for (const cli of ['docker', 'podman', 'ddev']) {
    fs.writeFileSync(path.join(bin, cli), `#!/usr/bin/env bash\necho "${cli} $*" >> "${dir}/calls.log"\n[ -t 0 ] || cat > /dev/null\n`, { mode: 0o755 });
  }
  return dir;
}

/** Runs `script` with the layer, the database functions and (with `plugin`) the fake platform sourced in `cwd`. */
function run(dir, cwd, script, { plugin = true } = {}) {
  const log = path.join(dir, 'calls.log');
  const r = spawnSync('bash', ['-c', `RT_STACKS=${STACKS}; source ${SCRIPTS}/functions/fun-runtime.sh; source ${SCRIPTS}/functions/fun-project-db.sh; RT_STACKS=${STACKS}; ${plugin ? FAKEP : ''}\n${script}`],
    { cwd, encoding: 'utf8', env: { ...process.env, PATH: `${dir}/bin:${process.env.PATH}`, WORKSPACE_ROOT: path.join(SCRIPTS, '..', '..'), CALLS: log } });
  const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : [];
  if (fs.existsSync(log)) fs.unlinkSync(log);
  return { out: r.stdout + r.stderr, calls, status: r.status };
}

function ddevProject(dir, name, config, marks = {}) {
  const p = path.join(dir, name);
  fs.mkdirSync(path.join(p, '.ddev'), { recursive: true });
  fs.writeFileSync(path.join(p, '.ddev', 'config.yaml'), config);
  for (const [file, text] of Object.entries(marks)) fs.writeFileSync(path.join(p, '.ddev', file), text);
  return p;
}

test('an ordinary DDEV project: the backup and the import are DDEV\'s, with the same arguments as before', () => {
  const dir = sandbox();
  const p = ddevProject(dir, 'site', 'name: site\ntype: drupal11\n');
  const r = run(dir, p, `export_project_db "${dir}/backups/dev---site--1-db" && echo "file=$PROJECT_DB_FILE"; import_project_db /etc/hostname; ddev export-db --file=${dir}/x.sql.gz; ddev import-db --file=${dir}/x.sql.gz`);
  assert.deepStrictEqual(r.calls, [
    `ddev export-db --file=${dir}/backups/dev---site--1-db.sql.gz`,
    'ddev import-db --file=/etc/hostname',
    `ddev export-db --file=${dir}/x.sql.gz`,
    `ddev import-db --file=${dir}/x.sql.gz`,
  ]);
  assert.match(r.out, new RegExp(`file=${dir}/backups/dev---site--1-db\\.sql\\.gz`));
  // A plugin's hook for another platform does not take a project that is not its own.
  assert.strictEqual(run(dir, p, 'rt_db_platform || echo none').out.trim(), 'none');
});

test('a DDEV project with no database and no hook: nothing to back up, said so, and not a failure', () => {
  const dir = sandbox();
  for (const [name, config, marks] of [
    ['inline', 'name: inline\ntype: generic\nomit_containers: [db]\n', {}],
    ['several', 'name: several\ntype: generic\nomit_containers: [ddev-ssh-agent, db]\n', {}],
    ['block', 'name: block\ntype: generic\n', { 'config.angular.yaml': 'omit_containers:\n  - db\n' }],
  ]) {
    const p = ddevProject(dir, name, config, marks);
    const r = run(dir, p, `export_project_db "${dir}/backups/dev---${name}--1-db" ; echo "status=$? file=[$PROJECT_DB_FILE]"`);
    assert.match(r.out, /This project has no database to back up/, name);
    assert.match(r.out, /status=0 file=\[\]/, `${name}: the backup goes on`);
    assert.deepStrictEqual(r.calls, [], `${name}: DDEV is not asked`);
    const i = run(dir, p, `import_project_db /etc/hostname ; echo "status=$?"`);
    assert.match(i.out, /no database to put hostname into/);
    assert.match(i.out, /status=1/);
  }
  // The word db in another key, or another container omitted, is a database still.
  const kept = ddevProject(dir, 'kept', 'name: kept\ntype: drupal11\nomit_containers: [ddev-ssh-agent]\ndatabase:\n  type: mariadb\n');
  assert.deepStrictEqual(run(dir, kept, `export_project_db "${dir}/k-db"`).calls, [`ddev export-db --file=${dir}/k-db.sql.gz`]);
});

test('a platform that keeps its database on DDEV: the backup, the verbs and the import are its plugin\'s', () => {
  const dir = sandbox();
  const p = ddevProject(dir, 'fapp', 'name: fapp\ntype: generic\nomit_containers: [db]\n', { 'config.fakep.yaml': '# the fake platform\n' });
  assert.strictEqual(run(dir, p, 'rt_db_platform').out.trim(), 'fakep');
  const r = run(dir, p, `export_project_db "${dir}/dev---fapp--1-db" && echo "file=$PROJECT_DB_FILE"`);
  assert.deepStrictEqual(r.calls, [`fake export ${dir}/dev---fapp--1-db.fakedump`], 'its own dump, in its own format');
  assert.match(r.out, new RegExp(`file=${dir}/dev---fapp--1-db\\.fakedump`));
  assert.strictEqual(fs.readFileSync(path.join(dir, 'dev---fapp--1-db.fakedump'), 'utf8').trim(), 'FAKE DUMP of fapp');
  // The verbs every other caller uses (the safety dump before a remove, a clone, the row's export): the same plugin,
  // with the file they name; DDEV is never asked.
  const v = run(dir, p, `ddev export-db --gzip --file ${dir}/before.sql.gz && ddev import-db --file=${dir}/dev---fapp--1-db.fakedump`);
  assert.deepStrictEqual(v.calls, [`fake export ${dir}/before.sql.gz`, `fake import ${dir}/dev---fapp--1-db.fakedump`]);
  // Its import checks the dump: one that is not whole fails, and says why.
  fs.writeFileSync(path.join(dir, 'broken.fakedump'), 'half');
  const bad = run(dir, p, `import_project_db ${dir}/broken.fakedump ; echo "status=$?"`);
  assert.match(bad.out, /not a whole fake dump/);
  assert.match(bad.out, /status=1/);
  // A verb with no file has nowhere to write: said so.
  const nofile = run(dir, p, 'ddev export-db ; echo "status=$?"');
  assert.match(nofile.out, /kept by its fakep plugin, which writes and reads a file: ddev export-db --file=<path>/);
  assert.match(nofile.out, /status=1/);
  assert.deepStrictEqual(nofile.calls, []);
});

test('a platform that keeps its database on another runtime: the same hook, one path for every runtime', () => {
  const dir = sandbox();
  const p = path.join(dir, 'dock');
  fs.mkdirSync(p);
  fs.writeFileSync(path.join(p, 'compose.yaml'), 'name: dock\nx-webship:\n  runtime: docker\n  platform: fakep\n  stack: generic\n  database: none\n  port: 41999\nservices:\n  web:\n    image: x\n');
  const r = run(dir, p, `export_project_db "${dir}/dev---dock--1-db" && ddev import-db --file=${dir}/dev---dock--1-db.fakedump`);
  assert.deepStrictEqual(r.calls, [`fake export ${dir}/dev---dock--1-db.fakedump`, `fake import ${dir}/dev---dock--1-db.fakedump`]);
  // Without the plugin the runtime's database is none: nothing to back up, said so; docker is not asked.
  const bare = run(dir, p, `export_project_db "${dir}/b-db" ; echo "status=$?"`, { plugin: false });
  assert.match(bare.out, /This project has no database to back up/);
  assert.match(bare.out, /status=0/);
  assert.deepStrictEqual(bare.calls, []);
});

test('a plugin\'s export that writes nothing fails the backup, and leaves no empty file', () => {
  const dir = sandbox();
  const p = ddevProject(dir, 'empty', 'name: empty\ntype: generic\n', { 'config.fakep.yaml': '' });
  const r = run(dir, p, `fakep_export_db() { : > "$1" ; } ; export_project_db "${dir}/e-db" ; echo "status=$?"`);
  assert.match(r.out, /The fakep plugin wrote no dump to .*e-db\.fakedump/);
  assert.match(r.out, /status=1/);
  assert.ok(!fs.existsSync(path.join(dir, 'e-db.fakedump')));
});

test('an export DDEV cannot finish fails the backup, and leaves no empty dump', () => {
  const dir = sandbox();
  // The stand-in ddev of this test starts the dump and fails, as DDEV does when the database is not there.
  fs.writeFileSync(path.join(dir, 'bin', 'ddev'), `#!/usr/bin/env bash\necho "ddev $*" >> "${dir}/calls.log"\nfor a in "$@" ; do case "$a" in --file=*) : > "\${a#--file=}" ;; esac ; done\nexit 1\n`, { mode: 0o755 });
  const p = ddevProject(dir, 'broken', 'name: broken\ntype: drupal11\n');
  const r = run(dir, p, `export_project_db "${dir}/b-db" ; echo "status=$? file=[$PROJECT_DB_FILE]"`, { plugin: false });
  assert.match(r.out, /status=1 file=\[\]/);
  assert.ok(!fs.existsSync(path.join(dir, 'b-db.sql.gz')), 'no empty dump');
});

test('every backup script backs the database up through export_project_db', () => {
  const repo = path.join(SCRIPTS, '..', '..');
  const scripts = ['dev/cmd-tools-backup-dev.sh', 'test/cmd-tools-backup-test.sh', 'sandboxes/cmd-tools-backup-sandboxes.sh',
    'demos/cmd-tools-backup-demo.sh', 'projects/cmd-tool-backup-project.sh', 'themes/cmd-backup-theme.sh'];
  for (const f of scripts) {
    const src = fs.readFileSync(path.join(repo, f), 'utf8');
    assert.match(src, /export_project_db "\$\{backups\}\/\$\{doc_name\}\/\$\{doc_name\}---\$\{PROJECT_NAME\}--\$\{(BACKUP_TIME|backup_time)\}-db"/, f);
    assert.doesNotMatch(src, /ddev export-db/, `${f} no longer asks DDEV directly`);
  }
});
