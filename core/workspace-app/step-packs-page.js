/**
 * The Extra steps panel of a project, and its run picker.
 *
 * A webship-js extra-steps pack (`@webship-js/<name>-steps`) adds the steps of one platform, or of a
 * service any site can use, to a project's suite. The panel lists every pack (npm's list, kept for a day,
 * or the one shipped with the core), says which the project has, and offers Add, Remove and Copy
 * examples; the run picker lists the project's features, the copied examples among them, each with Run.
 *
 * What a project has and what each verb does is core/scripts/libs/step_packs.js — the same module
 * `cmd-tools-testing.sh` uses — so the panel and the command cannot disagree. Every button here runs that
 * command in a screen session (actions/step-packs.js): nothing is installed from the dashboard process.
 */

const fs = require('fs');
const path = require('path');

const { esc } = require('./html.mts');
const { humanTime } = require('./format.mts');
const { iconHtml } = require('./icons');
const { ROOT } = require('./workspaces');

const stepPacks = require(path.join(ROOT, 'core', 'scripts', 'libs', 'step_packs'));

const PUBLIC_LOGOS = path.join(__dirname, 'public', 'step-packs');
const LOGO_RE = /^[a-z0-9][a-z0-9.-]*\.(svg|png)$/;
const MAX_FEATURES = 400;
// A feature the picker can run: `--path` reaches `ddev exec` inside double quotes (cmd-tools-testing.sh), so a name
// with a quote, a dollar sign, a backtick or a backslash is listed without a Run button rather than passed on.
const RUNNABLE_FEATURE = /^tests\/features\/(?:[A-Za-z0-9_@+][A-Za-z0-9._@+ -]*\/)*[A-Za-z0-9_@+][A-Za-z0-9._@+ -]*\.feature$/;

/**
 * The logo of a pack: the one the core ships beside the docs cards' (public/step-packs/), else the
 * `assets/logo.svg|png` the installed pack carries — inlined as a data URI in an <img>, so a file from npm
 * is never served from this origin as a document — else '' (the panel draws a puzzle piece).
 */
function logoSrc(pack, projectDir) {
  if (pack.logo && LOGO_RE.test(pack.logo) && fs.existsSync(path.join(PUBLIC_LOGOS, pack.logo))) return `/step-packs/${pack.logo}`;
  for (const ext of ['svg', 'png']) {
    const file = path.join(projectDir, 'node_modules', ...pack.name.split('/'), 'assets', `logo.${ext}`);
    try {
      const st = fs.lstatSync(file);
      if (!st.isFile() || st.size > 64 * 1024) continue;
      return `data:image/${ext === 'svg' ? 'svg+xml' : 'png'};base64,${fs.readFileSync(file).toString('base64')}`;
    } catch (_) { /* not shipped */ }
  }
  return '';
}

function sourceNote(list) {
  if (list.source === 'npm' || list.source === 'cache') {
    return `From npm, read ${list.at ? esc(humanTime(new Date(list.at))) : 'just now'} and kept for a day.`;
  }
  if (list.source === 'stale-cache') {
    return `npm cannot be reached (${esc(list.error)}): this is its answer of ${esc(humanTime(new Date(list.at)))}.`;
  }
  return `npm cannot be reached (${esc(list.error)}): this is the list shipped with the Workspace.`;
}

const kindLabel = (p) => (p.kind === 'any-site' ? 'for any site'
  : p.kind === 'extension' ? `builds on ${esc(p.base.replace('@webship-js/', '').replace(/-steps$/, ''))}` : 'platform');

/**
 * @param {object} ctx  workspace, project, projectDir, busy (a testing or step-pack session is running)
 */
async function stepPacksPanelHtml({ workspace, project, projectDir, busy = false, list = null }) {
  const packs = list || await stepPacks.listPacks({ root: ROOT });
  const state = stepPacks.projectState(projectDir);
  const ready = state.hasPackageJson && state.hasCucumber;
  const vals = (extra) => esc(JSON.stringify({ workspace, projectName: project, ...extra }));
  const out = `hx-target="#webship-workspace-output" hx-swap="innerHTML"`;
  const off = busy || !ready;
  const offWhy = busy ? 'A testing or step-pack command is running on this project: wait for it, it is on Screens.'
    : 'Set the testing environment up first.';

  const row = (p, has) => {
    const logo = logoSrc(p, projectDir);
    const badges = [];
    if (has) {
      badges.push('<span class="uk-label uk-label-success">in this project</span>');
      if (has.profile && has.profile !== 'default') badges.push(`<span class="uk-label" title="Its own cucumber.js profile: platform packs share phrases">profile ${esc(has.profile)}</span>`);
      badges.push(has.installed ? `<span class="uk-text-meta">installed ${esc(has.installed)}</span>`
        : '<span class="uk-label uk-label-warning" title="In package.json, not in node_modules yet: Add installs it">not installed</span>');
      if (has.examples) badges.push(`<span class="uk-text-meta">${has.examples} feature${has.examples === 1 ? '' : 's'} in tests/features/${esc(p.dir)}/</span>`);
    }
    const buttons = [];
    if (!has) {
      buttons.push(`<button data-refocus-item="add" class="uk-button uk-button-primary uk-button-small" hx-post="/actions/steps-add" hx-vals='${vals({ pack: p.name })}' ${out}
        ${off ? `disabled title="${esc(offWhy)}"` : `title="${esc(`Add ${p.name} to ${project}: package.json, cucumber.js, then npm install in the container`)}"`}>Add</button>`);
    } else {
      if (!has.installed && has.range) {
        buttons.push(`<button data-refocus-item="install" class="uk-button uk-button-default uk-button-small" hx-post="/actions/steps-add" hx-vals='${vals({ pack: p.name })}' ${out}
          ${off ? `disabled title="${esc(offWhy)}"` : 'title="Install what package.json lists"'}>Install</button>`);
      }
      buttons.push(`<button data-refocus-item="examples" class="uk-button uk-button-default uk-button-small" hx-post="/actions/steps-examples" hx-vals='${vals({ pack: p.name })}' ${out}
        ${busy ? `disabled title="${esc(offWhy)}"` : `title="${esc(`Copy the features ${p.name} ships into tests/features/${p.dir}/, and the files they use, never over a file`)}"`}>Copy examples</button>`);
      buttons.push(has.ours
        ? `<button data-refocus-item="remove" class="uk-button uk-button-default uk-button-small arm-step" hx-post="/actions/steps-remove" hx-vals='${vals({ pack: p.name, confirm: 'yes' })}' ${out}
            hx-trigger="confirmed-remove" ${busy ? `disabled title="${esc(offWhy)}"` : `title="${esc(`Remove ${p.name}: what Add put in package.json and cucumber.js`)}"`}>Remove</button>`
        : `<button class="uk-button uk-button-default uk-button-small" disabled title="${esc('A platform plugin or a person added it: Remove only takes out what Add put in')}">Remove</button>`);
    }
    return `
    <li class="step-pack${has ? ' is-in' : ''}" data-pack="${esc(p.name)}" data-refocus="${esc(`step-pack:${p.name}`)}">
      <div class="step-pack-line">
        <span class="step-pack-logo" aria-hidden="true">${logo ? `<img src="${esc(logo)}" alt="" width="32" height="32" loading="lazy">` : iconHtml('tabler:puzzle', 1.2)}</span>
        <span class="step-pack-main">
          <span class="step-pack-head"><span class="step-pack-name">${esc(p.title)}</span>
            <code class="step-pack-id">${esc(p.name)}</code>
            <span class="uk-text-meta">${esc(p.version || '')}${p.version ? ' · ' : ''}${kindLabel(p)}</span></span>
          ${badges.length ? `<span class="step-pack-state">${badges.join(' ')}</span>` : ''}
          <span class="step-pack-why">${esc(p.summary)} <a class="step-pack-docs" href="${esc(p.docs)}" target="_blank" rel="noopener noreferrer">Docs<span class="uk-hidden-visually"> for ${esc(p.title)}</span></a></span>
        </span>
        <span class="step-pack-actions">${buttons.join('')}</span>
      </div>
    </li>`;
  };

  const inProject = packs.packs.filter((p) => state.packs[p.name]);
  const others = packs.packs.filter((p) => !state.packs[p.name]);
  // A pack the project has that the list does not (a private one, or one taken off npm).
  const strays = Object.values(state.packs).filter((h) => !packs.packs.some((p) => p.name === h.name))
    .map((h) => stepPacks.describePack({ name: h.name }));
  const picker = `/fragments/projects/features/${encodeURIComponent(workspace)}/${encodeURIComponent(project)}`;

  // Drawn again when the page is told its lists changed: a step this panel started tells it when its screen is
  // done (#488), so a pack just added reads as in the project, and the buttons a running step turned off come back.
  const self = `/fragments/projects/steps/${encodeURIComponent(workspace)}/${encodeURIComponent(project)}`;
  return `
    <div class="editor-card step-packs" hx-get="${esc(self)}" hx-trigger="refresh-projects from:body" hx-swap="outerHTML">
      <h3 class="uk-margin-small-bottom">Extra steps for ${esc(project)}</h3>
      <p class="uk-text-meta step-packs-help">A step pack adds the steps of one platform, or of a service any site can use, to this
        project's webship-js suite. <strong>Add</strong> puts it in <code>package.json</code> and <code>cucumber.js</code> and installs it in the
        project's container; a second platform gets a <code>cucumber.js</code> profile of its own, because platform packs share their
        phrases. <strong>Remove</strong> takes out exactly what Add put in. <strong>Copy examples</strong> copies the features a pack ships
        into <code>tests/features/&lt;pack&gt;/</code>, and the files they use into <code>tests/assets/</code> and <code>tests/fixtures/</code>,
        never over a file. Each runs <code>cmd-tools-testing.sh</code> in a screen.
        ${sourceNote(packs)}</p>
      ${ready ? '' : `<div class="msg error step-packs-not-ready">This project has no webship-js stack yet (<code>package.json</code> and <code>cucumber.js</code>).
        <button class="uk-button uk-button-default uk-button-small" hx-post="/actions/testing-configure" hx-vals='${vals({})}' ${out}${busy ? ' disabled' : ''}>Set up the testing environment</button></div>`}
      ${busy ? '<p class="uk-text-meta step-packs-busy">A testing or step-pack command is running on this project: the buttons come back when it is done (Screens shows it).</p>' : ''}

      <h4 class="uk-margin-small-bottom">In this project <span class="uk-badge">${inProject.length + strays.length}</span></h4>
      ${inProject.length + strays.length
    ? `<ul class="uk-list uk-list-divider step-pack-list step-pack-list-in">${[...inProject, ...strays].map((p) => row(p, state.packs[p.name])).join('')}</ul>`
    : '<p class="uk-text-meta">None yet.</p>'}

      <h4 class="uk-margin-small-bottom">Add a pack <span class="uk-badge">${others.length}</span></h4>
      <ul class="uk-list uk-list-divider step-pack-list step-pack-list-other">${others.map((p) => row(p, null)).join('')}</ul>

      <p class="uk-text-meta">The copied examples are in <a href hx-get="${picker}" hx-target="#editor-modal-body" hx-swap="innerHTML">Run one feature…</a>,
        with every other feature of the project. The same from a terminal: <code>bash cmd-tools-testing.sh ${esc(project)} --list-steps</code>.</p>
    </div>`;
}

/** The project's features, by folder: [{ folder, files: [{ rel, profile }] }]. */
function projectFeatures(projectDir) {
  const base = path.join(projectDir, 'tests', 'features');
  const files = stepPacks.featureFiles(base, MAX_FEATURES);
  const groups = new Map();
  for (const rel of files) {
    const folder = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
    const full = `tests/features/${rel}`;
    if (!groups.has(folder)) groups.set(folder, []);
    groups.get(folder).push({ rel: full, name: rel.slice(rel.lastIndexOf('/') + 1), profile: stepPacks.profileFor(projectDir, full), runnable: RUNNABLE_FEATURE.test(full) });
  }
  return [...groups.entries()].map(([folder, list]) => ({ folder, files: list }));
}

/** The run picker: one Run per feature, copied examples included. */
function featuresPickerHtml({ workspace, project, projectDir, busy = false }) {
  const state = stepPacks.projectState(projectDir);
  const groups = projectFeatures(projectDir);
  const count = groups.reduce((n, g) => n + g.files.length, 0);
  const vals = (extra) => esc(JSON.stringify({ workspace, projectName: project, ...extra }));
  const panel = `/fragments/projects/steps/${encodeURIComponent(workspace)}/${encodeURIComponent(project)}`;
  const body = groups.map((g) => `
      <h4 class="uk-margin-small-bottom feature-folder">tests/features/${esc(g.folder)}${g.folder ? '/' : ''} <span class="uk-badge">${g.files.length}</span></h4>
      <ul class="uk-list uk-list-divider feature-list">${g.files.map((f) => `
        <li class="feature-line"><span class="feature-name">${esc(f.name)}</span>
          ${f.profile !== 'default' ? `<span class="uk-label" title="Runs with the cucumber.js profile ${esc(f.profile)}">profile ${esc(f.profile)}</span>` : ''}
          ${f.runnable ? `<button class="uk-button uk-button-default uk-button-small" hx-post="/actions/testing-run-feature" hx-vals='${vals({ feature: f.rel })}'
            hx-target="#webship-workspace-output" hx-swap="innerHTML"${busy || state.stack === 'none' ? ' disabled' : ''}
            title="${esc(`bash cmd-tools-testing.sh ${project} --run --path ${f.rel}`)}">${iconHtml('play', 0.7)} Run</button>`
    : '<span class="uk-text-meta" title="Its name has a character a command line would read as code: rename it to run it from here">not runnable from here</span>'}</li>`).join('')}
      </ul>`).join('');
  return `
    <div class="editor-card features-picker">
      <h3 class="uk-margin-small-bottom">Run one feature of ${esc(project)}</h3>
      <p class="uk-text-meta">Every feature under <code>tests/features/</code>, the examples a step pack copied among them. Run starts
        <code>cmd-tools-testing.sh ${esc(project)} --run --path &lt;feature&gt;</code> in a screen; a feature in the folder of a profile runs with that
        profile. The report is the Tests menu's, as for a whole run.${count >= MAX_FEATURES ? ` The first ${MAX_FEATURES} are listed.` : ''}</p>
      ${busy ? '<p class="uk-text-meta step-packs-busy">A testing command is running on this project: Run comes back when it is done.</p>' : ''}
      ${state.stack === 'none' ? '<div class="msg error">This project has no testing stack yet: set the testing environment up first (the Tests menu).</div>' : ''}
      ${count ? body : '<p class="uk-text-meta">No feature yet. A step pack\'s examples are one <strong>Copy examples</strong> away.</p>'}
      <p class="uk-text-meta"><a href hx-get="${panel}" hx-target="#editor-modal-body" hx-swap="innerHTML">Extra steps…</a></p>
    </div>`;
}

module.exports = { stepPacksPanelHtml, featuresPickerHtml, projectFeatures, logoSrc, MAX_FEATURES, RUNNABLE_FEATURE };
