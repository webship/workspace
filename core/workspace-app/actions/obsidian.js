/**
 * Building and removing a project's Obsidian vault.
 *
 * Both shell out to `cmd-tools-obsidian.sh` in the project's own workspace rather than
 * reimplementing the conversion, for the same reason every other action here does: the button and
 * the command line cannot then drift apart.
 */

const fs = require('fs');
const path = require('path');

const { listProjects, workspaceDir } = require('../workspaces');
const { esc } = require('../html');
const { jobFragment, runningJobKey, startJob } = require('../jobs');
const { NAME_RE } = require('../views');
const { graphStoreDir, GRAPH_FILES } = require('../graphs');
const { vaultDir } = require('../obsidian');

module.exports = {
  '/actions/obsidian': async ({ form, res, send, workspace, req }) => {
    const dir = workspaceDir(workspace);
    const script = 'cmd-tools-obsidian.sh';
    const projectName = String(form.projectName || '');
    if (!fs.existsSync(path.join(dir, script))) return send('<div class="msg error">This workspace has no Obsidian script.</div>', 400);
    if (!NAME_RE.test(projectName) || !listProjects(dir).includes(projectName)) {
      return send('<div class="msg error">Unknown project.</div>', 400);
    }
    // Said here rather than left to the script, because the menu is reached from a row that may
    // have had its graph deleted since the page was drawn.
    if (!fs.existsSync(path.join(graphStoreDir(workspace, projectName), GRAPH_FILES.json))) {
      return send('<div class="msg error">No graph to convert yet — build the graph first, from the same menu.</div>', 409);
    }
    // One writer per vault: the build writes to a sibling directory and swaps it in, so two runs
    // would race on that swap and the loser's vault would vanish under it.
    const jobKey = `obsidian:${workspace}/${projectName}`;
    if (runningJobKey(jobKey)) {
      return send('<div class="msg error">A vault is already being built for this project.</div>', 409);
    }
    const id = startJob(`🗂️ Obsidian <strong>${esc(projectName)}</strong>`, 'bash', [script, projectName], dir,
      { timeoutMs: 10 * 60 * 1000, echoLine: `bash ${script} ${projectName}`, key: jobKey });
    return send(jobFragment(id).html);
  },

  '/actions/obsidian-remove': async ({ form, res, send, workspace }) => {
    if (form.confirm !== 'yes') return send('<div class="msg error">Deleting requires confirmation.</div>', 400);
    const projectName = String(form.projectName || '');
    // The project may be long gone — a vault outlives it, and that is exactly a vault worth
    // throwing away. So the name is validated but not looked up.
    if (!NAME_RE.test(projectName)) return send('<div class="msg error">Unknown project.</div>', 400);
    const dir = vaultDir(workspace, projectName);
    if (!fs.existsSync(dir)) return send('<div class="msg">There was no vault to delete.</div>');
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (e) {
      return send(`<div class="msg error">Could not delete the vault: ${esc(e.message)}</div>`, 500);
    }
    return send('<div class="msg">Vault deleted. The graph it was made from is untouched.</div>');
  },
};
