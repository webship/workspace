/**
 * How long a recording or a sound runs, read from the file itself.
 *
 * The dashboard's container has no ffprobe, and a card that shows a length is worth a few kilobytes of
 * reading: mp4/m4v/mov/m4a from the movie header (at the front or the end of the file), webm from its
 * Duration element, wav from its header, and mp3 from its first frame, which is exact for the constant
 * bit rate files the tooling makes. Anything else is unknown, and unknown is shown as nothing.
 */

const fs = require('fs');
const path = require('path');

const MP4_RE = /\.(mp4|m4v|mov|m4a)$/i;
const cache = new Map();

function read(fd, start, length) {
  const buf = Buffer.alloc(length);
  const got = fs.readSync(fd, buf, 0, length, start);
  return got < length ? buf.subarray(0, got) : buf;
}

function mvhdSeconds(buf) {
  const at = buf.indexOf('mvhd');
  if (at < 0) return null;
  try {
    if (buf[at + 4] === 1) {
      const scale = buf.readUInt32BE(at + 8 + 16);
      return scale ? Number(buf.readBigUInt64BE(at + 8 + 20)) / scale : null;
    }
    const scale = buf.readUInt32BE(at + 8 + 8);
    return scale ? buf.readUInt32BE(at + 8 + 12) / scale : null;
  } catch (_) { return null; }
}

/** The movie header of an mp4-family file, wherever the encoder put it: walk the top-level boxes. */
function mp4Seconds(fd, size) {
  let pos = 0;
  for (let hops = 0; pos + 16 <= size && hops < 64; hops += 1) {
    const head = read(fd, pos, 16);
    let box = head.readUInt32BE(0);
    const type = head.toString('latin1', 4, 8);
    if (box === 1) box = Number(head.readBigUInt64BE(8));
    else if (box === 0) box = size - pos;
    if (type === 'moov') return mvhdSeconds(read(fd, pos, Math.min(box, 512)));
    if (box < 8) return null;
    pos += box;
  }
  return null;
}

function webmSeconds(fd, size) {
  const buf = read(fd, 0, Math.min(262144, size));
  const i = buf.indexOf(Buffer.from([0x44, 0x89]));
  if (i < 0) return null;
  const len = buf[i + 2] & 0x7f;
  let value;
  try {
    if (len === 4) value = buf.readFloatBE(i + 3);
    else if (len === 8) value = buf.readDoubleBE(i + 3);
    else return null;
  } catch (_) { return null; }
  let scale = 1000000;
  const k = buf.indexOf(Buffer.from([0x2a, 0xd7, 0xb1]));
  if (k >= 0) {
    const n = buf[k + 3] & 0x7f;
    if (n > 0 && n <= 8) scale = Number(buf.readUIntBE(k + 4, n));
  }
  return (value * scale) / 1e9;
}

function wavSeconds(fd, size) {
  const buf = read(fd, 0, Math.min(4096, size));
  if (buf.toString('latin1', 0, 4) !== 'RIFF') return null;
  const fmt = buf.indexOf('fmt ');
  const data = buf.indexOf('data');
  if (fmt < 0 || data < 0) return null;
  const rate = buf.readUInt32LE(fmt + 8 + 8);
  const bytes = Math.min(buf.readUInt32LE(data + 4), size - data - 8);
  return rate ? bytes / rate : null;
}

const MP3_RATES = {
  1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};

function mp3Seconds(fd, size) {
  const head = read(fd, 0, Math.min(65536, size));
  let at = 0;
  if (head.toString('latin1', 0, 3) === 'ID3') at = 10 + ((head[6] & 0x7f) << 21 | (head[7] & 0x7f) << 14 | (head[8] & 0x7f) << 7 | (head[9] & 0x7f));
  for (let i = at; i + 4 < head.length; i += 1) {
    if (head[i] !== 0xff || (head[i + 1] & 0xe0) !== 0xe0) continue;
    const version = (head[i + 1] >> 3) & 3;
    const layer = (head[i + 1] >> 1) & 3;
    const index = head[i + 2] >> 4;
    if (version === 1 || layer !== 1 || index === 0 || index === 15) continue;
    const table = MP3_RATES[version === 3 ? 1 : 2];
    const kbps = table[index];
    return kbps ? ((size - i) * 8) / (kbps * 1000) : null;
  }
  return null;
}

/** Seconds, or null when the file cannot be read or is of a kind not understood. Cached on path, size and time. */
function seconds(full) {
  let st;
  try { st = fs.statSync(full); } catch (_) { return null; }
  const key = `${full}|${st.size}|${st.mtimeMs}`;
  if (cache.has(key)) return cache.get(key);
  let found = null;
  let fd;
  try {
    fd = fs.openSync(full, 'r');
    const ext = path.extname(full).toLowerCase();
    if (MP4_RE.test(ext)) found = mp4Seconds(fd, st.size);
    else if (ext === '.webm' || ext === '.weba') found = webmSeconds(fd, st.size);
    else if (ext === '.wav') found = wavSeconds(fd, st.size);
    else if (ext === '.mp3') found = mp3Seconds(fd, st.size);
  } catch (_) { found = null; } finally { if (fd !== undefined) fs.closeSync(fd); }
  if (!(found > 0) || !Number.isFinite(found)) found = null;
  cache.set(key, found);
  if (cache.size > 4000) cache.delete(cache.keys().next().value);
  return found;
}

/** 7:56, or 1:02:03: the way a player says it, with no leading zero on the largest unit. */
function clock(sec) {
  if (!(sec > 0)) return '';
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

module.exports = { seconds, clock };
