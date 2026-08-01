/**
 * The file workspaces: saving, cloning, installing and deleting an item, and the things made FROM one.
 *
 * One module per area of the dashboard, each exporting the handlers it owns keyed by the path
 * that reaches them. server.js merges the maps and dispatches; nothing here knows about routing,
 * and adding an action is adding an entry rather than another branch in a 650-line function.
 *
 * Every handler takes the same context: the parsed form, the response, a `send` that writes an
 * HTML fragment, and the workspace the request named.
 */

const fs = require('fs');
const path = require('path');

const { ROOT, findSyncScript, isValidWorkspace, loadWorkspaces, workspaceDir } = require('../workspaces');
const { esc } = require('../html');
const { jobFragment, run, startJob } = require('../jobs');
const { INSTALL_TARGETS, NAME_RE, itemFile } = require('../views');
const handlers = {
  '/actions/save-item': async ({ form, res, send, workspace, req }) => {
    const meta = loadWorkspaces()[workspace];
    if (meta.kind !== 'files') return send('<div class="msg error">Not an editable workspace.</div>', 400);
    const name = String(form.name || '');
    if (!NAME_RE.test(name)) return send('<div class="msg error">Invalid name (letters, numbers, _ and - only).</div>', 400);
    const content = String(form.content || '').replace(/\r\n/g, '\n');
    if (content.length > 500000) return send('<div class="msg error">Content too large.</div>', 400);
    const file = itemFile(workspace, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    res.setHeader('HX-Trigger', 'refresh-projects');
    return send(`<div class="msg assistant">✅ Saved <strong>${esc(name)}</strong> (${esc(path.relative(ROOT, file))}).</div>`);
  },
  '/actions/clone-item': async ({ form, res, send, workspace, req }) => {
    const meta = loadWorkspaces()[workspace];
    if (!meta || meta.kind !== 'files') return send('<div class="msg error">Not an editable workspace.</div>', 400);
    const name = String(form.name || '');
    if (!NAME_RE.test(name)) return send('<div class="msg error">Invalid name.</div>', 400);
    const src = itemFile(workspace, name);
    if (!fs.existsSync(src)) return send('<div class="msg error">That item is gone.</div>', 404);
    // -copy, -copy-2, -copy-3: cloning twice should not need a name invented up front, and must
    // never overwrite the clone made a minute ago.
    let target = `${name}-copy`;
    for (let n = 2; fs.existsSync(itemFile(workspace, target)); n += 1) target = `${name}-copy-${n}`;
    try {
      const dest = itemFile(workspace, target);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
    } catch (err) {
      return send(`<div class="msg error">Could not clone it: ${esc(err.message)}</div>`, 500);
    }
    res.setHeader('HX-Trigger', 'refresh-projects');
    return send(`<div class="msg assistant">📄 Cloned to <strong>${esc(target)}</strong> — open it to adapt.</div>`);
  },
  '/actions/install-item': async ({ form, res, send, workspace, req }) => {
    const meta = loadWorkspaces()[workspace];
    const target = INSTALL_TARGETS[workspace];
    if (!target || meta.kind !== 'files') return send('<div class="msg error">This workspace has no install target.</div>', 400);
    const name = String(form.name || '');
    if (!NAME_RE.test(name)) return send('<div class="msg error">Invalid name.</div>', 400);
    const src = itemFile(workspace, name);
    if (!fs.existsSync(src)) return send('<div class="msg error">Item not found.</div>', 404);
    fs.mkdirSync(target, { recursive: true });
    let dest;
    if (workspace === 'skills') {
      dest = path.join(target, name, 'SKILL.md');
      fs.mkdirSync(path.dirname(dest), { recursive: true });
    } else {
      dest = path.join(target, `${name}.md`);
    }
    fs.copyFileSync(src, dest);
    const usage = workspace === 'prompts' ? ` — available in Claude Code as <code>/${esc(name)}</code>` : '';
    return send(`<div class="msg assistant">✅ Installed <strong>${esc(name)}</strong> to <code>${esc(dest.replace(process.env.HOME, '~'))}</code>${usage}. Restart Claude Code sessions to pick it up.</div>`);
  },
  '/actions/delete-item': async ({ form, res, send, workspace, req }) => {
    const meta = loadWorkspaces()[workspace];
    if (meta.kind !== 'files') return send('<div class="msg error">Not an editable workspace.</div>', 400);
    if (form.confirm !== 'yes') return send('<div class="msg error">Deleting requires confirmation.</div>', 400);
    const name = String(form.name || '');
    if (!/^[a-zA-Z0-9_.-]+$/.test(name) || name.includes('..')) return send('<div class="msg error">Invalid name.</div>', 400);
    const removed = [];
    if (/\.(pdf|html)$/.test(name)) {
      const f = path.join(meta.dir, name);
      if (fs.existsSync(f)) { fs.unlinkSync(f); removed.push(name); }
    } else if (workspace === 'skills') {
      const d = path.join(meta.dir, name);
      if (fs.existsSync(path.join(d, 'SKILL.md'))) { fs.rmSync(d, { recursive: true }); removed.push(name); }
    } else {
      const f = itemFile(workspace, name);
      if (fs.existsSync(f)) { fs.unlinkSync(f); removed.push(`${name}.md`); }
    }
    res.setHeader('HX-Trigger', 'refresh-projects');
    return send(`<div class="msg assistant">🗑️ Deleted: ${esc(removed.join(', ') || '(nothing found)')}</div>`);
  },
  '/actions/generate-item': async ({ form, res, send, workspace, req }) => {
    const target = INSTALL_TARGETS[workspace];
    const meta = loadWorkspaces()[workspace];
    if (!target || meta.kind !== 'files') return send('<div class="msg error">AI generation is for agents, skills, and prompts.</div>', 400);
    const name = String(form.name || '');
    const description = String(form.description || '').slice(0, 2000);
    if (!NAME_RE.test(name)) return send('<div class="msg error">Invalid name.</div>', 400);
    if (!description.trim()) return send('<div class="msg error">Describe what it should do.</div>', 400);

    const SPECS = {
      agents: `a Claude Code CLI subagent definition markdown file. It MUST start with YAML frontmatter delimited by --- lines containing: name: ${name}, a one-paragraph description: telling Claude when to invoke this agent (starting "Use this agent to"), and a tools: list (only the tools it truly needs from Bash, Read, Write, Edit, Glob, Grep, WebFetch). After the frontmatter: a # ${name} heading, a role statement, and concrete ## Instructions the agent follows. Study ${ROOT} with your tools first if the description references this workspace.`,
      skills: `a Claude Code CLI skill (SKILL.md) markdown file. It MUST start with YAML frontmatter delimited by --- lines containing: name: ${name} and a one-line description: saying what the skill does and when to use it. After the frontmatter: a # ${name} heading and precise step-by-step ## Instructions. Study ${ROOT} with your tools first if the description references this workspace.`,
      prompts: `a reusable prompt file for a Claude Code CLI slash command (/${name}). Plain markdown, no frontmatter: just the complete, well-structured prompt text a user would run repeatedly. Make it specific and actionable.`,
    };
    const file = itemFile(workspace, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const genPrompt = `Write ${SPECS[workspace]}\n\nWhat it should do: ${description}\n\nOutput ONLY the raw file content — no surrounding commentary, no code fences.`;
    const shellLine = `set -e; echo "Generating ${meta.noun} '${name}' with AI…"; claude -p ${JSON.stringify(genPrompt)} --allowedTools Read Glob Grep --disallowedTools Write Edit Bash --no-session-persistence > ${JSON.stringify(file)}; echo "Written: ${path.relative(ROOT, file)}"; head -20 ${JSON.stringify(file)}`;
    const id = startJob(`🤖 Generate ${esc(meta.noun)} <strong>${esc(name)}</strong>`, 'bash', ['-c', shellLine], meta.dir, { timeoutMs: 5 * 60 * 1000 });
    return send(jobFragment(id).html);
  },
  '/actions/make-html': async ({ form, res, send, workspace, req }) => {
    if (workspace !== 'docs') return send('<div class="msg error">HTML is generated in the docs workspace.</div>', 400);
    const name = String(form.name || '');
    if (!NAME_RE.test(name)) return send('<div class="msg error">Invalid name.</div>', 400);
    const meta = loadWorkspaces()[workspace];
    if (!fs.existsSync(itemFile('docs', name))) return send('<div class="msg error">Doc not found.</div>', 404);
    const id = startJob(`🌐 Render <strong>${esc(name)}.html</strong>`, 'bash',
      ['-c', `set -e; cd '${meta.dir}'; pandoc '${name}.md' -o '${name}.html' --standalone --metadata title='${name}' && echo "HTML written: ${name}.html"`],
      meta.dir, { timeoutMs: 2 * 60 * 1000 });
    return send(jobFragment(id).html);
  },
  '/actions/make-pdf': async ({ form, res, send, workspace, req }) => {
    if (workspace !== 'docs') return send('<div class="msg error">PDFs are generated in the docs workspace.</div>', 400);
    const name = String(form.name || '');
    if (!NAME_RE.test(name)) return send('<div class="msg error">Invalid name.</div>', 400);
    const meta = loadWorkspaces()[workspace];
    const md = itemFile('docs', name);
    if (!fs.existsSync(md)) return send('<div class="msg error">Doc not found.</div>', 404);
    const id = startJob(`📄 Render <strong>${esc(name)}.pdf</strong>`, 'bash',
      ['-c', `set -e; cd '${meta.dir}'; pandoc '${name}.md' -o '${name}.pdf' --pdf-engine=wkhtmltopdf --metadata title='${name}' -V margin-top=18mm -V margin-bottom=18mm -V margin-left=16mm -V margin-right=16mm && echo "PDF written: ${name}.pdf"`],
      meta.dir, { timeoutMs: 5 * 60 * 1000 });
    return send(jobFragment(id).html);
  },
  '/actions/screenshot': async ({ form, res, send, workspace, req }) => {
    if (workspace !== 'docs') return send('<div class="msg error">Screenshots are saved in the docs workspace.</div>', 400);
    const name = String(form.name || '');
    const url = String(form.url || '');
    if (!NAME_RE.test(name)) return send('<div class="msg error">Invalid name.</div>', 400);
    if (!/^https?:\/\/[a-zA-Z0-9.:\/_-]+$/.test(url)) return send('<div class="msg error">Invalid URL.</div>', 400);
    const meta = loadWorkspaces()[workspace];
    const id = startJob(`📸 Screenshot <strong>${esc(name)}.png</strong> of ${esc(url)}`, 'bash',
      ['-c', `set -e; cd '${meta.dir}'; wkhtmltoimage --width 1440 --quality 80 ${JSON.stringify(url)} '${name}.png' && echo "Screenshot written: ${name}.png"`],
      meta.dir, { timeoutMs: 3 * 60 * 1000 });
    return send(jobFragment(id).html);
  },
  '/actions/generate-doc': async ({ form, res, send, workspace, req }) => {
    const srcWs = String(form.sourceWorkspace || '');
    const projectName = String(form.projectName || '');
    const docName = String(form.docName || '');
    if (!isValidWorkspace(srcWs)) return send('<div class="msg error">Unknown source workspace.</div>', 400);
    if (!NAME_RE.test(projectName) || !NAME_RE.test(docName)) return send('<div class="msg error">Invalid names.</div>', 400);
    const projectDir = path.join(workspaceDir(srcWs), projectName);
    if (!fs.existsSync(projectDir)) return send('<div class="msg error">Site/project not found.</div>', 404);
    const docsDir = workspaceDir('docs');
    const prompt = `Write comprehensive documentation (Markdown, no code fences around the whole document) about the site/project at ${projectDir}. Inspect the real files (composer.json, .ddev/config.yaml, README, directory layout) with your tools. Cover: what it is, the stack and versions, how to start it with ddev, its URL, notable modules/packages, and folder structure. Start with a # title.`;
    const shellLine = `set -e; echo "Generating documentation for ${projectName}…"; claude -p ${JSON.stringify(prompt)} --allowedTools Read Glob Grep Bash --disallowedTools Write Edit --no-session-persistence > '${docsDir}/${docName}.md'; echo "Markdown written: ${docName}.md"; cd '${docsDir}'; pandoc '${docName}.md' -o '${docName}.pdf' --pdf-engine=wkhtmltopdf --metadata title='${docName}' -V margin-top=18mm -V margin-bottom=18mm -V margin-left=16mm -V margin-right=16mm; echo "PDF written: ${docName}.pdf"`;
    const id = startJob(`🤖 Generate site doc <strong>${esc(docName)}</strong> from ${esc(srcWs)}/${esc(projectName)}`, 'bash', ['-c', shellLine], docsDir);
    return send(jobFragment(id).html);
  },
  '/actions/sync-items': async ({ form, res, send, workspace, req }) => {
    const dir = workspaceDir(workspace);
    const script = findSyncScript(dir);
    if (!script) return send('<div class="msg error">No sync script in this workspace.</div>', 400);
    // Only the two sources the script understands; reading ~/.claude keeps the
    // script's own name filter, so client and third-party items stay out.
    const source = form.source === 'claude' ? 'claude' : 'repo';
    const label = source === 'claude' ? '~/.claude' : 'webship/ai-agents';
    const id = startJob(`🔄 Sync <strong>${esc(workspace)}</strong> from ${esc(label)}`,
      'bash', [script, '--source', source], dir);
    return send(jobFragment(id).html);
  },
};

module.exports = handlers;
