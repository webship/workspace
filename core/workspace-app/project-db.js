'use strict';

/**
 * A project's database as the workspace keeps it (webship/workspace#937): DDEV's, its runtime's, or a platform's own,
 * when the platform's plugin keeps it (the hook of core/scripts/functions/fun-project-db.sh). Asked of the shell,
 * which knows the plugins' functions: `bash core/scripts/project-db.sh describe` in the project's folder, read again
 * after a few seconds.
 *
 *   { platform: 'fastapi', extension: '.dump', database: true }    the platform's plugin keeps it
 *   { platform: null, extension: '.sql.gz', database: true }       DDEV's database, or its runtime's
 *   { platform: null, extension: '.sql.gz', database: false }      none: DDEV's db omitted, or the runtime's `none`
 *
 * WORKSPACE_PROJECT_DB_SCRIPT names another script that answers the same way (a test's stand-in).
 */

const path = require('path');
const { spawn } = require('child_process');

const TTL = 10 * 1000;
const NO_PLATFORM = Object.freeze({ platform: null, extension: '.sql.gz', database: true });
const cache = new Map();

/** What a line of the script's answer says, checked: a name, an extension, a yes or no. */
function parse(text) {
  try {
    const lines = String(text || '').trim().split('\n');
    const answer = JSON.parse(lines[lines.length - 1]);
    const platform = typeof answer.platform === 'string' && /^[a-z0-9_]+$/.test(answer.platform) ? answer.platform : null;
    const extension = typeof answer.extension === 'string' && /^\.[A-Za-z0-9][A-Za-z0-9.]*$/.test(answer.extension) ? answer.extension : '.sql.gz';
    return { platform, extension: platform ? extension : '.sql.gz', database: platform ? true : answer.database !== false };
  } catch (_) {
    return { ...NO_PLATFORM };
  }
}

/** The script that answers for a project's database (a test's stand-in when WORKSPACE_PROJECT_DB_SCRIPT names one). */
function scriptPath() {
  const { ROOT } = require('./workspaces');
  return process.env.WORKSPACE_PROJECT_DB_SCRIPT || path.join(ROOT, 'core', 'scripts', 'project-db.sh');
}

/**
 * The shell line that puts a dump back as the project's database, in the project's folder (#968): the script's import,
 * through the platform's plugin when one keeps the database, else DDEV's import with the core's own steps around it on
 * PostgreSQL (or the runtime's). `quoted` is the dump's path, already quoted for a shell. Empty when the script's path
 * has characters a shell line cannot carry safely.
 */
function importLine(quoted) {
  const script = scriptPath();
  if (!/^[A-Za-z0-9_./@+-]+$/.test(script)) return '';
  return `bash '${script}' import ${quoted}`;
}

/** The project's database, as the shell describes it; what was said before when the shell does not answer. */
function describeProjectDb(projectDir) {
  const dir = path.resolve(projectDir);
  const hit = cache.get(dir);
  if (hit && Date.now() - hit.at < TTL) return Promise.resolve(hit.value);
  const script = scriptPath();
  return new Promise((resolve) => {
    let out = '';
    let child;
    try {
      // stdin closed: nothing here answers a prompt, and `docker exec -i` would wait on an open one.
      child = spawn('bash', [script, 'describe'], { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch (_) {
      resolve({ ...NO_PLATFORM });
      return;
    }
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch (_) { /* gone */ } }, 30 * 1000);
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.on('error', () => { clearTimeout(timer); resolve({ ...NO_PLATFORM }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      const value = code === 0 ? parse(out) : (hit ? hit.value : { ...NO_PLATFORM });
      cache.set(dir, { at: Date.now(), value });
      resolve(value);
    });
  });
}

/** What the shell last said of a folder, however long ago, or null: for a row drawn without asking it again (#942). */
function peek(projectDir) {
  const hit = cache.get(path.resolve(projectDir));
  return hit ? hit.value : null;
}

/** Forget what was said of one folder, or of all. */
function forget(projectDir) {
  if (projectDir) cache.delete(path.resolve(projectDir)); else cache.clear();
}

module.exports = { describeProjectDb, forget, importLine, parse, peek, scriptPath };
