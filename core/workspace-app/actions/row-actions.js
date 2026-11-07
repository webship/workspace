/**
 * Commands → Buttons (rows management), and running the actions it lets someone add.
 *
 * Every change answers with the editor re-rendered, on the tab it came from. Each form carries the file's
 * mtime from when it was drawn, and a write refuses with 409 when the file changed since — another tab,
 * or a hand edit — rather than silently writing over it. An action change made from the Rows tab carries
 * the rest of that form, so a drag not yet saved is not lost by adding, editing or deleting an action.
 *
 * An action is run by id only. Its steps come from the file, never from the request; the only things a
 * request carries into a run are option values, each checked against its option and single-quoted.
 */

const fs = require('fs');
const path = require('path');

const { esc } = require('../html');
const { workspaceDir } = require('../workspaces');
const { screenStartedHtml, screenSessionName } = require('../jobs');
const { NAME_RE } = require('../validate');
const { lingerTail } = require('../linger');
const { hasOwnGit } = require('../git-info');
const { startUnlessRunning, terminalLink, isDdevProject, hasComposerJson, SAFE_PATH_RE } = require('./composer');
const { hasPackageJson } = require('./node');
const rowLayout = require('../row-layout');
const catalog = require('../commands');

const paneOf = (form) => (['0', '1', '2'].includes(String(form.pane)) ? Number(form.pane) : 0);
// The card someone was working in stays open when the editor comes back.
const editor = (send, form, message, code = 200) => send(rowLayout.rowActionsEditorHtml(message, paneOf(form),
  { openButton: String(form.open_button || '') }), code);
const ok = (text) => `<div class="msg assistant">✅ ${text}</div>`;
const bad = (text) => `<div class="msg error">${text}</div>`;

/** Write, or answer with why not. True when it was written. */
function write(send, form, fn) {
  try {
    fn();
    return true;
  } catch (err) {
    if (err && err.code === 'CHANGED') {
      editor(send, form, bad('Row actions changed since this page was loaded (another tab, or a hand edit), so nothing was saved. This is the current state.'), 409);
    } else {
      editor(send, form, bad(`Could not save: ${esc(String(err && err.message || err))}`), 500);
    }
    return false;
  }
}

/** The layout with whatever the Rows form carried applied to it (unchanged when the request had no form). */
function arranged(form) {
  const layout = rowLayout.loadRowLayoutFresh();
  return rowLayout.arrangementFromForm(layout, form);
}

// One step a line. A line `use: <command id>` runs that command of the catalog; any other line is a command line.
const stepsFrom = (text) => String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  .map((l) => { const m = /^use:\s*(\S+)$/.exec(l); return m ? { use: m[1] } : l; });

async function arrange_save({ form, send }) {
  const next = rowLayout.normalizeLayout(arranged(form));
  if (!write(send, form, () => rowLayout.saveRowLayout(next, form.mtime))) return undefined;
  return editor(send, form, ok('Rows saved. Reload a workspace page to see them.'));
}

async function rows_op({ form, send }) {
  const doc = arranged(form);
  const i = Number(form.index);
  const op = String(form.op || '');
  if (op === 'add') {
    if (doc.rows.length >= rowLayout.MAX_ROWS) return editor(send, form, bad(`Up to ${rowLayout.MAX_ROWS} rows.`), 400);
    doc.rows.push([]);
  } else if (!Number.isInteger(i) || i < 0 || i >= doc.rows.length) {
    return editor(send, form, bad('No such row.'), 400);
  } else if (op === 'remove') {
    if (doc.rows.length === 1) return editor(send, form, bad('A project row keeps at least one row.'), 400);
    const [gone] = doc.rows.splice(i, 1);
    doc.rows[Math.max(0, i - 1)].push(...gone);
  } else if (op === 'up' || op === 'down') {
    const j = op === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= doc.rows.length) return editor(send, form, bad('That row cannot move further.'), 400);
    [doc.rows[i], doc.rows[j]] = [doc.rows[j], doc.rows[i]];
  } else {
    return editor(send, form, bad('Unknown row operation.'), 400);
  }
  if (!write(send, form, () => rowLayout.saveRowLayout(rowLayout.normalizeLayout(doc), form.mtime))) return undefined;
  const said = { add: 'Row added', remove: 'Row removed — its buttons moved to the row above', up: 'Row moved up', down: 'Row moved down' }[op];
  return editor(send, form, ok(`${said}. Reload a workspace page to see it.`));
}

async function custom_add({ form, send }) {
  const doc = arranged(form);
  const key = form.for_button === '__new__' ? 'new' : String(form.for_button || '');
  const field = (n) => (form[`add_${n}_${key}`] === undefined ? '' : String(form[`add_${n}_${key}`]));
  // A command picked with nothing typed is the whole action: it takes that command's label, group and node filter.
  const typed = stepsFrom(field('steps'));
  const use = field('use').trim();
  const alone = use && !typed.length ? catalog.findCommand(use) : null;
  const label = field('label').trim() || (alone ? alone.label : '');
  const taken = new Set(doc.custom.map((c) => c.id));
  const base = rowLayout.slug(label);
  let id = base;
  for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`;
  const entry = rowLayout.cleanCustom({
    id, label,
    button: key === 'new' ? field('button') : key,
    group: field('group').trim() || (alone ? alone.group : 'Custom'),
    when: alone && (!field('when') || field('when') === 'any') ? alone.when : (field('when') || 'any'),
    steps: use ? [...typed, { use }] : typed,
    keepgoing: field('keepgoing') === '1',
    confirm: field('confirm') === '1',
    open: field('open'),
  });
  const why = rowLayout.customRefusal(entry) || rowLayout.useRefusal(entry);
  if (why) return editor(send, form, bad(`Not added: ${esc(why)}.`), 400);
  doc.custom.push(rowLayout.customToDoc(entry));
  if (!write(send, form, () => rowLayout.saveRowLayout(rowLayout.normalizeLayout(doc), form.mtime))) return undefined;
  return editor(send, form, ok(`Added ${esc(entry.label)} to ${esc(rowLayout.buttonLabel(entry.button))}. Reload a workspace page to see it.`));
}

async function custom_save({ form, send }) {
  const doc = arranged(form);
  const id = String(form.id || '');
  const at = doc.custom.findIndex((c) => c.id === id);
  if (at < 0) return editor(send, form, bad('No such action — it may have been deleted.'), 404);
  const old = rowLayout.cleanCustom(doc.custom[at]);
  const field = (n) => (form[`edit_${n}_${id}`] === undefined ? '' : String(form[`edit_${n}_${id}`]));
  // A step whose text did not change keeps its on_error; options are kept whole (Definition edits those).
  const steps = stepsFrom(field('steps')).map((step, i) => {
    const was = old.steps[i];
    const text = typeof step === 'string' ? step : `use: ${step.use}`;
    if (!was || !was.onError || rowLayout.stepText(was) !== text) return step;
    return typeof step === 'string' ? { command: step, on_error: was.onError } : { use: step.use, on_error: was.onError };
  });
  const entry = rowLayout.cleanCustom({
    ...rowLayout.customToDoc(old),
    command: undefined,
    label: field('label').trim(),
    group: field('group').trim() || 'Custom',
    when: field('when').trim().split(/\s+/).filter(Boolean),
    steps,
    keepgoing: field('keepgoing') === '1',
    confirm: field('confirm') === '1',
    open: field('open'),
  });
  const why = rowLayout.customRefusal(entry) || rowLayout.useRefusal(entry);
  if (why) return editor(send, form, bad(`Not saved: ${esc(why)}.`), 400);
  doc.custom[at] = rowLayout.customToDoc(entry);
  if (!write(send, form, () => rowLayout.saveRowLayout(rowLayout.normalizeLayout(doc), form.mtime))) return undefined;
  return editor(send, form, ok(`Saved ${esc(entry.label)}. Reload a workspace page to see it.`));
}

async function custom_remove({ form, send }) {
  const doc = arranged(form);
  const id = String(form.id || '');
  if (!doc.custom.some((c) => c.id === id)) return editor(send, form, bad('No such action — only actions you added can be deleted.'), 404);
  doc.custom = doc.custom.filter((c) => c.id !== id);
  if (!write(send, form, () => rowLayout.saveRowLayout(rowLayout.normalizeLayout(doc), form.mtime))) return undefined;
  return editor(send, form, ok('Action deleted.'));
}

async function layout_reset({ form, send }) {
  if (!write(send, form, () => rowLayout.resetRowLayout(form.mtime))) return undefined;
  return editor(send, form, ok('Back to the defaults.'));
}

function reportHtml(report) {
  return `${report.errors.map((e) => bad(esc(e))).join('')}${report.notes.length
    ? `<div class="msg assistant">${report.errors.length ? '' : '✅ '}${report.notes.map(esc).join(' ')}</div>` : ''}`;
}

async function definition_check({ form, send }) {
  const report = rowLayout.checkDefinition(form.definition, String(form.mode || 'replace'), rowLayout.loadRowLayoutFresh());
  if (!report.errors.length) report.notes.unshift('It loads cleanly.');
  return send(reportHtml(report), report.errors.length ? 400 : 200);
}

async function definition_save({ form, send }) {
  const report = rowLayout.checkDefinition(form.definition, String(form.mode || 'replace'), rowLayout.loadRowLayoutFresh());
  if (report.errors.length) return editor(send, { ...form, pane: '2' }, `${bad('Nothing was saved:')}${reportHtml(report)}`, 400);
  if (!write(send, { ...form, pane: '2' }, () => rowLayout.saveRowLayout(report.next, form.mtime))) return undefined;
  return editor(send, { ...form, pane: '2' }, ok(`Loaded. ${report.notes.map(esc).join(' ')}`));
}

/** The action and the folder it would run in, or an answer saying why not. */
function actionTarget({ form, send, workspace }) {
  const projectName = String(form.projectName || '');
  if (!NAME_RE.test(projectName)) { send(bad('Invalid project name.'), 400); return { done: true }; }
  const entry = rowLayout.loadRowLayout().custom.find((c) => c.id === String(form.id || ''));
  if (!entry) { send(bad('No such action — it may have been deleted in Commands → Buttons.'), 404); return { done: true }; }
  const why = rowLayout.customRefusal(entry);
  if (why) { send(bad(`Not running ${esc(entry.label)}: ${esc(why)}.`), 400); return { done: true }; }
  const projectDir = path.join(workspaceDir(workspace), projectName);
  let isDir = false;
  try { isDir = fs.statSync(projectDir).isDirectory(); } catch (_) { /* not there */ }
  if (!isDir) { send(bad(`No folder called ${esc(projectName)} here.`), 400); return { done: true }; }
  if (!SAFE_PATH_RE.test(projectDir)) { send(bad('Not running it: the folder path has characters a shell line cannot carry safely.'), 400); return { done: true }; }
  const ctx = { key: workspace, isDdev: isDdevProject(projectDir), hasComposer: hasComposerJson(projectDir), hasNode: hasPackageJson(projectDir), hasGit: hasOwnGit(projectDir) };
  if (!rowLayout.whenMatches(entry.when, ctx)) { send(bad(`${esc(entry.label)} is only for ${esc(rowLayout.describeWhen(entry.when))}.`), 400); return { done: true }; }
  const used = rowLayout.useRefusal(entry);
  if (used) { send(bad(`Not running ${esc(entry.label)}: ${esc(used)}.`), 400); return { done: true }; }
  // A command a step uses keeps its own node filter: the action's filter does not widen it.
  for (const { cmd } of rowLayout.usedCommands(entry)) {
    if (!rowLayout.whenMatches(cmd.when, ctx)) {
      send(bad(`${esc(entry.label)} uses ${esc(cmd.label)}, which is only for ${esc(rowLayout.describeWhen(cmd.when))}.`), 400);
      return { done: true };
    }
  }
  return { entry, projectName, projectDir };
}

async function custom_options(args) {
  const t = actionTarget(args);
  if (t.done) return undefined;
  return args.send(rowLayout.actionOptionsFormHtml(t.entry, { workspace: args.workspace, project: t.projectName }));
}

async function custom_run(args) {
  const { form, send, workspace } = args;
  const t = actionTarget(args);
  if (t.done) return undefined;
  const { entry, projectName, projectDir } = t;
  const options = rowLayout.effectiveOptions(entry);
  if (options.length && form.submitted !== '1') {
    return send(bad(`${esc(entry.label)} asks for ${options.length === 1 ? 'an option' : 'options'} — run it from its menu, which opens the form.`), 400);
  }
  const { values, error } = rowLayout.resolveOptions({ ...entry, options }, form);
  if (error) return send(bad(`Not running ${esc(entry.label)}: ${esc(error)}.`), 400);
  const expanded = catalog.expandSteps(entry, { workspace, project: projectName, projectDir });
  if (expanded.error) return send(bad(`Not running ${esc(entry.label)}: ${esc(expanded.error)}.`), 400);

  const verb = `custom-${entry.id}`;
  // The last run of this action here is about to have its log truncated: write down how it ended first.
  rowLayout.settleRun(screenSessionName(projectName, verb, workspace));
  const started = await startUnlessRunning({ workspace, project: projectName, projectDir, verb,
    cmdLine: `${rowLayout.actionCommandLine(expanded.entry, values)}; ${lingerTail(entry.label)}`, label: entry.label });
  if (started.stillRunning) {
    return send(bad(`<code>${esc(entry.label)}</code> is still running on <strong>${esc(projectName)}</strong> — ${terminalLink(started.session, 'open it')}. Left alone.`), 409);
  }
  if (!started.ok) return send(screenStartedHtml(started, entry.label, projectName), started.already ? 409 : 500);
  rowLayout.recordRun({ at: new Date().toISOString(), id: entry.id, label: entry.label, workspace, project: projectName, session: started.session });

  if (entry.open === 'screen') {
    // Its terminal, at once, in the dashboard's one modal — the same terminal the SCREENS menu opens.
    // Nothing visible lands in the page: this only fetches the terminal into the modal and shows it.
    return send(`<div hidden hx-get="/fragments/screen-term/${encodeURIComponent(started.session)}" hx-trigger="load" hx-target="#editor-modal-body" hx-swap="innerHTML"
      hx-on::after:request="UIkit.modal('#editor-modal').show()"></div>`);
  }
  return send(`<div class="msg assistant flash-now"><code>${esc(entry.label)}</code> on <strong>${esc(projectName)}</strong> — ${terminalLink(started.session, 'open the output')}</div>`);
}

module.exports = {
  '/actions/row-arrange-save': arrange_save,
  '/actions/row-rows': rows_op,
  '/actions/row-custom-add': custom_add,
  '/actions/row-custom-save': custom_save,
  '/actions/row-custom-remove': custom_remove,
  '/actions/row-layout-reset': layout_reset,
  '/actions/row-definition-check': definition_check,
  '/actions/row-definition-save': definition_save,
  '/actions/row-custom-options': custom_options,
  '/actions/row-custom-run': custom_run,
};
