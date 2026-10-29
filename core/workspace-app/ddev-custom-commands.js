'use strict';

/**
 * What a DDEV folder can run by name, for the DDEV menu: its own `ddev <command>`s from .ddev/commands,
 * the scripts in its composer.json (once composer.lock is there) and the scripts in its package.json.
 * Each group folds under its heading like the rest of the menu.
 */

const fs = require('fs');
const path = require('path');

const { esc } = require('./html');

const COMMAND_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,60}$/;
// The folders DDEV runs a command in: the host, or the service of that name.
const SERVICE_RE = /^[a-z0-9][a-z0-9_-]{0,40}$/;

function annotation(text, key) {
  const m = text.match(new RegExp(`^##\\s*${key}:\\s*(.+)$`, 'mi'));
  return m ? m[1].trim() : '';
}

function projectType(projectPath) {
  try {
    const m = fs.readFileSync(path.join(projectPath, '.ddev', 'config.yaml'), 'utf8').match(/^type:\s*["']?([\w-]+)/m);
    return m ? m[1] : '';
  } catch (_) { return ''; }
}

/** The project's custom commands, as DDEV lists them: one per file under .ddev/commands/<service>/. */
function customCommands(projectPath) {
  const root = path.join(projectPath, '.ddev', 'commands');
  let services = [];
  try { services = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && SERVICE_RE.test(d.name)); } catch (_) { return []; }
  const type = projectType(projectPath);
  const out = [];
  for (const s of services) {
    let files = [];
    try { files = fs.readdirSync(path.join(root, s.name), { withFileTypes: true }); } catch (_) { continue; }
    for (const f of files) {
      if (!f.isFile() || !COMMAND_RE.test(f.name) || /^readme/i.test(f.name) || /\.example$/.test(f.name)) continue;
      const file = path.join(root, s.name, f.name);
      let text = '';
      let exec = false;
      try { text = fs.readFileSync(file, 'utf8').slice(0, 4096); exec = (fs.statSync(file).mode & 0o111) !== 0; } catch (_) { continue; }
      // A helper the commands source is neither described nor executable.
      if (!/^## Description:/mi.test(text) && !(exec && text.startsWith('#!'))) continue;
      const types = annotation(text, 'ProjectTypes');
      if (types && type && !types.split(',').map((t) => t.trim()).includes(type)) continue;
      out.push({ name: f.name, service: s.name, description: annotation(text, 'Description'),
        usage: annotation(text, 'Usage'), aliases: annotation(text, 'Aliases').split(',').map((a) => a.trim()).filter((a) => COMMAND_RE.test(a)) });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function hasComposerLock(projectPath) {
  try { return fs.statSync(path.join(projectPath, 'composer.lock')).isFile(); } catch (_) { return false; }
}

/** The three groups, ready to drop into the DDEV menu. Empty when the folder has none of them. */
function menuGroupsHtml({ key, project, projectPath, running }) {
  const { SCRIPT_ROUTE, hasComposerJson, composerScripts } = require('./actions/composer');
  const { NODE_SCRIPT_ROUTE, hasPackageJson, nodeInfo, nodeScripts } = require('./actions/node');
  const vals = (extra = '') => `hx-vals='{"workspace":"${esc(key)}","projectName":"${esc(project)}"${extra}}' hx-target="#webship-workspace-output" hx-swap="innerHTML"`;
  const play = '<span uk-icon="icon: play; ratio: .7"></span>';
  const meta = (s) => (s ? ` <span class="uk-text-meta">· ${esc(s)}</span>` : '');
  const group = (title, items) => (items.length ? `
          <li class="uk-nav-divider"></li>
          <li class="uk-nav-header" data-group="${esc(title)}">${esc(title)}</li>
          ${items.join('\n          ')}` : '');

  const commands = customCommands(projectPath).map((c) => {
    const needsRun = c.service !== 'host' && !running;
    const tip = [c.description, c.usage && `ddev ${c.usage}`, c.aliases.length && `aliases: ${c.aliases.join(', ')}`,
      needsRun && 'Runs in a container: start the project first'].filter(Boolean).join(' — ');
    return needsRun
      ? `<li data-entry="ddev ${esc(c.name)}"><span class="uk-text-meta" title="${esc(tip)}">ddev ${esc(c.name)} · start first</span></li>`
      : `<li data-entry="ddev ${esc(c.name)}"><a href hx-post="/actions/ddev-project-command" ${vals(`,"command":"${esc(c.name)}"`)} title="${esc(tip)}">${play} ddev ${esc(c.name)}</a></li>`;
  });

  const composer = hasComposerJson(projectPath) && hasComposerLock(projectPath) ? composerScripts(projectPath).map((s) =>
    `<li><a href hx-post="${SCRIPT_ROUTE}" ${vals(`,"script":"${esc(s.name)}"`)} title="${esc(s.description || `ddev composer run-script ${s.name}`)}">${play} ${esc(s.name)}${meta(s.aliases.join(', '))}</a></li>`) : [];

  let node = [];
  if (hasPackageJson(projectPath)) {
    const info = nodeInfo(projectPath);
    const m = info.preferred || 'npm';
    node = (info.valid ? nodeScripts(info.pkg) : []).map((s) =>
      `<li><a href hx-post="${NODE_SCRIPT_ROUTE}" ${vals(`,"manager":"${esc(m)}","script":"${esc(s.name)}"`)} title="${esc(s.command || `${m} run ${s.name}`)}">${play} ${esc(s.name)}</a></li>`);
  }

  return group('custom commands', commands) + group('composer.json scripts', composer) + group('package.json scripts', node);
}

module.exports = { customCommands, hasComposerLock, menuGroupsHtml };
