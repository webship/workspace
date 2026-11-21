/**
 * Is a test run's file empty evidence: a screenshot of one solid colour, or a recording too short to show anything?
 *
 * A failed step often screenshots a page that never rendered, and a scenario that failed on its first step records
 * under a second; listing either as evidence of a failure is worse than listing nothing. The report's lookup
 * (test-reports.js) drops them with artifactIsEmpty(). These lived in server.js and stayed there when the lookup moved
 * out, so every call threw, and the report listed no screenshot, recording or PDF at all (webship/workspace#677).
 */

const fs = require('fs');
const zlib = require('zlib');
const { VIDEO_RE } = require('./format');

// Shortest recording worth showing. A scenario that failed on its first step records well
// under a second and shows nothing; across the 737 recordings here the median is 5s and
// nothing is shorter than 0.96s, so a zero-length rule excluded none of them. At 2s this
// drops 159 of 737.
const MIN_VIDEO_SECONDS = 2;

// Is this PNG a single solid colour? A failed step often screenshots a page that never
// rendered, leaving a 1600x1200 sheet of white — 59 of the 735 screenshots in this tree,
// and 11 of the 21 in the report the test workspace shows. Listing one as evidence of a
// failure is worse than listing nothing.
//
// Decoded here rather than shelled out to PIL, and only for files small enough to plausibly
// be uniform (a solid PNG of that size is ~8KB; the smallest real screenshot here is 10KB,
// so the cap is generous). Returns null when the format is not one this handles, and null
// means KEEP: never hide real evidence over an unsupported bit depth.
function pngIsUniform(full, size) {
  if (size > 262144) return null;
  let buf;
  try { buf = fs.readFileSync(full); } catch (_) { return null; }
  if (buf.length < 26 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  let w = 0, h = 0, depth = 0, colour = 0, interlace = 0;
  const idat = [];
  let off = 8;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      depth = data[8]; colour = data[9]; interlace = data[12];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (!w || !h || depth !== 8 || interlace !== 0) return null;   // 16-bit, palette, interlaced: not judged
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colour];
  if (!channels) return null;
  let raw;
  try { raw = zlib.inflateSync(Buffer.concat(idat)); } catch (_) { return null; }
  const stride = w * channels;
  if (raw.length < (stride + 1) * h) return null;
  // Un-filter into one reusable scanline pair and compare every pixel with the first.
  const prev = Buffer.alloc(stride);
  const cur = Buffer.alloc(stride);
  let first = null;
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)];
    raw.copy(cur, 0, y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let v = cur[i];
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      } else if (ft !== 0) return null;
      cur[i] = v & 0xff;
    }
    if (first === null) first = Buffer.from(cur.subarray(0, channels));
    for (let x = 0; x < stride; x += channels) {
      for (let k = 0; k < channels; k++) if (cur[x + k] !== first[k]) return false;
    }
    cur.copy(prev);
  }
  return true;
}

// A recording's length, without ffprobe (the container has none). webm: the EBML Duration
// element scaled by TimecodeScale. mp4: mvhd duration / timescale. null when it cannot be
// read — and null means KEEP.
function videoSeconds(full) {
  let buf;
  try {
    const fd = fs.openSync(full, 'r');
    buf = Buffer.alloc(Math.min(262144, fs.fstatSync(fd).size));
    fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
  } catch (_) { return null; }
  const mvhd = buf.indexOf('mvhd');
  if (mvhd > 0) {
    const version = buf[mvhd + 4];
    try {
      if (version === 1) {
        const scale = buf.readUInt32BE(mvhd + 8 + 16);
        const dur = Number(buf.readBigUInt64BE(mvhd + 8 + 20));
        return scale ? dur / scale : null;
      }
      const scale = buf.readUInt32BE(mvhd + 8 + 8);
      const dur = buf.readUInt32BE(mvhd + 8 + 12);
      return scale ? dur / scale : null;
    } catch (_) { return null; }
  }
  const i = buf.indexOf(Buffer.from([0x44, 0x89]));            // EBML Duration
  if (i < 0) return null;
  const size = buf[i + 2] & 0x7f;
  let val;
  try {
    if (size === 4) val = buf.readFloatBE(i + 3);
    else if (size === 8) val = buf.readDoubleBE(i + 3);
    else return null;
  } catch (_) { return null; }
  let scale = 1000000;                                          // EBML default, in nanoseconds
  const k = buf.indexOf(Buffer.from([0x2a, 0xd7, 0xb1]));       // TimecodeScale
  if (k >= 0) {
    const sl = buf[k + 3] & 0x7f;
    if (sl > 0 && sl <= 8) scale = Number(buf.readUIntBE(k + 4, sl));
  }
  return (val * scale) / 1e9;
}

// Both answers depend only on the bytes, so they are cached on path+size+mtime and never
// recomputed for an unchanged file. Without this a report with 300 screenshots would decode
// all of them on every job poll.
const _artifactJudgement = new Map();
function artifactIsEmpty(full, name, size, mtimeMs) {
  if (size === 0) return true;
  const k = `${full}:${size}:${mtimeMs}`;
  if (_artifactJudgement.has(k)) return _artifactJudgement.get(k);
  let verdict = false;
  if (/\.png$/i.test(name)) verdict = pngIsUniform(full, size) === true;
  else if (VIDEO_RE.test(name)) { const d = videoSeconds(full); verdict = d !== null && d <= MIN_VIDEO_SECONDS; }
  _artifactJudgement.set(k, verdict);
  return verdict;
}

module.exports = { artifactIsEmpty, pngIsUniform, videoSeconds, MIN_VIDEO_SECONDS };
