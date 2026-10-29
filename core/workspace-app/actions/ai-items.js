/**
 * The AI-items actions: everything a row or the rail can do to an agent, a
 * skill or a prompt — sync, fetch, add from any repo, update, install, save,
 * delete, propose, clone, generate. One module per area of the dashboard;
 * server.js merges the maps and dispatches. The shared primitives live in
 * ../ai-items, which the rendering imports too, so a button and its badge can
 * never disagree.
 */

const fs = require('fs');
const path = require('path');

const { esc } = require('../html');
const { VIDEO_RE, DOC_ARTIFACT_RE } = require('../format');
const { ROOT, loadWorkspaces, workspaceDir, isValidWorkspace } = require('../workspaces');
const filesBrowser = require('../files-browser');
const { screenAction } = require('../jobs');
const { NAME_RE, ITEM_NAME_RE } = require('../validate');
const {
  INSTALL_TARGETS, NO_CLAUDE_SYNC, AI_ITEMS_REPO, AI_ITEMS_REPO_PATHS, AI_ITEMS_PROJECT_PATHS,
  itemFile, invalidateRepoCaches,
} = require('../ai-items');

async function save_item({ form, res, send, workspace, pathname }) {
    const meta = loadWorkspaces()[workspace];
    if (meta.kind !== 'files') return send('<div class="msg error">Not an editable workspace.</div>', 400);
    const name = String(form.name || '');
    if (!ITEM_NAME_RE.test(name)) return send('<div class="msg error">A name starts with a letter or digit and holds letters, digits, dots, dashes and underscores.</div>', 400);
    const content = String(form.content || '').replace(/\r\n/g, '\n');
    if (content.length > 500000) return send('<div class="msg error">Content too large.</div>', 400);
    const file = itemFile(workspace, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    res.setHeader('HX-Trigger', 'refresh-projects');
    return send(`<div class="msg assistant">✅ Saved <strong>${esc(name)}</strong> (${esc(path.relative(ROOT, file))}).</div>`);
  }

async function sync_items({ form, res, send, workspace, pathname }) {
    const key = workspace;
    const dir = workspaceDir(key);
    const script = 'cmd-tools-ai-items.sh';
    if (!AI_ITEMS_REPO_PATHS[key] || !fs.existsSync(path.join(dir, script))) {
      return send('<div class="msg error">No sync script in this workspace.</div>', 400);
    }
    // Only the directions the script understands. Reading ~/.claude keeps
    // the script's own name filter, so client and third-party items stay out of
    // a folder that may end up in a shared repository.
    const source = ['claude', 'install', 'check', 'update'].includes(form.source) ? form.source : 'repo';
    if (NO_CLAUDE_SYNC.has(key) && ['install', 'check', 'update', 'claude'].includes(source)) {
      return send('<div class="msg error">Prompts are launch templates for a new screen, not slash commands — pull from the shared repo instead.</div>', 400);
    }
    const flags = source === 'install' ? ['--install']
      : source === 'claude' ? ['--pull', '--source', 'claude']
      : source === 'check' ? ['--check']
      : source === 'update' ? ['--update']
      : ['--pull'];
    invalidateRepoCaches(key);
    return screenAction(send, { workspace: key, project: source, projectDir: dir, verb: 'sync',
      cmdLine: `bash ${script} ${flags.join(' ')}`, label: `${source} ${key}` });
  }

async function fetch_item({ form, res, send, workspace, pathname }) {
    const key = workspace;
    const name = String(form.name || '');
    if (!AI_ITEMS_REPO_PATHS[key]) return send('<div class="msg error">Not a fetchable workspace.</div>', 400);
    if (!ITEM_NAME_RE.test(name)) return send('<div class="msg error">Invalid name.</div>', 400);
    const dir = workspaceDir(key);
    const script = 'cmd-tools-ai-items.sh';
    if (!fs.existsSync(path.join(dir, script))) {
      return send('<div class="msg error">This workspace has no cmd-tools-ai-items.sh.</div>', 400);
    }
    const toClaude = pathname === '/actions/fetch-item';
    if (toClaude && NO_CLAUDE_SYNC.has(key)) {
      return send('<div class="msg error">Prompts stay in this workspace folder — use “Copy here to edit” instead.</div>', 400);
    }
    const flag = toClaude ? '--fetch' : '--pull';
    invalidateRepoCaches(key);
    return screenAction(send, { workspace: key, project: name, projectDir: dir,
      verb: toClaude ? 'fetch' : 'copy',
      cmdLine: `bash ${script} ${JSON.stringify(name)} ${flag}`,
      label: toClaude ? `fetch ${name} into ~/.claude` : `copy ${name} into ${key}/` });
  }

async function add_item({ form, res, send, workspace, pathname }) {
    const key = workspace;
    if (!AI_ITEMS_REPO_PATHS[key] || NO_CLAUDE_SYNC.has(key)) return send('<div class="msg error">Not an installable workspace.</div>', 400);
    const dir = workspaceDir(key);
    const script = 'cmd-tools-ai-items.sh';
    if (!fs.existsSync(path.join(dir, script))) {
      return send('<div class="msg error">This workspace has no cmd-tools-ai-items.sh.</div>', 400);
    }
    // The script re-validates the source; this only keeps junk out of the job line.
    const source = String(form.source || '').trim();
    if (!/^(https:\/\/github\.com\/[\w./@-]+|[\w.-]+\/[\w.-]+(@[\w./-]+)?)$/.test(source) || source.includes('..')) {
      return send('<div class="msg error">Use owner/repo, owner/repo@branch, or a github.com URL.</div>', 400);
    }
    const name = String(form.name || '').trim();
    if (name && !ITEM_NAME_RE.test(name)) return send('<div class="msg error">Invalid name.</div>', 400);
    const toWorkspace = String(form.toWorkspace || '').trim();
    const toProject = String(form.toProject || '').trim();
    const args = [script, ...(name ? [name] : []), '--add', source];
    let where = '~/.claude';
    if (toWorkspace) {
      if (!isValidWorkspace(toWorkspace)) return send('<div class="msg error">Unknown target workspace.</div>', 400);
      if (!toProject || !NAME_RE.test(toProject)) return send('<div class="msg error">Name the project to install into.</div>', 400);
      if (!fs.existsSync(path.join(workspaceDir(toWorkspace), toProject))) {
        return send(`<div class="msg error">No ${esc(toWorkspace)}/${esc(toProject)}.</div>`, 404);
      }
      args.push('--to', `${toWorkspace}/${toProject}`);
      where = `${toWorkspace}/${toProject}`;
    }
    invalidateRepoCaches(key);
    return screenAction(send, { workspace: key, project: name || `all-${key}`, projectDir: dir, verb: 'add',
      cmdLine: `bash ${args.map((a) => JSON.stringify(a)).join(' ')}`,
      label: `add ${name || `all ${key}`} → ${where}` });
  }

async function update_one_item({ form, res, send, workspace, pathname }) {
    const key = workspace;
    const name = String(form.name || '');
    if (!AI_ITEMS_REPO_PATHS[key]) return send('<div class="msg error">Not a shared-items workspace.</div>', 400);
    if (!ITEM_NAME_RE.test(name)) return send('<div class="msg error">Invalid name.</div>', 400);
    const dir = workspaceDir(key);
    const script = 'cmd-tools-ai-items.sh';
    if (!fs.existsSync(path.join(dir, script))) {
      return send('<div class="msg error">This workspace has no cmd-tools-ai-items.sh.</div>', 400);
    }
    // Take the repo's version of this one item into THIS FOLDER only. These folders are
    // the staging area where items get worked on; reaching ~/.claude or a project is a
    // separate, explicit Install.
    const shellLine = `bash ${script} ${JSON.stringify(name)} --pull`;
    invalidateRepoCaches(key);
    return screenAction(send, { workspace: key, project: name, projectDir: dir, verb: 'update',
      cmdLine: shellLine, label: `update ${name}` });
  }

async function install_item({ form, res, send, workspace, pathname }) {
    const meta = loadWorkspaces()[workspace];
    if (!INSTALL_TARGETS[workspace] || meta.kind !== 'files') return send('<div class="msg error">This workspace has no install target.</div>', 400);
    if (NO_CLAUDE_SYNC.has(workspace)) return send('<div class="msg error">Prompts run a new screen session — they do not install into ~/.claude or a project.</div>', 400);
    const name = String(form.name || '');
    if (!ITEM_NAME_RE.test(name)) return send('<div class="msg error">Invalid name.</div>', 400);
    const src = itemFile(workspace, name);
    if (!fs.existsSync(src)) return send('<div class="msg error">Item not found.</div>', 404);

    // Global by default; a chosen workspace + project puts it in that project's own .claude/
    // instead, reaching only sessions started under it — same mechanism cmd-tools-ai-items.sh
    // --to uses, so a --to install and this button never disagree about where things land.
    const toWorkspace = String(form.toWorkspace || '').trim();
    const toProject = String(form.toProject || '').trim();
    let target = INSTALL_TARGETS[workspace];
    let where = '~/.claude';
    if (toWorkspace) {
      if (!isValidWorkspace(toWorkspace)) return send('<div class="msg error">Unknown target workspace.</div>', 400);
      if (!toProject || !NAME_RE.test(toProject)) return send('<div class="msg error">Name the project to install into.</div>', 400);
      const projectDir = path.join(workspaceDir(toWorkspace), toProject);
      if (!fs.existsSync(projectDir)) return send(`<div class="msg error">No ${esc(toWorkspace)}/${esc(toProject)}.</div>`, 404);
      target = path.join(projectDir, AI_ITEMS_PROJECT_PATHS[workspace]);
      where = `${toWorkspace}/${toProject}/${AI_ITEMS_PROJECT_PATHS[workspace]}`;
    }

    fs.mkdirSync(target, { recursive: true });
    let dest;
    if (workspace === 'ai-skills') {
      dest = path.join(target, name, 'SKILL.md');
      fs.mkdirSync(path.dirname(dest), { recursive: true });
    } else {
      dest = path.join(target, `${name}.md`);
    }
    fs.copyFileSync(src, dest);
    const usage = workspace === 'ai-prompts' && !toWorkspace ? ` — available in Claude Code as <code>/${esc(name)}</code>` : '';
    const reach = toWorkspace ? `sessions started under ${esc(toWorkspace)}/${esc(toProject)}` : 'Claude Code sessions';
    return send(`<div class="msg assistant">✅ Installed <strong>${esc(name)}</strong> to <code>${esc(where)}</code>${usage}. Restart ${reach} to pick it up.</div>`);
  }

async function delete_item({ form, res, send, workspace, pathname }) {
    const meta = loadWorkspaces()[workspace];
    if (meta.kind !== 'files') return send('<div class="msg error">Not an editable workspace.</div>', 400);
    if (form.confirm !== 'yes') return send('<div class="msg error">Deleting requires confirmation.</div>', 400);
    // `names` deletes every format of one document or recording, which is what a grouped
    // row offers; `name` stays for a single markdown item or skill.
    const targets = String(form.names || form.name || '').split(',').map((n) => n.trim()).filter(Boolean);
    if (!targets.length) return send('<div class="msg error">Nothing named to delete.</div>', 400);
    for (const t of targets) {
      if (!/^[a-zA-Z0-9_.-]+$/.test(t) || t.includes('..')) return send('<div class="msg error">Invalid name.</div>', 400);
    }
    // Which folder the row was in. A name is still a plain name — the subfolder is separate and
    // resolved by the same check the listing uses (segments, then realpath), so a delete can reach
    // into a folder you are browsing and nowhere else.
    const where = filesBrowser.safeSub(workspace, form.dir || '');
    if (!where.ok) return send('<div class="msg error">No such folder.</div>', 400);
    const base = where.abs;
    const inSub = !!where.rel;
    const removed = [];
    for (const name of targets) {
      // Match on what the workspace actually lists. This used to test /\.(pdf|html)$/
      // only, so once docs listed Office files and videos listed recordings, deleting
      // either fell through to the markdown branch, looked for "<name>.mp4.md", found
      // nothing and reported "(nothing found)" while leaving the file in place.
      if (inSub || DOC_ARTIFACT_RE.test(name) || VIDEO_RE.test(name)) {
        // Inside a folder every row is a file, whatever its extension: the browsable workspaces list
        // what is there rather than a curated set, so the delete has to cover the same ground or a
        // row offers a button that reports "(nothing found)".
        const f = path.join(base, name);
        if (fs.existsSync(f) && fs.statSync(f).isFile()) { fs.unlinkSync(f); removed.push(where.rel ? `${where.rel}/${name}` : name); }
      } else if (workspace === 'ai-skills') {
        const d = path.join(meta.dir, name);
        if (fs.existsSync(path.join(d, 'SKILL.md'))) { fs.rmSync(d, { recursive: true }); removed.push(name); }
      } else {
        const f = itemFile(workspace, name);
        if (fs.existsSync(f)) { fs.unlinkSync(f); removed.push(`${name}.md`); }
      }
    }
    res.setHeader('HX-Trigger', 'refresh-projects');
    return send(`<div class="msg assistant">🗑️ Deleted: ${esc(removed.join(', ') || '(nothing found)')}</div>`);
  }

async function propose_item({ form, res, send, workspace, pathname }) {
    const meta = loadWorkspaces()[workspace];
    if (!AI_ITEMS_REPO_PATHS[workspace] || meta.kind !== 'files') return send('<div class="msg error">Proposing is for agents, skills, and prompts.</div>', 400);
    const name = String(form.name || '');
    if (!ITEM_NAME_RE.test(name)) return send('<div class="msg error">Invalid name.</div>', 400);
    const summary = String(form.summary || '').slice(0, 2000).trim();
    const confirmed = String(form.confirm || '') === 'yes';
    if (confirmed && !summary) return send('<div class="msg error">Say what it is for — it goes into the issue and the PR.</div>', 400);
    const script = 'cmd-tools-ai-items.sh';
    if (!fs.existsSync(path.join(meta.dir, script))) {
      return send('<div class="msg error">This workspace has no cmd-tools-ai-items.sh.</div>', 400);
    }
    const args = [script, name, '--propose', '--summary', summary || '(no summary given)'];
    if (confirmed) args.push('--confirm');
    return screenAction(send, { workspace, project: name, projectDir: meta.dir,
      verb: confirmed ? 'propose' : 'propose-dry-run',
      cmdLine: `bash ${args.map((a) => JSON.stringify(a)).join(' ')}`,
      label: confirmed ? `propose ${name} upstream` : `what proposing ${name} would do` });
  }

async function clone_item({ form, res, send, workspace, pathname }) {
    const meta = loadWorkspaces()[workspace];
    if (!INSTALL_TARGETS[workspace] || meta.kind !== 'files') return send('<div class="msg error">Cloning is for agents, skills, and prompts.</div>', 400);
    const name = String(form.name || '');
    const cloneTo = String(form.cloneTo || '');
    const purpose = String(form.purpose || '').slice(0, 2000).trim();
    if (!NAME_RE.test(name) || !NAME_RE.test(cloneTo)) return send('<div class="msg error">Invalid name.</div>', 400);
    if (name === cloneTo) return send('<div class="msg error">Give the copy a different name.</div>', 400);

    // The CLI owns the copy, the identity rewrite and the AI pass, so the button
    // and `bash cmd-tools-ai-items.sh` cannot drift apart. A purpose means a
    // claude run, which is slow — hence a job with the AI timeout, not an
    // inline response.
    const args = [`${name}`, '--clone-to', cloneTo];
    if (purpose) args.push('--purpose', purpose);
    const shellLine = `bash cmd-tools-ai-items.sh ${args.map((a) => JSON.stringify(a)).join(' ')}`;
    res.setHeader('HX-Trigger', 'refresh-projects');
    return screenAction(send, { workspace, project: cloneTo, projectDir: meta.dir, verb: 'clone',
      cmdLine: shellLine, label: `clone ${name} to ${cloneTo}` });
  }

async function generate_item({ form, res, send, workspace, pathname }) {
    const target = INSTALL_TARGETS[workspace];
    const meta = loadWorkspaces()[workspace];
    if (!target || meta.kind !== 'files') return send('<div class="msg error">AI generation is for agents, skills, and prompts.</div>', 400);
    const name = String(form.name || '');
    const description = String(form.description || '').slice(0, 2000);
    if (!ITEM_NAME_RE.test(name)) return send('<div class="msg error">Invalid name.</div>', 400);
    if (!description.trim()) return send('<div class="msg error">Describe what it should do.</div>', 400);

    const SPECS = {
      agents: `a Claude Code CLI subagent definition markdown file. It MUST start with YAML frontmatter delimited by --- lines containing: name: ${name}, a one-paragraph description: telling Claude when to invoke this agent (starting "Use this agent to"), and a tools: list (only the tools it truly needs from Bash, Read, Write, Edit, Glob, Grep, WebFetch). After the frontmatter: a # ${name} heading, a role statement, and concrete ## Instructions the agent follows. Study ${ROOT} with your tools first if the description references this workspace.`,
      skills: `a Claude Code CLI skill (SKILL.md) markdown file. It MUST start with YAML frontmatter delimited by --- lines containing: name: ${name} and a one-line description: saying what the skill does and when to use it. After the frontmatter: a # ${name} heading and precise step-by-step ## Instructions. Study ${ROOT} with your tools first if the description references this workspace.`,
      prompts: `a reusable prompt file kept in this workspace's prompts folder (nothing installs into ~/.claude). Plain markdown, no frontmatter: just the complete, well-structured prompt text a user would paste or run repeatedly. Make it specific and actionable.`,
    };
    const file = itemFile(workspace, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const genPrompt = `Write ${SPECS[workspace]}\n\nWhat it should do: ${description}\n\nOutput ONLY the raw file content — no surrounding commentary, no code fences.`;
    const shellLine = `set -e; echo "Generating ${meta.noun} '${name}' with AI…"; claude -p ${JSON.stringify(genPrompt)} --allowedTools Read Glob Grep --disallowedTools Write Edit Bash --no-session-persistence > ${JSON.stringify(file)}; echo "Written: ${path.relative(ROOT, file)}"; head -20 ${JSON.stringify(file)}`;
    return screenAction(send, { workspace, project: name, projectDir: meta.dir, verb: 'generate',
      cmdLine: shellLine, label: `generate the ${meta.noun} ${name}` });
  }

module.exports = {
  '/actions/save-item': save_item,
  '/actions/sync-items': sync_items,
  '/actions/fetch-item': fetch_item,
  '/actions/pull-item': fetch_item,
  '/actions/add-item': add_item,
  '/actions/update-one-item': update_one_item,
  '/actions/install-item': install_item,
  '/actions/delete-item': delete_item,
  '/actions/propose-item': propose_item,
  '/actions/clone-item': clone_item,
  '/actions/generate-item': generate_item,
};
