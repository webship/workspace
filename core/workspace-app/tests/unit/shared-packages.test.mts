/**
 * The packages the plugins share are brought to the newest version that fits (webship/workspace#650).
 *
 * A family's plugins (upsun, acquia, cpanel …) need their base (`@webship.co/workspace-hosting`) with `^1.0.2`. npm keeps
 * the copy its lock file holds while it still fits, so a workspace whose plugins were all on their latest versions
 * still ran workspace-hosting 1.0.2, with 1.0.10 on npm. `plugins.sh --require` and `webship-workspace update` now
 * `npm update` those shared packages.
 */

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const APP = path.join(import.meta.dirname, '..', '..');
const BIN = path.join(APP, '..', 'bin', 'workspace.js');
import { sharedPackages } from '../../shared-packages.mts';

const put = (file: string, json: unknown): void => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(json)); };
/** node_modules/@webship.co/<name>/package.json for each entry: name → dependencies. */
function modules(app: string, packages: Record<string, Record<string, string>>): void {
  for (const [name, deps] of Object.entries(packages)) put(path.join(app, 'node_modules', '@webship.co', name, 'package.json'), { name: `@webship.co/${name}`, version: '1.0.2', dependencies: deps });
}

test('the shared packages: a base an installed plugin needs, placed at the top, that the app does not ask for itself', () => {
  const app = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-shared-'));
  put(path.join(app, 'package.json'), { name: 'app', dependencies: { '@webship.co/workspace-upsun': '^1.0.0', '@webship.co/workspace-github': '^1.0.0', '@webship.co/workspace-jira': '^1.0.0', 'js-yaml': '^4' } });
  modules(app, {
    'workspace-upsun': { '@webship.co/workspace-hosting': '^1.0.2', 'some-lib': '^1' },
    'workspace-github': { '@webship.co/workspace-forge': '^1.0.2' },
    'workspace-jira': { '@webship.co/workspace-jira': '^1.0.0', '@webship.co/workspace-gone': '^1.0.0' },
    'workspace-hosting': {},
    'workspace-forge': {},
  });
  // workspace-jira is one the app asks for itself, and workspace-gone is not placed at the top: neither is shared.
  assert.deepStrictEqual(sharedPackages(app), ['@webship.co/workspace-forge', '@webship.co/workspace-hosting']);
  // The command line prints them on one line.
  const r = spawnSync(process.execPath, [path.join(APP, 'shared-packages.mts'), app], { encoding: 'utf8' });
  assert.strictEqual(r.stdout.trim(), '@webship.co/workspace-forge @webship.co/workspace-hosting');
  // No plugins, or no app: nothing.
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-shared-'));
  put(path.join(bare, 'package.json'), { name: 'app' });
  assert.deepStrictEqual(sharedPackages(bare), []);
  assert.deepStrictEqual(sharedPackages(path.join(bare, 'missing')), []);
});

test('webship-workspace update runs npm install, then npm update of the shared packages', () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ws-shared-update-')), 'workspace');
  const quiet = { ...process.env, WEBSHIP_WORKSPACE_SKIP_NPM: '1', WEBSHIP_WORKSPACE_SKIP_DDEV: '1', WORKSPACE_PLUGINS_NO_RESTART: '1' };
  assert.strictEqual(spawnSync(process.execPath, [BIN, 'init', dir], { encoding: 'utf8', env: quiet }).status, 0);
  const app = path.join(dir, 'core', 'workspace-app');
  const pkgFile = path.join(app, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
  pkg.dependencies = { ...(pkg.dependencies || {}), '@webship.co/workspace-upsun': '^1.0.0' };
  fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2));
  modules(app, { 'workspace-upsun': { '@webship.co/workspace-hosting': '^1.0.2' }, 'workspace-hosting': {} });
  // A stand-in npm that writes down how it was called.
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-shared-bin-'));
  const log = path.join(bin, 'npm.log');
  fs.writeFileSync(path.join(bin, 'npm'), `#!/bin/sh\necho "$*" >> ${JSON.stringify(log)}\nexit 0\n`, { mode: 0o755 });
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, WEBSHIP_WORKSPACE_SKIP_DDEV: '1', WORKSPACE_PLUGINS_NO_RESTART: '1' };
  delete env.WEBSHIP_WORKSPACE_SKIP_NPM;
  const u = spawnSync(process.execPath, [BIN, 'update', dir], { encoding: 'utf8', env });
  assert.strictEqual(u.status, 0, u.stderr);
  const calls = fs.readFileSync(log, 'utf8').trim().split('\n');
  assert.deepStrictEqual(calls.filter((c) => /^(install|update)\b/.test(c)), ['install --no-audit --no-fund', 'update --no-audit --no-fund @webship.co/workspace-hosting']);
  assert.match(u.stdout, /updating what the plugins share: @webship\.co\/workspace-hosting/);
  // With npm skipped, neither runs (the command check still asks npm its version).
  fs.writeFileSync(log, '');
  assert.strictEqual(spawnSync(process.execPath, [BIN, 'update', dir], { encoding: 'utf8', env: { ...env, WEBSHIP_WORKSPACE_SKIP_NPM: '1' } }).status, 0);
  assert.deepStrictEqual(fs.readFileSync(log, 'utf8').trim().split('\n').filter((c) => /^(install|update)\b/.test(c)), []);
});

test('plugins.sh --require updates the shared packages once npm has installed the plugin, before its needs are read', () => {
  const sh = fs.readFileSync(path.join(APP, '..', 'scripts', 'plugins.sh'), 'utf8');
  const step = sh.slice(sh.indexOf('  --require)'), sh.indexOf('  --activate)'));
  const install = step.indexOf('npm install --no-audit --no-fund "${name}"');
  const update = step.indexOf('npm update --no-audit --no-fund ${shared}');
  const needs = step.indexOf('What this package brought');
  assert.ok(install > 0 && update > install && needs > update, 'install, then the shared packages, then the needs');
  assert.match(step, /shared="\$\( cd "\$\{APP\}" && node shared-packages\.mts 2> \/dev\/null \)"/);
});
