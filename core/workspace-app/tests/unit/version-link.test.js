/**
 * The version in the rail links to its own release page.
 *
 * The one thing that must not drift: the URL comes from `sources: tooling:` in settings.yml, never a
 * hardcoded github.com/webship/workspace. A fork, a mirror or a self-hosted GitLab has to land on its
 * own release page — and nothing here should hardcode what configuration already knows.
 */

const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('fs');
const path = require('path');

const app = path.join(__dirname, '..', '..');
const server = fs.readFileSync(path.join(app, 'server.js'), 'utf8');
const { sourceOf, appVersion } = require(path.join(app, 'workspaces'));

test('the release URL is built from the configured source, not a hardcoded repo', () => {
  const row = versionEntry();
  assert.match(row, /sourceOf\('tooling', 'host', 'github\.com'\)/);
  assert.match(row, /sourceOf\('tooling', 'repo', ''\)/);
  assert.match(row, /https:\/\/\$\{host\}\/\$\{repo\}\/releases\/tag\/\$\{encodeURIComponent\(tag\)\}/);
  assert.ok(!/github\.com\/Webship\/workspace\/releases/.test(server), 'the repo must not be hardcoded');
});

// To the end of the entry, not a fixed number of characters: the comments around it grow, and a window
// one character short reads as the markup having been taken away.
function versionEntry() {
  const from = server.indexOf('// The release page for this tag');
  return server.slice(from, server.indexOf('})(),', from));
}

test('a tree with no stamp gets plain text, not a link to nowhere', () => {
  const row = versionEntry();
  assert.match(row, /const href = tag && repo \?/, 'no release tag (no stamp and no tag of git) or no repo means no link');
  assert.match(row, /: `<span class="action-btn actions-version is-unknown"/);
});

test('it opens in a new tab, safely', () => {
  const row = versionEntry();
  assert.match(row, /target="_blank" rel="noopener"/, 'a rail link that replaced the dashboard would be a trap');
});

test('the settings this reads are actually there', () => {
  // If `sources: tooling:` ever loses these keys the link silently stops being built.
  assert.ok(sourceOf('tooling', 'repo', ''), 'settings.yml must carry sources.tooling.repo');
  assert.match(sourceOf('tooling', 'host', 'github.com'), /\./);
  const v = appVersion();
  if (v) assert.match(v, /^[0-9]/, 'a stamp is a version');
});

/* --- the version of a git checkout with no stamp (#856) -------------------------------------------
 * A contributor's clone, or the checkout the plugins' CI makes, has no .app-version: install.sh,
 * sync-tooling.sh --pull, update.sh and release.sh write it, and a clone runs none of them. git knows
 * the version all the same.
 */
const os = require('os');
const { execFileSync } = require('child_process');
const { versionInfoOf } = require(path.join(app, 'workspaces'));

/** A workspace in a temp dir, a git checkout of its own, with core/workspace-app in it and v1.0.32 on its commit. */
function checkout() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'version-'));
  const ws = path.join(tmp, 'workspace');
  const appDir = path.join(ws, 'core', 'workspace-app');
  fs.mkdirSync(appDir, { recursive: true });
  const git = (...a) => execFileSync('git', ['-C', ws, ...a], { encoding: 'utf8' }).trim();
  execFileSync('git', ['init', '-q', '-b', 'main', ws]);
  git('config', 'user.email', 't@t'); git('config', 'user.name', 'T');
  fs.writeFileSync(path.join(appDir, 'server.js'), '// the dashboard');
  git('add', '-A'); git('commit', '-qm', 'the release');
  git('tag', 'v1.0.32');
  return { tmp, ws, appDir, git };
}

test('a git checkout with no stamp takes its version from git: the release at its tag, the commits past it after', () => {
  const { tmp, appDir, git } = checkout();
  try {
    assert.deepStrictEqual(versionInfoOf(appDir), { version: '1.0.32', from: 'git', tag: 'v1.0.32', exact: true });
    fs.writeFileSync(path.join(appDir, 'server.js'), '// the dashboard, changed');
    git('commit', '-qam', 'a change after the release');
    const after = versionInfoOf(appDir);
    assert.match(after.version, /^1\.0\.32-1-g[0-9a-f]+$/);
    assert.deepStrictEqual([after.from, after.tag, after.exact], ['git', '', false], 'past its tag: no release to link to');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('a stamp still wins over git', () => {
  const { tmp, appDir } = checkout();
  try {
    fs.writeFileSync(path.join(appDir, '.app-version'), '1.0.40\n');
    assert.deepStrictEqual(versionInfoOf(appDir), { version: '1.0.40', from: 'stamp', tag: '1.0.40', exact: true });
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('no stamp and no git: version unknown; a workspace inside some other repository does not take its tags', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'version-'));
  try {
    const appDir = path.join(tmp, 'workspace', 'core', 'workspace-app');
    fs.mkdirSync(appDir, { recursive: true });
    assert.deepStrictEqual(versionInfoOf(appDir), { version: '', from: '', tag: '', exact: false });
    // The same tree inside a repository whose top folder is above the workspace: its tags are not this tree's.
    execFileSync('git', ['init', '-q', '-b', 'main', tmp]);
    const git = (...a) => execFileSync('git', ['-C', tmp, ...a], { encoding: 'utf8' });
    git('config', 'user.email', 't@t'); git('config', 'user.name', 'T');
    fs.writeFileSync(path.join(tmp, 'notes.txt'), 'another project');
    git('add', 'notes.txt'); git('commit', '-qm', 'another project'); git('tag', 'v9.9.9');
    assert.deepStrictEqual(versionInfoOf(appDir), { version: '', from: '', tag: '', exact: false });
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('the top bar says where the version came from, and the update hint is asked only for an installed tree', () => {
  assert.match(server, /info\.from === 'git'\s*\n?\s*\? `Current local version: Webship Workspace \$\{v\}, from git \(git describe --tags\)/);
  assert.match(server, /current: appVersionInfo\(\)\.from === 'stamp' \? appVersion\(\) : ''/);
});
