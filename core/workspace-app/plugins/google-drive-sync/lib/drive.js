/**
 * Google Drive, for pushing a workspace folder up to a Drive folder.
 *
 * Plain Drive v3 over fetch, no client library. One module serves three callers so they cannot
 * drift: the dashboard plugin (the Sync button), cmd-tools-google-drive-sync.sh through lib/cli.js, and
 * the MCP server in lib/mcp.js. All settings come from this plugin's own file, plugin.google-drive-sync.settings.yml.
 *
 * Why not the claude.ai Google Drive connector: it uploads a file by passing the whole content
 * through a tool call as text, so a 50 MB video cannot go that way. This streams the bytes.
 *
 * The push is one way and never deletes: new files are created, changed files are updated in
 * place, and anything that exists only on Drive is left alone.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ctx = require('./context');
const { findReportDirs } = require('./reports');

// Overridable so a test can point the whole module at a local stand-in for Google.
const api = () => process.env.GOOGLE_DRIVE_API || 'https://www.googleapis.com/drive/v3';
const uploadApi = () => process.env.GOOGLE_DRIVE_UPLOAD_API || 'https://www.googleapis.com/upload/drive/v3';
const tokenUrl = () => process.env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

const FOLDER = 'application/vnd.google-apps.folder';
// Places a folder can live (my_drive, shared_with_me, shared_drives) and the views Drive's sidebar adds over them
// (starred, recent). A view only decides what the picker offers; a folder picked from one is still judged by where it lives.
const LOCATIONS = ['my_drive', 'shared_with_me', 'shared_drives', 'starred', 'recent'];
const CHUNK = 8 * 1024 * 1024; // a multiple of 256 KiB, which resumable uploads require
const DEFAULT_EXCLUDE = ['node_modules', '.git', '.DS_Store', 'dev-ai-agents'];

// Never pushed, whatever `exclude` says in the plugin settings: it can add to this list but not take from it. These are the
// workspace's own tooling (a leading / means only at the top of what is being pushed) and files that hold
// passwords or keys, which have no business in a shared Drive.
const BASELINE_EXCLUDE = [
  '.*', 'cmd-*.sh', '/AGENTS.md', '/CLAUDE.md', '/README.md', '/*.code-workspace',
  '.env', '.env.*', '*.pem', '*.key', '*.p12', '*.pfx', '*.jks', '*.keystore', '*.kdbx', '*.gpg', '*.asc',
  'id_rsa*', 'id_ed25519*', 'id_ecdsa*', 'id_dsa*', '.npmrc', '.netrc', '.htpasswd', 'auth.json', 'settings.php', 'settings.local.php',
  '*secret*', '*password*', '*passwd*', '*credential*', '*.token', '*apikey*', '*api_key*', '*api-key*',
];

// What a file's CONTENT gives away. Names are not enough: a key pasted into notes.md is still a key.
const SCAN_EXT = /\.(md|markdown|txt|json|ya?ml|env|ini|conf|cfg|toml|xml|html?|csv|log|sh|js|mjs|cjs|ts|php|py|rb|twig|properties)$/i;
const SCAN_MAX = 512 * 1024;
const SECRET_PATTERNS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'a private key'],
  [/GOCSPX-[A-Za-z0-9_-]{20,}/, 'a Google client secret'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}/, 'a GitHub token'],
  [/\bgithub_pat_[A-Za-z0-9_]{30,}/, 'a GitHub token'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'an AWS access key'],
  [/\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}/, 'an API key'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/, 'a Slack token'],
  [/\bfigd_[A-Za-z0-9_-]{20,}/, 'a Figma token'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, 'a Google API key'],
];
const ASSIGN = /\b(pass(?:word|wd)?|pwd|secret|api[_-]?key|access[_-]?key|token|client[_-]?secret|private[_-]?key)\b["']?\s*[:=]\s*["']?([^\s"',;#<>`)]{12,})/gi;
const PLACEHOLDER = /^(change[_-]?me|changeme|your[-_a-z0-9]*|example[-_a-z0-9]*|placeholder|x{3,}|\*+|null|none|undefined|true|false|redacted|hidden|https?:.*|\$\{.*|\$[a-z_]+.*|%.*|<.*|\.{3}.*)$/i;

/** Why a file looks like it holds a secret, or '' when it does not. Only small text files are read. */
function secretIn(file, size) {
  if (!SCAN_EXT.test(file) || size > SCAN_MAX) return '';
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (_) { return ''; }
  for (const [re, why] of SECRET_PATTERNS) if (re.test(text)) return why;
  for (const m of text.matchAll(ASSIGN)) {
    const v = m[2];
    // A real secret has a digit or mixed case; a plain word after "password:" is prose.
    if (!PLACEHOLDER.test(v) && (/[0-9]/.test(v) || (/[a-z]/.test(v) && /[A-Z]/.test(v)))) return `a ${m[1].toLowerCase()} value`;
  }
  return '';
}

const MIME = {
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.json': 'application/json', '.md': 'text/markdown',
  '.txt': 'text/plain', '.html': 'text/html', '.csv': 'text/csv', '.yml': 'text/yaml', '.yaml': 'text/yaml',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.zip': 'application/zip',
};
const mimeOf = (file) => MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';

// A value that is empty or still the shipped placeholder is not a value.
const real = (v) => {
  const s = String(v == null ? '' : v).trim();
  return s && !/^(CHANGE_ME|sk-change-this)$/i.test(s) ? s : '';
};

/** The plugin's settings file, normalised. Read per call, so a settings change needs no restart. */
function driveSettings() {
  const g = ctx.pluginSettings();
  const hub = ctx.hubDomain();
  const exclude = [...new Set([...BASELINE_EXCLUDE, ...(Array.isArray(g.exclude) ? g.exclude.map(String) : DEFAULT_EXCLUDE)])];
  const settings = {
    clientId: real(g.client_id),
    clientSecret: real(g.client_secret),
    refreshToken: real(g.refresh_token),
    // Whose Drive this is meant to be: pre-selected when connecting, and what the panel checks the connected account against.
    account: String(g.account || '').trim().toLowerCase(),
    scope: real(g.scope) || 'https://www.googleapis.com/auth/drive',
    redirectUri: real(g.redirect_uri) || `https://${hub}/fragments/p/google-drive-sync/callback`,
    exclude,
    // Only files that match a target are pushed: targets.<workspace> is a list of names, globs or folders.
    targets: Object.fromEntries(Object.entries(g.targets && typeof g.targets === 'object' ? g.targets : {}).map(([k, v]) => [k, (Array.isArray(v) ? v : []).map(String).filter(Boolean)])),
    // Read small text files and skip any that give a password or key away. On unless set to false.
    scanForSecrets: g.scan_for_secrets !== false && String(g.scan_for_secrets) !== 'false',
    // Where a folder may be picked from: any of my_drive, shared_with_me, shared_drives. My Drive alone by default.
    locations: (() => { const l = (Array.isArray(g.locations) ? g.locations : []).map(String).filter((x) => LOCATIONS.includes(x)); return l.length ? l : ['my_drive']; })(),
    // One shared folder every workspace stores into, as <root_folder>/<workspace>, unless it has a destination of its own.
    rootFolder: parseFolderId(g.root_folder),
    destinations: g.destinations && typeof g.destinations === 'object' ? g.destinations : {},
    // What a workspace pushes: its whole folder (the default), or `test-reports`.
    sources: g.sources && typeof g.sources === 'object' ? g.sources : {},
  };
  settings.configured = !!(settings.clientId && settings.clientSecret);
  settings.connected = settings.configured && !!settings.refreshToken;
  return settings;
}

// ---- OAuth ----------------------------------------------------------------------------------

function authUrl(state, loginHint = '') {
  const s = driveSettings();
  const q = new URLSearchParams({
    client_id: s.clientId, redirect_uri: s.redirectUri, response_type: 'code', scope: s.scope,
    access_type: 'offline', prompt: 'consent', state,
  });
  // The account somebody signed in to the dashboard with, so Drive is not connected as a different one by accident.
  if (loginHint) q.set('login_hint', loginHint);
  return `${AUTH_URL}?${q}`;
}

async function tokenRequest(params) {
  const res = await fetch(tokenUrl(), {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Google refused the token request: ${body.error_description || body.error || res.status}`);
  return body;
}

/** Trade the code Google redirected back with for tokens. The refresh token is what gets stored. */
async function exchangeCode(code) {
  const s = driveSettings();
  const body = await tokenRequest({
    code, client_id: s.clientId, client_secret: s.clientSecret, redirect_uri: s.redirectUri, grant_type: 'authorization_code',
  });
  if (!body.refresh_token) throw new Error('Google returned no refresh token. Remove this app at myaccount.google.com/permissions and connect again.');
  return body;
}

let cached = { token: '', until: 0, key: '' };

async function accessToken() {
  const s = driveSettings();
  if (!s.connected) throw new Error('Google Drive is not connected. Set client_id and client_secret in plugin.google-drive-sync.settings.yml (or paste them into the Sync panel), then press Connect in the dashboard.');
  const key = `${s.clientId}:${s.refreshToken}`;
  if (cached.key === key && Date.now() < cached.until) return cached.token;
  const body = await tokenRequest({
    refresh_token: s.refreshToken, client_id: s.clientId, client_secret: s.clientSecret, grant_type: 'refresh_token',
  });
  cached = { token: body.access_token, until: Date.now() + (Number(body.expires_in || 3600) - 120) * 1000, key };
  return cached.token;
}

// ---- Requests -------------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** fetch with the bearer token, one token refresh on 401 and backoff on 429 and 5xx. */
async function call(url, init = {}) {
  let lastStatus = 0;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const token = await accessToken();
    const res = await fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } });
    lastStatus = res.status;
    if (res.status === 401 && attempt === 0) { cached.until = 0; continue; }
    if (res.status === 429 || res.status >= 500) { await sleep(500 * 2 ** attempt); continue; }
    return res;
  }
  throw new Error(`Drive kept answering ${lastStatus} for ${String(url).split('?')[0]}`);
}

async function json(url, init) {
  const res = await call(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Drive ${res.status}: ${(body.error && body.error.message) || 'request failed'}`);
  return body;
}

const ALL = 'supportsAllDrives=true';
const quote = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

async function listAll(q, fields, { orderBy = 'name', limit = 0 } = {}) {
  const out = [];
  let pageToken = '';
  do {
    const p = new URLSearchParams({
      q, fields: `nextPageToken,files(${fields})`, pageSize: '1000', includeItemsFromAllDrives: 'true', supportsAllDrives: 'true', corpora: 'allDrives', orderBy,
    });
    if (pageToken) p.set('pageToken', pageToken);
    const body = await json(`${api()}/files?${p}`);
    out.push(...(body.files || []));
    pageToken = limit && out.length >= limit ? '' : (body.nextPageToken || '');
  } while (pageToken);
  return limit ? out.slice(0, limit) : out;
}

const getFile = (id) => json(`${api()}/files/${encodeURIComponent(id)}?fields=id,name,mimeType,parents,driveId,ownedByMe,webViewLink&${ALL}`);

/** The signed-in account, shown beside Connected so it is clear whose Drive this is. */
async function about() {
  const body = await json(`${api()}/about?fields=user(displayName,emailAddress)`);
  return body.user || {};
}

/** The Google Workspace shared drives this account can reach. Their ids work as folder ids. */
async function listSharedDrives() {
  const out = [];
  let pageToken = '';
  do {
    const p = new URLSearchParams({ fields: 'nextPageToken,drives(id,name)', pageSize: '100' });
    if (pageToken) p.set('pageToken', pageToken);
    const body = await json(`${api()}/drives?${p}`);
    out.push(...(body.drives || []));
    pageToken = body.nextPageToken || '';
  } while (pageToken);
  return out;
}

const LOCATION_NAMES = { my_drive: 'My Drive', shared_with_me: 'Shared with me', shared_drives: 'Shared drives', starred: 'Starred', recent: 'Recent' };

function assertLocation(location) {
  if (!driveSettings().locations.includes(location)) {
    throw new Error(`${LOCATION_NAMES[location]} is not allowed here. Add ${location} to locations in plugin.google-drive-sync.settings.yml to allow it.`);
  }
}

/** Which of the three places a Drive file lives in: a shared drive, someone else's (shared with me), or mine. */
function locationOf(file) {
  if (file.driveId) return 'shared_drives';
  return file.ownedByMe === false ? 'shared_with_me' : 'my_drive';
}

/** Refuse a folder that is somewhere `locations` does not allow, however it was reached (a pasted link too). */
const assertAllowed = (file) => assertLocation(locationOf(file));

/** Folders directly inside `parent` (a folder id, 'root', 'shared' for Shared with me, or 'drives' for shared drives). */
function listFolders(parent) {
  if (parent === 'drives') { assertLocation('shared_drives'); return listSharedDrives(); }
  if (parent === 'shared') assertLocation('shared_with_me');
  if (parent === 'starred') { assertLocation('starred'); return listAll(`starred = true and mimeType = '${FOLDER}' and trashed = false`, 'id,name'); }
  if (parent === 'recent') { assertLocation('recent'); return listAll(`mimeType = '${FOLDER}' and trashed = false`, 'id,name', { orderBy: 'viewedByMeTime desc', limit: 30 }); }
  const q = parent === 'shared'
    ? `sharedWithMe = true and mimeType = '${FOLDER}' and trashed = false`
    : `${quote(parent || 'root')} in parents and mimeType = '${FOLDER}' and trashed = false`;
  return listAll(q, 'id,name');
}

const listChildren = (folderId) => listAll(`${quote(folderId)} in parents and trashed = false`, 'id,name,mimeType,size,md5Checksum');

async function createFolder(name, parentId) {
  return json(`${api()}/files?fields=id,name&${ALL}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: FOLDER, parents: [parentId] }),
  });
}

/** Folder id from a pasted link or a bare id. */
function parseFolderId(text) {
  const s = String(text || '').trim();
  const m = s.match(/\/folders\/([A-Za-z0-9_-]+)/) || s.match(/[?&]id=([A-Za-z0-9_-]+)/);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{10,}$/.test(s) || s === 'root' ? s : '';
}

// ---- Upload ---------------------------------------------------------------------------------

/**
 * Create or replace one file by resumable upload, streamed in chunks. `existingId` updates that
 * file's content in place (the same id, so links and sharing survive).
 */
async function uploadFile(localPath, name, parentId, { existingId = '', onProgress = null } = {}) {
  const size = fs.statSync(localPath).size;
  const meta = existingId ? { name } : { name, parents: [parentId] };
  const start = existingId
    ? `${uploadApi()}/files/${encodeURIComponent(existingId)}?uploadType=resumable&fields=id&${ALL}`
    : `${uploadApi()}/files?uploadType=resumable&fields=id&${ALL}`;
  const init = await call(start, {
    method: existingId ? 'PATCH' : 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mimeOf(localPath), 'X-Upload-Content-Length': String(size) },
    body: JSON.stringify(meta),
  });
  if (!init.ok) throw new Error(`Drive ${init.status} starting the upload of ${name}`);
  const session = init.headers.get('location');
  if (!session) throw new Error(`Drive gave no upload address for ${name}`);

  if (size === 0) {
    const res = await fetch(session, { method: 'PUT', headers: { 'Content-Length': '0' } });
    if (!res.ok) throw new Error(`Drive ${res.status} uploading the empty file ${name}`);
    return (await res.json().catch(() => ({}))).id || existingId;
  }

  const fd = fs.openSync(localPath, 'r');
  try {
    let offset = 0;
    let failures = 0;
    while (offset < size) {
      const len = Math.min(CHUNK, size - offset);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, offset);
      let res;
      try {
        res = await fetch(session, {
          method: 'PUT', headers: { 'Content-Length': String(len), 'Content-Range': `bytes ${offset}-${offset + len - 1}/${size}` }, body: buf,
        });
      } catch (err) {
        res = { status: 599, ok: false, headers: new Headers() };
      }
      if (res.status === 308) {
        const range = res.headers.get('range');   // "bytes=0-N" — what Drive actually holds
        offset = range ? Number(range.split('-')[1]) + 1 : 0;
        failures = 0;
        if (onProgress) onProgress(offset, size);
      } else if (res.ok) {
        if (onProgress) onProgress(size, size);
        return (await res.json().catch(() => ({}))).id || existingId;
      } else if (res.status >= 500 || res.status === 429) {
        failures += 1;
        if (failures > 4) throw new Error(`Drive kept failing (${res.status}) while uploading ${name}`);
        await sleep(1000 * 2 ** failures);
        const probe = await fetch(session, { method: 'PUT', headers: { 'Content-Length': '0', 'Content-Range': `bytes */${size}` } }).catch(() => null);
        if (probe && probe.status === 308) {
          const range = probe.headers.get('range');
          offset = range ? Number(range.split('-')[1]) + 1 : 0;
        }
      } else {
        throw new Error(`Drive ${res.status} uploading ${name}`);
      }
    }
  } finally {
    fs.closeSync(fd);
  }
  throw new Error(`The upload of ${name} ended without Drive confirming it`);
}

function md5Of(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('md5');
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

// ---- Sync -----------------------------------------------------------------------------------
//
// A push is a PLAN first and writes second. The plan compares the local tree with what is already on
// Drive and sorts every file into new, unchanged, or "would overwrite a file that is already there",
// and notes the existing sub folders it would write into. Nothing is written while either of the last
// two exists, unless the caller says it approved: an upload that quietly replaces what is in somebody's
// Drive is not one to find out about afterwards.

// A glob on a name or a relative path: * within a segment, ** across segments, ? one character.
function globToRegex(glob) {
  const body = String(glob).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0000/g, '.*');
  return new RegExp(`^${body}$`);
}

function excluder(patterns) {
  // A pattern starting with / matches only the path from the top of what is pushed; any other also matches a bare name at any depth.
  const rules = patterns.map((g) => (String(g).startsWith('/') ? { top: true, re: globToRegex(String(g).slice(1)) } : { top: false, re: globToRegex(g) }));
  return (rel, name) => rules.some((r) => (r.top ? r.re.test(rel) : r.re.test(name) || r.re.test(rel)));
}

const zero = () => ({ created: 0, updated: 0, unchanged: 0, failed: 0, skipped: 0, untargeted: 0, bytes: 0 });

/**
 * Does this path (from the top of the source) match a target? A name with no slash matches at any depth (*.mp4);
 * a path with a slash matches from the top; a folder, written with a trailing slash or simply existing, means
 * everything inside it.
 */
function targeter(targets, top) {
  const rules = targets.map((t) => {
    const clean = String(t).trim().replace(/^\.\//, '');
    const folder = clean.endsWith('/') || (!/[*?]/.test(clean) && (() => { try { return fs.statSync(path.join(top, clean)).isDirectory(); } catch (_) { return false; } })());
    if (folder) return (rel) => rel.startsWith(`${clean.replace(/\/+$/, '')}/`);
    const re = globToRegex(clean);
    return clean.includes('/') ? (rel) => re.test(rel) : (rel, name) => re.test(name);
  });
  return (rel, name) => rules.some((r) => r(rel, name));
}

/**
 * Compare `sources` ([{ local, prefix: [folder names] }], a source being a folder or one file) with the
 * Drive folder `destId`. Reads Drive, writes nothing. Returns
 * { ops, stats, overwrites: [rel], merges: [rel], needsApproval }.
 */
async function planSources(destId, sources, { exclude = DEFAULT_EXCLUDE, scan = true, log = () => {} } = {}) {
  const skip = excluder(exclude);
  const stats = zero();
  const secrets = [];
  const ops = [];
  const dirs = new Map([['', { rel: '', id: destId, existing: true, touched: false }]]);
  const kids = new Map();
  const childrenOf = async (id) => {
    if (!id) return [];
    if (!kids.has(id)) kids.set(id, await listChildren(id));
    return kids.get(id);
  };
  const parentOf = (rel) => rel.split('/').slice(0, -1).join('/');

  async function dirOp(rel) {
    if (dirs.has(rel)) return dirs.get(rel);
    const parent = await dirOp(parentOf(rel));
    const name = rel.split('/').pop();
    const hit = (await childrenOf(parent.id)).find((c) => c.mimeType === FOLDER && c.name === name);
    const entry = { kind: 'dir', rel, name, parentRel: parent.rel, id: hit ? hit.id : '', existing: !!hit, touched: false };
    dirs.set(rel, entry);
    ops.push(entry);
    return entry;
  }

  async function fileOp(local, rel, parentRel) {
    const name = rel.split('/').pop();
    const size = fs.statSync(local).size;
    const why = scan ? secretIn(local, size) : '';
    if (why) { secrets.push({ rel, why }); stats.skipped += 1; log(`  ! ${rel}: not pushed, it looks like it holds ${why}`); return; }
    // Made only now: a folder with nothing to push in it is not worth creating on Drive.
    const parent = await dirOp(parentRel);
    const match = (await childrenOf(parent.id)).find((c) => c.mimeType !== FOLDER && !c.mimeType.startsWith('application/vnd.google-apps.') && c.name === name);
    // Size first: a different size is a different file, and the checksum is only worth reading when the sizes agree.
    const same = !!match && Number(match.size) === size && match.md5Checksum === await md5Of(local);
    const action = !match ? 'create' : same ? 'unchanged' : 'update';
    ops.push({ kind: 'file', rel, name, local, size, parentRel, existingId: match ? match.id : '', action });
    if (action === 'unchanged') { stats.unchanged += 1; return; }
    stats[action === 'create' ? 'created' : 'updated'] += 1;
    stats.bytes += size;
    for (let r = parentRel; ; r = parentOf(r)) { const d = dirs.get(r); if (d) d.touched = true; if (!r) break; }
  }

  async function walk(dir, base, srcRel, wanted) {
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const within = srcRel ? `${srcRel}/${entry.name}` : entry.name;
      const rel = base ? `${base}/${within}` : within;
      const full = path.join(dir, entry.name);
      if (skip(within, entry.name)) { stats.skipped += 1; continue; }
      if (entry.isSymbolicLink()) { stats.skipped += 1; log(`  - ${rel} (symbolic link, not followed)`); continue; }
      try {
        if (entry.isDirectory()) await walk(full, base, within, wanted);
        else if (entry.isFile()) {
          if (wanted && !wanted(within, entry.name)) { stats.untargeted += 1; continue; }
          await fileOp(full, rel, parentOf(rel));
        }
      } catch (err) { stats.failed += 1; log(`  ! ${rel}: ${err.message}`); }
    }
  }

  for (const src of sources) {
    const base = src.prefix.join('/');
    try {
      if (fs.statSync(src.local).isFile()) {
        // Naming a file is a selection, which waives the targets; it does not waive the never-push rules.
        const name = path.basename(src.local);
        if (skip(name, name)) { stats.skipped += 1; log(`  ! ${name}: not pushed, it is on the never-push list (tooling, hidden or secret by name)`); continue; }
        await fileOp(src.local, base ? `${base}/${name}` : name, base);
      }
      else await walk(src.local, base, '', src.targets ? targeter(src.targets, src.local) : null);
    } catch (err) { stats.failed += 1; log(`  ! ${src.local}: ${err.message}`); }
  }

  const overwrites = ops.filter((o) => o.kind === 'file' && o.action === 'update').map((o) => o.rel);
  const merges = ops.filter((o) => o.kind === 'dir' && o.existing && o.touched).map((o) => o.rel);
  return { ops, stats, secrets, overwrites, merges, needsApproval: overwrites.length > 0 || merges.length > 0 };
}

/** Write a plan. Folders first, then files into them; a folder that fails takes what is inside it with it. */
async function applyPlan(destId, plan, { log = () => {} } = {}) {
  const stats = { ...plan.stats, created: 0, updated: 0, bytes: 0 };
  const ids = new Map([['', destId]]);
  for (const op of plan.ops) {
    try {
      const parentId = ids.get(op.parentRel);
      if (op.kind === 'dir') {
        if (parentId === undefined) { ids.set(op.rel, undefined); continue; }
        ids.set(op.rel, op.id || (await createFolder(op.name, parentId)).id);
      } else if (op.action !== 'unchanged') {
        if (!parentId) throw new Error('its folder could not be made');
        log(`  ${op.action === 'create' ? '+' : '~'} ${op.rel} (${op.size} bytes)`);
        let lastPct = 0;
        await uploadFile(op.local, op.name, parentId, {
          existingId: op.existingId,
          onProgress: op.size > 50 * 1024 * 1024 ? (sent, total) => {
            const pct = Math.floor((sent / total) * 4) * 25;
            if (pct > lastPct && pct < 100) { lastPct = pct; log(`      ${pct}% of ${op.name}`); }
          } : null,
        });
        stats[op.action === 'create' ? 'created' : 'updated'] += 1;
        stats.bytes += op.size;
      }
    } catch (err) {
      stats.failed += 1;
      log(`  ! ${op.rel}: ${err.message}`);
    }
  }
  return stats;
}

function logPlan(plan, log) {
  for (const op of plan.ops) if (op.kind === 'file' && op.action !== 'unchanged') log(`  ${op.action === 'create' ? '+' : '~'} ${op.rel} (${op.size} bytes)`);
}

/** What would be overwritten or merged into, as lines to show somebody. */
function approvalText(plan, limit = 40) {
  const list = (items, mark) => items.slice(0, limit).map((r) => `    ${mark} ${r}`).concat(items.length > limit ? [`    … and ${items.length - limit} more`] : []);
  const out = [];
  if (plan.overwrites.length) out.push(`Would OVERWRITE ${plan.overwrites.length} file(s) that are already on Drive:`, ...list(plan.overwrites, '~'));
  if (plan.merges.length) out.push(`Would write into ${plan.merges.length} sub folder(s) that are already on Drive:`, ...list(plan.merges, '='));
  return out.join('\n');
}

const sourceOf = (workspace) => (driveSettings().sources[workspace] === 'test-reports' ? 'test-reports' : 'folder');

/**
 * Where a workspace goes: its own destination if it has one, else <root_folder>/<workspace>, so a new
 * teammate sets one folder (a Google Workspace shared drive folder works) and every workspace has a home.
 */
function locate(workspace, folderId) {
  const s = driveSettings();
  const own = parseFolderId(folderId) || parseFolderId(s.destinations[workspace]);
  if (own) return { dest: own, base: [] };
  if (s.rootFolder) return { dest: s.rootFolder, base: [workspace] };
  throw new Error(`No Drive folder chosen for ${workspace}. Set the storage folder for all workspaces, or choose one for this workspace, in the dashboard (or root_folder / destinations.${workspace}).`);
}

/**
 * What a workspace pushes, and where: { dest, sources }. Folder mode is the whole folder, or one item of
 * it (into a Drive folder of its own name); `test-reports` is each project's reports, failure screenshots
 * and recordings, as <project>/<module>/<kind>.
 */
function sourcesFor(workspace, { folderId = '', item = '' } = {}) {
  if (!ctx.isValidWorkspace(workspace)) throw new Error(`Unknown workspace '${workspace}'.`);
  const { dest, base } = locate(workspace, folderId);
  const root = ctx.workspaceDir(workspace);
  const badItem = item && (/[\\/]/.test(item) || item === '.' || item === '..');

  if (sourceOf(workspace) === 'test-reports') {
    if (badItem || (item && !fs.existsSync(path.join(root, item)))) throw new Error(`${workspace}/${item} is not a project here.`);
    const projects = item ? [item] : fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name).sort();
    const sources = [];
    for (const project of projects) {
      for (const { reportsDir, testsDir, label } of findReportDirs(root, project)) {
        for (const [kind, local] of [['reports', reportsDir], ['screenshots', path.join(testsDir, 'screenshots')], ['videos', path.join(testsDir, 'videos')]]) {
          if (fs.existsSync(local)) sources.push({ local, prefix: [...base, project, label, kind] });
        }
      }
    }
    return { dest, sources, empty: sources.length ? '' : `No test reports found in ${workspace}${item ? `/${item}` : ''}.` };
  }

  if (!item) {
    // Only what is selected: no targets for a workspace means nothing is pushed, never "everything".
    const targets = driveSettings().targets[workspace] || [];
    if (!targets.length) return { dest, sources: [], empty: `No files are selected for ${workspace}. Choose what to push in the Sync panel, or list targets under targets.${workspace} in plugin.google-drive-sync.settings.yml.` };
    return { dest, sources: [{ local: root, prefix: base, targets }], empty: '' };
  }
  if (badItem) throw new Error('An item is one name inside the workspace, not a path.');
  const local = path.join(root, item);
  if (!fs.existsSync(local)) throw new Error(`${workspace}/${item} does not exist.`);
  return { dest, sources: [{ local, prefix: fs.statSync(local).isDirectory() ? [...base, item] : base }], empty: '' };
}

/** Compare a workspace with its Drive folder. Writes nothing. */
async function planWorkspace(workspace, opts = {}) {
  const { dest, sources, empty } = sourcesFor(workspace, opts);
  const settings = driveSettings();
  const plan = await planSources(dest, sources, { exclude: settings.exclude, scan: settings.scanForSecrets, log: opts.log });
  return { ...plan, dest, empty };
}

/**
 * Push a workspace to its Drive folder: `folderId`, else destinations.<workspace> from the plugin settings.
 * Plans first. With overwrites or existing folders involved nothing is written unless `approve` is true;
 * the returned { needsApproval: true, written: false } is how the caller knows to ask. `dryRun` plans only.
 */
async function pushWorkspace(workspace, { folderId = '', item = '', dryRun = false, approve = false, log = () => {} } = {}) {
  const plan = await planWorkspace(workspace, { folderId, item, log });
  if (plan.empty) log(plan.empty);
  else log(`Compared ${workspace}${item ? `/${item}` : ''} with Drive folder ${plan.dest}: ${plan.stats.created} new, ${plan.stats.updated} changed, ${plan.stats.unchanged} already there.`);
  if (dryRun) {
    logPlan(plan, log);
    if (plan.needsApproval) log(`\n${approvalText(plan)}\n(dry run: it would need your approval)`);
    return { ...plan, written: false };
  }
  if (plan.needsApproval && !approve) {
    log(`\n${approvalText(plan)}\n\nNothing was written. Approve with --overwrite once you have looked.`);
    return { ...plan, written: false };
  }
  const stats = await applyPlan(plan.dest, plan, { log });
  return { ...plan, stats, written: true };
}

const summary = (st) => `${st.created} new, ${st.updated} changed, ${st.unchanged} already there, ${st.skipped} skipped, ${st.failed} failed${st.untargeted ? `, ${st.untargeted} not selected` : ''}`;

module.exports = {
  pushWorkspace, planWorkspace, approvalText, locate, listSharedDrives, sourceOf, summary, driveSettings, authUrl, exchangeCode, accessToken, about, getFile, listFolders, listChildren, createFolder,
  parseFolderId, uploadFile, globToRegex, locationOf, assertAllowed, secretIn, BASELINE_EXCLUDE, DEFAULT_EXCLUDE, FOLDER,
};
