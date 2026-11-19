/**
 * A step pack given as a tarball or a folder (webship/workspace#491), to prove it on a real project
 * before it is on npm: the tarball is copied into the project's tests/step-packs/, where its container
 * sees it, the dependency is `file:tests/step-packs/<name>-<version>-<hash>.tgz`, and --remove-steps
 * takes both out again. A name, scoped or not, stays a name.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { ROOT } = require('../../workspaces');
const sp = require(path.join(ROOT, 'core', 'scripts', 'libs', 'step_packs'));

const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

const SCAFFOLD = `module.exports = {
  default: {
    require: [
      'node_modules/webship-js/tests/step-definitions/**/*.js',          // Webship-js core step definitions.
      'tests/step-definitions/**/*.js',                                  // Your custom step definitions.
    ],
    paths: ['tests/features/**/*.feature'],
  },
};
`;
const PACKAGE = '{\n  "name": "project-name",\n  "dependencies": {\n    "webship-js": "~2.0.0"\n  }\n}\n';

function project({ pkg = PACKAGE } = {}) {
  const dir = tmp('ws-local-project-');
  fs.mkdirSync(path.join(dir, 'tests', 'features'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'cucumber.js'), SCAFFOLD);
  fs.writeFileSync(path.join(dir, 'package.json'), pkg);
  return dir;
}

/** The folder of a pack: package.json, README and a step file. */
function packFolder({ name = '@webship-js/demo-steps', version = '2.0.0', step = '// steps\n' } = {}) {
  const dir = tmp('ws-local-pack-');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version, files: ['tests', 'README.md'] }));
  fs.writeFileSync(path.join(dir, 'README.md'), `require: ['node_modules/${name}/tests/step-definitions/**/*.js']\n`);
  fs.mkdirSync(path.join(dir, 'tests', 'step-definitions'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'tests', 'step-definitions', 'demo.steps.js'), step);
  return dir;
}

/** The tarball npm pack makes of a folder: everything under package/. */
function tarball(dir) {
  const stage = tmp('ws-local-stage-');
  fs.cpSync(dir, path.join(stage, 'package'), { recursive: true });
  const file = path.join(tmp('ws-local-tgz-'), 'pack.tgz');
  const r = spawnSync('tar', ['-czf', file, '-C', stage, 'package']);
  assert.strictEqual(r.status, 0, String(r.stderr));
  return file;
}

const add = (dir, local) => sp.addPack(dir, sp.describePack({ name: local.name, version: local.version }), { readme: local.readme, local });

test('a name, scoped or not, is a name; a path is read as a pack, or refused with the reason', () => {
  for (const name of ['diffy', 'wordpress-steps', '@webship-js/diffy-steps']) assert.strictEqual(sp.localPack(name), null, name);
  assert.match(sp.localPack('./no-such-pack.tgz').error, /no such file or folder/);
  const notPack = packFolder({ name: 'left-pad' });
  assert.match(sp.localPack(tarball(notPack)).error, /not a webship-js step pack \(its package\.json names left-pad/);
  const plain = tmp('ws-local-plain-');
  assert.match(sp.localPack(plain).error, /a folder with no package\.json is not a pack/);
  fs.writeFileSync(path.join(plain, 'notes.txt'), 'x');
  assert.match(sp.localPack(path.join(plain, 'notes.txt')).error, /give a \.tgz/);
});

test('a tarball: copied into tests/step-packs/, a file: dependency, the glob, and all of it taken out again', () => {
  const dir = project();
  const local = sp.localPack(tarball(packFolder()));
  assert.strictEqual(local.name, '@webship-js/demo-steps');
  assert.strictEqual(local.version, '2.0.0');
  assert.match(local.readme, /demo-steps\/tests\/step-definitions/);
  const r = add(dir, local);
  assert.ok(r.ok, r.error);
  const file = sp.localPackFile(local.name, local.version, local.source);
  assert.match(file, /^tests\/step-packs\/webship-js-demo-steps-2\.0\.0-[0-9a-f]{8}\.tgz$/);
  assert.ok(fs.existsSync(path.join(dir, ...file.split('/'))), 'the tarball is in the project, where its container sees it');
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).devDependencies['@webship-js/demo-steps'], `file:${file}`);
  assert.match(fs.readFileSync(path.join(dir, 'cucumber.js'), 'utf8'), /node_modules\/@webship-js\/demo-steps\/tests\/step-definitions/);
  assert.ok(r.changed.some((c) => c.startsWith(`${file} (copied from `)), r.changed.join('\n'));

  const again = add(dir, sp.localPack(tarball(packFolder())));
  assert.ok(again.ok);
  assert.deepStrictEqual(again.changed, [], 'the same tarball again changes nothing');

  const gone = sp.removePack(dir, '@webship-js/demo-steps');
  assert.ok(gone.changed.includes(`${file} deleted`), gone.changed.join('\n'));
  assert.ok(!fs.existsSync(path.join(dir, 'tests', 'step-packs')), 'the folder goes with its last tarball');
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).devDependencies, undefined);
  assert.doesNotMatch(fs.readFileSync(path.join(dir, 'cucumber.js'), 'utf8'), /demo-steps/);
});

test('a rebuilt tarball replaces the one before it, so package.json changes and the caller installs again', () => {
  const dir = project();
  const first = sp.localPack(tarball(packFolder()));
  assert.ok(add(dir, first).ok);
  const before = sp.localPackFile(first.name, first.version, first.source);
  const rebuilt = sp.localPack(tarball(packFolder({ step: '// steps, rebuilt\n' })));
  const r = add(dir, rebuilt);
  assert.ok(r.ok, r.error);
  const after = sp.localPackFile(rebuilt.name, rebuilt.version, rebuilt.source);
  assert.notStrictEqual(after, before);
  assert.ok(r.changed.includes(`${before} deleted (replaced)`), r.changed.join('\n'));
  assert.ok(!fs.existsSync(path.join(dir, ...before.split('/'))));
  assert.ok(fs.existsSync(path.join(dir, ...after.split('/'))));
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).devDependencies['@webship-js/demo-steps'], `file:${after}`);
});

test('a tarball takes the place of a line a plugin\'s hook wrote, and --remove-steps puts that line back (#507)', () => {
  for (const where of ['devDependencies', 'dependencies']) {
    const pkg = `{\n  "name": "project-name",\n  "${where}": {\n    "@webship-js/demo-steps": "^2.0.0"\n  }\n}\n`;
    const dir = project({ pkg });
    const r = add(dir, sp.localPack(tarball(packFolder())));
    assert.ok(r.ok, r.error);
    assert.ok(r.notes.some((n) => n.includes(`package.json had @webship-js/demo-steps ^2.0.0 (${where}), which --add-steps did not write`)), r.notes.join('\n'));
    const after = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    assert.match(after[where]['@webship-js/demo-steps'], /^file:tests\/step-packs\//, `in ${where}, where the line was`);
    if (where === 'dependencies') assert.strictEqual(after.devDependencies, undefined, 'no second line in devDependencies');
    const gone = sp.removePack(dir, '@webship-js/demo-steps');
    assert.ok(gone.changed.includes(`package.json: @webship-js/demo-steps back to ^2.0.0 (${where}), as it was before the tarball`), gone.changed.join('\n'));
    assert.strictEqual(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'), pkg, 'package.json is back as it was');
    assert.ok(!fs.existsSync(path.join(dir, 'tests', 'step-packs')), 'and the tarball is gone');
  }
});

test('a folder is packed with npm first, then added the same way', { skip: spawnSync('npm', ['--version']).status !== 0 && 'npm is not on this machine' }, () => {
  const dir = project();
  const local = sp.localPack(packFolder());
  assert.ok(!local.error, local.error);
  assert.ok(local.packedIn && fs.existsSync(local.source), 'npm pack made the tarball in a temporary folder');
  const r = add(dir, local);
  assert.ok(r.ok, r.error);
  assert.ok(r.changed.some((c) => / \(copied from the folder, packed with npm pack\)$/.test(c)), r.changed.join('\n'));
  fs.rmSync(local.packedIn, { recursive: true, force: true });
});
