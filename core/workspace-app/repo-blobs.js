/**
 * Git blob identity, cheap on both sides.
 *
 * Remote: ONE recursive Trees call per repo@ref answers every "what is in the
 * repo and at which sha" question a page has — cached for 5 minutes AND
 * single-flighted, so ten rows rendering during a cold cache still cost one
 * network call, not ten. `null` means unreachable, and is cached too: an
 * unauthenticated container must not retry on every render.
 *
 * Local: sha1("blob <size>\0" + content), memoized by (size, mtime) — a page
 * of fifty unchanged files hashes nothing on re-render.
 */

const fs = require('fs');
const crypto = require('crypto');

const { run } = require('./jobs');
const { githubEnv } = require('./github-auth');

const TTL_MS = 5 * 60 * 1000;
const _trees = new Map(); // `${repo}@${ref}` -> { at, promise }

/** Map<path, blob sha> for the whole repo at ref, or null when unreachable. */
function repoTree(repo, ref) {
  const key = `${repo}@${ref}`;
  const hit = _trees.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.promise;
  const promise = (async () => {
    const res = await run('gh',
      ['api', `repos/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
        '--jq', '.tree[] | select(.type=="blob") | .path + " " + .sha'],
      process.env.HOME, { timeoutMs: 30 * 1000, env: githubEnv() });
    if (res.code !== 0) return null;
    const map = new Map();
    for (const line of String(res.stdout || '').split('\n')) {
      const sp = line.lastIndexOf(' ');
      if (sp < 1) continue;
      map.set(line.slice(0, sp), line.slice(sp + 1));
    }
    return map;
  })();
  _trees.set(key, { at: Date.now(), promise });
  return promise;
}

function invalidateRepoTree(repo) {
  for (const key of _trees.keys()) {
    if (key.startsWith(`${repo}@`)) _trees.delete(key);
  }
}

const _blobMemo = new Map(); // file -> { size, mtimeMs, sha }

/** git's blob sha for a local file. Throws like fs does when it cannot be read. */
function gitBlobSha(file) {
  const st = fs.statSync(file);
  const hit = _blobMemo.get(file);
  if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs) return hit.sha;
  const buf = fs.readFileSync(file);
  const sha = crypto.createHash('sha1')
    .update(`blob ${buf.length}\0`).update(buf).digest('hex');
  _blobMemo.set(file, { size: st.size, mtimeMs: st.mtimeMs, sha });
  return sha;
}

module.exports = { repoTree, invalidateRepoTree, gitBlobSha };
