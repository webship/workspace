/**
 * The one action of the Sources and AI CLIs panel. It runs the terminal's own command
 * (`ai-anycli-cli.js <kind> <verb> …`, what `bash core/scripts/ai-items.sh` runs) as a child process
 * with stdin closed, and draws the panel again with what the command printed: a button and the
 * terminal cannot disagree, and the dashboard does not wait on a clone inside its own process.
 */

const path = require('path');

const { run } = require('../jobs');
const { loadWorkspaces } = require('../workspaces');
const { panelHtml } = require('../ai-anycli-page');
const A = require('../ai-anycli');

const VERBS = new Set(['source-add', 'source-check', 'source-update', 'source-remove', 'install', 'uninstall']);
const TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

/** The folders a cmd-* source may go in: the workspace folders of this workspace. */
const cmdFolders = () => Object.keys(loadWorkspaces());

async function any_cli({ form, send, workspace }) {
  const kind = String(form.kind || '');
  const verb = String(form.verb || '');
  if (!A.KINDS.includes(kind) || !VERBS.has(verb)) return send('<div class="msg error">Unknown request.</div>', 400);
  const workspaces = cmdFolders();
  const again = (said, failed = false) => send(panelHtml(kind, { said, failed, workspaces }));
  const field = (name) => String(form[name] || '').trim();
  const args = [kind, verb];

  if (verb === 'source-add') {
    const source = field('source');
    // The engine reads the source again; this only keeps an option out of the argument list.
    if (!source || source.startsWith('-') || /\s/.test(source)) return again('Name the source: owner/repo, an https:// address, or skills.sh/owner/repo/skill.', true);
    args.push(source);
    for (const [name, flag] of [['id', '--as'], ['ref', '--ref'], ['item', '--item']]) {
      const v = field(name);
      if (!v) continue;
      if (v.startsWith('-') || !/^[A-Za-z0-9_./-]+$/.test(v)) return again(`Not a value I can use for ${name}: ${v}`, true);
      args.push(flag, v);
    }
    if (kind === 'cmd') args.push('--to', workspace);
  } else if (verb.startsWith('source-')) {
    const id = field('id');
    if (!TOKEN_RE.test(id)) return again('Which source?', true);
    args.push(id);
  } else {
    const name = field('name'); const cli = field('cli');
    if (!TOKEN_RE.test(name) || !TOKEN_RE.test(cli)) return again('Which item, and which CLI?', true);
    args.push(name, '--cli', cli);
    // Asked for, and confirmed, on a cell whose file is not what the folder installs.
    if (verb === 'uninstall' && field('force') === '1') args.push('--force');
  }

  const out = await run(process.execPath, [path.join(__dirname, '..', 'ai-anycli-cli.js'), ...args], path.join(__dirname, '..'),
    { timeoutMs: 5 * 60 * 1000, env: process.env });
  const said = `${out.stdout}${out.stderr}`.trim() || (out.ok ? 'Done.' : 'It did not finish.');
  return again(said, !out.ok);
}

module.exports = { '/actions/any-cli': any_cli };
