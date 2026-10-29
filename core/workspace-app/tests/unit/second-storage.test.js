/**
 * Second storage: whole workspace folders on another disk, each a symlink from the tree.
 *
 * What matters is that nothing is lost: a move swaps only after a checksum compare, keeps the original,
 * refuses what it cannot do safely (DDEV projects, no room, a non-empty target), and the dashboard still
 * serves files from a workspace that is a symlink while refusing a link that leads out of it.
 */

const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const fb = require('../../files-browser');

const ROOT = path.join(__dirname, '..', '..', '..', '..');
const FUN = path.join(ROOT, 'core', 'scripts', 'functions', 'fun-storage.sh');
const ARGS = path.join(ROOT, 'core', 'scripts', 'args', 'arg-storage.sh');
const CMD = path.join(ROOT, 'core', 'scripts', 'storage.sh');
const SYNC = path.join(ROOT, 'core', 'scripts', 'sync-tooling.sh');

/** A workspace root and a "drive", both in a temp dir. The drive counts as its own filesystem. */
function fixture(storage) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-storage-'));
  const root = path.join(base, 'workspace');
  const drive = path.join(base, 'drive', 'workspace');
  fs.mkdirSync(path.join(root, 'videos', 'clips'), { recursive: true });
  fs.writeFileSync(path.join(root, 'videos', 'a.mp4'), 'video bytes');
  fs.writeFileSync(path.join(root, 'videos', 'clips', 'b.mp4'), 'more bytes');
  fs.mkdirSync(path.join(root, 'dev', 'site1', '.ddev'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dev', 'site1', '.ddev', 'config.yaml'), 'name: site1\n');
  fs.mkdirSync(drive, { recursive: true });
  return { base, root, drive, storage: storage === undefined ? drive : storage };
}

/** Run bash with the functions loaded against the fixture. `prelude` can redefine a function. */
function sh(fx, snippet, prelude = 'function storage_same_fs() { return 1 ; } ; function storage_avail_bytes() { echo 999999999999 ; }') {
  const script = [
    `source ${JSON.stringify(FUN)}`,
    `WORKSPACE_ROOT=${JSON.stringify(fx.root)}`,
    'WORKSPACE_SCRIPTS=/x/core/scripts',
    'workspaces=(dev videos docs)',
    `storage_second=${JSON.stringify(JSON.stringify(fx.storage))}`,
    'STORAGE_RSYNC_FLAGS=-aH',
    prelude,
    snippet,
  ].join('\n');
  const r = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
  return { code: r.status, out: (r.stdout + r.stderr).trim() };
}

test('the shell files are valid, and storage.sh is in the smoke test', () => {
  for (const f of [FUN, ARGS, CMD, SYNC]) assert.strictEqual(spawnSync('bash', ['-n', f]).status, 0, f);
  const smoke = fs.readFileSync(path.join(ROOT, 'core/scripts/tests/cmd-smoke-test.sh'), 'utf8');
  assert.match(smoke, /MACHINE_SCRIPTS=\([^)]*\bstorage\.sh\b/);
  const boot = fs.readFileSync(path.join(ROOT, 'core/scripts/bootstrap-functions.sh'), 'utf8');
  assert.match(boot, /functions\/fun-storage\.sh/);
});

test('the committed settings ship no machine path', () => {
  const yml = fs.readFileSync(path.join(ROOT, 'core/config/settings.yml'), 'utf8');
  assert.match(yml, /^storage:\n {2}second: ""$/m);
  const ignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  assert.match(ignore, /^core\/workspace-app\/\.ddev\/docker-compose\.second-storage\.yaml$/m);
});

test('the path is read with parse_yaml quotes stripped, and empty means none', () => {
  const fx = fixture('');
  try {
    assert.strictEqual(sh(fx, 'storage_path').out, '');
    assert.strictEqual(sh({ ...fx, storage: '/mnt/x/workspace/' }, 'storage_path').out, '/mnt/x/workspace');
  } finally { fs.rmSync(fx.base, { recursive: true, force: true }); }
});

test('a move copies, verifies, swaps to a symlink and keeps the original', () => {
  const fx = fixture();
  try {
    const r = sh(fx, 'storage_move videos');
    assert.strictEqual(r.code, 0, r.out);
    const link = path.join(fx.root, 'videos');
    assert.ok(fs.lstatSync(link).isSymbolicLink());
    assert.strictEqual(fs.readlinkSync(link), path.join(fx.drive, 'videos'));
    assert.strictEqual(fs.readFileSync(path.join(link, 'clips', 'b.mp4'), 'utf8'), 'more bytes');
    assert.ok(fs.existsSync(path.join(fx.root, 'videos.pre-move', 'a.mp4')), 'the original is kept');
    assert.strictEqual(sh(fx, 'storage_state videos').out, 'second');
    assert.match(sh(fx, 'storage_status').out, /videos\s+second storage/);
    assert.match(sh(fx, 'storage_status').out, /videos\.pre-move kept locally/);
  } finally { fs.rmSync(fx.base, { recursive: true, force: true }); }
});

test('the pre-move copy goes only on request, and only while the link works', () => {
  const fx = fixture();
  try {
    assert.strictEqual(sh(fx, 'storage_move videos').code, 0);
    // Drive gone: the kept copy may be the only one.
    fs.renameSync(fx.drive, fx.drive + '-away');
    assert.strictEqual(sh(fx, 'storage_state videos').out, 'broken');
    assert.strictEqual(sh(fx, 'storage_remove_pre_move videos').code, 1);
    assert.ok(fs.existsSync(path.join(fx.root, 'videos.pre-move')));
    fs.renameSync(fx.drive + '-away', fx.drive);
    assert.strictEqual(sh(fx, 'storage_remove_pre_move videos').code, 0);
    assert.ok(!fs.existsSync(path.join(fx.root, 'videos.pre-move')));
  } finally { fs.rmSync(fx.base, { recursive: true, force: true }); }
});

test('back makes it a local folder again and keeps the drive copy', () => {
  const fx = fixture();
  try {
    assert.strictEqual(sh(fx, 'storage_move videos').code, 0);
    fs.writeFileSync(path.join(fx.root, 'videos', 'new.mp4'), 'made on the drive');
    const r = sh(fx, 'storage_back videos');
    assert.strictEqual(r.code, 0, r.out);
    const dir = path.join(fx.root, 'videos');
    assert.ok(!fs.lstatSync(dir).isSymbolicLink());
    assert.strictEqual(fs.readFileSync(path.join(dir, 'new.mp4'), 'utf8'), 'made on the drive');
    assert.ok(!fs.existsSync(path.join(fx.root, 'videos.pre-move')), 'the kept copy became the folder');
    assert.ok(fs.existsSync(path.join(fx.drive, 'videos', 'a.mp4')), 'nothing on the drive is deleted');
  } finally { fs.rmSync(fx.base, { recursive: true, force: true }); }
});

test('refused: DDEV projects, no room, a non-empty target, the same filesystem, not a workspace', () => {
  const fx = fixture();
  try {
    let r = sh(fx, 'storage_move dev');
    assert.strictEqual(r.code, 1); assert.match(r.out, /holds DDEV projects/);

    r = sh(fx, 'storage_move videos', 'function storage_same_fs() { return 1 ; } ; function storage_avail_bytes() { echo 1000 ; }');
    assert.strictEqual(r.code, 1); assert.match(r.out, /Not enough room/);

    r = sh(fx, 'storage_move videos', 'function storage_avail_bytes() { echo 999999999999 ; }');
    assert.strictEqual(r.code, 1); assert.match(r.out, /not mounted on its own filesystem/);

    fs.mkdirSync(path.join(fx.drive, 'videos'));
    fs.writeFileSync(path.join(fx.drive, 'videos', 'old.mp4'), 'an older copy');
    r = sh(fx, 'storage_move videos');
    assert.strictEqual(r.code, 1); assert.match(r.out, /already holds files/);
    assert.strictEqual(fs.readFileSync(path.join(fx.drive, 'videos', 'old.mp4'), 'utf8'), 'an older copy');

    r = sh(fx, 'storage_move core');
    assert.strictEqual(r.code, 1); assert.match(r.out, /not a workspace/);

    assert.ok(fs.lstatSync(path.join(fx.root, 'videos')).isDirectory(), 'every refusal left the folder alone');
  } finally { fs.rmSync(fx.base, { recursive: true, force: true }); }
});

test('a copy that differs is never swapped in', () => {
  const fx = fixture();
  try {
    const r = sh(fx, 'storage_move videos', 'function storage_same_fs() { return 1 ; } ; function storage_avail_bytes() { echo 999999999999 ; } ; function storage_diff() { echo ">f.st...... a.mp4" ; }');
    assert.strictEqual(r.code, 1); assert.match(r.out, /differs from the source/);
    assert.ok(!fs.lstatSync(path.join(fx.root, 'videos')).isSymbolicLink());
  } finally { fs.rmSync(fx.base, { recursive: true, force: true }); }
});

test('relink follows the drive to a new mount point', () => {
  const fx = fixture();
  try {
    assert.strictEqual(sh(fx, 'storage_move videos').code, 0);
    const moved = path.join(fx.base, 'fixed', 'workspace');
    fs.mkdirSync(path.dirname(moved), { recursive: true });
    fs.renameSync(fx.drive, moved);
    const r = sh({ ...fx, storage: moved }, 'storage_relink');
    assert.strictEqual(r.code, 0, r.out);
    assert.strictEqual(fs.readlinkSync(path.join(fx.root, 'videos')), path.join(moved, 'videos'));
  } finally { fs.rmSync(fx.base, { recursive: true, force: true }); }
});

test('the dashboard mounts: the media parent with rslave under /run/media, the path itself elsewhere', () => {
  const fx = fixture('/run/media/someone/workspace1/workspace');
  try {
    // A link left on the old udisks name is covered by the same parent mount.
    fs.renameSync(path.join(fx.root, 'videos'), path.join(fx.base, 'gone'));
    fs.symlinkSync('/run/media/someone/workspace/workspace/videos', path.join(fx.root, 'videos'));
    const yml = sh(fx, 'storage_compose').out;
    assert.match(yml, /^ {6}- \/run\/media\/someone:\/run\/media\/someone:rslave$/m);
    assert.strictEqual((yml.match(/^ {6}- /gm) || []).length, 1, 'one mount covers both names');
    assert.match(yml, /^services:\n {2}web:\n {4}volumes:$/m);

    const other = sh({ ...fx, storage: '/mnt/workspace/workspace' }, 'storage_mount_sources').out.split('\n');
    assert.deepStrictEqual(other, ['/mnt/workspace/workspace', '/run/media/someone']);
    assert.strictEqual(sh(fixture(''), 'storage_compose').out, '', 'nothing set, nothing linked: no file');
  } finally { fs.rmSync(fx.base, { recursive: true, force: true }); }
});

test('under /run/media the stable fstab fix is printed, by UUID, and never run', () => {
  const src = fs.readFileSync(FUN, 'utf8');
  assert.match(src, /UUID=\$\{uuid\}\s+\$\{point\}/);
  assert.match(src, /nofail/);
  assert.doesNotMatch(src.replace(/^\s*echo .*$/gm, ''), /\bsudo\b/, 'sudo appears only in printed advice');
});

test('the dashboard serves files from a workspace that is a symlink, and still refuses links out', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-files-link-'));
  try {
    const drive = path.join(base, 'drive', 'videos');
    const secrets = path.join(base, 'secrets');
    fs.mkdirSync(path.join(drive, 'sub'), { recursive: true });
    fs.mkdirSync(secrets);
    fs.writeFileSync(path.join(drive, 'sub', 'a.mp4'), 'x');
    fs.writeFileSync(path.join(secrets, 'key'), 'k');
    fs.symlinkSync(secrets, path.join(drive, 'escape'));
    const root = path.join(base, 'workspace', 'videos');
    fs.mkdirSync(path.dirname(root));
    fs.symlinkSync(drive, root);

    assert.strictEqual(fb.realFileIn(root, 'sub/a.mp4'), path.join(fs.realpathSync(drive), 'sub', 'a.mp4'));
    assert.strictEqual(fb.realFileIn(root, 'escape/key'), '', 'a link out of the drive copy is refused');
    assert.strictEqual(fb.realFileIn(root, 'sub'), '', 'a folder is not a file');
    assert.strictEqual(fb.realFileIn(root, 'nope.mp4'), '');
    assert.strictEqual(fb.safeSubIn(root, 'sub').ok, true, 'browsing a subfolder works');
    assert.strictEqual(fb.safeSubIn(root, 'escape').ok, false);

    const server = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');
    assert.match(server, /filesBrowser\.realFileIn\(workspaceDir\(fileMatch\[1\]\), name\)/, '/files uses the tested check');
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});
