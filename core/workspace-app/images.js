/**
 * The images workspace: what an image file is, how big it is, and where images live.
 *
 * Dimensions are read from the file's own header, a few kilobytes of it, so a folder of three hundred
 * screenshots lists without starting a process per file.
 */

const fs = require('fs');
const path = require('path');

const { ROOT, workspaceDir, isValidWorkspace } = require('./workspaces');

const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg|avif)$/i;
const TYPES = ['png', 'jpg', 'gif', 'webp', 'svg', 'avif'];
const typeOf = (name) => {
  const ext = path.extname(name).slice(1).toLowerCase();
  return ext === 'jpeg' ? 'jpg' : ext;
};
const NOISE_DIRS = new Set(['node_modules', '.git', 'dev-ai-agents', 'workspace-repo', 'vendor']);

// ------------------------------------------------------------- dimensions --

function readHead(file, bytes) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(bytes);
    const n = fs.readSync(fd, buf, 0, bytes, 0);
    return buf.subarray(0, n);
  } catch (_) {
    return Buffer.alloc(0);
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch (_) { /* closed */ }
  }
}

function pngSize(b) {
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

function gifSize(b) {
  if (b.length < 10 || b.toString('ascii', 0, 3) !== 'GIF') return null;
  return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
}

function jpegSize(b) {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i += 1; continue; }
    const marker = b[i + 1];
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { i += 2; continue; }
    const len = b.readUInt16BE(i + 2);
    // SOF0..SOF15, less the ones that are not frames (DHT, JPG, DAC).
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) };
    }
    i += 2 + len;
  }
  return null;
}

function webpSize(b) {
  if (b.length < 30 || b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WEBP') return null;
  const chunk = b.toString('ascii', 12, 16);
  if (chunk === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  if (chunk === 'VP8L') {
    const bits = b.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') return { width: b.readUIntLE(24, 3) + 1, height: b.readUIntLE(27, 3) + 1 };
  return null;
}

function avifSize(b) {
  const at = b.indexOf('ispe');
  if (at < 0 || at + 16 > b.length) return null;
  return { width: b.readUInt32BE(at + 8), height: b.readUInt32BE(at + 12) };
}

function svgSize(b) {
  const text = b.toString('utf8');
  const tag = (text.match(/<svg\b[^>]*>/i) || [])[0];
  if (!tag) return null;
  const attr = (n) => { const m = tag.match(new RegExp(`\\s${n}\\s*=\\s*["']([\\d.]+)(px)?["']`, 'i')); return m ? Math.round(Number(m[1])) : 0; };
  let width = attr('width');
  let height = attr('height');
  const vb = tag.match(/viewBox\s*=\s*["'][-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)["']/i);
  if ((!width || !height) && vb) { width = width || Math.round(Number(vb[1])); height = height || Math.round(Number(vb[2])); }
  return width && height ? { width, height } : null;
}

const dimCache = new Map();
const DIM_CACHE_MAX = 5000;

/** { width, height } of an image, or null when its header does not say. */
function dimensions(file, stat) {
  const st = stat || (() => { try { return fs.statSync(file); } catch (_) { return null; } })();
  if (!st) return null;
  const key = `${file}|${st.size}|${st.mtimeMs}`;
  if (dimCache.has(key)) return dimCache.get(key);
  const type = typeOf(file);
  // A JPEG's frame header can sit after a large EXIF block, so it gets a longer read.
  const head = readHead(file, type === 'jpg' ? 262144 : 65536);
  const parse = { png: pngSize, gif: gifSize, jpg: jpegSize, webp: webpSize, avif: avifSize, svg: svgSize }[type];
  let out = null;
  try { out = parse ? parse(head) : null; } catch (_) { out = null; }
  if (dimCache.size >= DIM_CACHE_MAX) dimCache.delete(dimCache.keys().next().value);
  dimCache.set(key, out);
  return out;
}

// ---------------------------------------------------------------- listing --

/** Resolve rel inside root, following links, or null when it leads out. */
function safeIn(root, rel) {
  const clean = String(rel || '').replace(/^\/+|\/+$/g, '');
  if (clean.includes('\0') || clean.split('/').some((s) => s === '..' || s.startsWith('.'))) return null;
  try {
    const base = fs.realpathSync(root);
    const abs = fs.realpathSync(path.join(base, clean));
    if (abs !== base && !abs.startsWith(base + path.sep)) return null;
    return { base, abs, rel: path.relative(base, abs).split(path.sep).join('/') };
  } catch (_) {
    return null;
  }
}

/** The sidecar that says how an image was made, when there is one. */
function sidecarOf(abs) {
  try {
    const j = JSON.parse(fs.readFileSync(`${abs}.json`, 'utf8'));
    return j && typeof j === 'object' ? j : null;
  } catch (_) {
    return null;
  }
}

/** One image, as the gallery and the viewer use it. */
function describe(abs, rel, stat) {
  const st = stat || fs.statSync(abs);
  const dims = dimensions(abs, st);
  return {
    name: path.basename(abs), rel, type: typeOf(abs), size: st.size, mtime: st.mtime,
    width: dims ? dims.width : 0, height: dims ? dims.height : 0,
  };
}

/** The folders and images in one folder of a workspace. */
function listFolder(root, rel) {
  const where = safeIn(root, rel);
  if (!where) return { ok: false, folders: [], images: [], rel: '' };
  const folders = [];
  const images = [];
  let entries = [];
  try { entries = fs.readdirSync(where.abs, { withFileTypes: true }); } catch (_) { /* unreadable */ }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const childRel = where.rel ? `${where.rel}/${e.name}` : e.name;
    const abs = path.join(where.abs, e.name);
    if (e.isDirectory()) {
      if (NOISE_DIRS.has(e.name)) continue;
      let count = 0;
      let subs = 0;
      try {
        for (const c of fs.readdirSync(abs, { withFileTypes: true })) {
          if (c.name.startsWith('.')) continue;
          if (c.isDirectory() && !NOISE_DIRS.has(c.name)) subs += 1;
          else if (c.isFile() && IMAGE_RE.test(c.name)) count += 1;
        }
      } catch (_) { /* unreadable */ }
      let mtime = new Date(0);
      try { mtime = fs.statSync(abs).mtime; } catch (_) { /* gone */ }
      folders.push({ folder: true, name: e.name, rel: childRel, count, folders: subs, mtime, size: 0 });
    } else if (e.isFile() && IMAGE_RE.test(e.name)) {
      try { images.push(describe(abs, childRel)); } catch (_) { /* vanished */ }
    }
  }
  return { ok: true, folders, images, rel: where.rel };
}

// ------------------------------------------------------------- everywhere --

// Read-only sources for "All media images". Workspaces of documents and media, never of sites.
const EVERYWHERE = ['images', 'docs', 'videos', 'audio', 'specs', 'designs'];
const APP_SHOTS = 'dashboard';
const appShotsDir = () => path.join(ROOT, 'core', 'workspace-app', 'docs', 'screenshots');
const SCAN_DEPTH = 4;
// Each source gets its own share, so one large folder of docs cannot crowd out the rest.
const SCAN_MAX = 1000;
const SCAN_TTL = 60 * 1000;
let scanMemo = { at: 0, list: null };

function walk(root, src, out) {
  const start = out.length;
  const full = () => out.length - start >= SCAN_MAX;
  const go = (dir, rel, depth) => {
    if (depth > SCAN_DEPTH || full()) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of entries) {
      if (full()) return;
      if (e.name.startsWith('.') || NOISE_DIRS.has(e.name)) continue;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) go(abs, childRel, depth + 1);
      else if (e.isFile() && IMAGE_RE.test(e.name)) {
        try { out.push({ ...describe(abs, childRel), src }); } catch (_) { /* vanished */ }
      }
    }
  };
  go(root, '', 0);
  return full();
}

/** Every image in the media and document workspaces, and the dashboard's own screenshots. */
function scanEverywhere({ fresh = false } = {}) {
  if (!fresh && scanMemo.list && Date.now() - scanMemo.at < SCAN_TTL) return scanMemo.list;
  const out = [];
  const capped = [];
  for (const ws of EVERYWHERE) if (isValidWorkspace(ws) && walk(workspaceDir(ws), ws, out)) capped.push(ws);
  if (fs.existsSync(appShotsDir()) && walk(appShotsDir(), APP_SHOTS, out)) capped.push(APP_SHOTS);
  out.capped = capped;
  scanMemo = { at: Date.now(), list: out };
  return out;
}

function forgetScan() { scanMemo = { at: 0, list: null }; }

/** Where an image of a source lives on disk, or null. */
function sourceRoot(src) {
  if (src === APP_SHOTS) return appShotsDir();
  return EVERYWHERE.includes(src) && isValidWorkspace(src) ? workspaceDir(src) : null;
}

// ------------------------------------------------------------------ names --

/** A file name made safe: letters, digits, dot, dash and underscore, and an image extension kept. */
function safeName(name) {
  const base = path.basename(String(name || '')).replace(/\s+/g, '-').replace(/[^A-Za-z0-9._-]/g, '').replace(/^[.-]+/, '');
  return base.slice(0, 120);
}

/** The first free name for <stem>.<ext> in dir: stem, stem-2, stem-3… */
function freeName(dir, stem, ext) {
  const clean = safeName(stem).replace(/\.[^.]*$/, '') || 'image';
  for (let n = 1; n < 10000; n += 1) {
    const name = n === 1 ? `${clean}.${ext}` : `${clean}-${n}.${ext}`;
    if (!fs.existsSync(path.join(dir, name))) return name;
  }
  return `${clean}-${Date.now()}.${ext}`;
}

/** The next version of a file: <stem>-v2.<ext>, -v3… never the original. */
function versionName(dir, file, ext) {
  const stem = path.basename(file).replace(/\.[^.]*$/, '').replace(/-v\d+$/, '');
  for (let n = 2; n < 10000; n += 1) {
    const name = `${stem}-v${n}.${ext}`;
    if (!fs.existsSync(path.join(dir, name))) return name;
  }
  return `${stem}-v${Date.now()}.${ext}`;
}

module.exports = {
  IMAGE_RE, TYPES, typeOf, dimensions, safeIn, sidecarOf, describe, listFolder,
  EVERYWHERE, APP_SHOTS, SCAN_MAX, appShotsDir, scanEverywhere, forgetScan, sourceRoot,
  safeName, freeName, versionName,
  _parsers: { pngSize, gifSize, jpegSize, webpSize, avifSize, svgSize },
};
