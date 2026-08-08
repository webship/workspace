/**
 * The Obsidian vault a graphed project can have, and the menu entries that make and read it.
 *
 * A vault is made FROM the graph — `cmd-tools-obsidian.sh` reads `graph.json` and writes notes,
 * wikilinks and a JSON Canvas — so it lives inside the graph store at
 * `graphs/<workspace>/<project>/obsidian/` and is thrown away with it. It also means the entries
 * belong in the Graph menu rather than a menu of their own: without a graph there is nothing to
 * convert, and a second button that is disabled most of the time only adds noise to the row.
 *
 * `views.js` builds the row's menu from this and `server.js` serves what the menu points at, so
 * the menu cannot offer a file the server will not find.
 */

const fs = require('fs');
const path = require('path');

const { ROOT } = require('./workspaces');
const { esc } = require('./html');
const { graphStoreDir } = require('./graphs');

// Where a project's vault lives. Inside its graph, never inside the project.
function vaultDir(wsKey, project) {
  return path.join(graphStoreDir(wsKey, project), 'obsidian');
}

// The index note is named after the project, with the same sanitising the builder applies, so the
// server and the builder agree on one filename.
function indexNote(project) {
  return `${String(project).replace(/[\\/:*?"<>|[\]#^]+/g, '-').replace(/^[ .-]+|[ .-]+$/g, '').slice(0, 120) || 'unnamed'}.md`;
}

// Same memo window as the graph's: a row re-renders once a second while a job runs, and asking the
// filesystem per render turns a list of twenty projects into a stream of stat calls.
let _cache = new Map();
let _cacheAt = 0;
function hasVault(wsKey, project) {
  const now = Date.now();
  if (now - _cacheAt > 2000) { _cache = new Map(); _cacheAt = now; }
  const k = `${wsKey}/${project}`;
  if (!_cache.has(k)) _cache.set(k, fs.existsSync(path.join(vaultDir(wsKey, project), '.obsidian')));
  return _cache.get(k);
}

/**
 * The Obsidian entries of the Graph menu.
 *
 * Returned as a list of `<li>` strings rather than a menu, because they hang off the Graph button:
 * `graphMenuHtml` decides where they sit and only asks for them once a graph exists.
 */
function obsidianMenuItems(key, project, vals, busy) {
  const built = hasVault(key, project);
  const items = ['<li class="uk-nav-divider"></li>', '<li class="uk-nav-header">Obsidian</li>'];

  items.push(`<li><a href hx-post="/actions/obsidian" ${vals()} class="${busy ? 'uk-disabled' : ''}"><span uk-icon="icon: file-edit; ratio: .7"></span> ${built ? 'Rebuild the vault' : 'Build the vault'}${busy ? ' (running…)' : ''}</a></li>`);

  if (built) {
    // A desktop protocol link, not an HTTP one: it hands the absolute path to the Obsidian app on
    // the machine running the browser. Every reserved character has to be encoded — an unescaped
    // slash makes Obsidian read the path as a vault name and open the wrong thing, or nothing.
    const uri = `obsidian://open?path=${encodeURIComponent(vaultDir(key, project))}`;
    items.push(`<li><a href="${esc(uri)}" title="Opens the Obsidian app on this machine"><span uk-icon="icon: link-external; ratio: .7"></span> Open in Obsidian</a></li>`);
    items.push(`<li><a href hx-get="/obsidian/${esc(key)}/${esc(project)}/index" hx-target="#editor-modal-body" hx-swap="innerHTML"><span uk-icon="icon: list; ratio: .7"></span> Read the index</a></li>`);
    items.push(`<li><a href="/obsidian/${esc(key)}/${esc(project)}/download" title="The vault as a .tar.gz, to open on another machine"><span uk-icon="icon: download; ratio: .7"></span> Download the vault</a></li>`);
    items.push(`<li><a href class="uk-text-danger arm-step" data-armed="0" hx-post="/actions/obsidian-remove" ${vals(',"confirm":"yes"')} hx-trigger="confirmed-remove"><span uk-icon="icon: trash; ratio: .7"></span> Delete the vault</a></li>`);
  }

  return items.join('');
}

module.exports = { vaultDir, hasVault, obsidianMenuItems, indexNote };
