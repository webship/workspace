/**
 * How this app authenticates GitHub work: gh's own login when it stands on its
 * own, otherwise the token from settings.yml's git.github block — probed once
 * and cached, never logged.
 */

const fs = require('fs');
const path = require('path');

const { run } = require('./jobs');
const { loadSettings } = require('./workspaces');

// Whether the `gh` CLI can authenticate on its own, and as whom. Cached for 5 minutes: the
// probe is a network call. `hosts.yml` names the account even when the token is unreachable —
// that is exactly the container's situation — so the name alone proves nothing and the probe
// is what decides.
let _ghAuth = null;
let _ghAuthAt = 0;
async function ghCliAuth() {
  if (_ghAuth && Date.now() - _ghAuthAt < 5 * 60 * 1000) return _ghAuth;
  const out = { binary: null, named: '', login: '' };
  for (const dir of (process.env.PATH || '').split(':')) {
    const candidate = path.join(dir, 'gh');
    try { fs.accessSync(candidate, fs.constants.X_OK); out.binary = candidate; break; } catch (_) { /* keep looking */ }
  }
  try {
    const hosts = fs.readFileSync(path.join(process.env.HOME, '.config', 'gh', 'hosts.yml'), 'utf8');
    out.named = (hosts.match(/^\s*user:\s*(\S+)/m) || [])[1] || '';
  } catch (_) { /* gh never signed in here */ }
  if (out.binary) {
    // No settings token in this environment: the question is whether gh stands on its own.
    const env = { ...process.env };
    delete env.GH_TOKEN; delete env.GITHUB_TOKEN;
    const res = await run('gh', ['api', 'user', '--jq', '.login'], process.env.HOME, { timeoutMs: 20000, env });
    if (res.ok) out.login = res.stdout.trim();
  }
  _ghAuth = out; _ghAuthAt = Date.now();
  return out;
}


// GitHub auth for the child processes that need it. The token comes from settings.yml's
// `git.github_token`, which is how this container authenticates at all: its gh config is
// mounted from the host but the token lives in the host keyring, which it cannot read. Passed
// per child rather than assigned into process.env, so it is not handed to every job the
// dashboard runs. Never logged.
function githubEnv() {
  if (process.env.GH_TOKEN || process.env.GITHUB_TOKEN) return process.env;
  const github = (() => { try { return (loadSettings().git || {}).github || {}; } catch (_) { return {}; } })();
  // gh's own login is preferred when it works; the cached probe answers without waiting.
  if (String(github.use_gh_cli) !== 'false' && _ghAuth && _ghAuth.login) return process.env;
  const token = github.token || '';
  if (!token || token === 'CHANGE_ME') return process.env;
  return { ...process.env, GH_TOKEN: token };
}

module.exports = { ghCliAuth, githubEnv };
