/**
 * The settings files under core/config, read and written a LINE AT A TIME.
 *
 * Nothing here parses YAML and dumps it back. js-yaml would discard every comment, reflow the
 * quoting and reorder nothing but look like it had — turning a one-key change into an unreviewable
 * diff of the whole file. These files are hand-maintained and heavily commented (they are how the
 * workspace is configured), so an edit here replaces the LINES it means to change and leaves the
 * rest byte-for-byte.
 *
 * The other rule is about secrets: a secret's value is never sent to the browser, never echoed
 * back in a response and never written to the audit log. `isSecretKey` decides that, and it judges
 * the full dotted path — `account.pass` is the admin password a fresh install is given on this
 * machine, which is the one thing that field is for, so it is not treated as a secret.
 *
 * Extracted from server.js so the assistant can name the settings files without importing the web
 * server, and so the writers can be unit-tested against a real file rather than only through a
 * form post.
 */

const fs = require('fs');
const path = require('path');

const { CONFIG_DIR } = require('./workspaces');

// A theme's tokens are configuration like anything else here, so `theme.<name>.yml` is editable
// on the Settings screen rather than only by editing a stylesheet in the app's own directory.
const SETTINGS_FILE_RE = /^(settings\.yml|style\.yml|workspace\.[a-z0-9_-]+\.settings\.yml|plugin\.[a-z0-9_-]+\.settings\.yml|theme\.[a-z0-9_-]+\.yml)$/;

// Keys whose value must never reach the browser. Judged on the full path, because one
// "password" here is not a secret at all: `account.pass` is the admin password a fresh
// Drupal/Webship/Drupal CMS install is given on this machine. Masking it made the field
// unreadable for the one thing it is for — checking what you will log in with.
const NOT_SECRET_PATHS = new Set(['account.pass']);

function isSecretKey(key, dotted) {
  if (dotted && NOT_SECRET_PATHS.has(dotted)) return false;
  return /^(pass|password|passwd|token|api_key|apikey|secret|secret_key)$/i.test(key)
    || /(^|_)(token|secret|api_key|apikey|password|passwd)$/i.test(key);
}

function listSettingsFiles() {
  let files = [];
  try {
    files = fs.readdirSync(CONFIG_DIR).filter((f) => SETTINGS_FILE_RE.test(f));
  } catch (_) {
    return [];
  }
  // settings.yml first, then the per-workspace files alphabetically.
  // settings.yml, then style.yml, then the workspaces, then the themes — the order somebody
  // looks for them in, rather than the order the directory happens to list them.
  const rank = (f) => (f === 'settings.yml' ? 0 : f === 'style.yml' ? 1 : f.startsWith('workspace.') ? 2 : f.startsWith('plugin.') ? 3 : 4);
  return files.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

// Flatten a settings file into editable rows, straight from its lines so the
// order matches the file and nothing is invented.
//
// Scalars only. A list (settings.yml's `workspaces:`) is shown read-only: its
// order is the dashboard's card order and its membership registers a workspace,
// so it is not something to retype into a text field by accident.
function readSettingsRows(file) {
  const full = path.join(CONFIG_DIR, file);
  let text;
  try {
    text = fs.readFileSync(full, 'utf8');
  } catch (_) {
    return null;
  }
  return rowsFromText(text);
}

/**
 * The same walk over text rather than a file, so the raw editor can give the text somebody TYPED the
 * same dotted paths the file has. Matching a masked secret by its key alone was not enough: a file with
 * `git.github.token`, `git.drupal.token` and `git.bitbucket.token` has three keys called `token`, and
 * every one of them restored the first one's value — one service's token copied onto another.
 */
function rowsFromText(text) {
  const rows = [];
  const stack = [];   // [{ indent, key }]
  let notes = [];     // the comment lines straight above a key, which describe it
  text.split('\n').forEach((line, i) => {
    const c = line.match(/^\s*#\s?(.*)$/);
    if (c) { notes.push(c[1]); return; }
    const m = line.match(/^(\s*)([A-Za-z0-9_.-]+):\s*(.*)$/);
    const comment = notes.join(' ').replace(/\s+/g, ' ').trim();
    notes = [];
    if (!m) return;
    const [, indentStr, key, rawValue] = m;
    const indent = indentStr.length;
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const dotted = [...stack.map((x) => x.key), key].join('.');
    const value = rawValue.replace(/\s+#.*$/, '').trim();
    if (value === '') {
      // A parent key, or a key whose list items follow. Recorded so children get
      // their dotted path; only shown if it turns out to hold a list.
      stack.push({ indent, key });
      const next = text.split('\n')[i + 1] || '';
      if (/^\s*-\s+/.test(next)) rows.push({ line: i, dotted, key, value: '', list: true });
      return;
    }
    rows.push({ line: i, dotted, key, value, leaf: String(dotted).split('.').slice(-1)[0], secret: isSecretKey(key, dotted), comment });
  });
  return rows;
}

// Replace the value on one known line, leaving the rest of the file — comments,
// blank lines, quoting style, list blocks — exactly as it was.
function writeSettingsValues(file, updates) {
  const full = path.join(CONFIG_DIR, file);
  const lines = fs.readFileSync(full, 'utf8').split('\n');
  let changed = 0;
  for (const { line, key, value, bool } of updates) {
    const cur = lines[line];
    if (!cur) continue;
    const m = cur.match(/^(\s*)([A-Za-z0-9_.-]+):(\s*)(.*)$/);
    if (!m || m[2] !== key) continue;         // the file moved under us — skip it
    const [, indentStr, k, gap, rest] = m;
    const comment = rest.match(/\s+#.*$/);
    // Quote when the value could otherwise change type or break the parse.
    // A value that already is a quoted scalar ("" from an emptied field, '…' from a form) is kept as it is.
    const quoted = /^(".*"|'.*')$/.test(value);
    const needsQuote = !bool && !quoted
      && (/[:#]|^\s|\s$|^[@`!&*%|>{}\[\]?]|^-\s|^-$/.test(value) || (value !== '' && /^(y|n|yes|no|true|false|on|off|null|~)$/i.test(value)));
    const out = needsQuote ? JSON.stringify(value) : value;
    lines[line] = `${indentStr}${k}:${gap || ' '}${out}${comment ? comment[0] : ''}`;
    changed += 1;
  }
  fs.writeFileSync(full, lines.join('\n'));
  return changed;
}

// A list by its dotted path, so a nested one (auth.google.allowed_domains) is found as well as a top-level one.
function readListBlock(file, key) {
  const full = path.join(CONFIG_DIR, file);
  const text = fs.readFileSync(full, 'utf8');
  const lines = text.split('\n');
  const row = rowsFromText(text).find((r) => r.list && r.dotted === key);
  if (!row) return null;
  const start = row.line;
  const items = [];
  const raw = [];
  let end = start;
  for (let i = start + 1; i < lines.length; i += 1) {
    const m = lines[i].match(/^\s*-\s+(.+?)\s*$/);
    if (!m) break;
    items.push(m[1].replace(/\s+#.*$/, '').replace(/^["']|["']$/g, ''));
    raw.push(lines[i]);
    end = i;
  }
  const indent = (raw[0] || '').match(/^\s*/)[0] || `${lines[start].match(/^\s*/)[0]}  `;
  return { start, end, items, indent, raw };
}

// An entry that is kept keeps its own line, quotes and comment included; only new entries are written fresh.
function writeListBlock(file, key, items) {
  const full = path.join(CONFIG_DIR, file);
  const lines = fs.readFileSync(full, 'utf8').split('\n');
  const block = readListBlock(file, key);
  if (!block) throw new Error(`no ${key}: list in ${file}`);
  const rendered = items.map((n) => {
    const i = block.items.indexOf(n);
    return i === -1 ? `${block.indent}- ${n}` : block.raw[i];
  });
  lines.splice(block.start + 1, block.end - block.start, ...rendered);
  fs.writeFileSync(full, lines.join('\n'));
}

/**
 * The icon and subtitle on a workspace's card, changed IN PLACE.
 *
 * This used to render the whole `presentation:` block from the two fields the form posts and
 * splice it over whatever was there — which deleted every other key under it. That is not
 * hypothetical: `presentation:` also carries `label` (the RAG workspace's card says RAG while its
 * folder is `rag`), `noun`, `kind` and `also_files`, plus the comments explaining them. Choosing
 * an icon on the RAG card silently renamed the workspace to "rag" and dropped its buildable
 * behaviour.
 *
 * So: replace the `icon:` line and the `subtitle:` line, and touch nothing else. An empty value
 * removes just that line. A missing key is inserted at the top of the block, which is where both
 * already sit in every file that has them.
 */
function writeWorkspacePresentation(file, icon, subtitle) {
  const full = path.join(CONFIG_DIR, file);
  const lines = fs.readFileSync(full, 'utf8').split('\n');
  const start = lines.findIndex((l) => /^presentation:\s*$/.test(l));

  // No block yet: write one, with only the fields that have a value.
  if (start === -1) {
    const rendered = [];
    if (icon) rendered.push(`  icon: ${icon}`);
    if (subtitle) rendered.push(`  subtitle: ${JSON.stringify(subtitle)}`);
    if (!rendered.length) return;
    while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
    fs.writeFileSync(full, `${[...lines, 'presentation:', ...rendered].join('\n')}\n`);
    return;
  }

  // Where the block ends: the last line that is still indented under it.
  let end = start;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (!/^\s+\S/.test(lines[i]) && lines[i].trim() !== '') break;
    if (lines[i].trim() !== '') end = i;
  }

  // One key, edited where it stands. Comment lines and every other key are never touched.
  const setKey = (key, value) => {
    const at = lines.findIndex((l, i) => i > start && i <= end && new RegExp(`^\\s+${key}:`).test(l));
    if (!value) {
      if (at !== -1) { lines.splice(at, 1); end -= 1; }
      return;
    }
    const rendered = `  ${key}: ${key === 'subtitle' ? JSON.stringify(value) : value}`;
    if (at === -1) { lines.splice(start + 1, 0, rendered); end += 1; }
    else lines[at] = rendered;
  };

  setKey('icon', icon);
  setKey('subtitle', subtitle);

  // An empty block is not valid YAML: `presentation:` with nothing under it parses as null and
  // the loader would read a workspace with no presentation at all. Drop the header too.
  const stillHasKeys = lines.slice(start + 1, end + 1).some((l) => /^\s+[A-Za-z0-9_-]+:/.test(l));
  if (!stillHasKeys) lines.splice(start, end - start + 1);

  fs.writeFileSync(full, lines.join('\n'));
}


/* ------------------------------------------------------------------ *
 * The file itself, for the raw editor
 * ------------------------------------------------------------------ */

/**
 * What a secret's value is replaced with on its way to the browser, and what a save reads as "keep it".
 *
 * The line-by-line editor renders a secret as an empty password field, and a blank submission keeps
 * what is on disk. A raw editor cannot do that: the whole file goes to the browser, and the whole file
 * comes back. So the value is swapped for this on the way out, and any value that is still exactly this
 * on the way in is put back from disk — the same promise, expressed in a form a text editor can hold.
 *
 * Deliberately unlikely to be typed by accident, and deliberately visible: a row of dots would look
 * like a value somebody had set.
 */
const SECRET_MASK = '<<kept — the value on disk>>';

const SECRET_LINE = /^(\s*)([A-Za-z0-9_.-]+):[ \t]*(.*)$/;

/** The file as text, with every secret's value masked. Also says which keys were masked. */
function readSettingsText(file) {
  const full = path.join(CONFIG_DIR, file);
  let text;
  try { text = fs.readFileSync(full, 'utf8'); } catch (_) { return null; }
  const rows = readSettingsRows(file) || [];
  // `line` from readSettingsRows is a ZERO-based index into the file, which is what writeSettingsValues
  // indexes with too. Reading it as a line NUMBER masked the line after each secret — the next key's
  // value — and left the secret itself in the clear, which is the exact failure this must never have.
  const secretAtLine = new Map(rows.filter((r) => r.secret).map((r) => [r.line, r.dotted]));
  const masked = [];
  const lines = text.split('\n').map((line, i) => {
    const dotted = secretAtLine.get(i);
    if (!dotted) return line;
    const m = line.match(SECRET_LINE);
    if (!m || !m[3].trim()) return line;
    masked.push(dotted);
    return `${m[1]}${m[2]}: ${SECRET_MASK}`;
  });
  return { text: lines.join('\n'), masked };
}

/**
 * Write the file from the raw editor, putting every still-masked secret back from disk.
 *
 * Refuses rather than writes when: the text is not YAML at all, or it is not a mapping, or it is empty.
 * A settings file that does not parse takes the dashboard's whole configuration with it, and the person
 * who broke it is not necessarily the person who finds out.
 */
function writeSettingsText(file, text, { yaml }) {
  const full = path.join(CONFIG_DIR, file);
  const body = String(text == null ? '' : text).replace(/\r\n/g, '\n');
  if (!body.trim()) return { error: 'An empty file would take every setting in it with it.' };
  let parsed;
  try {
    parsed = yaml.load(body);
  } catch (err) {
    return { error: `That is not YAML: ${String(err.message || err).split('\n')[0]}` };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { error: 'A settings file is a mapping of keys to values.' };
  }

  // Every secret still wearing its mask keeps the value on disk. A secret whose mask was replaced was
  // deliberately retyped, and is taken literally — which is how a raw editor sets a new one.
  const onDisk = new Map((readSettingsRows(file) || []).filter((r) => r.secret).map((r) => [r.dotted, r]));
  let current = [];
  try { current = fs.readFileSync(full, 'utf8').split('\n'); } catch (_) { current = []; }
  // Where each line of the SUBMITTED text sits in the tree, so a masked value is matched by its whole
  // path and not by its key. Three services can each have a `token`, and restoring by key gave all
  // three the first one's value.
  const submitted = new Map(rowsFromText(body).map((r) => [r.line, r.dotted]));
  const kept = [];
  const lines = body.split('\n').map((line, i) => {
    const m = line.match(SECRET_LINE);
    if (!m || m[3].trim() !== SECRET_MASK) return line;
    const row = onDisk.get(submitted.get(i));
    const was = row ? (current[row.line] || '').match(SECRET_LINE) : null;
    // A masked value with nothing behind it — a key moved, or renamed — is written empty rather than
    // guessed at, and the mask never reaches the file.
    if (!was) return `${m[1]}${m[2]}:`;
    kept.push(row.dotted);
    return `${m[1]}${m[2]}: ${was[3]}`;
  });

  const out = lines.join('\n');
  const tmp = `${full}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, out.endsWith('\n') ? out : `${out}\n`);
  fs.renameSync(tmp, full);
  return { kept };
}

/**
 * Set one dotted key, creating whatever of its path the file does not have yet. A machine's settings.yml
 * is never overwritten by an update (it holds the real secrets), so a block added in a later release is
 * simply absent there; a feature that saves into it creates the lines on first use rather than failing.
 * An existing key is rewritten in place, comment and all; a missing one is added directly under its
 * parent, or at the end of the file for a new top-level block.
 */
function upsertSettingsValue(file, dotted, value) {
  const full = path.join(CONFIG_DIR, file);
  const text = fs.readFileSync(full, 'utf8');
  const row = rowsFromText(text).find((r) => r.dotted === dotted);
  const out = value === '' ? '""' : value;
  if (row) return writeSettingsValues(file, [{ line: row.line, key: row.key, value: out }]);

  const parts = dotted.split('.');
  const lines = text.split('\n');
  let parentLine = -1;
  let depth = 0;
  // Walk down the parents that exist: each must sit one level in from the one above it.
  for (; depth < parts.length - 1; depth += 1) {
    const indent = depth * 2;
    let found = -1;
    for (let i = parentLine + 1; i < lines.length; i += 1) {
      const m = lines[i].match(/^(\s*)(\S.*)$/);
      if (!m || m[2].startsWith('#')) continue;
      if (m[1].length < indent) break;                        // left the parent's block
      const bare = m[2].replace(/\s+#.*$/, '').trim();
      if (m[1].length !== indent) continue;
      if (bare === `${parts[depth]}:`) { found = i; break; }
      // An empty map in flow style (`plugins: {}`, the way the lean template ships it) is the parent too:
      // open it, or the key would be written again as a second block and the file would no longer parse.
      if (bare === `${parts[depth]}: {}`) { lines[i] = lines[i].replace(/:\s*\{\}/, ':'); found = i; break; }
    }
    if (found < 0) break;
    parentLine = found;
  }
  const add = [];
  for (let d = depth; d < parts.length; d += 1) add.push(`${' '.repeat(d * 2)}${parts[d]}:${d === parts.length - 1 ? ` ${!/^(".*"|'.*')$/.test(out) && /[:#]|^\s|\s$|^[@`!&*%|>{}\[\]?]|^-\s|^-$/.test(out) ? JSON.stringify(out) : out}` : ''}`);
  if (parentLine >= 0) lines.splice(parentLine + 1, 0, ...add);
  else {
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    lines.push('', ...add, '');
  }
  fs.writeFileSync(full, lines.join('\n'));
  return 1;
}

/**
 * Set a dotted key to a LIST, in place: the existing items under it are replaced and the rest of the file is
 * left alone; a key (or the path to it) the file lacks is created. An item is quoted unless it is a plain
 * word, since a bare * starts a YAML alias and a bare `true` is not a string.
 */
function upsertSettingsList(file, dotted, items) {
  const full = path.join(CONFIG_DIR, file);
  const lines = fs.readFileSync(full, 'utf8').split('\n');
  const parts = dotted.split('.');
  let parentLine = -1;
  let depth = 0;
  for (; depth < parts.length; depth += 1) {
    const indent = depth * 2;
    let found = -1;
    for (let i = parentLine + 1; i < lines.length; i += 1) {
      const m = lines[i].match(/^(\s*)(\S.*)$/);
      if (!m || m[2].startsWith('#')) continue;
      if (m[1].length < indent) break;
      if (m[1].length === indent && m[2].replace(/\s+#.*$/, '').trim().replace(/^([^:]+):.*$/, '$1:') === `${parts[depth]}:`) { found = i; break; }
    }
    if (found < 0) break;
    parentLine = found;
  }
  // A plain word (a folder name: dev, ai-agents) is written bare: the bash tooling reads this file too
  // (parse_yaml), and it keeps the quotes of a quoted item, so `- "dev"` is a folder named "dev" there.
  // Anything YAML could read as something else (a glob, a number, true, a word with a space) is quoted.
  const quote = (v) => (/^[A-Za-z_][A-Za-z0-9_.\/-]*$/.test(String(v)) && !/^(true|false|null|yes|no|on|off)$/i.test(String(v)) ? String(v) : JSON.stringify(String(v)));
  if (depth === parts.length) {
    // The key exists: drop its old items (the dash lines straight after it) and write the new ones.
    const keyIndent = (lines[parentLine].match(/^\s*/) || [''])[0].length;
    let end = parentLine + 1;
    while (end < lines.length && (/^\s*-\s/.test(lines[end]) || /^\s*-$/.test(lines[end])) && (lines[end].match(/^\s*/) || [''])[0].length >= keyIndent) end += 1;
    lines[parentLine] = lines[parentLine].replace(/:\s*(\[\])?\s*(#.*)?$/, ':$2').replace(/:$/, ':');
    lines.splice(parentLine + 1, end - parentLine - 1, ...items.map((v) => `${' '.repeat(keyIndent + 2)}- ${quote(v)}`));
    if (!items.length) lines[parentLine] = lines[parentLine].replace(/:\s*(#.*)?$/, ': []$1');
  } else {
    const add = [];
    for (let d = depth; d < parts.length; d += 1) add.push(`${' '.repeat(d * 2)}${parts[d]}:${d === parts.length - 1 && !items.length ? ' []' : ''}`);
    if (items.length) add.push(...items.map((v) => `${' '.repeat(parts.length * 2)}- ${quote(v)}`));
    if (parentLine >= 0) lines.splice(parentLine + 1, 0, ...add);
    else {
      while (lines.length && lines[lines.length - 1] === '') lines.pop();
      lines.push('', ...add, '');
    }
  }
  fs.writeFileSync(full, lines.join('\n'));
}

module.exports = {
  SETTINGS_FILE_RE,
  isSecretKey,
  listSettingsFiles,
  readSettingsRows,
  writeSettingsValues,
  upsertSettingsValue,
  upsertSettingsList,
  readSettingsText,
  writeSettingsText,
  rowsFromText,
  SECRET_MASK,
  readListBlock,
  writeListBlock,
  writeWorkspacePresentation,
};
