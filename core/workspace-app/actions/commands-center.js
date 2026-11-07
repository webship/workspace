/**
 * The Commands page's writes, and running a command on what it runs on.
 *
 * Each form carries the mtime of core/config/commands.yml from when it was drawn, and a write refuses with 409 when
 * the file changed since, rather than silently writing over another tab or a hand edit. A refused save answers
 * with the same form holding what was typed, so nothing has to be typed again.
 *
 * A command is run by id only: its line comes from the catalog, never from the request. The only things a request
 * carries into a run are the target it picked — resolved and kept inside its workspace or project — and option
 * values, each checked against its option. Every value is single-quoted.
 */

const fs = require('fs');

const { esc } = require('../html');
const { isValidWorkspace, workspaceDir } = require('../workspaces');
const { screenStartedHtml, screenSessionName } = require('../jobs');
const { lingerTail } = require('../linger');
const { hasOwnGit } = require('../git-info');
const { startUnlessRunning, terminalLink, isDdevProject, hasComposerJson } = require('./composer');
const { hasPackageJson } = require('./node');
const rl = require('../row-layout');
const cc = require('../commands');
const cp = require('../commands-page');

const ok = (text) => `<div class="msg assistant">✅ ${text}</div>`;
const bad = (text) => `<div class="msg error">${text}</div>`;
const saveError = (err) => (err && err.code === 'CHANGED'
  ? { code: 409, html: bad('Your commands changed since this page was loaded (another tab, or a hand edit), so nothing was saved. Reload to see them.') }
  : { code: 500, html: bad(`Could not save: ${esc(String((err && err.message) || err))}`) });

/** A command from the add or edit form. Editing keeps the id and the options (those are changed in Definition). */
function fromForm(form, old) {
  const f = (n) => (form[`cc_${n}`] === undefined ? '' : String(form[`cc_${n}`]));
  const kind = f('kind') === 'script' ? 'script' : 'run';
  return cc.cleanCommand({
    id: old ? old.id : f('id').trim(),
    label: f('label'),
    group: f('group'),
    description: f('description'),
    on: f('on'),
    when: f('when').trim().split(/\s+/).filter(Boolean),
    run: kind === 'run' ? f('run') : '',
    script: kind === 'script' ? f('script') : '',
    args: kind === 'script' ? f('args') : '',
    options: old ? old.options : [],
    confirm: f('confirm') === '1',
    open: f('open'),
    tags: f('tags').split(/[\s,]+/).filter(Boolean),
  }, 'yours');
}

async function cc_save({ form, send, res }) {
  const cat = cc.loadCatalog();
  const scripts = cc.listScripts();
  const editing = String(form.id || '');
  const old = editing ? cat.commands.find((c) => c.id === editing) : null;
  if (editing && !old) return send(`<div id="cc-command">${bad('No such command — it may have been deleted.')} <a href="/commands">Back to the commands</a></div>`, 404);
  const again = (message, draft, code) => send(old
    ? cp.commandPageBody(old, { message, draft, scripts })
    : cp.newPageBody({ scripts, draft, message }), code);

  const e = fromForm(form, old);
  if (!old) {
    if (!e.id) {
      const base = rl.slug(e.label);
      let id = base;
      for (let n = 2; cat.commands.some((c) => c.id === id); n += 1) id = `${base}-${n}`;
      e.id = id;
    } else if (cat.commands.some((c) => c.id === e.id)) {
      return again(bad(`There is already a command with the id ${esc(e.id)} — pick another, or edit that one.`), e, 409);
    }
  }
  const why = cc.commandRefusal(e);
  if (why) return again(bad(`Not saved: ${esc(why)}.`), e, 400);

  const list = cat.yours.slice();
  const at = list.findIndex((c) => c.id === e.id);
  if (at >= 0) list[at] = e; else list.push(e);
  try { cc.saveYourCommands(list, form.mtime); } catch (err) {
    const { code, html } = saveError(err);
    return again(html, e, code);
  }
  if (res) res.setHeader('HX-Trigger', 'refresh-projects');
  const saved = cc.findCommand(e.id);
  const changedBuiltin = cat.builtin.some((c) => c.id === e.id);
  return send(cp.commandPageBody(saved, { scripts,
    message: ok(`${old ? 'Saved' : 'Added'} <strong>${esc(saved.label)}</strong>${changedBuiltin ? ' — your version of a built-in command' : ''}.`
      + `${old ? '' : ` Its page is <a href="/commands/c/${encodeURIComponent(saved.id)}">/commands/c/${esc(saved.id)}</a>.`}`) }));
}

async function cc_copy({ form, send, res }) {
  const fromPage = form.from === 'page';
  const cat = cc.loadCatalog();
  const src = cat.commands.find((c) => c.id === String(form.id || ''));
  if (!src) return send(fromPage ? `<div id="cc-command">${bad('No such command.')} <a href="/commands">Back to the commands</a></div>` : bad('No such command.'), 404);
  const base = `${src.id.slice(0, 38)}-copy`;
  let id = base;
  for (let n = 2; cat.commands.some((c) => c.id === id); n += 1) id = `${base}-${n}`;
  const copy = { ...src, id, label: `${src.label.slice(0, 55)} copy`, source: 'yours', overrides: undefined };
  const why = cc.commandRefusal(copy);
  if (why) return send(bad(`Not copied: ${esc(why)}.`), 400);
  try { cc.saveYourCommands([...cat.yours, copy], form.mtime); } catch (err) {
    const { code, html } = saveError(err);
    return send(fromPage ? cp.commandPageBody(src, { message: html, scripts: cc.listScripts() }) : html, code);
  }
  if (res) res.setHeader('HX-Trigger', 'refresh-projects');
  const saved = cc.findCommand(id);
  if (fromPage) return send(cp.commandPageBody(saved, { scripts: cc.listScripts(), message: ok(`This is the copy, <strong>${esc(saved.label)}</strong> — change it below.`) }));
  return send(ok(`Copied to <strong>${esc(saved.label)}</strong>. <a href="/commands/c/${encodeURIComponent(id)}">Open the copy</a> to change it.`));
}

async function cc_remove({ form, send, res }) {
  const fromPage = form.from === 'page';
  const cat = cc.loadCatalog();
  const id = String(form.id || '');
  const fail = (html, code) => send(fromPage ? `<div id="cc-command">${html} <a href="/commands">Back to the commands</a></div>` : html, code);
  if (!cat.yours.some((c) => c.id === id)) {
    return fail(bad(cat.builtin.some((c) => c.id === id)
      ? 'A built-in command cannot be deleted. Copy it and change the copy, or hide it from its button in Buttons.'
      : 'No such command of yours — it may have been deleted already.'), 404);
  }
  // Deleting yours of a built-in id leaves the built-in one, so only a command of yours alone is refused while a button uses it.
  const by = cat.builtin.some((c) => c.id === id) ? [] : cc.usedBy(id);
  if (by.length) {
    return fail(bad(`${esc(cat.yours.find((c) => c.id === id).label)} is on ${by.length === 1 ? 'a button' : `${by.length} buttons`}: `
      + `${esc(cc.describeUses(by))}. Take it off in Buttons first, then delete it.`), 409);
  }
  try { cc.saveYourCommands(cat.yours.filter((c) => c.id !== id), form.mtime); } catch (err) {
    const { code, html } = saveError(err);
    return fail(html, code);
  }
  if (res) res.setHeader('HX-Trigger', 'refresh-projects');
  const builtin = cc.findCommand(id);
  if (fromPage) {
    return send(builtin
      ? cp.commandPageBody(builtin, { scripts: cc.listScripts(), message: ok('Yours is deleted: this is the built-in command again.') })
      : `<div id="cc-command">${ok('Command deleted.')} <a href="/commands">Back to the commands</a></div>`);
  }
  return send(ok(builtin ? `Yours is deleted: <strong>${esc(builtin.label)}</strong> is the built-in command again.` : 'Command deleted.'));
}

async function cc_run({ form, send }) {
  const e = cc.findCommand(form.id);
  if (!e) return send(bad('No such command — it may have been deleted.'), 404);
  const why = cc.commandRefusal(e);
  if (why) return send(bad(`Not running ${esc(e.label)}: ${esc(why)}.`), 400);
  const t = cc.resolveTarget(e, form);
  if (t.error) return send(bad(`Not running ${esc(e.label)}: ${esc(t.error)}`), 400);
  const ctx = { key: t.ws, isDdev: isDdevProject(t.base), hasComposer: hasComposerJson(t.base), hasNode: hasPackageJson(t.base), hasGit: hasOwnGit(t.base) };
  if (!rl.whenMatches(e.when, ctx)) return send(bad(`${esc(e.label)} is only for ${esc(rl.describeWhen(e.when))}, and ${esc(t.name)} is not.`), 400);

  let cwd = t.cwd;
  if (e.script) {
    const m = cc.SCRIPT_REF_RE.exec(e.script);
    if (m[1] !== 'commands' && !isValidWorkspace(m[1])) return send(bad(`Not running ${esc(e.label)}: there is no ${esc(m[1])} workspace.`), 400);
    const file = cc.scriptPath(e);
    if (!fs.existsSync(file)) return send(bad(`Not running ${esc(e.label)}: ${esc(e.script)} does not exist.`), 404);
    // A script runs from its own folder, the way it runs from a terminal; the target reaches it through its arguments.
    cwd = m[1] === 'commands' ? require('path').dirname(file) : workspaceDir(m[1]);
  }
  if (e.options.length && form.submitted !== '1') {
    return send(bad(`${esc(e.label)} asks for ${e.options.length === 1 ? 'an option' : 'options'} — run it from its form.`), 400);
  }
  const { values, error } = rl.resolveOptions(e, form);
  if (error) return send(bad(`Not running ${esc(e.label)}: ${esc(error)}.`), 400);

  const verb = `cmd-${e.id}`;
  const project = t.project || t.ws;
  // The last run of this command here is about to have its log truncated: write down how it ended first.
  rl.settleRun(screenSessionName(project, verb, t.ws));
  const started = await startUnlessRunning({ workspace: t.ws, project, projectDir: cwd, ownerDir: t.base, verb,
    cmdLine: `${cc.commandLine(e, t.vars, values)}; ${lingerTail(e.label)}`, label: e.label });
  if (started.stillRunning) {
    return send(bad(`<code>${esc(e.label)}</code> is still running on <strong>${esc(t.name)}</strong> — ${terminalLink(started.session, 'open it')}. Left alone.`), 409);
  }
  if (!started.ok) return send(screenStartedHtml(started, e.label, t.name), started.already ? 409 : 500);
  rl.recordRun({ at: new Date().toISOString(), id: `command:${e.id}`, label: e.label, workspace: t.ws, project: t.where || '.', session: started.session });

  if (e.open === 'screen') {
    return send(`<div hidden hx-get="/fragments/screen-term/${encodeURIComponent(started.session)}" hx-trigger="load" hx-target="#editor-modal-body" hx-swap="innerHTML"
      hx-on::after:request="UIkit.modal('#editor-modal').show()"></div>`);
  }
  return send(`<div class="msg assistant flash-now"><code>${esc(e.label)}</code> on <strong>${esc(t.name)}</strong> — ${terminalLink(started.session, 'open the output')}</div>`);
}

/** Put a command on a button: an action there whose one step uses it, with the command's node filter. */
async function cc_add_to_button({ form, send }) {
  const cmd = cc.findCommand(form.id);
  if (!cmd) return send(`<div id="cc-command">${bad('No such command — it may have been deleted.')} <a href="/commands">Back to the commands</a></div>`, 404);
  const scripts = cc.listScripts();
  const again = (message, code) => send(cp.commandPageBody(cmd, { message, scripts }), code);
  const layout = rl.loadRowLayoutFresh();
  const label = String(form.label || '').trim() || cmd.label;
  const taken = new Set(layout.custom.map((c) => c.id));
  const base = rl.slug(label);
  let id = base;
  for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`;
  const entry = rl.cleanCustom({ id, label, button: String(form.button || ''), group: String(form.group || '').trim() || cmd.group,
    description: cmd.description, when: cmd.when, confirm: cmd.confirm, open: cmd.open, steps: [{ use: cmd.id }] });
  const why = rl.customRefusal(entry) || rl.useRefusal(entry);
  if (why) return again(bad(`Not added: ${esc(why)}.`), 400);
  const doc = rl.toDoc(layout);
  doc.custom.push(rl.customToDoc(entry));
  try { rl.saveRowLayout(rl.normalizeLayout(doc), form.mtime); } catch (err) {
    return again(bad(err && err.code === 'CHANGED'
      ? 'The buttons changed since this page was loaded (another tab, or a hand edit), so nothing was added. Reload to see them.'
      : `Could not save: ${esc(String((err && err.message) || err))}`), err && err.code === 'CHANGED' ? 409 : 500);
  }
  return again(ok(`Added to ${esc(rl.buttonLabel(entry.button))} → ${esc(entry.group)} as <strong>${esc(label)}</strong>. Reload a workspace page to see it.`));
}

function reportHtml(report) {
  return `${report.errors.map((x) => bad(esc(x))).join('')}${report.notes.length
    ? `<div class="msg assistant">${report.errors.length ? '' : '✅ '}${report.notes.map(esc).join(' ')}</div>` : ''}`;
}

async function cc_definition_check({ form, send }) {
  const report = cc.checkDefinition(form.definition);
  if (!report.errors.length) report.notes.unshift('It loads cleanly.');
  return send(reportHtml(report), report.errors.length ? 400 : 200);
}

async function cc_definition_save({ form, send }) {
  const report = cc.checkDefinition(form.definition);
  if (report.errors.length) {
    return send(cp.definitionBody({ message: `${bad('Nothing was saved:')}${reportHtml(report)}`, draft: String(form.definition || '') }), 400);
  }
  try { cc.saveYourCommands(report.next, form.mtime); } catch (err) {
    const { code, html } = saveError(err);
    return send(cp.definitionBody({ message: html, draft: String(form.definition || '') }), code);
  }
  return send(cp.definitionBody({ message: ok(`Saved. ${report.notes.map(esc).join(' ')}`) }));
}

async function cc_reset({ form, send }) {
  const cat = cc.loadCatalog();
  const used = cat.yours.filter((c) => !cat.builtin.some((b) => b.id === c.id)).map((c) => ({ c, by: cc.usedBy(c.id) })).filter((x) => x.by.length);
  if (used.length) {
    return send(cp.definitionBody({ message: bad(`Nothing was removed: ${used.map((x) => `${esc(x.c.id)} is used by ${esc(cc.describeUses(x.by))}`).join('; ')}. Take those off their buttons first.`) }), 409);
  }
  try { cc.saveYourCommands([], form.mtime); } catch (err) {
    const { code, html } = saveError(err);
    return send(cp.definitionBody({ message: html }), code);
  }
  return send(cp.definitionBody({ message: ok('Every command of yours is removed; the built-in commands are as shipped.') }));
}

module.exports = {
  '/actions/cc-save': cc_save,
  '/actions/cc-copy': cc_copy,
  '/actions/cc-remove': cc_remove,
  '/actions/cc-run': cc_run,
  '/actions/cc-definition-check': cc_definition_check,
  '/actions/cc-definition-save': cc_definition_save,
  '/actions/cc-reset': cc_reset,
  '/actions/cc-add-to-button': cc_add_to_button,
};
