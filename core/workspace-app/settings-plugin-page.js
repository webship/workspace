/**
 * A plugin's own page in Settings: /settings/plugin/<name>.
 *
 * Everything about one plugin in one place, where it used to be a card on the Plugins page, a tile
 * for its settings file and another for its folder: the state it is in, the four steps as one list
 * with the step that is next carrying its button and the same command for a terminal, what it needs
 * (met by which plugin, or not met with the fix), its settings form, what it ships and where that
 * was placed, and how to remove it. The rules are settings-model.mts's; the buttons run
 * core/scripts/plugins.sh exactly as the Plugins page did.
 */

const path = require('path');

const { esc } = require('./html.mts');
const { iconHtml } = require('./icons.mts');
const { needsInstall } = require('./plugin-manifest.mts');
const model = require('./settings-model.mts');
const { stateHtml, actionHtml, pluginHref } = require('./settings-home.mts');

const command = (verb, name, withNeeds = false) => `bash core/scripts/plugins.sh --${verb} ${name}${withNeeds ? ' --with-needs' : ''}`;
const anyOfText = (anyOf) => (anyOf.length > 1 ? `${anyOf.slice(0, -1).join(', ')} or ${anyOf[anyOf.length - 1]}` : anyOf[0]);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function postButton(verb, p, label, { primary = false, danger = false, withNeeds = false, confirm = '' } = {}) {
  return `<button type="button" class="uk-button uk-button-${danger ? 'danger plugin-danger' : primary ? 'primary' : 'default'} uk-button-small" data-refocus-item="${esc(verb)}" hx-post="/actions/plugins"
      hx-vals='${esc(JSON.stringify({ verb, name: p.name, ...(withNeeds ? { withNeeds: '1' } : {}) }))}'
      hx-target="#webship-workspace-output" hx-swap="innerHTML"${confirm ? ` hx-confirm="${esc(confirm)}"` : ''}>${esc(label)}</button>`;
}

// What a section says when it has nothing to say. A plugin page does not draw such a section under its own
// heading (four headings and rules that each said "nothing" ended the notes plugin's page): it says them
// together in one line under the steps (nothingHtml). Each comes from the manifest, so a step never fills one.
const NO_SETTINGS = '<p class="plugin-quiet">This plugin has no settings.</p>';
const NO_NEEDS = '<p class="plugin-quiet">Needs nothing from another plugin, and no command on this machine.</p>';
const NO_SHIPS = '<p class="plugin-quiet">It ships no files for the workspace: its code runs inside the dashboard.</p>';

/** A plugin that is a folder under plugins/ (no npm package behind it), such as the notes plugin the base ships. */
const isFolder = (p) => !p.module && /^plugins\//.test(String(p.spec || ''));

/**
 * The steps, each `{ id, title, status: done | now | later, applies, text, action }`. Only the step
 * that is next has an action. A step that does not apply to this plugin (nothing to place, no settings
 * file) says so in `applies: false`: it is not numbered and not counted, so a plugin with one thing
 * left to do does not announce four.
 */
function steps(p) {
  const label = p.label || p.manifest.label || p.name;
  const unmet = (p.wants && !(p.wants.problems || []).length && p.wants.unmet) || [];
  const picks = unmet.map((n) => n.pick).join(' and ');
  const withNeeds = unmet.length > 0;
  const places = needsInstall(p.manifest) || !!(p.manifest.workspace && p.manifest.workspace.key);
  const file = p.manifest.settingsFile || '';
  const placedCount = (p.placed && p.placed.placed) || 0;
  const status = (i) => (i <= p.step ? 'done' : i === p.step + 1 ? 'now' : 'later');
  const needsLine = withNeeds ? ` It needs ${picks}, which ${unmet.length === 1 ? 'is' : 'are'} not here yet: one run adds ${unmet.length === 1 ? 'it' : 'them'} first (require, activate, install).` : '';
  return [
    { id: 'require', title: 'Require', word: 'required', status: 'done', applies: true,
      text: isFolder(p) ? `It is a folder of the dashboard: ${p.spec}.`
        : `The package is in the dashboard: ${p.module || p.spec || p.name}${p.version ? ` ${p.version}` : ''}.` },
    { id: 'activate', title: 'Activate', word: 'activated', status: status(1), applies: true,
      text: p.step >= 1 ? 'Switched on in settings.yml.' : `Switch ${label} on in settings.yml.${needsLine}`,
      action: p.step === 0 ? { verb: 'activate', label: `Activate${withNeeds ? ` with ${picks}` : ''}`, withNeeds } : null },
    { id: 'install', title: 'Install', word: 'installed', status: !places && p.step >= 1 ? 'done' : status(2), applies: places,
      text: !places ? 'Nothing to place: this plugin ships no files for the workspace.'
        : p.step >= 2 ? `${plural(placedCount, 'file')} placed in the workspace.`
          : `Place what it ships in the workspace: commands, functions, AI items, its settings file.${p.step === 1 ? needsLine : ''}`,
      action: p.step === 1 ? { verb: 'install', label: `Install${withNeeds ? ` with ${picks}` : ''}`, withNeeds } : null },
    { id: 'configure', title: 'Configure', word: 'configured', status: !file && p.step >= 2 ? 'done' : status(3), applies: !!file,
      text: !file ? 'No settings file: nothing to configure.'
        : p.step >= 3 ? `${file} has no placeholder left.`
          : p.step === 2 ? `Fill in its settings, below: a value in ${file} is still the placeholder, or the file is not there.`
            : `Its own file, ${file}, is written by Install.`,
      action: p.step === 2 ? { href: '#settings', label: 'Go to its settings' } : null },
  ];
}

/** The steps that are real for this plugin and not done yet. */
const stepsLeft = (p) => steps(p).filter((s) => s.applies && s.status !== 'done').length;

function stepsListHtml(p) {
  const icons = { done: 'tabler:circle-check', now: 'tabler:circle-dot', later: 'tabler:circle-dashed' };
  const words = { done: 'Done', now: 'Next', later: 'Later' };
  const real = steps(p).filter((s) => s.applies);
  const items = real.map((s, i) => {
    const action = !s.action ? '' : s.action.href
      ? `<p class="plugin-step-do"><a class="uk-button uk-button-primary uk-button-small" href="${esc(s.action.href)}">${esc(s.action.label)}</a></p>`
      : `<p class="plugin-step-do">${postButton(s.action.verb, p, s.action.label, { primary: true, withNeeds: s.action.withNeeds })}
           <span class="plugin-step-command">or in a terminal: <code>${esc(command(s.action.verb, p.name, s.action.withNeeds))}</code></span></p>`;
    return `
      <li class="plugin-step-item is-${s.status}"${s.status === 'now' ? ' aria-current="step"' : ''}>
        <span class="plugin-step-mark">${iconHtml(icons[s.status], 1)}</span>
        <div class="plugin-step-body">
          <p class="plugin-step-title"><strong>${i + 1}. ${esc(s.title)}</strong> <span class="plugin-step-status">${words[s.status]}</span></p>
          <p class="plugin-step-text">${esc(s.text)}</p>
          ${action}
        </div>
      </li>`;
  }).join('');
  const skipped = steps(p).filter((s) => !s.applies).map((s) => s.text);
  return `<ol class="plugin-step-list">${items}</ol>${skipped.length ? `<p class="plugin-quiet plugin-steps-skipped">${esc(skipped.join(' '))}</p>` : ''}`;
}

/**
 * The steps as the page shows them. While something is left: a heading that counts what is left and
 * the list. When all is done: one line, with the list behind it, so a ready plugin's page leads with
 * its settings and not with four ticks.
 */
function stepsHtml(p) {
  const left = stepsLeft(p);
  if (!left) {
    const done = steps(p).filter((s) => s.applies).map((s) => s.word);
    return `<details class="plugin-steps-done"><summary><span class="plugin-steps-done-title">${iconHtml('tabler:circle-check', 0.9)} Turned on</span>
        <span class="plugin-quiet">${esc(done.join(', '))}</span></summary>${stepsListHtml(p)}</details>`;
  }
  const count = ['no', 'one', 'two', 'three', 'four'][left] || String(left);
  return `<h3 class="plugin-section-head" id="plugin-steps-head">Turn it on: ${count} step${left === 1 ? '' : 's'} left</h3>${stepsListHtml(p)}`;
}

/** What is off beside the four steps: a need that went away, files that are gone, a need that cannot be met, a command it needs that is not on this machine. */
function alertHtml(p) {
  const s = p.state;
  if (!['needs', 'files-missing', 'problem', 'needs-command'].includes(s.id)) return '';
  return `<div class="plugin-alert is-${esc(s.tone)}" role="status">
      ${iconHtml(s.icon, 1)}
      <div><p><strong>${esc(s.label)}.</strong> ${esc(s.note)}.${s.id === 'needs-command' ? ` <a href="${esc(s.action.href)}">${esc(s.action.label)}</a>.` : ''}</p>
      ${s.action.kind === 'post' ? `<p>${actionHtml(p, { primary: true })} <span class="plugin-step-command">or: <code>${esc(command(s.action.verb, p.name, s.action.withNeeds))}</code></span></p>` : ''}</div>
    </div>`;
}

/** A web address inside a sentence becomes a link; the rest is escaped text. */
function linked(text) {
  return String(text || '').split(/(https?:\/\/[^\s)]+[^\s).,;])/).map((part, i) => (i % 2 ? `<a href="${esc(part)}" rel="noopener">${esc(part)}</a>` : esc(part))).join('');
}

function needsHtml(p, known = new Set()) {
  const w = p.wants || { needs: [], suggests: [], problems: [] };
  const link = (name) => (known.has(name) ? `<a href="${esc(pluginHref(name))}">${esc(name)}</a>` : esc(name));
  // One name that is here says so once ("ai-agents: here"), not "ai-agents: met by ai-agents".
  const met = (n) => (n.anyOf.length === 1 && n.metBy === n.anyOf[0] ? `<strong>${link(n.metBy)}</strong>: here.` : `<strong>${esc(anyOfText(n.anyOf))}</strong>: met by ${link(n.metBy)}.`);
  const need = (n) => (n.metBy
    ? `<li class="plugin-need is-met">${iconHtml('tabler:circle-check', 0.9)}<span>${met(n)}</span></li>`
    : `<li class="plugin-need is-unmet">${iconHtml('tabler:alert-triangle', 0.9)}<span><strong>${esc(anyOfText(n.anyOf))}</strong>: not here.
        ${n.anyOf.length > 1 ? `${esc(n.pick)} is the one that is added. ` : ''}${p.state.action.kind === 'post' && p.state.action.withNeeds
    ? `<em>${esc(p.state.action.label)}</em> adds it in the same run`
    : 'It is added with the next step'}${known.has(n.pick) ? `, or open ${link(n.pick)} and turn it on there` : ''}.</span></li>`);
  const suggest = (n) => `<li class="plugin-need is-${n.metBy ? 'met' : 'optional'}">${iconHtml(n.metBy ? 'tabler:circle-check' : 'tabler:circle-dashed', 0.9)}<span>${n.metBy
    ? (n.anyOf.length === 1 ? `${link(n.metBy)}: here.` : `${esc(anyOfText(n.anyOf))}: here (${link(n.metBy)}).`)
    : `${esc(anyOfText(n.anyOf))}: not here, and not needed.`}</span></li>`;
  const cmd = (r) => {
    const name = `${r.anyOf.length > 1 ? `one of ${r.anyOf.join(', ')}` : r.anyOf[0]}${r.where === 'host' ? '' : ` (${r.where})`}`;
    if (r.state === 'found') return `<li class="plugin-need is-met">${iconHtml('tabler:circle-check', 0.9)}<span><code>${esc(name)}</code>: found${r.version ? `, ${esc(r.version)}` : ''}.</span></li>`;
    if (r.state === 'unchecked') return `<li class="plugin-need is-optional">${iconHtml('tabler:circle-dashed', 0.9)}<span><code>${esc(name)}</code>: not checked from here${r.why ? ` (${esc(r.why)})` : ''}.</span></li>`;
    return `<li class="plugin-need is-unmet">${iconHtml('tabler:alert-triangle', 0.9)}<span><code>${esc(name)}</code>: not on this machine${r.kind === 'needs' ? '' : ' (a part of the plugin uses it)'}.${r.hint ? ` Install: ${linked(r.hint)}` : ''}</span></li>`;
  };
  const parts = [];
  if (w.problems && w.problems.length) parts.push(`<p class="plugin-alert is-danger">${iconHtml('tabler:alert-triangle', 1)}<span>${esc(w.problems.join('; '))}</span></p>`);
  if (w.needs.length) parts.push(`<h4 class="plugin-sub">Other plugins it cannot work without</h4><ul class="plugin-need-list">${w.needs.map(need).join('')}</ul>`);
  if (w.suggests.length) parts.push(`<h4 class="plugin-sub">Goes well with</h4><ul class="plugin-need-list">${w.suggests.map(suggest).join('')}</ul>`);
  if ((p.commands || []).length) parts.push(`<h4 class="plugin-sub">Commands on this machine</h4><ul class="plugin-need-list">${p.commands.map(cmd).join('')}</ul>`);
  if (!parts.length) parts.push(NO_NEEDS);
  if ((p.neededBy || []).length) parts.push(`<h4 class="plugin-sub">Needed by</h4><p class="plugin-quiet">${p.neededBy.map(link).join(', ')}.</p>`);
  return parts.join('');
}

/** A newer version on npm: what it is, the button that requires it, and the same for a terminal. */
function updateHtml(p) {
  const v = p.state.update;
  if (!v || !p.module) return '';
  const spec = `${p.module}@${v}`;
  return `<div class="plugin-alert is-info" role="status">
      ${iconHtml('tabler:arrow-up-circle', 1)}
      <div><p><strong>Version ${esc(v)} is on npm.</strong> This workspace has ${esc(p.version || 'an unknown version')}.</p>
      <p><button type="button" class="uk-button uk-button-primary uk-button-small" hx-post="/actions/plugins"
          hx-vals='${esc(JSON.stringify({ verb: 'require', spec }))}' hx-target="#webship-workspace-output" hx-swap="innerHTML">Update to ${esc(v)}</button>
        <span class="plugin-step-command">or: <code>bash core/scripts/plugins.sh --require ${esc(spec)}</code></span></p>
      ${p.step >= 2 ? '<p>Then Reinstall, at the end of this page, places the files of the new version.</p>' : ''}</div>
    </div>`;
}

/** The settings of the plugin: the form of the chosen file, the way to the other one, or why there is none. */
function settingsHtml(p, { files = [], chosen = null, formHtml = '' } = {}) {
  const here = files.filter((f) => f.exists);
  const names = { plugin: 'Plugin settings', folder: 'Folder settings' };
  if (!files.length) return NO_SETTINGS;
  if (!here.length) {
    return `<p class="plugin-quiet">${files.map((f) => `<code>core/config/${esc(f.file)}</code>`).join(' and ')} ${files.length === 1 ? 'is' : 'are'} written by Install${p.step < 2 ? ', the step above' : '. Reinstall puts a missing file back'}.</p>`;
  }
  const tabs = here.length > 1 ? `<p class="settings-tabs plugin-file-tabs">${here.map((f) => `<a class="uk-button uk-button-${chosen && f.file === chosen.file ? 'primary' : 'default'} uk-button-small"
      href="${esc(pluginHref(p.name))}?file=${esc(f.kind)}#settings"${chosen && f.file === chosen.file ? ' aria-current="page"' : ''}>${esc(names[f.kind])}</a>`).join(' ')}</p>` : '';
  const missing = files.filter((f) => !f.exists);
  return `${tabs}${missing.length ? `<p class="plugin-quiet">${missing.map((f) => `<code>core/config/${esc(f.file)}</code>`).join(' and ')} is not there yet: Install writes it.</p>` : ''}${formHtml}`;
}

const base = (f) => path.basename(String(f));


/** What the plugin ships, and where the install put it. */
function shipsHtml(p, { record = null, workspaces = new Set() } = {}) {
  const m = p.manifest;
  const placed = (record && record.placed) || [];
  const where = (file) => placed.filter((x) => path.basename(x) === file).map((x) => `<code>${esc(x)}</code>`);
  const commandFiles = [...new Set([...(((m.commands || {}).files) || []), ...(((m.workspace || {}).files) || [])].map(base))];
  const parts = [];
  if (commandFiles.length) {
    parts.push(`<h4 class="plugin-sub">Commands <span class="settings-family-count">${commandFiles.length}</span></h4>
      <ul class="plugin-ship-list">${commandFiles.map((f) => {
    const at = where(f);
    return `<li><code>${esc(f)}</code><span class="plugin-quiet">${at.length ? `in ${at.map((x) => x.replace(/<code>(.*)\/[^/]*<\/code>/, '<code>$1/</code>')).join(', ')}` : 'not placed yet'}</span></li>`;
  }).join('')}</ul>`);
  }
  const kinds = [['agents', 'ai-agents', 'Agents'], ['skills', 'ai-skills', 'Skills'], ['commands', 'ai-commands', 'Commands'], ['prompts', 'ai-prompts', 'Prompts']];
  const ai = kinds.map(([kind, folder, title]) => ({ kind, folder, title, items: (((m.ai || {})[kind]) || []).map((f) => base(f).replace(/\.md$/, '')) })).filter((k) => k.items.length);
  if (ai.length) {
    parts.push(`<h4 class="plugin-sub">AI items <span class="settings-family-count">${ai.reduce((n, k) => n + k.items.length, 0)}</span></h4>
      <ul class="plugin-ship-list">${ai.map((k) => `<li><span><strong>${esc(k.title)}</strong>: ${k.items.map((i) => `<code>${esc(i)}</code>`).join(', ')}</span>
        <span class="plugin-quiet">${workspaces.has(k.folder)
    ? `${p.step >= 2 ? 'in' : 'will be placed in'} <a href="/${esc(k.folder)}">${esc(k.folder)}/</a>`
    : `skipped: there is no ${esc(k.folder)}/ folder here`}</span></li>`).join('')}</ul>`);
  }
  const also = [
    (m.themes || []).length ? plural(m.themes.length, 'style') : '',
    (m.features || []).length ? plural(m.features.length, 'browser test file') : '',
    ((m.ddev || {}).compose || []).length ? plural(m.ddev.compose.length, 'compose file') : '',
    (((m.scripts || {}).functions) || []).length ? plural(m.scripts.functions.length, 'bash function file') : '',
    (((m.workspace || {}).docs) || []).length ? plural(m.workspace.docs.length, 'doc') : '',
  ].filter(Boolean);
  if (also.length) parts.push(`<p class="plugin-quiet">Also: ${esc(also.join(', '))}.</p>`);
  if (placed.length) {
    parts.push(`<details class="plugin-placed"><summary>${plural(placed.length, 'file')} placed${record.installed ? ` on ${esc(String(record.installed).slice(0, 10))}` : ''}</summary>
      <ul class="plugin-placed-list">${placed.map((x) => `<li><code>${esc(x)}</code></li>`).join('')}</ul></details>`);
  }
  if (!parts.length) parts.push(NO_SHIPS);
  return parts.join('');
}

function removeHtml(p) {
  const label = p.label || p.manifest.label || p.name;
  if (p.step < 1 && !(p.placed && p.placed.installed)) {
    // Nothing of it is in the workspace: what is left is the package and its line in settings.yml (#493).
    if ((p.neededBy || []).length) {
      return `<p class="plugin-quiet">It is not active, and nothing of it is in the workspace. ${esc(p.neededBy.join(', '))} ${p.neededBy.length === 1 ? 'needs' : 'need'} it, so it stays in the dashboard.</p>`;
    }
    // A folder of the dashboard (the notes plugin the base ships, or one put there by hand) is no npm
    // package: --remove would leave the folder, and the plugin with it, so there is nothing to offer.
    if (isFolder(p)) {
      return `<p class="plugin-quiet">It is not active, and nothing of it is in the workspace. <code>${esc(p.spec)}</code> is a folder of the dashboard, not an npm package, so there is nothing to remove: while it is not active it does nothing.</p>`;
    }
    return `<p class="plugin-buttons"><span class="plugin-buttons-apart">${postButton('remove', p, 'Remove', { danger: true, confirm: `Remove ${label}? Its package leaves the dashboard and plugins.${p.name} leaves settings.yml. Its settings file, if it has one, stays. Require brings it back.` })}</span></p>
    <p class="plugin-quiet">It is not active, and nothing of it is in the workspace. Remove takes its package out of the dashboard (<code>npm uninstall ${esc(p.module || p.name)}</code>) and its line out of <code>settings.yml</code>.</p>`;
  }
  if ((p.neededBy || []).length) {
    // Reinstall removes nothing, so it stays: "Update to <version>, then Reinstall" is finished here for a
    // plugin others need as for any other (#410). Deactivate and Uninstall wait for the plugins that need it.
    const places = needsInstall(p.manifest) || !!(p.manifest.workspace && p.manifest.workspace.key);
    const reinstall = p.step >= 1 && places ? `<p class="plugin-buttons">${postButton('install', p, p.step >= 2 ? 'Reinstall' : 'Install')}</p>` : '';
    return `${reinstall}<p class="plugin-quiet">${esc(label)} cannot be deactivated or uninstalled while ${esc(p.neededBy.join(', '))} ${p.neededBy.length === 1 ? 'needs' : 'need'} it. Remove ${p.neededBy.length === 1 ? 'that one' : 'those'} first.${reinstall ? ' Reinstall places its files again and is safe to repeat.' : ''}</p>`;
  }
  const keep = [
    p.step >= 1 && needsInstall(p.manifest) ? postButton('install', p, p.step >= 2 ? 'Reinstall' : 'Install') : '',
    p.step >= 1 ? postButton('deactivate', p, 'Deactivate', { confirm: `Deactivate ${label}? Its menus and pages go; its files and settings stay.` }) : '',
  ].filter(Boolean).join(' ');
  // The one that removes files is drawn as what it is, last and apart from the two that do not.
  const remove = p.placed && p.placed.installed
    ? postButton('uninstall', p, 'Uninstall', { danger: true, confirm: `Uninstall ${label}? What Install placed is removed (a file edited here is kept) and the plugin is deactivated.` }) : '';
  // Said for the buttons that are there: a plugin that places nothing has no Reinstall to explain.
  const reinstalls = p.step >= 1 && needsInstall(p.manifest);
  return `<p class="plugin-buttons">${keep}${remove ? `<span class="plugin-buttons-apart">${remove}</span>` : ''}</p>
    <p class="plugin-quiet">${reinstalls ? 'Reinstall places its files again and is safe to repeat. ' : ''}Deactivate keeps ${reinstalls ? 'files and settings' : 'its settings'}.${remove ? ' Uninstall removes what Install placed.' : ''}</p>`;
}

/**
 * The part that says where the plugin is: the heading with the state, what is off, the steps. Drawn
 * again when a step has run. In a pane of the settings modal the name is the pane's own heading, so it
 * is not said again here (`fragment`).
 */
function statusHtml(p, { fragment = false } = {}) {
  const f = model.familyById(p.family);
  const about = String(p.description || p.summary || '').replace(/`/g, '');
  return `
  <div class="plugin-status" id="plugin-status" hx-get="${esc(fragmentUrl(p, 'status'))}${fragment ? '&amp;fragment=1' : ''}" hx-trigger="refresh-projects from:body" hx-swap="outerHTML">
    <header class="plugin-head">
      <div class="plugin-head-title">
        ${fragment ? '' : `<h2 class="plugin-head-name">${esc(p.label || p.manifest.label || p.name)}</h2>`}
        <span class="plugin-head-state">${stateHtml(p.state)}</span>
      </div>
      <p class="plugin-head-meta">${esc(f.label)} · <code>${esc(p.module || p.spec || p.name)}</code>${p.version ? ` ${esc(p.version)}` : ''}</p>
      ${about ? `<p class="plugin-head-about">${esc(about)}</p>` : ''}
    </header>
    ${alertHtml(p)}${updateHtml(p)}${p.step >= 1 && p.loaded === false ? `
    <p class="plugin-alert" role="status">${iconHtml('tabler:refresh', 1)}<span><strong>Active, but not loaded yet.</strong> The dashboard loads a plugin's code when it starts; its menus and pages show after a restart: <code>bash core/scripts/plugins.sh --restart</code></span></p>` : ''}
    <section class="plugin-section plugin-steps" ${stepsLeft(p) ? 'aria-labelledby="plugin-steps-head"' : 'aria-label="The steps that turned it on"'} data-refocus="steps-${esc(p.name)}">
      ${stepsHtml(p)}
    </section>
  </div>`;
}

const fragmentUrl = (p, part) => `/fragments/settings/plugin/${encodeURIComponent(p.name)}?part=${part}`;

/**
 * The settings section. While there is no form in it (the file is written by Install), it is drawn
 * again when a step has run, so the form appears without a reload; once a form is there it is left
 * alone, whatever runs: what a person is typing is never replaced under them.
 */
function settingsSectionHtml(p, ctx = {}) {
  const hasForm = !!ctx.formHtml;
  if (settingsHtml(p, ctx) === NO_SETTINGS) return '';
  return `
    <section class="plugin-section" id="settings" aria-labelledby="plugin-settings-head"${hasForm ? '' : `
             hx-get="${esc(fragmentUrl(p, 'settings'))}" hx-trigger="refresh-projects from:body" hx-swap="outerHTML"`}>
      <h3 class="plugin-section-head" id="plugin-settings-head">Settings</h3>
      ${settingsHtml(p, ctx)}
    </section>`;
}

/** What it needs, what it ships and how to remove it: all three change with a step, so they are drawn again after one. */
function afterHtml(p, ctx = {}) {
  const needs = needsHtml(p, ctx.known);
  const ships = shipsHtml(p, ctx);
  return `
    <div class="plugin-after" id="plugin-after" hx-get="${esc(fragmentUrl(p, 'after'))}" hx-trigger="refresh-projects from:body" hx-swap="outerHTML">${needs === NO_NEEDS ? '' : `
    <section class="plugin-section" id="needs" aria-labelledby="plugin-needs-head">
      <h3 class="plugin-section-head" id="plugin-needs-head">What it needs</h3>
      ${needs}
    </section>`}${ships === NO_SHIPS ? '' : `
    <section class="plugin-section" id="ships" aria-labelledby="plugin-ships-head">
      <h3 class="plugin-section-head" id="plugin-ships-head">What it ships</h3>
      ${ships}
    </section>`}
    <section class="plugin-section" id="remove" aria-labelledby="plugin-remove-head" data-refocus="remove-${esc(p.name)}">
      <h3 class="plugin-section-head" id="plugin-remove-head">Reinstall or remove</h3>
      ${removeHtml(p)}
    </section>
    </div>`;
}

/** The sections that have nothing to say, said together in one quiet line; '' when every one has something. */
function nothingHtml(p, ctx = {}) {
  const ships = shipsHtml(p, ctx) === NO_SHIPS;
  const none = [
    settingsHtml(p, ctx) === NO_SETTINGS ? 'has no settings' : '',
    needsHtml(p, ctx.known) === NO_NEEDS ? 'needs no other plugin and no command' : '',
    ships ? 'places no files in the workspace' : '',
  ].filter(Boolean);
  if (!none.length) return '';
  const said = none.length === 1 ? none[0] : none.length === 2 ? `${none[0]}, and ${none[1]}` : `${none[0]}, ${none[1]}, and ${none[2]}`;
  return `<p class="plugin-quiet plugin-nothing">It ${said}${ships ? ': its code runs inside the dashboard' : ''}.</p>`;
}

/** The whole page body. `ctx`: `{ known, files, chosen, formHtml, record, workspaces }`. */
function pluginPageHtml(p, ctx = {}) {
  return `
  <article class="plugin-page" data-plugin="${esc(p.name)}">
    <div hx-get="/fragments/settings/updates?plugin=${esc(encodeURIComponent(p.name))}" hx-trigger="load" hx-swap="none" hidden></div>
    ${statusHtml(p, ctx)}
    ${nothingHtml(p, ctx)}
    ${settingsSectionHtml(p, ctx)}
    ${afterHtml(p, ctx)}
  </article>`;
}

/** No such plugin here: say so, and where one is added. */
function missingHtml(name) {
  return `<div class="settings-empty">
      <p><strong>No plugin called ${esc(name)} is added to this workspace.</strong></p>
      <p>See what is added on <a href="/settings">Settings</a>, or add it from <a href="/settings/plugins">the catalogue</a>:
        <code>bash core/scripts/plugins.sh --require @webship.co/workspace-${esc(name)}</code></p>
    </div>`;
}

module.exports = { pluginPageHtml, nothingHtml, statusHtml, settingsSectionHtml, afterHtml, updateHtml, steps, stepsLeft, stepsHtml, linked, needsHtml, settingsHtml, shipsHtml, removeHtml, missingHtml };
