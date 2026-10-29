/**
 * The voiceover script of a video, shown with it.
 *
 * A recording's script sits in docs/ beside the write-up, named after the video: `<video>-voiceover-script.md`.
 * People who watch the video, or cannot hear it, want the words; this finds the script and draws the spoken
 * lines, section by section, with the section's start time as a button that seeks the player.
 */

const fs = require('fs');
const path = require('path');

const { esc } = require('./html');

const SUFFIXES = ['-voiceover-script', '-voiceover', '-transcript', '-script'];
const HEADING = /^##\s+(\S+)\s+(.+?)\s+\(((?:\d+:)?\d{1,2}:\d{2}(?:\.\d+)?)\s+to\s+((?:\d+:)?\d{1,2}:\d{2}(?:\.\d+)?)\)\s*$/;
const MAX_BYTES = 200 * 1024;

const memo = new Map();

/** The markdown files at the top of `dir`, remembered for a moment: a list asks once per row. */
function scriptNames(dir) {
  const hit = memo.get(dir);
  if (hit && Date.now() - hit.at < 3000) return hit.names;
  let names = new Set();
  try { names = new Set(fs.readdirSync(dir).filter((n) => n.endsWith('.md'))); } catch (_) { /* no such folder */ }
  memo.set(dir, { at: Date.now(), names });
  return names;
}

/**
 * The script file of a video stem, or null. It is looked for in docs/ first and then in `also`, a
 * `{ dir, key }` for a second folder (the videos folder, where some scripts were saved beside their video).
 */
function findScript(docsDir, stem, also = null) {
  for (const dir of [docsDir, also && also.dir].filter(Boolean)) {
    const names = scriptNames(dir);
    const hit = SUFFIXES.map((s) => `${stem}${s}.md`).find((n) => names.has(n));
    if (hit) return hit;
  }
  return null;
}

/** Which folder holds a script `findScript` found: `{ dir, key }`, docs/ first. */
function locateScript(docsDir, name, also = null) {
  if (also && !scriptNames(docsDir).has(name) && scriptNames(also.dir).has(name)) return { dir: also.dir, key: also.key };
  return { dir: docsDir, key: 'docs' };
}

/** Give every recording its script, in the same pass that built the rows. */
function attachScripts(groups, docsDir, also = null) {
  for (const [stem, g] of groups) {
    if (g.video) g.script = findScript(docsDir, stem, also);
  }
  return groups;
}

const seconds = (stamp) => stamp.split(':').reduce((t, part) => t * 60 + parseFloat(part), 0);

function stamp(sec) {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}

const spoken = (line) => line.replace(/^>\s?/, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*`]/g, '').trim();

/**
 * The script as people read it. A timed script gives sections with their spoken lines; anything else
 * gives its paragraphs. On-screen notes, tables and metadata are not words anyone says, so they stay out.
 */
function parseTranscript(text) {
  const lines = String(text).split('\n');
  const title = ((lines.find((l) => /^#\s+/.test(l)) || '').replace(/^#\s+/, '').trim()) || '';
  if (lines.some((l) => HEADING.test(l))) {
    const sections = [];
    for (const line of lines) {
      const h = line.match(HEADING);
      if (h) { sections.push({ id: h[1], title: h[2], start: seconds(h[3]), end: seconds(h[4]), lines: [] }); continue; }
      if (sections.length && line.startsWith('> ')) {
        const optional = /\*\(optional\)\*/.test(line);
        const t = spoken(line.replace(/\*\(optional\)\*\s*/g, ''));
        if (t) sections[sections.length - 1].lines.push({ text: t, optional });
      }
    }
    return { title, timed: true, sections: sections.filter((s) => s.lines.length) };
  }
  const quoted = lines.filter((l) => l.startsWith('> ')).map(spoken).filter(Boolean);
  const paragraphs = quoted.length ? quoted
    : String(text).split(/\n\s*\n/).map((b) => b.split('\n').filter((l) => l.trim() && !/^\s*(#|[-*+]\s|\||\d+[.)]\s)/.test(l)).join(' ').trim()).filter(Boolean);
  return { title, timed: false, paragraphs };
}

const SOUND_TEXT = ['.txt', '.md', '-transcript.md', '-transcript.txt', '-script.md', '-voiceover-script.md'];
const RECORD_ORDER = [['kind', 'Made as'], ['engine', 'With'], ['voice', 'Voice'], ['model', 'Model'], ['duration', 'Duration (s)'], ['seconds', 'Length (s)'],
  ['loop', 'Loop'], ['instrumental', 'Instrumental'], ['created_utc', 'Made']];

/** What belongs to a sound, beside it: the text it was made from, and the record of how. */
function soundBelongings(dir, stem) {
  let text = null;
  for (const suffix of SOUND_TEXT) {
    try {
      const f = path.join(dir, stem + suffix);
      if (fs.statSync(f).size <= MAX_BYTES) { text = { file: stem + suffix, content: fs.readFileSync(f, 'utf8') }; break; }
    } catch (_) { /* not there */ }
  }
  let record = null;
  try { record = JSON.parse(fs.readFileSync(path.join(dir, `${stem}.json`), 'utf8')); } catch (_) { /* none */ }
  return { text, record };
}

function recordHtml(rec) {
  if (!rec || typeof rec !== 'object') return '';
  const rows = RECORD_ORDER.filter(([k]) => rec[k] !== undefined && rec[k] !== '' && typeof rec[k] !== 'object')
    .map(([k, label]) => `<span class="sound-fact"><span class="uk-text-meta">${label}</span> ${esc(typeof rec[k] === 'boolean' ? (rec[k] ? 'yes' : 'no') : String(rec[k]))}</span>`);
  return rows.length ? `<p class="sound-record">${rows.join('')}</p>` : '';
}

/** A sound's card: how it was made, and the words. `hrefFor` turns a file beside it into its address. */
function soundCardHtml(dir, stem, hrefFor) {
  const { text, record } = soundBelongings(dir, stem);
  if (!text && !record) return null;
  const made = record && (record.kind === 'sound' || record.kind === 'music');
  const body = text ? transcriptHtml(parseTranscript(text.content), { file: text.file, href: hrefFor(text.file) })
    .replace('<h4 class="uk-margin-small-bottom">Transcript', `<h4 class="uk-margin-small-bottom">${made ? 'Description' : 'Transcript'}`) : '';
  return `<div class="sound-card">${recordHtml(record)}${body}</div>`;
}

/** The transcript as markup. `seek` makes each section's time a button the player answers to. */
function transcriptHtml(parsed, { file, href, seek = false, heading = true } = {}) {
  const from = file ? `<span class="uk-text-meta">from <a href="${esc(href)}" target="_blank">${esc(file)}</a></span>` : '';
  let body;
  if (parsed.timed) {
    body = parsed.sections.map((s) => {
      const time = seek
        ? `<button type="button" class="transcript-seek" data-seek="${s.start}" title="Play from ${stamp(s.start)}">${stamp(s.start)}</button>`
        : `<span class="transcript-time">${stamp(s.start)}</span>`;
      return `<section class="transcript-section" data-start="${s.start}" data-end="${s.end}"><h5>${time} ${esc(s.title)}</h5>${s.lines.map((l) => `<p${l.optional ? ' class="is-optional" title="Optional: dropped when the speech runs long"' : ''}>${esc(l.text)}</p>`).join('')}</section>`;
    }).join('');
  } else {
    body = parsed.paragraphs.map((p) => `<p>${esc(p)}</p>`).join('');
  }
  const head = heading ? `<h4 class="uk-margin-small-bottom">Transcript ${from}</h4>` : (from ? `<p class="uk-margin-small-bottom">${from}</p>` : '');
  return `<div class="transcript">${head}<div class="transcript-body">${body || '<p class="uk-text-meta">The script has no spoken lines.</p>'}</div></div>`;
}

/** The sections of a timed script as chapters: where each starts and ends, and what it is called. */
function chaptersFor(docsDir, scriptName, also = null) {
  if (!scriptName) return [];
  try {
    const parsed = parseTranscript(fs.readFileSync(path.join(locateScript(docsDir, scriptName, also).dir, scriptName), 'utf8'));
    return parsed.timed ? parsed.sections.map((s) => ({ start: s.start, end: s.end, title: `${s.id} ${s.title}` })) : [];
  } catch (_) { return []; }
}

/** Read and draw a script from docs/, or null when there is none or it cannot be read. */
function transcriptFor(docsDir, scriptName, { also = null, ...opts } = {}) {
  if (!scriptName) return null;
  const home = locateScript(docsDir, scriptName, also);
  const file = path.join(home.dir, scriptName);
  try {
    if (fs.statSync(file).size > MAX_BYTES) return null;
    return transcriptHtml(parseTranscript(fs.readFileSync(file, 'utf8')), { file: scriptName, href: `/files/${home.key}/${encodeURIComponent(scriptName)}`, ...opts });
  } catch (_) { return null; }
}

module.exports = { findScript, locateScript, attachScripts, parseTranscript, transcriptHtml, transcriptFor, chaptersFor, soundBelongings, recordHtml, soundCardHtml, stamp, SUFFIXES };
