/**
 * The records beside a made image: <file>.json for the dashboard and a readable <stem>.md for people. No
 * dependencies, so the host-side finish step of a Claude Code drawing can write them too.
 */

const fs = require('fs');
const path = require('path');

const RECORD_MARK = '<!-- images: how this image was made -->';

/** The readable record beside an image: <stem>.md, or <file>.md when a note of the same stem is someone else's. */
function recordPath(abs) {
  const stem = abs.replace(/\.[^./]*$/, '');
  const md = `${stem}.md`;
  try { if (fs.existsSync(md) && !fs.readFileSync(md, 'utf8').startsWith(RECORD_MARK)) return `${abs}.md`; } catch (_) { /* unreadable */ }
  return md;
}

/** Write the sidecar and the readable record for an image. */
function writeRecords(abs, rec) {
  const clean = Object.fromEntries(Object.entries(rec).filter(([, v]) => v !== undefined && v !== '' && v !== null));
  fs.writeFileSync(`${abs}.json`, `${JSON.stringify(clean, null, 2)}\n`);
  const name = path.basename(abs);
  const title = name.replace(/\.[^.]*$/, '').replace(/[-_]+/g, ' ');
  const line = (label, v) => (v ? `- **${label}:** ${String(v).replace(/\s+/g, ' ')}\n` : '');
  const src = clean.source && typeof clean.source === 'object' ? `${clean.source.workspace}/${clean.source.path}` : '';
  fs.writeFileSync(recordPath(abs), `${RECORD_MARK}
# ${title}

![${(clean.alt || title).replace(/[\[\]]/g, '')}](./${name})

${clean.summary ? `${clean.summary}\n\n` : '_No description written yet._\n\n'}**Alt text:** ${clean.alt || '_none yet_'}

## How it was made

${line('Prompt', clean.prompt)}${line('Edited from', src)}${line('Edit prompt', clean.edit_prompt)}${line('Source', typeof clean.source === 'string' ? clean.source : clean.from)}${line('Provider', clean.provider)}${line('Model', clean.model)}${line('Style', clean.style)}${line('Attempts', clean.attempts)}${line('Palette', clean.palette)}${line('Size', clean.size)}${line('Quality', clean.quality)}${line('PNG preview', clean.png)}${line('Made', clean.created)}${line('Cost', clean.cost)}${line('Description', clean.described_by ? `${clean.described_by}, ${clean.description_cost || ''}`.replace(/, $/, '') : '')}`);
}

module.exports = { RECORD_MARK, recordPath, writeRecords };
