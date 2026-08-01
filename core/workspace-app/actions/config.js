/**
 * Editing what is in core/config — the settings files, the ordered lists, a workspace's card.
 *
 * One module per area of the dashboard, each exporting the handlers it owns keyed by the path
 * that reaches them. server.js merges the maps and dispatches; nothing here knows about routing,
 * and adding an action is adding an entry rather than another branch in a 650-line function.
 *
 * Every handler takes the same context: the parsed form, the response, a `send` that writes an
 * HTML fragment, and the workspace the request named.
 */


const { invalidateWorkspaces, loadWorkspaces } = require('../workspaces');
const { SETTINGS_FILE_RE, listEditorHtml, readListBlock, readSettingsRows, workspacePresentationHtml, writeListBlock, writeSettingsValues, writeWorkspacePresentation } = require('../settings');
const { esc } = require('../html');
const { workspaceCardsHtml } = require('../views');
const { tablerIcons } = require('../icons');
const handlers = {
  '/actions/list-order': async ({ form, res, send, workspace, req }) => {
    const file = String(form.file || '');
    const key = String(form.key || '');
    if (!SETTINGS_FILE_RE.test(file)) return send('<div class="msg error">Not a settings file.</div>', 400);
    if (!/^[a-z][a-z0-9_]*$/.test(key)) return send('<div class="msg error">Not a list name.</div>', 400);
    const block = readListBlock(file, key);
    if (!block) return send(`<div class="msg error">${esc(key)} is not a list in ${esc(file)}.</div>`, 400);
    const wanted = String(form.order || '').split(',').filter(Boolean);
    // The submitted order has to be the same set, or a dropped row would delete a workspace.
    const same = wanted.length === block.items.length && wanted.every((n) => block.items.includes(n));
    if (!same) return send('<div class="msg error">That order does not match the list — reload and try again.</div>', 409);
    // The order the page was rendered from comes back with the drag, so a save on top of someone
    // else's edit is refused rather than silently discarding it.
    const was = String(form.was || '');
    if (was && was !== block.items.join(',')) {
      return send('<div class="msg error">The order changed since this page was loaded — reload and try again.</div>', 409);
    }
    try {
      writeListBlock(file, key, wanted);
    } catch (err) {
      return send(`<div class="msg error">Could not write ${esc(file)}: ${esc(err.message)}</div>`, 500);
    }
    invalidateWorkspaces();
    // The drag happened either on the settings list or on the home cards; each gets its own
    // markup back, so the thing you dragged is the thing that re-renders.
    if (form.view === 'home') {
      return send(workspaceCardsHtml('<div class="msg assistant">✅ Order saved.</div>'));
    }
    return send(listEditorHtml(file, key, '<div class="msg assistant">Order saved.</div>'));
  },
  '/actions/list-move': async ({ form, res, send, workspace, req }) => {
    const file = String(form.file || '');
    const key = String(form.key || '');
    const name = String(form.name || '');
    const dir = form.dir === 'up' ? -1 : 1;
    if (!SETTINGS_FILE_RE.test(file)) return send('<div class="msg error">Not a settings file.</div>', 400);
    if (!/^[a-z][a-z0-9_]*$/.test(key)) return send('<div class="msg error">Not a list name.</div>', 400);
    const block = readListBlock(file, key);
    if (!block) return send(`<div class="msg error">${esc(key)} is not a list in ${esc(file)}.</div>`, 400);
    const items = [...block.items];
    const i = items.indexOf(name);
    if (i === -1) return send('<div class="msg error">That entry is not in the list.</div>', 404);
    const j = i + dir;
    if (j < 0 || j >= items.length) return send(listEditorHtml(file, key));
    [items[i], items[j]] = [items[j], items[i]];
    try {
      writeListBlock(file, key, items);
    } catch (err) {
      return send(`<div class="msg error">Could not write ${esc(file)}: ${esc(err.message)}</div>`, 500);
    }
    // The card order is this list. loadWorkspaces() caches for two seconds, so the next page
    // load re-reads it without anything having to invalidate it here.
    return send(listEditorHtml(file, key, `<div class="msg assistant">Moved <strong>${esc(name)}</strong>.</div>`));
  },
  '/actions/workspace-presentation': async ({ form, res, send, workspace, req }) => {
    const file = String(form.file || '');
    if (!SETTINGS_FILE_RE.test(file) || file === 'settings.yml') {
      return send('<div class="msg error">Not a workspace settings file.</div>', 400);
    }
    const icon = String(form.icon || '').trim();
    // Only an icon this dashboard can actually draw, so a typo cannot leave a card blank.
    if (icon && !(icon.startsWith('tabler:') && tablerIcons().has(icon.slice(7)))) {
      return send('<div class="msg error">That is not an icon in the library.</div>', 400);
    }
    const subtitle = String(form.subtitle || '').trim();
    try {
      writeWorkspacePresentation(file, icon, subtitle);
    } catch (err) {
      return send(`<div class="msg error">Could not write ${esc(file)}: ${esc(err.message)}</div>`, 500);
    }
    // The card order and the card itself both come from these files, so the memo has to go.
    invalidateWorkspaces();
    return send(workspacePresentationHtml(file, '<div class="msg assistant">✅ Card saved.</div>'));
  },
  '/actions/save-settings': async ({ form, res, send, workspace, req }) => {
    // A duplicated field means the form carried more than one `file`. String() would quietly turn
    // ['a','a'] into "a,a"; refuse rather than guess which was meant.
    if (Array.isArray(form.file)) return send('<div class="msg error">Ambiguous request — reload the page and try again.</div>', 400);
    const file = String(form.file || '');
    if (!SETTINGS_FILE_RE.test(file)) return send('<div class="msg error">Not a settings file.</div>', 400);
    const rows = readSettingsRows(file);
    if (!rows) return send('<div class="msg error">Could not read that settings file.</div>', 400);

    const updates = [];
    let keptSecrets = 0;
    for (const r of rows) {
      if (r.list) continue;
      const submittedKey = form[`k_${r.line}`];
      if (submittedKey === undefined) continue;
      // The line must still hold the key the form was built from, or the file changed since it was
      // rendered and this value belongs somewhere else now.
      if (submittedKey !== r.key) {
        return send('<div class="msg error">That file changed since this form was opened — reload and try again.</div>', 409);
      }
      const raw = form[`v_${r.line}`];
      const value = String((Array.isArray(raw) ? raw[raw.length - 1] : raw) ?? '');
      if (form[`secret_${r.line}`] === '1' && value === '') { keptSecrets += 1; continue; }
      if (value === r.value) continue;
      updates.push({
        line: r.line, key: r.key, value,
        // The row already held a boolean and so does the new value: write it unquoted so it stays
        // a YAML boolean. Quoting makes `active: "true"` — a string the shell reader never matches.
        bool: /^(true|false)$/i.test(String(r.value).trim()) && /^(true|false)$/i.test(value),
      });
    }

    if (!updates.length) {
      return send(`<div class="msg assistant">Nothing to change.${keptSecrets ? ` ${keptSecrets} secret(s) left as they are.` : ''}</div>`);
    }
    let changed = 0;
    try {
      changed = writeSettingsValues(file, updates);
    } catch (err) {
      return send(`<div class="msg error">Could not write ${esc(file)}: ${esc(err.message)}</div>`, 500);
    }
    return send(`<div class="msg assistant">✅ Saved <strong>${esc(file)}</strong> — ${changed} value(s) changed.${keptSecrets ? ` ${keptSecrets} secret(s) left as they are.` : ''}</div>`);
  },
};

module.exports = handlers;
