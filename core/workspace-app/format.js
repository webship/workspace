/**
 * How a size, a time and a video are said, in one place.
 *
 * Small, and imported by nearly everything that renders — which is exactly why it is not left
 * in the middle of the server.
 */

// What counts as a video, in one place: the listing, the play fragment and the row icon all have
// to agree, or a file gets a Play button that 404s.
const VIDEO_RE = /\.(mp4|m4v|webm|ogv|mov)$/i;
// Sound the browser plays in an <audio> element; the listing, the player and the file route share it.
const AUDIO_RE = /\.(mp3|wav|ogg|oga|opus|m4a|aac|flac|weba)$/i;
// Rendered document formats a docs row can carry beside its markdown.
const DOC_ARTIFACT_RE = /\.(pdf|html?|docx?|xlsx?|pptx?|odt|ods|odp|rtf|csv)$/i;

function humanTime(d) {
  if (!(d instanceof Date) || !d.getTime()) return '';
  const p = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d)
    .reduce((o, x) => (o[x.type] = x.value, o), {});
  const off = -d.getTimezoneOffset();
  const sign = off < 0 ? '-' : '+';
  const oh = String(Math.floor(Math.abs(off) / 60)).padStart(2, '0');
  const om = String(Math.abs(off) % 60).padStart(2, '0');
  return `${p.day} ${p.month} ${p.year} ${p.hour}:${p.minute} ${sign}${oh}:${om}`;
}

function humanSize(bytes) {
  if (bytes > 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
  if (bytes > 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return Math.max(1, Math.round(bytes / 1024)) + ' KB';
}


/**
 * A path as a person writes it: `~/workspace/dev/site1`, not
 * `/home/rajab/workspace/dev/site1`. Every path the dashboard SHOWS goes
 * through this — the home prefix is noise in a UI, and it is the one part of a
 * path that differs between machines, so a command someone copies from here
 * should paste cleanly on theirs.
 */
function tildePath(p) {
  const home = process.env.HOME || '';
  const s = String(p || '');
  if (!home || !s.startsWith(home)) return s;
  const rest = s.slice(home.length);
  return rest === '' ? '~' : (rest.startsWith('/') ? `~${rest}` : s);
}

// A CLI's error, trimmed for a person to read.
//
// Tail-slicing is right for a build log — the end is where the failure is — and wrong
// for a command's error: these CLIs print the REASON first and then a usage synopsis,
// so `.slice(-300)` showed a list of flags and threw the reason away. An unreadable
// error is worse than a long one: the Upsun token failure read as a syntax problem for
// as long as it was displayed that way.
function cliError(text, max = 400) {
  const raw = String(text || '').replace(/\r/g, '');
  const kept = raw.split('\n').filter((l) => {
    const t = l.trim();
    if (!t) return false;
    // the usage synopsis: "upsun environments [-I|--no-inactive] … [--] <command>"
    if (/\[-{1,2}[A-Za-z]/.test(t) && /\[--\]|\[-h\|--help\]/.test(t)) return false;
    if (/^Usage:$/i.test(t) || /^\s*[a-z][\w:.-]*( \[[^\]]+\])+\s*$/.test(t)) return false;
    return true;
  }).join('\n').trim();
  const out = kept || raw.trim();
  return out.length > max ? out.slice(0, max) + '…' : out;
}

module.exports = {
  tildePath, cliError,
  DOC_ARTIFACT_RE, VIDEO_RE, AUDIO_RE, humanTime, humanSize };
