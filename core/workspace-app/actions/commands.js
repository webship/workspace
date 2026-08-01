/**
 * Managing the workspace's own commands against the tooling repository.
 *
 * Every one of these shells out to `commands/cmd-tools-commands.sh` rather than reimplementing it,
 * so a button and the CLI cannot answer differently. What the dashboard adds is that the output
 * arrives in a job toast you can watch, which matters when a comparison walks 180 files.
 */

const fs = require('fs');
const path = require('path');

const { ROOT } = require('../workspaces');
const { esc } = require('../html');
const { startJob, jobFragment } = require('../jobs');
const { commandFile, toolingRepo, SCRIPT_RE } = require('../commands');

const COMMANDS_DIR = () => path.join(ROOT, 'commands');
const TOOL = 'cmd-tools-commands.sh';

// Every action here runs the same script with different arguments, so they share one launcher.
function run(send, title, args, minutes) {
  const dir = COMMANDS_DIR();
  if (!fs.existsSync(path.join(dir, TOOL))) {
    return send(`<div class="msg error">commands/${TOOL} is missing — the commands tooling is not installed.</div>`, 400);
  }
  // Quoted per argument: a command file name is validated, but the script also takes a summary
  // that is free text, and an unquoted one would be split into arguments by the shell.
  const line = `bash ${TOOL} ${args.map((a) => JSON.stringify(a)).join(' ')}`;
  const id = startJob(title, 'bash', ['-c', line], dir, { timeoutMs: minutes * 60 * 1000, echoLine: line });
  return send(jobFragment(id).html);
}

// The ones that act on a single command need to know which one, and it has to exist: the script
// would otherwise search the tree and report nothing, which reads like a repository problem.
function requireCommand({ form, send }) {
  const file = String(form.file || '');
  const workspace = String(form.workspace || '');
  if (!SCRIPT_RE.test(file)) { send('<div class="msg error">Not a command file name.</div>', 400); return null; }
  if (!commandFile(workspace, file)) { send(`<div class="msg error">No ${esc(file)} in ${esc(workspace)}.</div>`, 404); return null; }
  return { file, workspace };
}

module.exports = {
  '/actions/command-list-remote': async ({ send }) => {
    const { repo } = toolingRepo();
    return run(send, `☁️ Compare every command with <strong>${esc(repo)}</strong>`, ['--list-remote'], 5);
  },

  '/actions/command-diff': async ({ form, send }) => {
    const c = requireCommand({ form, send });
    if (!c) return undefined;
    const { repo } = toolingRepo();
    return run(send, `🔀 Diff <strong>${esc(c.file)}</strong> against ${esc(repo)}`, ['--diff', c.file], 5);
  },

  '/actions/command-pull': async ({ form, res, send }) => {
    const c = requireCommand({ form, send });
    if (!c) return undefined;
    const { repo } = toolingRepo();
    // The list shows what each command is; pulling can change that, so the list is refreshed.
    res.setHeader('HX-Trigger', 'refresh-projects');
    return run(send, `⬇️ Pull <strong>${esc(c.file)}</strong> from ${esc(repo)}`, ['--pull', c.file], 5);
  },

  '/actions/command-save': async ({ form, res, send }) => {
    const c = requireCommand({ form, send });
    if (!c) return undefined;
    const full = commandFile(c.workspace, c.file);
    const content = String(form.content || '').replace(/\r\n/g, '\n');
    if (!content.trim()) return send('<div class="msg error">Refusing to save an empty command.</div>', 400);
    if (content.length > 500000) return send('<div class="msg error">Content too large.</div>', 400);
    // Written in place, keeping the mode: a cmd-*.sh that loses its executable bit is one that
    // stops working from the shell while still working from the dashboard.
    const mode = fs.statSync(full).mode;
    fs.writeFileSync(full, content);
    fs.chmodSync(full, mode);
    res.setHeader('HX-Trigger', 'refresh-projects');
    return send(`<div class="msg assistant">✅ Saved <strong>${esc(c.workspace)}/${esc(c.file)}</strong>.</div>`);
  },

  '/actions/command-propose': async ({ form, send }) => {
    const c = requireCommand({ form, send });
    if (!c) return undefined;
    const { repo } = toolingRepo();
    // Deliberately WITHOUT --confirm: the script prints what it would do and stops. Publishing to
    // a shared repository is not something a single click should complete, and the plan is worth
    // reading before it happens.
    const summary = String(form.summary || '').slice(0, 200);
    const args = ['--propose', c.file, ...(summary ? ['--summary', summary] : [])];
    return run(send, `📤 Plan a proposal of <strong>${esc(c.file)}</strong> to ${esc(repo)}`, args, 10);
  },
};
