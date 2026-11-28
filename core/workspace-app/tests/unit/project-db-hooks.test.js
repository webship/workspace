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

test('an export DDEV cannot finish fails the backup, and leaves no dump, empty or cut short, unless it was there before', () => {
  const dir = sandbox();
  // The stand-in ddev of this test writes part of a dump and fails, as DDEV does when the export breaks off.
  fs.writeFileSync(path.join(dir, 'bin', 'ddev'), `#!/usr/bin/env bash\necho "ddev $*" >> "${dir}/calls.log"\nfor a in "$@" ; do case "$a" in --file=*) printf 'partial dump' > "\${a#--file=}" ;; esac ; done\nexit 1\n`, { mode: 0o755 });
  const p = ddevProject(dir, 'broken', 'name: broken\ntype: drupal11\n');
  const r = run(dir, p, `export_project_db "${dir}/b-db" ; echo "status=$? file=[$PROJECT_DB_FILE]"`, { plugin: false });
  assert.match(r.out, /status=1 file=\[\]/);
  assert.ok(!fs.existsSync(path.join(dir, 'b-db.sql.gz')), 'no cut-short dump for the Import panel to list');
  // A file that was there before the call is not the call's to remove.
  fs.writeFileSync(path.join(dir, 'kept-db.sql.gz'), 'an older dump');
  run(dir, p, `export_project_db "${dir}/kept-db"`, { plugin: false });
  assert.ok(fs.existsSync(path.join(dir, 'kept-db.sql.gz')), 'the file that was there stays');
});

test('a platform\'s own hook that calls ddev export-db reaches DDEV once, never itself', () => {
  const dir = sandbox();
  const p = ddevProject(dir, 'both', 'name: both\ntype: drupal11\n', { 'config.fakep.yaml': '' });
  // A platform that keeps a database of its own beside DDEV's, and dumps DDEV's too, through the workspace's ddev.
  const both = 'fakep_export_db() { echo "fake export $1" >> "${CALLS}" ; ddev export-db --file="$1.ddev.sql.gz" || return 1 ; echo "FAKE DUMP" > "$1" ; }';
  const r = run(dir, p, `${both}\nexport_project_db "${dir}/both-db" ; echo "status=$?" ; ddev export-db --file=${dir}/again.dump ; echo "verb status=$?"`);
  assert.match(r.out, /status=0/);
  assert.match(r.out, /verb status=0/);
  assert.deepStrictEqual(r.calls, [
    `fake export ${dir}/both-db.fakedump`,
    `ddev export-db --file=${dir}/both-db.fakedump.ddev.sql.gz`,
    `fake export ${dir}/again.dump`,
    `ddev export-db --file=${dir}/again.dump.ddev.sql.gz`,
  ], 'DDEV\'s export once for each, and the plugin once for each');
  // Outside the hook, the mark is gone: the next verb asks the plugin again.
  assert.doesNotMatch(run(dir, p, 'echo "mark=[${RT_DB_HOOK_ACTIVE:-}]"').out, /mark=\[1\]/);
});

// A Restore from the backups list (#951): once the archive is extracted, the project is started and the dump beside the
// archive imported through the runtime layer, so the plugin that keeps the database reads it, on DDEV as elsewhere.
function backup(dir, name, dumps) {
  const backups = path.join(dir, 'backups');
  fs.mkdirSync(backups, { recursive: true });
  const archive = path.join(backups, `dev---${name}--2026-11-27_10-00-00.tar.gz`);
  fs.writeFileSync(archive, 'archive');
  for (const [ext, body] of Object.entries(dumps)) fs.writeFileSync(archive.replace(/\.tar\.gz$/, `-db${ext}`), body);
  return archive;
}

test('a Restore of an ordinary DDEV project: started, then DDEV\'s own import of the .sql.gz beside the archive, as before', () => {
  const dir = sandbox();
  const p = ddevProject(dir, 'site', 'name: site\ntype: drupal11\n');
  const archive = backup(dir, 'site', { '.sql.gz': 'gz' });
  const r = run(dir, p, `restore_project_db "${archive}"`);
  assert.deepStrictEqual(r.calls, ['ddev start -y', `ddev import-db --file=${archive.replace(/\.tar\.gz$/, '-db.sql.gz')}`]);
  assert.match(r.out, /Importing database…/);
  assert.strictEqual(r.status, 0);
  // The cases the restore has always had (#354): a .sql when there is no .sql.gz; an empty dump named, not imported; an
  // empty .sql.gz does not hide a .sql that has the database; no dump at all: started, nothing imported, nothing said.
  const sql = backup(dir, 'site2', { '.sql': '-- sql' });
  assert.deepStrictEqual(run(dir, p, `restore_project_db "${sql}"`).calls, ['ddev start -y', `ddev import-db --file=${sql.replace(/\.tar\.gz$/, '-db.sql')}`]);
  const empty = backup(dir, 'site3', { '.sql.gz': '' });
  const e = run(dir, p, `restore_project_db "${empty}"`);
  assert.deepStrictEqual(e.calls, ['ddev start -y'], 'started, and nothing imported');
  assert.match(e.out, /dev---site3--2026-11-27_10-00-00-db\.sql\.gz is empty: the project had no database to export when it was backed up, so there is none to import\./);
  const both = backup(dir, 'site4', { '.sql.gz': '', '.sql': '-- sql' });
  assert.deepStrictEqual(run(dir, p, `restore_project_db "${both}"`).calls, ['ddev start -y', `ddev import-db --file=${both.replace(/\.tar\.gz$/, '-db.sql')}`]);
  // No dump at all beside the archive of a project with a database: started, and the Restore says it did not finish.
  const none = backup(dir, 'site5', {});
  const n = run(dir, p, `restore_project_db "${none}"`);
  assert.deepStrictEqual(n.calls, ['ddev start -y'], 'started, nothing imported');
  assert.strictEqual(n.status, 1);
  assert.match(n.out, /The Restore did not finish: no dump of the project's database is beside dev---site5--2026-11-27_10-00-00\.tar\.gz that this workspace can read, so the project is back on an empty database\./);
  // A project with no database: its folder is the whole of it, started, nothing said.
  const nodb = ddevProject(dir, 'nodb', 'name: nodb\ntype: generic\nomit_containers: [db]\n');
  const n2 = run(dir, nodb, `restore_project_db "${backup(dir, 'nodb', {})}"`);
  assert.strictEqual(n2.status, 0, n2.out);
  assert.deepStrictEqual(n2.calls, ['ddev start -y']);
  assert.doesNotMatch(n2.out, /Importing|empty|beside the archive|did not finish/);
  // A project that does not start: the Restore says what it did not put back.
  const failing = sandbox();
  fs.writeFileSync(path.join(failing, 'bin', 'ddev'), `#!/usr/bin/env bash\necho "ddev $*" >> "${failing}/calls.log"\n[ "$1" = start ] && exit 1\nexit 0\n`, { mode: 0o755 });
  const fp = ddevProject(failing, 'site', 'name: site\ntype: drupal11\n');
  const fa = backup(failing, 'site', { '.sql.gz': 'gz' });
  const f = run(failing, fp, `sleep() { echo "sleep $1" >> "${failing}/calls.log" ; } ; restore_project_db "${fa}"`);
  assert.strictEqual(f.status, 1);
  assert.deepStrictEqual(f.calls, ['ddev start -y', 'sleep 20', 'ddev start -y'], 'started again once, after a wait; nothing imported into a project that did not start');
  assert.match(f.out, /The project did not start at once; it is started again in 20 seconds, in case another start of it was running at the same moment\./);
  assert.match(f.out, /The Restore did not finish: the project did not start, so its database was not put back from dev---site--2026-11-27_10-00-00-db\.sql\.gz\./);
  // A start that fails once (another start of the project at the same moment) and goes through the second time: the
  // import comes after it, and the Restore finishes.
  const once = sandbox();
  fs.writeFileSync(path.join(once, 'bin', 'ddev'), `#!/usr/bin/env bash\necho "ddev $*" >> "${once}/calls.log"\nif [ "$1" = start ] && [ ! -f "${once}/started" ] ; then : > "${once}/started" ; exit 1 ; fi\nexit 0\n`, { mode: 0o755 });
  const op = ddevProject(once, 'site', 'name: site\ntype: drupal11\n');
  const oa = backup(once, 'site', { '.sql.gz': 'gz' });
  const o = run(once, op, `sleep() { echo "sleep $1" >> "${once}/calls.log" ; } ; restore_project_db "${oa}"`);
  assert.strictEqual(o.status, 0, o.out);
  assert.deepStrictEqual(o.calls, ['ddev start -y', 'sleep 20', 'ddev start -y', `ddev import-db --file=${oa.replace(/\.tar\.gz$/, '-db.sql.gz')}`]);
  assert.match(o.out, /Restored: the project and its database from dev---site--2026-11-27_10-00-00\.tar\.gz\./);
});

test('a Restore of a platform that keeps its database on DDEV: its own dump, read by its plugin, never DDEV\'s import', () => {
  const dir = sandbox();
  const p = ddevProject(dir, 'fapp', 'name: fapp\ntype: generic\nomit_containers: [db]\n', { 'config.fakep.yaml': '# the fake platform\n' });
  // Its own extension (FastAPI's .dump, Wekan's .archive.gz).
  const own = backup(dir, 'fapp', { '.fakedump': 'FAKE DUMP of fapp' });
  const r = run(dir, p, `restore_project_db "${own}"`);
  assert.deepStrictEqual(r.calls, ['ddev start -y', `fake import ${own.replace(/\.tar\.gz$/, '-db.fakedump')}`]);
  assert.strictEqual(r.status, 0);
  // A plugin whose dumps are gzipped SQL (Immich's): the .sql.gz goes to the plugin, not to DDEV's omitted database.
  const sqlgz = backup(dir, 'fapp2', { '.sql.gz': 'FAKE DUMP of fapp' });
  const g = run(dir, p, `unset -f fakep_db_extension ; restore_project_db "${sqlgz}"`);
  assert.deepStrictEqual(g.calls, ['ddev start -y', `fake import ${sqlgz.replace(/\.tar\.gz$/, '-db.sql.gz')}`]);
  // The plugin's own dump comes before the SQL forms; a .sql.gz of a backup made before the plugin kept the database
  // still restores, through the plugin, which reads both.
  const older = backup(dir, 'fapp3', { '.sql.gz': 'FAKE DUMP of fapp' });
  assert.deepStrictEqual(run(dir, p, `restore_project_db "${older}"`).calls, ['ddev start -y', `fake import ${older.replace(/\.tar\.gz$/, '-db.sql.gz')}`]);
  // An import the plugin refuses fails the restore, and says why.
  const half = backup(dir, 'fapp4', { '.fakedump': 'half' });
  const bad = run(dir, p, `restore_project_db "${half}" ; echo "status=$?"`);
  assert.match(bad.out, /not a whole fake dump/);
  assert.match(bad.out, /status=1/);
});

test('a Restore of a platform that keeps its database on another runtime: the same path, the runtime\'s start', () => {
  const dir = sandbox();
  const p = path.join(dir, 'dock');
  fs.mkdirSync(p);
  fs.writeFileSync(path.join(p, 'compose.yaml'), 'name: dock\nx-webship:\n  runtime: docker\n  platform: fakep\n  stack: generic\n  database: none\n  port: 41999\nservices:\n  web:\n    image: x\n');
  const archive = backup(dir, 'dock', { '.fakedump': 'FAKE DUMP of dock' });
  const r = run(dir, p, `restore_project_db "${archive}"`);
  assert.ok(r.calls.length >= 2, r.out);
  assert.match(r.calls[0], /^docker compose /, 'started by its runtime');
  assert.strictEqual(r.calls[r.calls.length - 1], `fake import ${archive.replace(/\.tar\.gz$/, '-db.fakedump')}`);
  assert.ok(!r.calls.some((c) => /^ddev /.test(c)), 'DDEV is never asked');
});

test('a Restore whose dump only a plugin reads, with no plugin to keep the database: started, and the dump named for the row\'s Import', () => {
  const dir = sandbox();
  const p = ddevProject(dir, 'fapp', 'name: fapp\ntype: generic\nomit_containers: [db]\n', { 'config.fakep.yaml': '# the fake platform\n' });
  const archive = backup(dir, 'fapp', { '.fakedump': 'FAKE DUMP of fapp' });
  const r = run(dir, p, `restore_project_db "${archive}"`, { plugin: false });
  assert.deepStrictEqual(r.calls, ['ddev start -y'], 'nothing imported into a database the project omits');
  assert.match(r.out, /dev---fapp--2026-11-27_10-00-00-db\.fakedump is beside the archive, but no plugin of this workspace keeps this project's database: add the plugin of its platform, then import it from the row's menu\./);
});

test('project-db.sh restore: a folder that is not a project is only put back; a project is started and its dump imported', () => {
  const dir = sandbox();
  // A scripts folder whose bootstrap loads the layer, the database functions and the fake platform, as the workspace's does.
  const scripts = path.join(dir, 'scripts');
  fs.mkdirSync(path.join(scripts, 'functions'), { recursive: true });
  fs.copyFileSync(path.join(SCRIPTS, 'project-db.sh'), path.join(scripts, 'project-db.sh'));
  fs.writeFileSync(path.join(scripts, 'bootstrap.sh'), `RT_STACKS=${STACKS}; source ${SCRIPTS}/functions/fun-runtime.sh; source ${SCRIPTS}/functions/fun-project-db.sh; RT_STACKS=${STACKS};\n${FAKEP}\n`);
  const verb = (cwd, archive) => {
    const log = path.join(dir, 'calls.log');
    const r = spawnSync('bash', [path.join(scripts, 'project-db.sh'), 'restore', archive],
      { cwd, encoding: 'utf8', env: { ...process.env, PATH: `${dir}/bin:${process.env.PATH}`, WORKSPACE_SCRIPTS: scripts, WORKSPACE_ROOT: path.join(SCRIPTS, '..', '..'), CALLS: log } });
    const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : [];
    if (fs.existsSync(log)) fs.unlinkSync(log);
    return { out: r.stdout + r.stderr, calls, status: r.status };
  };
  const plain = path.join(dir, 'notes');
  fs.mkdirSync(plain);
  const archive = backup(dir, 'notes', { '.sql.gz': 'gz' });
  const r = verb(plain, archive);
  assert.strictEqual(r.status, 0);
  assert.deepStrictEqual(r.calls, []);
  assert.match(r.out, /notes is back, but it is not a project of the workspace .*: nothing was started or imported\./);
  assert.match(r.out, /Its dump is beside the archive: dev---notes--2026-11-27_10-00-00-db\.sql\.gz\./);
  const p = ddevProject(dir, 'fapp', 'name: fapp\ntype: generic\nomit_containers: [db]\n', { 'config.fakep.yaml': '# the fake platform\n' });
  const own = backup(dir, 'fapp', { '.fakedump': 'FAKE DUMP of fapp' });
  const v = verb(p, own);
  assert.strictEqual(v.status, 0, v.out);
  assert.deepStrictEqual(v.calls, ['ddev start -y', `fake import ${own.replace(/\.tar\.gz$/, '-db.fakedump')}`]);
  assert.match(verb(p, '').out, /Usage: bash project-db\.sh restore <archive>/);
});

// DDEV's import of a database on PostgreSQL (#968): DDEV drops the database first, which PostgreSQL refuses while an
// application is connected. The core closes it to new connections and ends its sessions first, and opens it again
// after, whatever the import did. MariaDB and MySQL go to DDEV as before.
const CLOSE = 'ddev psql -d postgres -q -c ALTER DATABASE db WITH ALLOW_CONNECTIONS false';
const END = "ddev psql -d postgres -tA -c SELECT count(pg_terminate_backend(pid)) FROM pg_stat_activity WHERE datname = 'db' AND pid <> pg_backend_pid()";
const OPEN = 'ddev psql -d postgres -q -c ALTER DATABASE db WITH ALLOW_CONNECTIONS true';
/** A stand-in ddev whose import ends with IMPORT_RC (0 by default), and whose session query says 3. */
function pgSandbox() {
  const dir = sandbox();
  fs.writeFileSync(path.join(dir, 'bin', 'ddev'), `#!/usr/bin/env bash\necho "ddev $*" >> "${dir}/calls.log"\n[ -t 0 ] || cat > /dev/null\ncase "$1 $*" in\n  "import-db "*) exit "\${IMPORT_RC:-0}" ;;\n  psql*pg_terminate_backend*) echo 3 ;;\nesac\nexit 0\n`, { mode: 0o755 });
  return dir;
}

test('DDEV on PostgreSQL: the database is closed and its sessions ended before DDEV\'s import, and opened again after (#968)', () => {
  const dir = pgSandbox();
  for (const [name, config] of [
    ['blk', 'name: blk\ntype: generic\ndatabase:\n    type: postgres\n    version: "15"\n'],
    ['flow', 'name: flow\ntype: generic\ndatabase: {type: postgres, version: "17"}\n'],
  ]) {
    const p = ddevProject(dir, name, config);
    assert.strictEqual(run(dir, p, 'rt_ddev_db_type', { plugin: false }).out.trim(), 'postgres', name);
    // Every way the core imports on DDEV: the runtime layer's ddev, import_project_db, and a Restore from the backups.
    const file = `${dir}/x.sql.gz`;
    for (const line of [`ddev import-db --file=${file}`, `import_project_db /etc/hostname`]) {
      const r = run(dir, p, line, { plugin: false });
      assert.strictEqual(r.status, 0, `${name}: ${line}: ${r.out}`);
      const f = line.startsWith('ddev') ? file : '/etc/hostname';
      assert.deepStrictEqual(r.calls, [CLOSE, END, `ddev import-db --file=${f}`, OPEN], `${name}: ${line}`);
      assert.match(r.out, /The database db is closed to new connections, and its open sessions are ended \(3\): DDEV's import drops it, which PostgreSQL refuses while an application is connected\./);
    }
    // A Restore: started, the import, then started again, so the application starts on the database the backup holds.
    const archive = backup(dir, name, { '.sql.gz': 'gz' });
    const restore = run(dir, p, `restore_project_db "${archive}"`, { plugin: false });
    assert.deepStrictEqual(restore.calls, ['ddev start -y', CLOSE, END, `ddev import-db --file=${archive.replace(/\.tar\.gz$/, '-db.sql.gz')}`, OPEN, 'ddev restart'], `${name}: the Restore`);
    assert.match(restore.out, /Starting the project again, so its application starts on the database the backup holds…/);
  }
});

test('DDEV on PostgreSQL: a dump DDEV refuses leaves the database open, and the import\'s code is DDEV\'s (#968)', () => {
  const dir = pgSandbox();
  const p = ddevProject(dir, 'pg', 'name: pg\ntype: generic\ndatabase:\n  type: postgres\n  version: "12"\n');
  // DDEV checks a dump before it drops anything: one it cannot read (cut short) ends with 255, the old database there.
  const r = spawnSync('bash', ['-c', `RT_STACKS=${STACKS}; source ${SCRIPTS}/functions/fun-runtime.sh; source ${SCRIPTS}/functions/fun-project-db.sh; ddev import-db --file=${dir}/cut.sql.gz`],
    { cwd: p, encoding: 'utf8', env: { ...process.env, PATH: `${dir}/bin:${process.env.PATH}`, IMPORT_RC: '255' } });
  const calls = fs.readFileSync(path.join(dir, 'calls.log'), 'utf8').trim().split('\n');
  assert.strictEqual(r.status, 255, 'DDEV\'s own code');
  assert.deepStrictEqual(calls, [CLOSE, END, `ddev import-db --file=${dir}/cut.sql.gz`, OPEN], 'opened again after the refusal');
  assert.match(r.stderr, /The import did not succeed: the database db is open again, as it was before the import\./);
  // In a Restore the project is not started again after a refused import: the Restore ends with the import's code.
  const archive = backup(dir, 'pg', { '.sql.gz': 'gz' });
  const rr = spawnSync('bash', ['-c', `RT_STACKS=${STACKS}; source ${SCRIPTS}/functions/fun-runtime.sh; source ${SCRIPTS}/functions/fun-project-db.sh; restore_project_db "${archive}"`],
    { cwd: p, encoding: 'utf8', env: { ...process.env, PATH: `${dir}/bin:${process.env.PATH}`, IMPORT_RC: '255' } });
  assert.strictEqual(rr.status, 255);
  assert.doesNotMatch(fs.readFileSync(path.join(dir, 'calls.log'), 'utf8'), /ddev restart/);
});

test('DDEV on MariaDB or MySQL, an import with --no-drop or into another database: DDEV\'s import as before (#968)', () => {
  const dir = pgSandbox();
  for (const [name, config] of [
    ['maria', 'name: maria\ntype: drupal11\n'],
    ['maria2', 'name: maria2\ntype: drupal11\ndatabase:\n    type: mariadb\n    version: "10.11"\n'],
    ['my', 'name: my\ntype: php\ndatabase: {type: mysql, version: "8.0"}\n'],
  ]) {
    const p = ddevProject(dir, name, config);
    const r = run(dir, p, `ddev import-db --file=${dir}/x.sql.gz && import_project_db /etc/hostname`, { plugin: false });
    assert.strictEqual(r.status, 0, name);
    assert.deepStrictEqual(r.calls, [`ddev import-db --file=${dir}/x.sql.gz`, 'ddev import-db --file=/etc/hostname'], `${name}: no psql`);
  }
  const p = ddevProject(dir, 'pgx', 'name: pgx\ntype: generic\ndatabase:\n    type: postgres\n    version: "15"\n');
  for (const args of ['--no-drop --file=/etc/hostname', '--database=other --file=/etc/hostname', '-d other --file=/etc/hostname']) {
    assert.deepStrictEqual(run(dir, p, `ddev import-db ${args}`, { plugin: false }).calls, [`ddev import-db ${args}`], args);
  }
  // A config.*.yaml after config.yaml says the type as DDEV reads it.
  const o = ddevProject(dir, 'over', 'name: over\ntype: generic\n', { 'config.postgres.yaml': 'database:\n  type: postgres\n  version: "16"\n' });
  assert.strictEqual(run(dir, o, 'rt_ddev_db_type', { plugin: false }).out.trim(), 'postgres');
});

test('DDEV on PostgreSQL with a plugin that keeps the database: the plugin\'s import, as before (#937, #968)', () => {
  const dir = pgSandbox();
  const p = ddevProject(dir, 'fpg', 'name: fpg\ntype: generic\ndatabase:\n  type: postgres\n  version: "15"\n', { 'config.fakep.yaml': '# the fake platform\n' });
  fs.writeFileSync(path.join(dir, 'dump.fakedump'), 'FAKE DUMP of fpg');
  const r = run(dir, p, `import_project_db ${dir}/dump.fakedump`);
  assert.strictEqual(r.status, 0, r.out);
  assert.deepStrictEqual(r.calls, [`fake import ${dir}/dump.fakedump`], 'the plugin wins');
});

test('project-db.sh import: the row\'s Import goes through import_project_db, the core\'s steps on DDEV\'s PostgreSQL (#968)', () => {
  const dir = pgSandbox();
  const scripts = path.join(dir, 'scripts');
  fs.mkdirSync(path.join(scripts, 'functions'), { recursive: true });
  fs.copyFileSync(path.join(SCRIPTS, 'project-db.sh'), path.join(scripts, 'project-db.sh'));
  fs.writeFileSync(path.join(scripts, 'bootstrap.sh'), `RT_STACKS=${STACKS}; source ${SCRIPTS}/functions/fun-runtime.sh; source ${SCRIPTS}/functions/fun-project-db.sh; RT_STACKS=${STACKS};\n${FAKEP}\n`);
  const verb = (cwd, ...args) => {
    const log = path.join(dir, 'calls.log');
    const r = spawnSync('bash', [path.join(scripts, 'project-db.sh'), 'import', ...args],
      { cwd, encoding: 'utf8', env: { ...process.env, PATH: `${dir}/bin:${process.env.PATH}`, WORKSPACE_SCRIPTS: scripts, WORKSPACE_ROOT: path.join(SCRIPTS, '..', '..'), CALLS: log } });
    const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : [];
    if (fs.existsSync(log)) fs.unlinkSync(log);
    return { out: r.stdout + r.stderr, calls, status: r.status };
  };
  const pg = ddevProject(dir, 'pgs', 'name: pgs\ntype: generic\ndatabase:\n  type: postgres\n  version: "15"\n');
  const r = verb(pg, '/etc/hostname');
  assert.strictEqual(r.status, 0, r.out);
  assert.deepStrictEqual(r.calls, [CLOSE, END, 'ddev import-db --file=/etc/hostname', OPEN]);
  const maria = ddevProject(dir, 'mar', 'name: mar\ntype: drupal11\n');
  assert.deepStrictEqual(verb(maria, '/etc/hostname').calls, ['ddev import-db --file=/etc/hostname'], 'MariaDB: as before');
  assert.match(verb(pg).out, /Usage: bash project-db\.sh import <dump>/);
  const notes = path.join(dir, 'notes');
  fs.mkdirSync(notes);
  const n = verb(notes, '/etc/hostname');
  assert.notStrictEqual(n.status, 0);
  assert.deepStrictEqual(n.calls, []);
  assert.match(n.out, /notes is not a project of the workspace: nothing was imported\./);
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
