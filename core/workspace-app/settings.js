/**
 * Reading and writing core/config/*.yml for the settings page.
 *
 * Split out of server.js because it is one job with one seam: it turns settings files into rows
 * and rows back into files, and knows nothing about routing. `settingsPage` stays in server.js —
 * it needs the page shell, and importing that back would be circular.
 */

const fs = require('fs');
const path = require('path');

const { CONFIG_DIR, loadYaml, loadWorkspaces } = require('./workspaces');
const { esc } = require('./html');
const { iconHtml, tablerIcons } = require('./icons');

const SETTINGS_FILE_RE = /^(settings\.yml|workspace\.[a-z0-9_-]+\.settings\.yml)$/;

// A value that should not be echoed back into a page. A blank field keeps what is on disk.
function isSecretKey(key) {
  return /(pass|password|secret|token|api_key|apikey)$/i.test(key);
}

function listSettingsFiles() {
  let files = [];
  try {
    files = fs.readdirSync(CONFIG_DIR).filter((f) => SETTINGS_FILE_RE.test(f));
  } catch (_) {
    return [];
  }
  // settings.yml first, then the per-workspace files alphabetically.
  return files.sort((a, b) => (a === 'settings.yml' ? -1 : b === 'settings.yml' ? 1 : a.localeCompare(b)));
}

// Flatten a settings file into editable rows, straight from its lines so the order matches the
// file and nothing is invented.
//
// Scalars only. A list — settings.yml's `workspaces:` — is shown read-only: its order is the
// dashboard's card order and its membership is what registers a workspace, so it is not something
// to retype into a text field by accident.
// What a field is for, in the words of whoever has to set it. A settings file explains itself in
// comments; the form has to carry that across or it becomes a list of bare keys.
// What each settings field is for, and which values it accepts, read from
// core/config/settings-fields.yml rather than written into this file: a new field explains
// itself by being described in YAML, not by a code change here. Re-read with the same short memo
// as the workspaces, so editing the file shows up without a restart.
let _fieldsCache = null;
let _fieldsCacheAt = 0;
function fieldConfig() {
  const now = Date.now();
  if (_fieldsCache && now - _fieldsCacheAt < 2000) return _fieldsCache;
  let cfg = {};
  try {
    cfg = loadYaml(path.join(CONFIG_DIR, 'settings-fields.yml')) || {};
  } catch (_) { /* the form still works without it — every field just goes unexplained */ }
  const enums = {};
  for (const [key, list] of Object.entries(cfg.enums || {})) {
    if (Array.isArray(list)) enums[key] = list.map((o) => [String(o.value), String(o.label ?? o.value)]);
  }
  _fieldsCache = {
    hints: cfg.hints || {},
    enums,
    ordered: new Set(Array.isArray(cfg.ordered_lists) ? cfg.ordered_lists : []),
  };
  _fieldsCacheAt = now;
  return _fieldsCache;
}



// Lists whose ORDER is meaningful, not just their membership. `workspaces` is both what exists
// and the order the cards appear in, so it gets move controls; a plain set does not.

function fieldHint(dotted) {
  const text = fieldConfig().hints[dotted]
    || (/\.api_key$/.test(dotted) ? 'API key for this provider. Leave the placeholder to skip it.' : '')
    || (/\.pass(word)?$/.test(dotted) ? 'Stored in this file — never committed with a real value.' : '');
  return text ? `<span class="settings-hint">${esc(text)}</span>` : '';
}

function readListBlock(file, key) {
  const lines = fs.readFileSync(path.join(CONFIG_DIR, file), 'utf8').split('\n');
  const start = lines.findIndex((l) => new RegExp(`^${key}:\\s*$`).test(l));
  if (start === -1) return null;
  const items = [];
  let end = start;
  for (let i = start + 1; i < lines.length; i += 1) {
    const m = lines[i].match(/^\s*-\s+(.+?)\s*$/);
    if (!m) break;
    items.push(m[1].replace(/^["']|["']$/g, ''));
    end = i;
  }
  return { start, end, items };
}

function writeListBlock(file, key, items) {
  const full = path.join(CONFIG_DIR, file);
  const lines = fs.readFileSync(full, 'utf8').split('\n');
  const block = readListBlock(file, key);
  if (!block) throw new Error(`no ${key}: list in ${file}`);
  lines.splice(block.start + 1, block.end - block.start, ...items.map((n) => `  - ${n}`));
  fs.writeFileSync(full, lines.join('\n'));
}

// A list gets real controls rather than a read-only dump: for `workspaces` the order is the card
// order on the home page, and retyping it into a text field to change it is how a workspace gets
// lost.
function listEditorHtml(file, key, message) {
  const block = readListBlock(file, key);
  if (!block) return `<div class="msg error">${esc(file)} has no <code>${esc(key)}:</code> list.</div>`;
  const ordered = fieldConfig().ordered.has(key);
  const all = loadWorkspaces();
  const rows = block.items.map((name, i) => {
    if (!ordered) return `<li class="set-item">${esc(name)}</li>`;
    const known = all[name];
    const move = (dir, disabled, icon, title) => `
      <button type="button" class="uk-button uk-button-default uk-button-small" hx-post="/actions/list-move"
              hx-vals='{"file":"${esc(file)}","key":"${esc(key)}","name":"${esc(name)}","dir":"${dir}"}'
              hx-target="#list-editor" hx-swap="outerHTML" ${disabled ? 'disabled' : ''} title="${title}">
        <span uk-icon="icon: ${icon}; ratio: .7"></span></button>`;
    return `
      <li class="ws-item" draggable="true" data-ws="${esc(name)}">
        <span class="ws-handle" uk-icon="icon: menu; ratio: .7" title="Drag to reorder"></span>
        <span class="ws-order">${i + 1}</span>
        <span uk-icon="icon: ${esc(known ? known.icon : 'folder')}; ratio: .8"></span>
        <span class="ws-name">${esc(name)}</span>
        ${known ? '' : '<span class="uk-label">not loaded — restart the app</span>'}
        <span class="ws-move">${move('up', i === 0, 'chevron-up', 'Move up')}${move('down', i === block.items.length - 1, 'chevron-down', 'Move down')}</span>
      </li>`;
  }).join('');
  return `
    <div class="settings-row-block" id="list-editor" data-file="${esc(file)}" data-key="${esc(key)}">
      <label class="settings-key">${esc(key)}${ordered ? ' <span class="uk-text-meta">— order is the card order</span>' : ''}</label>
      ${message || ''}
      <ul class="ws-list">${rows}</ul>
    </div>`;
}

function readSettingsRows(file) {
  let text;
  try {
    text = fs.readFileSync(path.join(CONFIG_DIR, file), 'utf8');
  } catch (_) {
    return null;
  }
  const lines = text.split('\n');
  const rows = [];
  const stack = [];
  lines.forEach((line, i) => {
    const m = line.match(/^(\s*)([A-Za-z0-9_.-]+):\s*(.*)$/);
    if (!m) return;
    const [, indentStr, key, rawValue] = m;
    const indent = indentStr.length;
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const dotted = [...stack.map((x) => x.key), key].join('.');
    const value = rawValue.replace(/\s+#.*$/, '').trim();
    if (value === '') {
      // A parent key, or one whose list items follow. Recorded so children get their dotted
      // path; only shown when it turns out to hold a list.
      stack.push({ indent, key });
      if (/^\s*-\s+/.test(lines[i + 1] || '')) {
        const items = [];
        for (let j = i + 1; j < lines.length; j += 1) {
          const li = lines[j].match(/^\s*-\s+(.+?)\s*$/);
          if (!li) break;
          items.push(li[1].replace(/^["']|["']$/g, ''));
        }
        rows.push({ line: i, dotted, key, value: '', list: true, items });
      }
      return;
    }
    rows.push({ line: i, dotted, key, value, secret: isSecretKey(key) });
  });
  return rows;
}

// Replace the value on one known line, leaving the rest of the file — comments, blank lines,
// quoting style, list blocks — exactly as it was.
function writeSettingsValues(file, updates) {
  const full = path.join(CONFIG_DIR, file);
  const lines = fs.readFileSync(full, 'utf8').split('\n');
  let changed = 0;
  for (const { line, key, value, bool } of updates) {
    const cur = lines[line];
    if (cur === undefined) continue;
    const m = cur.match(/^(\s*)([A-Za-z0-9_.-]+):(\s*)(.*)$/);
    if (!m || m[2] !== key) continue;          // the file moved under us — skip it
    const [, indentStr, k, gap, rest] = m;
    const comment = rest.match(/\s+#.*$/);
    // Quote when the value would otherwise change type or break the parse.
    const needsQuote = !bool
      && (/[:#]|^\s|\s$/.test(value)
        || (value !== '' && /^(y|n|yes|no|true|false|on|off|null|~)$/i.test(value)));
    lines[line] = `${indentStr}${k}:${gap || ' '}${needsQuote ? JSON.stringify(value) : value}${comment ? comment[0] : ''}`;
    changed += 1;
  }
  if (changed) fs.writeFileSync(full, lines.join('\n'));
  return changed;
}

function settingsFieldHtml(r, file) {
  // A list is edited with its own controls; membership and order are not free text.
  if (r.list) return listEditorHtml(file, r.dotted);

  const id = `s_${r.line}`;
  const label = esc(r.dotted.split('.').slice(-1)[0]);
  const keyField = `<input type="hidden" name="k_${r.line}" value="${esc(r.key)}">`;

  if (r.secret) {
    return `
      <div class="settings-row">
        <label class="settings-key" for="${id}">${label} <span class="uk-label">secret</span>${fieldHint(r.dotted)}</label>
        <input class="uk-input" id="${id}" name="v_${r.line}" type="password" value=""
               placeholder="${r.value ? 'set — leave blank to keep it' : 'not set'}" autocomplete="new-password">
        ${keyField}<input type="hidden" name="secret_${r.line}" value="1">
      </div>`;
  }

  const options = fieldConfig().enums[r.dotted];
  if (options) {
    const cur = String(r.value).trim();
    // An unknown value is kept as an extra option rather than silently corrected: the file says
    // one thing and the form must not quietly say another.
    const known = options.some(([v]) => v === cur);
    return `
      <div class="settings-row">
        <label class="settings-key" for="${id}">${label}${fieldHint(r.dotted)}</label>
        <select class="uk-select" id="${id}" name="v_${r.line}">
          ${options.map(([v, l]) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`).join('')}
          ${known ? '' : `<option value="${esc(cur)}" selected>${esc(cur)} — not a known value</option>`}
        </select>
        ${keyField}
      </div>`;
  }

  if (/^(true|false)$/i.test(String(r.value).trim())) {
    const on = String(r.value).trim().toLowerCase() === 'true';
    // The hidden false is what an UNCHECKED box submits — a checkbox sends nothing at all, which
    // the save loop reads as "no change", and the value could never be turned off.
    return `
      <div class="settings-row">
        <label class="settings-key" for="${id}">${label}${fieldHint(r.dotted)}</label>
        <label class="settings-toggle">
          <input type="hidden" name="v_${r.line}" value="false">
          <input class="uk-checkbox" id="${id}" type="checkbox" name="v_${r.line}" value="true"${on ? ' checked' : ''}>
          <span>${on ? 'on' : 'off'}</span>
        </label>
        ${keyField}
      </div>`;
  }

  return `
    <div class="settings-row">
      <label class="settings-key" for="${id}">${label}${fieldHint(r.dotted)}</label>
      <input class="uk-input" id="${id}" name="v_${r.line}" type="text" value="${esc(r.value)}">
      ${keyField}
    </div>`;
}

// Choosing an icon means seeing it, so the chooser is real radios with labels rather than a
// <select>, which can only render text. Radios also keep it keyboard-navigable and need no
// JavaScript — :checked + label does the highlighting.
//
// Tabler only. UIKit's icons still RENDER, and any value stored before this keeps working; they
// are simply not offered as a choice, because mixing a thin inconsistent set with 4,736 icons in
// one visual language produced cards that did not match each other.
function workspacePresentationHtml(file, message) {
  const key = file.replace(/^workspace\.|\.settings\.yml$/g, '');
  const meta = loadWorkspaces()[key];
  if (!meta) return '';
  const current = String(meta.icon || '').startsWith('tabler:')
    ? `<input class="icon-radio" type="radio" name="icon" id="ic-current" value="${esc(meta.icon)}" checked>
       <label class="icon-choice" for="ic-current" title="${esc(meta.icon.slice(7))}">${iconHtml(meta.icon, 0.9)}</label>`
    : '';
  return `
      <div class="settings-row settings-row-block" id="ws-presentation">
        <label class="settings-key">presentation <span class="uk-text-meta">(the card and the rail)</span></label>
        <div>
          ${message || ''}
          <div class="pres-preview">
            <span class="pres-icon">${iconHtml(meta.icon, 1.2)}</span>
            <span><strong>${esc(meta.label)}</strong><br><span class="uk-text-meta">${esc(meta.subtitle)}</span></span>
          </div>
          <input class="uk-input icon-filter" type="search" name="q"
                 placeholder="Search ${tablerIcons().size} icons by name…"
                 aria-label="Search icons by name" autocomplete="off"
                 hx-get="/fragments/icons" hx-trigger="keyup changed delay:250ms, search"
                 hx-target="#icon-grid-wrap" hx-swap="innerHTML">
          <div id="icon-grid-wrap" hx-get="/fragments/icons" hx-trigger="load" hx-swap="innerHTML">
            <div class="icon-grid">${current}</div>
          </div>
          <div class="pres-fields">
            <input class="uk-input" id="pres-subtitle" name="subtitle" value="${esc(meta.subtitle)}"
                   placeholder="What this workspace is for" maxlength="120">
            <button type="button" class="uk-button uk-button-primary uk-button-small"
                    hx-post="/actions/workspace-presentation"
                    hx-include="#ws-presentation .icon-radio:checked, #pres-subtitle"
                    hx-vals='{"file":"${esc(file)}"}' hx-target="#ws-presentation" hx-swap="outerHTML">
              <span uk-icon="icon: check; ratio: .7"></span> Save the card</button>
          </div>
          <p class="uk-text-meta">Written to <code>presentation:</code> in this file, which overrides the
            built-in table — so a workspace gets its icon and description without a code change.</p>
        </div>
      </div>`;
}

// Upsert the presentation block. The line-by-line writer only edits values that are already
// there, and these keys usually are not — so this one appends the block when it is missing and
// rewrites it in place when it is not.
function writeWorkspacePresentation(file, icon, subtitle) {
  const full = path.join(CONFIG_DIR, file);
  const lines = fs.readFileSync(full, 'utf8').split('\n');
  const start = lines.findIndex((l) => /^presentation:\s*$/.test(l));
  const rendered = ['presentation:'];
  if (icon) rendered.push(`  icon: ${icon}`);
  if (subtitle) rendered.push(`  subtitle: ${JSON.stringify(subtitle)}`);
  if (rendered.length === 1) rendered.length = 0;   // nothing set: drop the block

  if (start === -1) {
    if (!rendered.length) return;
    while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
    fs.writeFileSync(full, `${[...lines, ...rendered].join('\n')}\n`);
    return;
  }
  let end = start;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (!/^\s+\S/.test(lines[i])) break;
    end = i;
  }
  lines.splice(start, end - start + 1, ...rendered);
  fs.writeFileSync(full, lines.join('\n'));
}

function settingsFormHtml(file, message) {
  const rows = readSettingsRows(file);
  if (!rows) return '<div class="msg error">Could not read that settings file.</div>';
  const ws = file === 'settings.yml' ? null : file.replace(/^workspace\.|\.settings\.yml$/g, '');

  // Grouped the way the file is: keys under `account.` belong together, and a flat list of
  // twenty inputs hides which of them are related.
  const groups = [];
  for (const r of rows) {
    const parts = String(r.dotted).split('.');
    const section = parts.length > 1 ? parts.slice(0, -1).join('.') : '';
    const last = groups[groups.length - 1];
    if (last && last.section === section) last.rows.push(r);
    else groups.push({ section, rows: [r] });
  }
  const fields = groups.map((g) => {
    const body = g.rows.map((r) => settingsFieldHtml(r, file)).join('');
    if (!g.section) return body;
    return `<fieldset class="settings-group">
      <legend class="settings-group-name">${esc(g.section)}</legend>
      ${body}
    </fieldset>`;
  }).join('');

  return `
    <h3 class="uk-margin-small-bottom">${esc(file)}</h3>
    <p class="uk-text-meta">${ws
      ? `Settings for the <strong>${esc(ws)}</strong> workspace.`
      : 'Hub settings: the account installs are created with, and the workspaces that exist.'}
      Comments and formatting are preserved — only the lines you change are rewritten. Secrets are
      never sent to this page: a blank secret field keeps the value on disk.</p>
    ${message || ''}
    ${ws ? workspacePresentationHtml(file) : ''}
    <form hx-post="/actions/save-settings" hx-target="#settings-output" hx-swap="innerHTML">
      <input type="hidden" name="file" value="${esc(file)}">
      ${fields}
      <div class="uk-margin-top">
        <button type="submit" class="uk-button uk-button-primary"><span uk-icon="icon: check; ratio: .8"></span> Save ${esc(file)}</button>
      </div>
    </form>`;
}

module.exports = {
  SETTINGS_FILE_RE,
  fieldConfig,
  fieldHint,
  readListBlock,
  writeListBlock,
  listEditorHtml,
  readSettingsRows,
  writeSettingsValues,
  settingsFieldHtml,
  settingsFormHtml,
  listSettingsFiles,
  workspacePresentationHtml,
  writeWorkspacePresentation,
};
