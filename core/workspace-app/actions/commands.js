/**
 * Managing the workspace's own commands against the tooling repository.
 *
 * Every one of these shells out to `commands/cmd-tools-commands.sh` rather than reimplementing it,
 * so a button and the CLI cannot answer differently. What the dashboard adds is that the output
 * arrives in a job toast you can watch, which matters when a comparison walks 180 files.
 */

const fs = require('fs');
const path = require('path');

const { ROOT, loadWorkspaces } = require('../workspaces');
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

  '/actions/command-sync': async ({ form, res, send }) => {
    const { repo } = toolingRepo();
    const confirmed = form.confirm === 'yes';
    const overwrite = form.overwrite === 'yes';
    // Without --confirm the script reports and writes nothing, which is what the first menu item
    // is for. The list is only refreshed when something could actually have changed.
    if (confirmed) res.setHeader('HX-Trigger', 'refresh-projects');
    const args = ['--sync', ...(confirmed ? ['--confirm'] : []), ...(overwrite ? ['--overwrite'] : [])];
    const what = !confirmed ? 'Show what would change from' : overwrite ? 'Sync and replace from' : 'Take what is missing from';
    return run(send, `⬇️ ${what} <strong>${esc(repo)}</strong>`, args, 10);
  },

  // Scaffold an empty command: the script writes the bootstrap chain, the settings load and the
  // argparse block, which is the part that is easy to get subtly wrong by hand.
  '/actions/command-new': async ({ form, res, send }) => {
    const name = String(form.newName || '').trim();
    const target = String(form.target || '').trim();
    const label = String(form.label || '').slice(0, 120);
    if (!SCRIPT_RE.test(name)) return send('<div class="msg error">A command is named cmd-&lt;something&gt;.sh.</div>', 400);
    if (!loadWorkspaces()[target]) return send('<div class="msg error">Unknown workspace.</div>', 400);
    if (fs.existsSync(path.join(loadWorkspaces()[target].dir, name))) {
      return send(`<div class="msg error">${esc(target)}/${esc(name)} already exists.</div>`, 409);
    }
    res.setHeader('HX-Trigger', 'refresh-projects');
    const args = ['--new', name, '--workspace', target, ...(label ? ['--label', label] : [])];
    return run(send, `📄 New command <strong>${esc(target)}/${esc(name)}</strong>`, args, 2);
  },

  // Or have it written. Same shape as generating an agent: the model writes the file, and the
  // scaffold goes in first so what it writes has the right bootstrap chain to start from.
  '/actions/command-generate': async ({ form, res, send }) => {
    const name = String(form.newName || '').trim();
    const target = String(form.target || '').trim();
    const description = String(form.description || '').slice(0, 2000);
    if (!SCRIPT_RE.test(name)) return send('<div class="msg error">A command is named cmd-&lt;something&gt;.sh.</div>', 400);
    const ws = loadWorkspaces()[target];
    if (!ws) return send('<div class="msg error">Unknown workspace.</div>', 400);
    if (!description.trim()) return send('<div class="msg error">Describe what the command should do.</div>', 400);
    if (fs.existsSync(path.join(ws.dir, name))) {
      return send(`<div class="msg error">${esc(target)}/${esc(name)} already exists.</div>`, 409);
    }
    res.setHeader('HX-Trigger', 'refresh-projects');

    const file = path.join(ws.dir, name);
    const prompt = `Write one workspace command: a bash script named ${name} that lives in ${ROOT}/${target}/ and is run from that folder.

What it should do: ${description}

It MUST follow how every other command in this workspace is written — read ${ROOT}/${target}/ and ${ROOT}/CLAUDE.md first with your tools:
- Locate the tooling from its own path: WORKSPACE_SCRIPTS="\${WORKSPACE_SCRIPTS:-$(cd "$(dirname "\${BASH_SOURCE[0]}")/../core/scripts" && pwd)}"; then source \${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;
- Load its workspace settings: eval $(parse_yaml \${WORKSPACE_CONFIG}/workspace.${target}.settings.yml);
- Declare arguments with the argparse heredoc the other commands use, and shift $# after it.
- Everything to do with a Drupal site goes through DDEV — ddev composer, ddev drush, ddev export-db. Never a host composer, drush or mysql. ddev start takes -y; ddev stop does not.
- If it BUILDS something, carry a "# workspace-name: <Human Name>" header, which is what the dashboard's Build dropdown shows.

Output ONLY the raw script — no commentary, no code fences.`;

    const line = `set -e; echo "Writing ${target}/${name} with AI…"; claude -p ${JSON.stringify(prompt)} --allowedTools Read Glob Grep --disallowedTools Write Edit Bash --no-session-persistence > ${JSON.stringify(file)}; chmod +x ${JSON.stringify(file)}; echo "Written: ${target}/${name}"; head -25 ${JSON.stringify(file)}`;
    const id = startJob(`🤖 Write <strong>${esc(target)}/${esc(name)}</strong> with AI`, 'bash', ['-c', line], ws.dir, { timeoutMs: 10 * 60 * 1000 });
    return send(jobFragment(id).html);
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
    const confirmed = form.confirm === 'yes';
    const args = ['--propose', c.file, ...(summary ? ['--summary', summary] : []), ...(confirmed ? ['--confirm'] : [])];
    const what = confirmed ? '📤 Propose' : '📋 Plan a proposal of';
    // Confirmed, this hands the file to the AI agent to file an issue and open a pull request,
    // which is minutes of work rather than seconds.
    return run(send, `${what} <strong>${esc(c.file)}</strong> to ${esc(repo)}`, args, confirmed ? 30 : 10);
  },
};
