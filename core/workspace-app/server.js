/*
 * workspace dashboard — basic Node.js (node:http, no framework) + HTMX.
 * All interactivity is server-rendered HTML fragments swapped in by HTMX;
 * the only client scripts are the vendored htmx.min.js and a tiny ui.js.
 */
const http = require('http');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const querystring = require('querystring');
const {
  ROOT,
  CONFIG_DIR,
  hubDomain,
  loadWorkspaces,
  loadYaml,
  invalidateWorkspaces,
  isValidWorkspace,
  workspaceDir,
  findBackupScript,
  findSyncScript,
  findRemoveScript,
  findBuilderScripts,
  builderLabel,
  listProjects,
  listBackups,
  ddevProjectName,
} = require('./workspaces');
const {
  SETTINGS_FILE_RE,
  fieldConfig,
  readListBlock,
  writeListBlock,
  listEditorHtml,
  readSettingsRows,
  writeSettingsValues,
  settingsFormHtml,
  listSettingsFiles,
  workspacePresentationHtml,
  writeWorkspacePresentation,
} = require('./settings');

const PUBLIC_DIR = path.join(__dirname, 'public');

// Default navigation scheme: workspace subdomains under the hub domain
// (workspace.ddev.site locally; hub_domain in settings.yml for a public
// remote-hub deployment).

const { esc } = require('./html');
const { readListState, setListCookies } = require('./lists');
const { DDEV_ACTIONS } = require('./ddev');
const { graphStoreDir, GRAPH_FILES } = require('./graphs');
const { milvusPost, ragInstanceFor, ragCollectionName, ragCollections } = require('./rag');
const { iconHtml, tablerIcons } = require('./icons');
const { run, jobs, runningJobKey, startJob, jobFragment } = require('./jobs');
const { assistantReply } = require('./assistant');
const {
  INSTALL_TARGETS, VIDEO_RE, REVIEWABLE_RE, humanSize, ITEM_TEMPLATES, NAME_RE, SCRIPT_RE,
  itemFile, listItems, testingStackOf, projectTestRuns, testRunHtml,
  itemRowsHtml, editorFormHtml, settingsPage, pageShell, homePage, workspaceCardsHtml,
  ddevStatusMap, projectRowsHtml, parseBuilderArgs, builderArgsHtml, backupRowsHtml,
  backupsPage, workspacePage, resultFragment, HOME_URL, wsUrl,
} = require('./views');



/* ---------------- file-item workspaces (agents, skills, prompts, docs) --- */






/* ---------------- test runs and their evidence ------------------------- */






/* ---------------- shared page chrome ---------------- */

/* ---------------- settings editor -------------------------------------- */




// The assistant's logo mark: a large + small four-point sparkle (inline SVG,
// inherits currentColor) — used in the panel header and the floating launcher.

// The AI assistant panel — included on EVERY page. `floating` renders it as
// the bottom-right widget with a launcher button; inline renders it in flow.


/* ---------------- pages ---------------- */




// Backup archives for a workspace: ${backups}/<workspace>/*.tar.gz created by
// the cmd-tool*-backup-*.sh scripts, newest first.








/* ---------------- HTMX fragments/actions ---------------- */


// Append-only audit trail of every action the dashboard executes — request
// logs don't survive container restarts, so destructive operations (remove,
// build) must be attributable after the fact from this file.
const AUDIT_LOG = path.join(__dirname, 'actions.log');
function audit(pathname, form, result) {
  const line = JSON.stringify({
    time: new Date().toISOString(),
    action: pathname,
    workspace: form.workspace,
    projectName: form.projectName,
    script: form.script,
    file: form.file,
    ok: result === undefined ? undefined : !!result,
  });
  try { fs.appendFileSync(AUDIT_LOG, line + '\n'); } catch (_) { /* never block the action */ }
}

async function handleAction(pathname, form, res) {
  const send = (html, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  };
  if (pathname !== '/actions/status' && pathname !== '/actions/chat') audit(pathname, form);

  const workspace = form.workspace || 'dev';
  // save-settings edits core/config, so it carries no workspace to validate.
  if (pathname !== '/actions/chat' && pathname !== '/actions/status' && pathname !== '/actions/save-settings'
      && !isValidWorkspace(workspace)) {
    return send('<div class="msg error">Unknown workspace.</div>', 400);
  }

  if (pathname === '/actions/build' || pathname === '/actions/quick-build') {
    const dir = workspaceDir(workspace);
    const script = String(form.script || '');
    const projectName = String(form.projectName || '');
    if (!SCRIPT_RE.test(script) || !findBuilderScripts(dir).includes(script)) return send('<div class="msg error">Unknown build script.</div>', 400);
    if (!NAME_RE.test(projectName)) return send('<div class="msg error">Invalid project name.</div>', 400);
    // Structured Arguments UI fields (argb: checkboxes, argv: value inputs)
    // take precedence; fall back to the legacy free-text `flags` (kept for
    // the API and the AI assistant).
    const schema = parseBuilderArgs(dir, script);
    const schemaFlags = new Map(schema.map((a) => [a.flag, a]));
    let flags = [];
    let usedStructured = false;
    for (const [k, v] of Object.entries(form)) {
      if (k.startsWith('argb:')) {
        usedStructured = true;
        const flag = k.slice(5);
        if (schemaFlags.has(flag)) flags.push(flag);
      } else if (k.startsWith('argv:')) {
        usedStructured = true;
        const flag = k.slice(5);
        const meta = schemaFlags.get(flag);
        const val = String(v).trim();
        if (meta && val && val !== String(meta.def)) flags.push(`${flag}=${val}`);
      }
    }
    if (!usedStructured) {
      flags = String(form.flags || '--install').trim().split(/\s+/).filter((f) => /^--[a-zA-Z0-9=_.,:@^~\/-]*$/.test(f));
    }
    // Full distribution builds (composer create-project + install) can far
    // exceed the default 15m on a cold composer cache.
    // Echo the exact final command as the first terminal line.
    const finalCmd = `bash ${script} ${projectName}${flags.length ? ' ' + flags.join(' ') : ''}`;
    const id = startJob(`🏗️ Build <strong>${esc(projectName)}</strong> (${esc(builderLabel(dir, script))})`, 'bash', [script, projectName, ...flags], dir, { timeoutMs: 60 * 60 * 1000, echoLine: finalCmd });
    return send(jobFragment(id).html);
  }

  if (pathname === '/actions/testing-configure' || pathname === '/actions/testing-run') {
    const dir = workspaceDir(workspace);
    const projectName = String(form.projectName || '');
    const script = 'cmd-tools-testing.sh';
    const isRun = pathname.endsWith('-run');
    if (!fs.existsSync(path.join(dir, script))) return send('<div class="msg error">No testing script in this workspace.</div>', 400);
    if (!NAME_RE.test(projectName) || !listProjects(dir).includes(projectName)) {
      return send('<div class="msg error">Unknown project.</div>', 400);
    }
    // Running a suite before the stack exists fails deep inside cucumber; say so here instead.
    if (isRun && testingStackOf(dir, projectName) === 'none') {
      return send('<div class="msg error">No testing stack in this project yet — set the environment up first.</div>', 409);
    }
    const jobKey = `testing:${workspace}/${projectName}`;
    if (runningJobKey(jobKey)) {
      return send('<div class="msg error">A testing job is already running for this project.</div>', 409);
    }
    const args = isRun ? [script, projectName, '--run'] : [script, projectName];
    // A suite is minutes, not seconds: the default job timeout would kill a real run.
    const id = startJob(`${isRun ? '🧪 Run tests' : '🧰 Set up testing'} <strong>${esc(projectName)}</strong>`,
      'bash', args, dir,
      { timeoutMs: 90 * 60 * 1000, echoLine: `bash ${args.join(' ')}`, key: jobKey });
    return send(jobFragment(id).html);
  }

  if (pathname === '/actions/backup') {
    const dir = workspaceDir(workspace);
    const script = findBackupScript(dir);
    if (!script) return send('<div class="msg error">No backup script in this workspace.</div>', 400);
    if (!NAME_RE.test(String(form.projectName || ''))) return send('<div class="msg error">Invalid project name.</div>', 400);
    const id = startJob(`💾 Backup <strong>${esc(form.projectName)}</strong>`, 'bash', [script, form.projectName], dir);
    return send(jobFragment(id).html);
  }

  if (pathname === '/actions/list-order') {
    const file = String(form.file || '');
    const key = String(form.key || '');
    if (!SETTINGS_FILE_RE.test(file)) return send('<div class="msg error">Not a settings file.</div>', 400);
    if (!/^[a-z][a-z0-9_]*$/.test(key)) return send('<div class="msg error">Not a list name.</div>', 400);
    const block = readListBlock(file, key);
    if (!block) return send(`<div class="msg error">${esc(key)} is not a list in ${esc(file)}.</div>`, 400);
    const wanted = String(form.order || '').split(',').filter(Boolean);
    // The submitted order has to be the same set, or a dropped row would delete a workspace.
    const same = wanted.length === block.items.length && wanted.every((n) => block.items.includes(n));
    if (!same) return send('<div class="msg error">That order does not match the list — reload and try again.</div>', 409);
    // The order the page was rendered from comes back with the drag, so a save on top of someone
    // else's edit is refused rather than silently discarding it.
    const was = String(form.was || '');
    if (was && was !== block.items.join(',')) {
      return send('<div class="msg error">The order changed since this page was loaded — reload and try again.</div>', 409);
    }
    try {
      writeListBlock(file, key, wanted);
    } catch (err) {
      return send(`<div class="msg error">Could not write ${esc(file)}: ${esc(err.message)}</div>`, 500);
    }
    invalidateWorkspaces();
    // The drag happened either on the settings list or on the home cards; each gets its own
    // markup back, so the thing you dragged is the thing that re-renders.
    if (form.view === 'home') {
      return send(workspaceCardsHtml('<div class="msg assistant">✅ Order saved.</div>'));
    }
    return send(listEditorHtml(file, key, '<div class="msg assistant">Order saved.</div>'));
  }

  if (pathname === '/actions/list-move') {
    const file = String(form.file || '');
    const key = String(form.key || '');
    const name = String(form.name || '');
    const dir = form.dir === 'up' ? -1 : 1;
    if (!SETTINGS_FILE_RE.test(file)) return send('<div class="msg error">Not a settings file.</div>', 400);
    if (!/^[a-z][a-z0-9_]*$/.test(key)) return send('<div class="msg error">Not a list name.</div>', 400);
    const block = readListBlock(file, key);
    if (!block) return send(`<div class="msg error">${esc(key)} is not a list in ${esc(file)}.</div>`, 400);
    const items = [...block.items];
    const i = items.indexOf(name);
    if (i === -1) return send('<div class="msg error">That entry is not in the list.</div>', 404);
    const j = i + dir;
    if (j < 0 || j >= items.length) return send(listEditorHtml(file, key));
    [items[i], items[j]] = [items[j], items[i]];
    try {
      writeListBlock(file, key, items);
    } catch (err) {
      return send(`<div class="msg error">Could not write ${esc(file)}: ${esc(err.message)}</div>`, 500);
    }
    // The card order is this list. loadWorkspaces() caches for two seconds, so the next page
    // load re-reads it without anything having to invalidate it here.
    return send(listEditorHtml(file, key, `<div class="msg assistant">Moved <strong>${esc(name)}</strong>.</div>`));
  }

  if (pathname === '/actions/workspace-presentation') {
    const file = String(form.file || '');
    if (!SETTINGS_FILE_RE.test(file) || file === 'settings.yml') {
      return send('<div class="msg error">Not a workspace settings file.</div>', 400);
    }
    const icon = String(form.icon || '').trim();
    // Only an icon this dashboard can actually draw, so a typo cannot leave a card blank.
    if (icon && !(icon.startsWith('tabler:') && tablerIcons().has(icon.slice(7)))) {
      return send('<div class="msg error">That is not an icon in the library.</div>', 400);
    }
    const subtitle = String(form.subtitle || '').trim();
    try {
      writeWorkspacePresentation(file, icon, subtitle);
    } catch (err) {
      return send(`<div class="msg error">Could not write ${esc(file)}: ${esc(err.message)}</div>`, 500);
    }
    // The card order and the card itself both come from these files, so the memo has to go.
    invalidateWorkspaces();
    return send(workspacePresentationHtml(file, '<div class="msg assistant">✅ Card saved.</div>'));
  }

  if (pathname === '/actions/save-settings') {
    // A duplicated field means the form carried more than one `file`. String() would quietly turn
    // ['a','a'] into "a,a"; refuse rather than guess which was meant.
    if (Array.isArray(form.file)) return send('<div class="msg error">Ambiguous request — reload the page and try again.</div>', 400);
    const file = String(form.file || '');
    if (!SETTINGS_FILE_RE.test(file)) return send('<div class="msg error">Not a settings file.</div>', 400);
    const rows = readSettingsRows(file);
    if (!rows) return send('<div class="msg error">Could not read that settings file.</div>', 400);

    const updates = [];
    let keptSecrets = 0;
    for (const r of rows) {
      if (r.list) continue;
      const submittedKey = form[`k_${r.line}`];
      if (submittedKey === undefined) continue;
      // The line must still hold the key the form was built from, or the file changed since it was
      // rendered and this value belongs somewhere else now.
      if (submittedKey !== r.key) {
        return send('<div class="msg error">That file changed since this form was opened — reload and try again.</div>', 409);
      }
      const raw = form[`v_${r.line}`];
      const value = String((Array.isArray(raw) ? raw[raw.length - 1] : raw) ?? '');
      if (form[`secret_${r.line}`] === '1' && value === '') { keptSecrets += 1; continue; }
      if (value === r.value) continue;
      updates.push({
        line: r.line, key: r.key, value,
        // The row already held a boolean and so does the new value: write it unquoted so it stays
        // a YAML boolean. Quoting makes `active: "true"` — a string the shell reader never matches.
        bool: /^(true|false)$/i.test(String(r.value).trim()) && /^(true|false)$/i.test(value),
      });
    }

    if (!updates.length) {
      return send(`<div class="msg assistant">Nothing to change.${keptSecrets ? ` ${keptSecrets} secret(s) left as they are.` : ''}</div>`);
    }
    let changed = 0;
    try {
      changed = writeSettingsValues(file, updates);
    } catch (err) {
      return send(`<div class="msg error">Could not write ${esc(file)}: ${esc(err.message)}</div>`, 500);
    }
    return send(`<div class="msg assistant">✅ Saved <strong>${esc(file)}</strong> — ${changed} value(s) changed.${keptSecrets ? ` ${keptSecrets} secret(s) left as they are.` : ''}</div>`);
  }

  if (pathname === '/actions/sync-items') {
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
  }

  if (pathname === '/actions/remove') {
    const dir = workspaceDir(workspace);
    const script = findRemoveScript(dir);
    if (!script) return send('<div class="msg error">No remove script in this workspace.</div>', 400);
    if (form.confirm !== 'yes') return send('<div class="msg error">Destructive action requires confirmation.</div>', 400);
    if (!NAME_RE.test(String(form.projectName || ''))) return send('<div class="msg error">Invalid project name.</div>', 400);
    const id = startJob(`🗑️ Remove <strong>${esc(form.projectName)}</strong>`, 'bash', [script, form.projectName], dir);
    return send(jobFragment(id).html);
  }

  if (pathname === '/actions/restore') {
    const meta = loadWorkspaces()[workspace];
    const file = String(form.file || '');
    if (form.confirm !== 'yes') return send('<div class="msg error">Restore requires confirmation.</div>', 400);
    // Backup filenames come from the backup scripts: <ws>---<project>--<stamp>.tar.gz
    const m = file.match(/^([a-z]+)---([a-zA-Z0-9_.-]+)--([0-9_-]+)\.tar\.gz$/);
    if (!m) return send('<div class="msg error">Unrecognized backup filename.</div>', 400);
    const projectName = m[2];
    // `.` and `..` would name the workspace directory itself as the restore target.
    if (/^\.+$/.test(projectName)) return send('<div class="msg error">Unrecognized backup filename.</div>', 400);
    const archive = path.join(meta.backupsDir, file);
    if (!fs.existsSync(archive)) return send('<div class="msg error">Backup file not found.</div>', 404);
    const targetDir = path.join(meta.dir, projectName);
    if (fs.existsSync(targetDir)) {
      return send(`<div class="msg error">'${esc(projectName)}' already exists in this workspace — remove it first, then restore.</div>`, 409);
    }

    // The archives were created from inside the workspace folder, so they
    // extract back to <workspace>/<project>/. Then, if a matching DB dump
    // sits next to the archive, bring the project up and import it — all as
    // one streaming job. (file/projectName are regex-validated above, so
    // embedding them in the shell line is safe.)
    const dbCandidates = [`${file.replace(/\.tar\.gz$/, '')}-db.sql.gz`, `${file.replace(/\.tar\.gz$/, '')}-db.sql`];
    const dbFile = dbCandidates.map((f) => path.join(meta.backupsDir, f)).find((f) => fs.existsSync(f));
    let shellLine = `set -e; echo "Extracting ${file}…"; tar -xzf '${archive}'`;
    if (dbFile) {
      shellLine += ` && if [ -f '${targetDir}/.ddev/config.yaml' ]; then cd '${targetDir}' && ddev start -y && echo "Importing database…" && ddev import-db --file='${dbFile}'; else echo "Not a DDEV project — import the DB dump manually: ${path.basename(dbFile)}"; fi`;
    }
    const id = startJob(`♻️ Restore <strong>${esc(projectName)}</strong> from <code>${esc(file)}</code>`, 'bash', ['-c', shellLine], meta.dir);
    return send(jobFragment(id).html);
  }

  if (pathname === '/actions/backup-delete') {
    const meta = loadWorkspaces()[workspace];
    const file = String(form.file || '');
    if (form.confirm !== 'yes') return send('<div class="msg error">Deleting a backup requires confirmation.</div>', 400);
    // Two shapes live in a backups folder: a project archive from the backup scripts, and a
    // standalone dump from a row's "Export the database". Both are deletable here — a file the
    // dashboard writes has to be a file the dashboard can remove.
    const isArchive = /^[a-z]+---[a-zA-Z0-9_.-]+--[0-9_-]+\.tar\.gz$/.test(file) && !file.includes('/');
    const isDump = /^[a-zA-Z0-9_-]+--db--[0-9-]+\.sql\.gz$/.test(file);
    if (!isArchive && !isDump) return send('<div class="msg error">Unrecognized backup filename.</div>', 400);
    const archive = path.join(meta.backupsDir, file);
    if (!fs.existsSync(archive)) return send('<div class="msg error">Backup file not found.</div>', 404);
    const removed = [];
    // An archive carries a companion dump beside it; a standalone dump is only itself.
    for (const f of isDump ? [archive] : [archive,
      path.join(meta.backupsDir, file.replace(/\.tar\.gz$/, '-db.sql.gz')),
      path.join(meta.backupsDir, file.replace(/\.tar\.gz$/, '-db.sql'))]) {
      if (fs.existsSync(f)) { fs.unlinkSync(f); removed.push(path.basename(f)); }
    }
    res.setHeader('HX-Trigger', 'refresh-projects');
    return send(`<div class="msg assistant"><p>🗑️ Deleted backup:</p><pre>${esc(removed.join('\n'))}</pre></div>`);
  }

  if (pathname === '/actions/save-item') {
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
  }

  if (pathname === '/actions/clone-item') {
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
  }

  if (pathname === '/actions/install-item') {
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
  }

  if (pathname === '/actions/delete-item') {
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
  }

  if (pathname === '/actions/generate-item') {
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
  }

  if (pathname === '/actions/make-html') {
    if (workspace !== 'docs') return send('<div class="msg error">HTML is generated in the docs workspace.</div>', 400);
    const name = String(form.name || '');
    if (!NAME_RE.test(name)) return send('<div class="msg error">Invalid name.</div>', 400);
    const meta = loadWorkspaces()[workspace];
    if (!fs.existsSync(itemFile('docs', name))) return send('<div class="msg error">Doc not found.</div>', 404);
    const id = startJob(`🌐 Render <strong>${esc(name)}.html</strong>`, 'bash',
      ['-c', `set -e; cd '${meta.dir}'; pandoc '${name}.md' -o '${name}.html' --standalone --metadata title='${name}' && echo "HTML written: ${name}.html"`],
      meta.dir, { timeoutMs: 2 * 60 * 1000 });
    return send(jobFragment(id).html);
  }

  if (pathname === '/actions/screenshot') {
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
  }

  if (pathname === '/actions/make-pdf') {
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
  }

  if (pathname === '/actions/generate-doc') {
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
  }

  if (pathname === '/actions/ddev-start' || pathname === '/actions/ddev-stop') {
    const projectName = String(form.projectName || '');
    if (!NAME_RE.test(projectName)) return send('<div class="msg error">Invalid project name.</div>', 400);
    const projectDir = path.join(workspaceDir(workspace), projectName);
    if (!ddevProjectName(projectDir)) return send('<div class="msg error">Not a DDEV project.</div>', 400);
    const verb = pathname === '/actions/ddev-start' ? 'start' : 'stop';
    // `ddev start` accepts -y (skip confirmation); `ddev stop` has no such flag.
    const args = verb === 'start' ? ['start', '-y'] : ['stop'];
    const id = startJob(`${verb === 'start' ? '▶️' : '⏹️'} <code>ddev ${verb}</code> on <strong>${esc(projectName)}</strong>`, 'ddev', args, projectDir, { timeoutMs: 5 * 60 * 1000 });
    return send(jobFragment(id).html);
  }

  // The rest of the DDEV verbs, from a row's DDEV dropdown. Every one is per-project and runs
  // `ddev` in the project directory, exactly like Start and Stop — so the workspace's rule holds
  // throughout: no host composer, drush or mysql, ever.
  if (DDEV_ACTIONS[pathname]) {
    const act = DDEV_ACTIONS[pathname];
    const projectName = String(form.projectName || '');
    if (!NAME_RE.test(projectName)) return send('<div class="msg error">Invalid project name.</div>', 400);
    const projectDir = path.join(workspaceDir(workspace), projectName);
    if (!ddevProjectName(projectDir)) return send('<div class="msg error">Not a DDEV project.</div>', 400);
    let args = act.args;
    if (act.needsRunning) {
      // Asked rather than assumed: `ddev drush` on a stopped project prints a docker error that
      // says nothing about the actual problem, which is that the site is not up.
      const statuses = await ddevStatusMap();
      if (statuses[ddevProjectName(projectDir)]?.status !== 'running') {
        return send(`<div class="msg error">${esc(projectName)} is not running — start it first.</div>`, 400);
      }
    }
    if (act.toBackups) {
      // A dump belongs in the workspace's backups folder, beside the archives — never in the home
      // directory, and never inside the project it came from.
      const outDir = loadWorkspaces()[workspace].backupsDir;
      try { fs.mkdirSync(outDir, { recursive: true }); } catch (_) { /* ddev reports it */ }
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
      args = [...args, '--gzip', '--file', path.join(outDir, `${projectName}--db--${stamp}.sql.gz`)];
    }
    const id = startJob(`${act.icon} <code>${esc(act.label)}</code> on <strong>${esc(projectName)}</strong>`,
      'ddev', args, projectDir, { timeoutMs: act.ms });
    return send(jobFragment(id).html);
  }

  if (pathname === '/actions/ragify') {
    const dir = workspaceDir(workspace);
    const script = 'cmd-tools-ragify.sh';
    const projectName = String(form.projectName || '');
    if (!fs.existsSync(path.join(dir, script))) return send('<div class="msg error">This workspace has no ragify script.</div>', 400);
    if (!NAME_RE.test(projectName) || !listProjects(dir).includes(projectName)) {
      return send('<div class="msg error">Unknown project.</div>', 400);
    }
    // Two indexers writing one collection interleave their upserts, and the result is a
    // collection that is neither run's.
    const jobKey = `ragify:${workspace}/${projectName}`;
    if (runningJobKey(jobKey)) {
      return send('<div class="msg error">This project is already being indexed.</div>', 409);
    }
    const state = await ragCollections(ragInstanceFor(workspace, projectName));
    if (!state || !state.up) {
      return send(`<div class="msg error">${esc(ragInstanceFor(workspace, projectName))} is not running — start it in the RAG workspace first.</div>`, 409);
    }
    // The default mode is BM25: Milvus builds the sparse vectors itself, so no model, no key, and
    // nothing leaves this machine. Dense embeddings are opt-in from the command line.
    const id = startJob(`📚 Index <strong>${esc(projectName)}</strong>`, 'bash', [script, projectName], dir,
      { timeoutMs: 60 * 60 * 1000, echoLine: `bash ${script} ${projectName}`, key: jobKey });
    return send(jobFragment(id).html);
  }

  if (pathname === '/actions/rag-info') {
    const projectName = String(form.projectName || '');
    if (!NAME_RE.test(projectName)) return send('<div class="msg error">Unknown project.</div>', 400);
    const instance = ragInstanceFor(workspace, projectName);
    const collection = ragCollectionName(workspace, projectName);
    const stats = await milvusPost('/v2/vectordb/collections/describe', { collectionName: collection }, 6000, instance);
    if (!stats || stats.code !== 0) {
      return send(`<div class="msg error">Could not read ${esc(collection)} from ${esc(instance)}.</div>`, 409);
    }
    const count = await milvusPost('/v2/vectordb/entities/query',
      { collectionName: collection, filter: 'id >= 0', outputFields: ['count(*)'], limit: 1 }, 8000, instance);
    const chunks = count && count.code === 0 && count.data && count.data[0] ? count.data[0]['count(*)'] : null;
    const fields = (stats.data.fields || []).map((f) => f.name).join(', ');
    const functions = (stats.data.functions || []).map((f) => `${f.name} (${f.type})`).join(', ');
    return send(`
      <div class="msg assistant">
        <p><strong>${esc(collection)}</strong> on <strong>${esc(instance)}</strong></p>
        <pre>chunks:    ${chunks === null ? 'unknown' : esc(String(chunks))}
fields:    ${esc(fields || '—')}
functions: ${esc(functions || '—')}</pre>
        <p class="uk-text-meta">A function is what builds the sparse vector inside the database — that is
        what BM25 mode means, and why indexing needs no model and no key.</p>
      </div>`);
  }

  if (pathname === '/actions/rag-remove') {
    if (form.confirm !== 'yes') return send('<div class="msg error">Deleting requires confirmation.</div>', 400);
    const projectName = String(form.projectName || '');
    if (!NAME_RE.test(projectName)) return send('<div class="msg error">Unknown project.</div>', 400);
    if (runningJobKey(`ragify:${workspace}/${projectName}`)) {
      return send('<div class="msg error">This project is being indexed — wait for it to finish.</div>', 409);
    }
    const instance = ragInstanceFor(workspace, projectName);
    const collection = ragCollectionName(workspace, projectName);
    // Milvus's drop is idempotent and answers code 0 for a collection that was never there, so
    // without this the dashboard would report having deleted something that did not exist.
    const state = await ragCollections(instance);
    if (!state || !state.up) {
      return send(`<div class="msg error">${esc(instance)} is not running — nothing can be dropped while it is down.</div>`, 409);
    }
    if (!state.list.includes(collection)) {
      return send(`<div class="msg error">No index to delete — ${esc(collection)} is not in ${esc(instance)}.</div>`, 404);
    }
    const out = await milvusPost('/v2/vectordb/collections/drop', { collectionName: collection }, 10000, instance);
    if (!out || out.code !== 0) {
      return send(`<div class="msg error">Could not drop ${esc(collection)}: ${esc((out && out.message) || 'no answer from ' + instance)}</div>`, 409);
    }
    res.setHeader('HX-Trigger', 'refresh-projects');
    return send(`<div class="msg assistant">🗑️ Dropped <strong>${esc(collection)}</strong>. It is regenerable — index the project again whenever you need it.</div>`);
  }

  if (pathname === '/actions/rag-mcp-command') {
    const projectName = String(form.projectName || '');
    if (!NAME_RE.test(projectName)) return send('<div class="msg error">Unknown project.</div>', 400);
    const instance = ragInstanceFor(workspace, projectName);
    const collection = ragCollectionName(workspace, projectName);
    return send(`
      <div class="msg assistant">
        <p>Serve <strong>${esc(collection)}</strong> to the Claude Code CLI:</p>
        <pre>cd ~/workspace/rag &amp;&amp; bash cmd-milvus-mcp.sh ${esc(instance)}</pre>
        <p class="uk-text-meta">Run it <strong>on the host</strong>. It prints the <code>claude mcp add</code> line for this
        instance, including the gRPC port it was published on — the database is reached on 127.0.0.1 from
        outside its own network, so the port is the part worth not guessing.</p>
      </div>`);
  }

  if (pathname === '/actions/graphify') {
    const dir = workspaceDir(workspace);
    const script = 'cmd-tools-graphify.sh';
    const projectName = String(form.projectName || '');
    if (!fs.existsSync(path.join(dir, script))) return send('<div class="msg error">This workspace has no graphify script.</div>', 400);
    if (!NAME_RE.test(projectName) || !listProjects(dir).includes(projectName)) {
      return send('<div class="msg error">Unknown project.</div>', 400);
    }
    // graphify has no cross-process lock: two runs against one output directory race on the
    // manifest and the graph itself, and the loser's atomic replace silently wins.
    const jobKey = `graphify:${workspace}/${projectName}`;
    if (runningJobKey(jobKey)) {
      return send('<div class="msg error">A graph is already being built for this project.</div>', 409);
    }
    // Local parsing only — no API key, nothing leaves the machine. A large codebase takes a
    // while, so it gets the long build timeout rather than the default.
    const id = startJob(`🕸️ Graph <strong>${esc(projectName)}</strong>`, 'bash', [script, projectName], dir,
      { timeoutMs: 60 * 60 * 1000, echoLine: `bash ${script} ${projectName}`, key: jobKey });
    return send(jobFragment(id).html);
  }

  if (pathname === '/actions/graph-remove') {
    if (form.confirm !== 'yes') return send('<div class="msg error">Deleting requires confirmation.</div>', 400);
    const projectName = String(form.projectName || '');
    // The project itself may be long gone — a graph outlives it, and that is exactly a graph
    // worth throwing away. So the name is validated but not looked up.
    if (!NAME_RE.test(projectName)) return send('<div class="msg error">Unknown project.</div>', 400);
    if (runningJobKey(`graphify:${workspace}/${projectName}`)) {
      return send('<div class="msg error">A graph run is in progress for this project — wait for it to finish.</div>', 409);
    }
    const out = graphStoreDir(workspace, projectName);
    let real;
    try {
      real = fs.realpathSync(out);
      const base = fs.realpathSync(path.join(ROOT, 'graphs'));
      // Symlinks are resolved before anything is deleted: a project directory that is a link
      // would otherwise put rm outside the graph store entirely.
      if (!real.startsWith(base + path.sep) || !fs.statSync(real).isDirectory()) throw new Error('outside the store');
    } catch (_) {
      return send('<div class="msg error">No graph to delete.</div>', 404);
    }
    fs.rmSync(real, { recursive: true, force: true });
    res.setHeader('HX-Trigger', 'refresh-projects');
    return send(`<div class="msg assistant">🗑️ Deleted the graph of <strong>${esc(projectName)}</strong>. It is regenerable — build it again whenever you need it.</div>`);
  }

  if (pathname === '/actions/graph-mcp-command') {
    const projectName = String(form.projectName || '');
    if (!NAME_RE.test(projectName)) return send('<div class="msg error">Unknown project.</div>', 400);
    const graph = path.join(graphStoreDir(workspace, projectName), GRAPH_FILES.json);
    if (!fs.existsSync(graph)) return send('<div class="msg error">No graph yet — build it first.</div>', 409);
    const shown = graph.replace(ROOT, '~/workspace');
    return send(`
      <div class="msg assistant">
        <p>Serve the <strong>${esc(workspace)}/${esc(projectName)}</strong> graph to the Claude Code CLI:</p>
        <pre>claude mcp add --scope user graph-${esc(workspace)}-${esc(projectName)} -- graphify-mcp ${esc(shown)}</pre>
        <p class="uk-text-meta">Run it <strong>on the host</strong>, in a terminal. It speaks stdio, so there is no port
        and no daemon — the CLI starts the server when a session needs it. Open a NEW session to see the tools;
        rebuilding the graph needs no re-registration.</p>
      </div>`);
  }

  if (pathname === '/actions/status') {
    const result = await run('ddev', ['list', '--json-output'], ROOT, { timeoutMs: 60 * 1000 });
    let lines = '';
    try {
      const parsed = JSON.parse(result.stdout);
      lines = (parsed.raw || [])
        .map((p) => `${p.status === 'running' ? '🟢' : '⚪'} ${p.name} — ${p.status}${p.status === 'running' ? ` — ${p.primary_url}` : ''}`)
        .join('\n') || 'No DDEV projects registered.';
    } catch (_) {
      lines = (result.stdout + '\n' + result.stderr).replace(/\x1b\[[0-9;]*m/g, '').trim();
    }
    return send(`
      <div class="msg ${result.ok ? 'assistant' : 'error'}">
        <p>💚 <strong>DDEV status:</strong></p>
        <pre>${esc(lines)}</pre>
      </div>`);
  }

  if (pathname === '/actions/chat') {
    const message = String(form.message || '').trim();
    if (!message) return send('<div class="msg error">Empty message.</div>', 400);
    audit(pathname, { workspace: '-', projectName: message.slice(0, 120) });
    const { replyHtml, directive } = await assistantReply(message, String(form.context || ''));

    const triggers = { 'refresh-projects': directive.refresh ? {} : undefined, 'assistant-directive': (directive.navigate || directive.open) ? directive : undefined };
    const activeTriggers = Object.fromEntries(Object.entries(triggers).filter(([, v]) => v !== undefined));
    if (Object.keys(activeTriggers).length) res.setHeader('HX-Trigger', JSON.stringify(activeTriggers));

    return send(`<div class="msg user">${esc(message)}</div><div class="msg assistant">${replyHtml}</div>`);
  }

  send('<div class="msg error">Unknown action.</div>', 404);
}

/* ---------------- static files ---------------- */

const MIME = {
  '.css': 'text/css', '.js': 'application/javascript', '.html': 'text/html',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

function serveStatic(pathname, res) {
  const file = path.join(PUBLIC_DIR, path.normalize(pathname).replace(/^([.][.][/\\])+/, ''));
  if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
  return true;
}

/* ---------------- server ---------------- */

const server = http.createServer(async (req, res) => {
  let { pathname } = new URL(req.url, 'http://localhost');

  // Workspace subdomains: <ws>.workspace.ddev.site serves that workspace's
  // pages — / maps to the workspace page and /backups to its backups page.
  // Absolute paths (/actions, /fragments, /files, assets) work unchanged.
  const hostMatch = String(req.headers.host || '').match(new RegExp(`^([a-z0-9_-]+)\\.${hubDomain().replace(/\./g, '\\.')}(?::\\d+)?$`));
  if (hostMatch && isValidWorkspace(hostMatch[1])) {
    if (pathname === '/') pathname = `/${hostMatch[1]}`;
    else if (pathname === '/backups' || pathname === '/backups/') pathname = `/${hostMatch[1]}/backups`;
  }

  try {
    if (req.method === 'GET') {
      if (pathname === '/' ) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(homePage());
      }
      if (pathname === '/actions/status') return handleAction(pathname, {}, res);
      const jobMatch = pathname.match(/^\/fragments\/job\/([a-z0-9-]+)$/);
      if (jobMatch) {
        const frag = jobFragment(jobMatch[1]);
        // When the job finishes, refresh the project/backup lists so status
        // badges and buttons reflect the new state.
        if (frag.done) res.setHeader('HX-Trigger', 'refresh-projects');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(frag.html);
      }
      const itemsMatch = pathname.match(/^\/fragments\/([a-z0-9_-]+)\/items$/);
      if (itemsMatch && isValidWorkspace(itemsMatch[1])) {
        const itemsState = readListState(req);
        setListCookies(res, itemsState);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(itemRowsHtml(itemsMatch[1], itemsState));
      }
      const newMatch = pathname.match(/^\/fragments\/([a-z0-9_-]+)\/new$/);
      if (newMatch && isValidWorkspace(newMatch[1]) && loadWorkspaces()[newMatch[1]].kind === 'files') {
        const key = newMatch[1];
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(editorFormHtml(key, '', (ITEM_TEMPLATES[key] || ITEM_TEMPLATES.docs)('my-' + loadWorkspaces()[key].noun), true));
      }
      const editMatch = pathname.match(/^\/fragments\/([a-z0-9_-]+)\/edit\/([a-zA-Z0-9_%.-]+)$/);
      if (editMatch && isValidWorkspace(editMatch[1])) {
        const key = editMatch[1];
        const name = decodeURIComponent(editMatch[2]);
        if (!NAME_RE.test(name)) { res.writeHead(400); return res.end('bad name'); }
        const file = itemFile(key, name);
        if (!fs.existsSync(file)) { res.writeHead(404); return res.end('not found'); }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(editorFormHtml(key, name, fs.readFileSync(file, 'utf8'), false));
      }
      const aiFormMatch = pathname.match(/^\/fragments\/(agents|skills|prompts)\/ai-form$/);
      if (aiFormMatch) {
        const key = aiFormMatch[1];
        const meta = loadWorkspaces()[key];
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(`
          <div class="uk-card uk-card-default uk-card-body uk-margin-top editor-card">
            <h3 class="uk-margin-small-bottom">Generate a ${esc(meta.noun)} with AI</h3>
            <form hx-post="/actions/generate-item" hx-target="#webship-workspace-output" hx-swap="innerHTML">
              <input type="hidden" name="workspace" value="${esc(key)}">
              <input class="uk-input uk-margin-small-bottom" name="name" placeholder="${esc(meta.noun)}-name" required pattern="[a-zA-Z0-9_\\-]+">
              <textarea class="uk-textarea" name="description" rows="4" placeholder="Describe what this ${esc(meta.noun)} should do — e.g. 'reviews cmd-*.sh scripts for DDEV-only compliance and reports violations'" required></textarea>
              <div class="uk-margin-small-top">
                <button type="submit" class="uk-button uk-button-primary"><span uk-icon="icon: bolt; ratio: .8"></span> Generate</button>
              </div>
            </form>
          </div>`);
      }
      if (pathname === '/fragments/docs/screenshot-form') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(`
          <div class="uk-card uk-card-default uk-card-body uk-margin-top editor-card">
            <h3 class="uk-margin-small-bottom">Screenshot a site → docs/&lt;name&gt;.png</h3>
            <form class="uk-grid uk-grid-small" uk-grid hx-post="/actions/screenshot" hx-target="#webship-workspace-output" hx-swap="innerHTML">
              <input type="hidden" name="workspace" value="docs">
              <div class="uk-width-1-3@s"><input class="uk-input" name="name" placeholder="shot-name" required pattern="[a-zA-Z0-9_\\-]+"></div>
              <div class="uk-width-1-2@s"><input class="uk-input" name="url" placeholder="https://mysite.ddev.site" required></div>
              <div class="uk-width-1-6@s"><button type="submit" class="uk-button uk-button-primary uk-width-1-1">Capture</button></div>
            </form>
          </div>`);
      }
      if (pathname === '/fragments/docs/site-doc-form') {
        const wsOptions = Object.values(loadWorkspaces())
          .filter((w) => w.kind !== 'files')
          .map((w) => `<option value="${esc(w.key)}">${esc(w.label)}</option>`).join('');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(`
          <div class="uk-card uk-card-default uk-card-body uk-margin-top editor-card">
            <h3 class="uk-margin-small-bottom">Generate site documentation (AI → Markdown + PDF)</h3>
            <form class="uk-grid uk-grid-small" uk-grid hx-post="/actions/generate-doc" hx-target="#webship-workspace-output" hx-swap="innerHTML">
              <input type="hidden" name="workspace" value="docs">
              <div class="uk-width-1-4@s"><select class="uk-select" name="sourceWorkspace">${wsOptions}</select></div>
              <div class="uk-width-1-4@s"><input class="uk-input" name="projectName" placeholder="site/project name" required pattern="[a-zA-Z0-9_\\-]+"></div>
              <div class="uk-width-1-4@s"><input class="uk-input" name="docName" placeholder="doc-name" required pattern="[a-zA-Z0-9_\\-]+"></div>
              <div class="uk-width-1-4@s"><button type="submit" class="uk-button uk-button-primary uk-width-1-1">Generate</button></div>
            </form>
          </div>`);
      }
      // Searching an index, in the dialog. A GET renders the form; the same path with ?q= runs the
      // search, so the form posts to itself and there is one route rather than two.
      const ragSearchMatch = pathname.match(/^\/fragments\/([a-z0-9_-]+)\/rag-search\/([a-zA-Z0-9_%.-]+)$/);
      if (ragSearchMatch && isValidWorkspace(ragSearchMatch[1])) {
        const wsKey = ragSearchMatch[1];
        const project = decodeURIComponent(ragSearchMatch[2]);
        if (!NAME_RE.test(project)) { res.writeHead(400); return res.end('bad name'); }
        const q = String(new URL(req.url, 'http://localhost').searchParams.get('q') || '').trim().slice(0, 500);
        const instance = ragInstanceFor(wsKey, project);
        const collection = ragCollectionName(wsKey, project);
        const url = `/fragments/${encodeURIComponent(wsKey)}/rag-search/${encodeURIComponent(project)}`;

        let results = '';
        if (q) {
          // Sparse search against the BM25 function the collection carries. `data` is the raw
          // query text: the database embeds it with the same function it indexed with, which is
          // the whole point of building the vectors inside Milvus.
          const body = await milvusPost('/v2/vectordb/entities/search', {
            collectionName: collection,
            data: [q],
            annsField: 'sparse',
            limit: 10,
            outputFields: ['path', 'start_line', 'end_line', 'text'],
          }, 15000, instance);
          if (!body || body.code !== 0) {
            results = `<div class="msg error">${esc((body && body.message) || `No answer from ${instance}.`)}</div>`;
          } else if (!body.data || !body.data.length) {
            results = `<p class="uk-text-meta">Nothing in ${esc(collection)} matches “${esc(q)}”.</p>`;
          } else {
            // A chunk is a line RANGE, and the range is what makes a hit openable: it is the
            // difference between "it is in this file" and "it is at this line".
            results = body.data.map((hit) => {
              const lines = hit.start_line ? `${hit.start_line}${hit.end_line && hit.end_line !== hit.start_line ? `–${hit.end_line}` : ''}` : '';
              return `
              <div class="rag-hit">
                <div class="rag-hit-head"><code>${esc(String(hit.path || '?'))}${lines ? `:${esc(lines)}` : ''}</code><span class="uk-text-meta">score ${esc(String(Math.round((hit.distance || 0) * 1000) / 1000))}</span></div>
                <pre>${esc(String(hit.text || '').slice(0, 1200))}</pre>
              </div>`;
            }).join('');
          }
        }

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(`
    <div class="uk-card uk-card-default uk-card-body editor-card">
      <h3 class="uk-margin-small-bottom">Search ${esc(project)}</h3>
      <p class="uk-text-meta">${esc(collection)} on ${esc(instance)} — the prose, templates and config a graph does not read.</p>
      <div class="list-controls">
        <div class="lc-group lc-find">
          <input class="uk-input uk-form-small list-search" type="search" name="q" value="${esc(q)}"
                 placeholder="Ask it something…" aria-label="Search this index" autofocus
                 hx-get="${esc(url)}" hx-target="#editor-modal-body" hx-swap="innerHTML"
                 hx-trigger="keyup[key=='Enter'], search">
          <button class="uk-button uk-button-primary uk-button-small" type="button"
                  hx-get="${esc(url)}" hx-target="#editor-modal-body" hx-swap="innerHTML"
                  hx-include="closest .list-controls"><span uk-icon="icon: search; ratio: .7"></span> Search</button>
        </div>
      </div>
      <div class="rag-results">${results}</div>
      <div class="uk-margin-small-top">
        <button type="button" class="uk-button uk-button-default uk-modal-close">Close</button>
      </div>
    </div>`);
      }

      // The graph as a single archive, to hand to another workspace. Streamed straight out of
      // tar: a graph runs to tens of megabytes and buffering it would hold the whole thing in the
      // app's memory.
      const graphDlMatch = pathname.match(/^\/graph\/([a-z0-9_-]+)\/([a-zA-Z0-9_.-]+)\/download$/);
      if (graphDlMatch && isValidWorkspace(graphDlMatch[1])) {
        const [, wsKey, project] = graphDlMatch;
        if (project.includes('..')) { res.writeHead(400); return res.end('bad name'); }
        let real;
        try {
          real = fs.realpathSync(graphStoreDir(wsKey, project));
          const base = fs.realpathSync(path.join(ROOT, 'graphs'));
          if (!real.startsWith(base + path.sep) || !fs.statSync(real).isDirectory()) throw new Error('outside');
        } catch (_) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          return res.end('No graph yet — build one from the Graph menu on the project row.');
        }
        const archive = `${wsKey}--${project}--graph.tar.gz`;
        res.writeHead(200, {
          'Content-Type': 'application/gzip',
          'Content-Disposition': `attachment; filename="${archive.replace(/[^A-Za-z0-9._-]/g, '_')}"`,
          'X-Content-Type-Options': 'nosniff',
        });
        const tar = spawn('tar', ['-czf', '-', '-C', path.dirname(real), path.basename(real)],
          { stdio: ['ignore', 'pipe', 'pipe'] });
        tar.stdout.pipe(res);
        tar.stderr.resume();
        tar.on('error', () => { try { res.destroy(); } catch (_) { /* client gone */ } });
        res.on('close', () => { try { tar.kill(); } catch (_) { /* already exited */ } });
        return;
      }

      // The picture, and the report. Symlinks are resolved before the path is trusted: a project
      // directory that is a link would otherwise read outside the workspace, and this container
      // bind-mounts ~/.claude as well as ~/workspace.
      const graphMatch = pathname.match(/^\/graph\/([a-z0-9_-]+)\/([a-zA-Z0-9_-]+)(\/report)?$/);
      if (graphMatch && isValidWorkspace(graphMatch[1])) {
        const wantsReport = !!graphMatch[3];
        const file = path.join(graphStoreDir(graphMatch[1], graphMatch[2]),
          wantsReport ? GRAPH_FILES.report : GRAPH_FILES.html);
        let real = null;
        try {
          const base = fs.realpathSync(path.join(ROOT, 'graphs'));
          real = fs.realpathSync(file);
          if (!real.startsWith(base + path.sep)) real = null;
          if (real && !fs.statSync(real).isFile()) real = null;
        } catch (_) { real = null; }
        if (!real) {
          res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
          return res.end('<div class="msg error">No graph yet — build one from the Graph menu on the project row.</div>');
        }
        if (wantsReport) {
          // The report opens in the dialog, so it is delivered as a fragment rather than as a
          // file: markdown in a <pre>, which is what it is.
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          return res.end(`
    <div class="uk-card uk-card-default uk-card-body editor-card">
      <h3 class="uk-margin-small-bottom">${esc(graphMatch[2])} — graph report</h3>
      <pre class="graph-report">${esc(fs.readFileSync(real, 'utf8'))}</pre>
      <div class="uk-margin-small-top">
        <a class="uk-button uk-button-default" href="/graph/${esc(graphMatch[1])}/${esc(graphMatch[2])}" target="_blank"><span uk-icon="icon: image; ratio: .8"></span> Open the graph</a>
        <button type="button" class="uk-button uk-button-default uk-modal-close">Close</button>
      </div>
    </div>`);
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return fs.createReadStream(real).pipe(res);
      }
      const reviewMatch = pathname.match(/^\/fragments\/([a-z0-9_-]+)\/review\/([a-zA-Z0-9_%.-]+)$/);
      if (reviewMatch && isValidWorkspace(reviewMatch[1])) {
        const key = reviewMatch[1];
        const name = decodeURIComponent(reviewMatch[2]);
        if (!/^[a-zA-Z0-9_.-]+$/.test(name) || name.includes('..')) { res.writeHead(400); return res.end('bad name'); }
        const full = path.join(workspaceDir(key), name);
        if (!fs.existsSync(full) || !fs.statSync(full).isFile() || !REVIEWABLE_RE.test(name)) {
          res.writeHead(404); return res.end('not reviewable');
        }
        const st = fs.statSync(full);
        const src = `/files/${encodeURIComponent(key)}/${encodeURIComponent(name)}`;
        const ext = path.extname(name).toLowerCase();
        let body;
        if (ext === '.pdf') {
          // <object>, not <iframe>: showing a PDF needs the browser's own viewer, and where there
          // is none an iframe renders an empty white box with nothing said about why. <object>
          // falls back to its children instead, so the reason is stated and the file is still
          // reachable. Not sandboxed either way — the sandbox attribute disables that viewer.
          body = `<object class="review-frame" type="application/pdf" data="${src}#view=FitH" title="${esc(name)}">
              <div class="review-fallback">
                <p>This browser has no built-in PDF viewer, so it cannot be shown here.</p>
                <p><a class="uk-button uk-button-primary uk-button-small" href="${src}?download=1">Download it</a>
                   <a class="uk-button uk-button-default uk-button-small" href="${src}" target="_blank">or open it in a tab</a></p>
              </div>
            </object>`;
        } else if (/\.html?$/.test(ext)) {
          // The dashboard generated this page, but it is still a whole document being framed:
          // sandbox="" gives it a unique origin and no scripts, forms or navigation. Inline CSS,
          // which is what pandoc --standalone emits, still applies.
          body = `<iframe class="review-frame" src="${src}" title="${esc(name)}" sandbox="" referrerpolicy="no-referrer"></iframe>`;
        } else {
          body = `<img class="review-image" src="${src}" alt="${esc(name)}">`;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(`
    <div class="uk-card uk-card-default uk-card-body editor-card">
      <h3 class="uk-margin-small-bottom">${esc(name)}</h3>
      <p class="uk-text-meta">${humanSize(st.size)} · ${st.mtime.toISOString().slice(0, 16).replace('T', ' ')} · from <code>${esc(key)}/</code></p>
      ${body}
      <div class="uk-margin-small-top">
        <a class="uk-button uk-button-primary" href="${src}?download=1"><span uk-icon="icon: download; ratio: .8"></span> Download</a>
        <a class="uk-button uk-button-default" href="${src}" target="_blank"><span uk-icon="icon: link-external; ratio: .8"></span> Open in a tab</a>
        <button type="button" class="uk-button uk-button-default uk-modal-close">Close</button>
      </div>
    </div>`);
      }
      const fileMatch = pathname.match(/^\/files\/([a-z0-9_-]+)\/([a-zA-Z0-9_%.-]+)$/);
      if (fileMatch && isValidWorkspace(fileMatch[1])) {
        const name = decodeURIComponent(fileMatch[2]);
        if (name.includes('..') || name.includes('/')) { res.writeHead(400); return res.end('bad name'); }
        const file = path.join(workspaceDir(fileMatch[1]), name);
        if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end('not found'); }
        const type = { '.pdf': 'application/pdf', '.html': 'text/html; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.png': 'image/png',
          '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime',
          '.webm': 'video/webm', '.ogg': 'video/ogg', '.ogv': 'video/ogg' }[path.extname(file).toLowerCase()] || 'application/octet-stream';
        const size = fs.statSync(file).size;
        // The dialog offers a Download beside its viewer. Without this the link merely opens the
        // file again, which is not what a button called Download does. Decided here rather than
        // with setHeader, because writeHead's own headers win over anything set before it.
        const disposition = new URL(req.url, 'http://localhost').searchParams.has('download')
          ? `attachment; filename="${name.replace(/"/g, '')}"`
          : 'inline';
        // A <video> seeks by asking for a byte range. Answering the whole file with a 200 makes the
        // browser download all of it before the first frame and disables scrubbing entirely, so a
        // range request gets the 206 it asked for.
        const range = VIDEO_RE.test(file) ? req.headers.range : undefined;
        if (range) {
          const m = /^bytes=(\d*)-(\d*)$/.exec(range);
          if (m) {
            let start = m[1] === '' ? null : parseInt(m[1], 10);
            let end = m[2] === '' ? null : parseInt(m[2], 10);
            if (start === null) { start = Math.max(0, size - (end || 0)); end = size - 1; }
            if (end === null || end >= size) end = size - 1;
            if (Number.isNaN(start) || start > end || start >= size) {
              res.writeHead(416, { 'Content-Range': `bytes */${size}` });
              return res.end();
            }
            res.writeHead(206, {
              'Content-Type': type,
              'Content-Length': end - start + 1,
              'Content-Range': `bytes ${start}-${end}/${size}`,
              'Accept-Ranges': 'bytes',
            });
            return fs.createReadStream(file, { start, end }).pipe(res);
          }
        }
        res.writeHead(200, {
          'Content-Type': type,
          'Content-Length': size,
          'Content-Disposition': disposition,
          ...(VIDEO_RE.test(file) ? { 'Accept-Ranges': 'bytes' } : {}),
        });
        return fs.createReadStream(file).pipe(res);
      }
      const playMatch = pathname.match(/^\/fragments\/([a-z0-9_-]+)\/play\/([a-zA-Z0-9_%.-]+)$/);
      if (playMatch && isValidWorkspace(playMatch[1])) {
        const name = decodeURIComponent(playMatch[2]);
        if (!VIDEO_RE.test(name) || name.includes('..') || name.includes('/')) { res.writeHead(400); return res.end('bad name'); }
        const dir = workspaceDir(playMatch[1]);
        if (!fs.existsSync(path.join(dir, name))) { res.writeHead(404); return res.end('not found'); }
        // <stem>-poster.jpg is the convention, so the player shows a frame before it is played.
        const stem = name.replace(VIDEO_RE, '');
        const poster = ['-poster.jpg', '-poster.jpeg', '-poster.png']
          .map((s2) => `${stem}${s2}`).find((f) => fs.existsSync(path.join(dir, f)));
        const src = `/files/${playMatch[1]}/${encodeURIComponent(name)}`;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(`
          <div class="msg assistant">
            <p><span uk-icon="icon: play-circle; ratio: .8"></span> <strong>${esc(name)}</strong></p>
            <video class="uk-width-1-1" controls preload="metadata"${poster ? ` poster="/files/${playMatch[1]}/${encodeURIComponent(poster)}"` : ''} src="${src}"></video>
          </div>`);
      }

      if (pathname === '/settings' || pathname.startsWith('/settings/')) {
        const wanted = decodeURIComponent(pathname.slice('/settings/'.length) || '');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(settingsPage(SETTINGS_FILE_RE.test(wanted) ? wanted : ''));
      }

      if (pathname === '/fragments/icons') {
        const params = new URL(req.url, 'http://localhost').searchParams;
        const q = String(params.get('q') || '').trim().toLowerCase();
        // Which tile to draw as chosen. The grid is where you look to see what is selected, so it
        // has to be told — the checked radio that guarantees a value lives outside it.
        const current = String(params.get('current') || '');
        const all = [...tablerIcons()].sort();
        const hits = q ? all.filter((i) => i.includes(q)) : all;
        // Paged rather than search-only: 4,736 tiles inline would be a multi-megabyte page, but
        // making search the only way in means you cannot browse — and you often do not know the
        // name of the icon you want.
        const PER_PAGE = 120;
        const pages = Math.max(1, Math.ceil(hits.length / PER_PAGE));
        const page = Math.min(Math.max(1, parseInt(params.get('page'), 10) || 1), pages);
        const shown = hits.slice((page - 1) * PER_PAGE, page * PER_PAGE);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        if (!hits.length) return res.end(`<span class="uk-text-meta">No icon matches “${esc(q)}”.</span>`);
        const tiles = shown.map((i) => `
          <input class="icon-radio" type="radio" name="icon" id="ic-${esc(i)}" value="tabler:${esc(i)}"${`tabler:${i}` === current ? ' checked' : ''}>
          <label class="icon-choice" for="ic-${esc(i)}" title="${esc(i)}">${iconHtml(`tabler:${i}`, 0.9)}</label>`).join('');
        const pager = pages > 1 ? `
          <div class="icon-pager uk-text-meta">
            ${page > 1 ? `<button type="button" class="uk-button uk-button-default uk-button-small" hx-get="/fragments/icons?page=${page - 1}&current=${encodeURIComponent(current)}" hx-include=".icon-filter" hx-target="#icon-grid-wrap" hx-swap="innerHTML">Previous</button>` : ''}
            <span>${(page - 1) * PER_PAGE + 1}–${Math.min(page * PER_PAGE, hits.length)} of ${hits.length}</span>
            ${page < pages ? `<button type="button" class="uk-button uk-button-default uk-button-small" hx-get="/fragments/icons?page=${page + 1}&current=${encodeURIComponent(current)}" hx-include=".icon-filter" hx-target="#icon-grid-wrap" hx-swap="innerHTML">Next</button>` : ''}
          </div>` : '';
        return res.end(`<div class="icon-grid">${tiles}</div>${pager}`);
      }

      const testsMatch = pathname.match(/^\/fragments\/([a-z0-9_-]+)\/tests\/([a-zA-Z0-9_.-]+)$/);
      if (testsMatch && isValidWorkspace(testsMatch[1])) {
        const project = decodeURIComponent(testsMatch[2]);
        if (!NAME_RE.test(project) || !listProjects(workspaceDir(testsMatch[1])).includes(project)) {
          res.writeHead(404); return res.end('not found');
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(testRunHtml(testsMatch[1], project));
      }

      // One artifact out of a project's tests/ directory. Everything is resolved and then checked
      // to be inside that directory, so a crafted path cannot walk out of it.
      const projFileMatch = pathname.match(/^\/project-files\/([a-z0-9_-]+)\/([a-zA-Z0-9_.-]+)\/(.+)$/);
      if (projFileMatch && isValidWorkspace(projFileMatch[1])) {
        const [, key, project, relRaw] = projFileMatch;
        if (!NAME_RE.test(project) || !listProjects(workspaceDir(key)).includes(project)) {
          res.writeHead(404); return res.end('not found');
        }
        const testsRoot = path.resolve(workspaceDir(key), project, 'tests');
        const file = path.resolve(testsRoot, decodeURIComponent(relRaw).replace(/^tests\//, ''));
        if (file !== testsRoot && !file.startsWith(testsRoot + path.sep)) { res.writeHead(400); return res.end('bad path'); }
        if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end('not found'); }
        const type = { '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.json': 'application/json',
          '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.pdf': 'application/pdf',
          '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.ogg': 'video/ogg', '.ogv': 'video/ogg',
          '.mov': 'video/quicktime' }[path.extname(file).toLowerCase()] || 'application/octet-stream';
        const size = fs.statSync(file).size;
        // A recording is seeked with a range request; answering the whole file with a 200 makes
        // the browser fetch all of it before the first frame and disables scrubbing.
        const range = VIDEO_RE.test(file) ? req.headers.range : undefined;
        const m = range && /^bytes=(\d*)-(\d*)$/.exec(range);
        if (m) {
          let start = m[1] === '' ? null : parseInt(m[1], 10);
          let end = m[2] === '' ? null : parseInt(m[2], 10);
          if (start === null) { start = Math.max(0, size - (end || 0)); end = size - 1; }
          if (end === null || end >= size) end = size - 1;
          if (Number.isNaN(start) || start > end || start >= size) {
            res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end();
          }
          res.writeHead(206, { 'Content-Type': type, 'Content-Length': end - start + 1,
            'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes' });
          return fs.createReadStream(file, { start, end }).pipe(res);
        }
        res.writeHead(200, { 'Content-Type': type, 'Content-Length': size,
          ...(VIDEO_RE.test(file) ? { 'Accept-Ranges': 'bytes' } : {}) });
        return fs.createReadStream(file).pipe(res);
      }

      if (pathname === '/fragments/jobs/running') {
        const running = [...jobs.entries()].filter(([, j]) => !j.done);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(running.map(([id]) => jobFragment(id).html).join(''));
      }

      const argsMatch = pathname.match(/^\/fragments\/([a-z0-9_-]+)\/builder-args$/);
      if (argsMatch && isValidWorkspace(argsMatch[1])) {
        const script = new URL(req.url, 'http://localhost').searchParams.get('script') || '';
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(builderArgsHtml(argsMatch[1], script));
      }
      const fragMatch = pathname.match(/^\/fragments\/([a-z0-9_-]+)\/projects$/);
      if (fragMatch && isValidWorkspace(fragMatch[1])) {
        const projState = readListState(req);
        setListCookies(res, projState);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(await projectRowsHtml(fragMatch[1], workspaceDir(fragMatch[1]), projState));
      }
      const backupsMatch = pathname.match(/^\/fragments\/([a-z0-9_-]+)\/backups$/);
      if (backupsMatch && isValidWorkspace(backupsMatch[1])) {
        const backupState = readListState(req);
        setListCookies(res, backupState);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(backupRowsHtml(backupsMatch[1], backupState));
      }
      const backupsPageMatch = pathname.match(/^\/([a-z0-9_-]+)\/backups\/?$/);
      if (backupsPageMatch && isValidWorkspace(backupsPageMatch[1])) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(backupsPage(backupsPageMatch[1], readListState(req)));
      }
      const wsKey = pathname.replace(/^\/+|\/+$/g, '');
      if (isValidWorkspace(wsKey)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(await workspacePage(wsKey, readListState(req)));
      }
      if (serveStatic(pathname, res)) return;
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }

    // deep-chat speaks JSON, not form-encoded HTMX fragments, so it gets its own route rather
    // than going through handleAction: it posts { messages: [...] } and expects a Response object
    // back ({ html }), with anything else in the JSON left for our own responseInterceptor.
    if (req.method === 'POST' && pathname === '/actions/deep-chat') {
      let raw = '';
      req.on('data', (d) => { raw += d; if (raw.length > 1e6) req.destroy(); });
      req.on('end', async () => {
        const json = (o, status = 200) => {
          res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify(o));
        };
        try {
          const parsed = JSON.parse(raw || '{}');
          const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
          // Only the newest user turn is the ask; deep-chat keeps the transcript for display.
          const last = [...messages].reverse().find((m) => m.role !== 'ai');
          const message = String((last && (last.text || last.message)) || '').trim();
          if (!message) return json({ error: 'Empty message.' }, 400);
          audit('/actions/chat', { workspace: '-', projectName: message.slice(0, 120) });
          const { replyHtml, directive } = await assistantReply(message, String(parsed.context || ''));
          // `html` is deep-chat's own field; `directive` is ours, read by the response interceptor.
          return json({ html: `<div class="dc-reply">${replyHtml}</div>`, directive });
        } catch (err) {
          return json({ error: err.message || 'Assistant failed.' }, 500);
        }
      });
      return;
    }

    if (req.method === 'POST' && pathname.startsWith('/actions/')) {
      let body = '';
      req.on('data', (d) => { body += d; if (body.length > 1e6) req.destroy(); });
      req.on('end', () => handleAction(pathname, querystring.parse(body), res));
      return;
    }

    res.writeHead(405, { 'Content-Type': 'text/plain' });
    res.end('Method not allowed');
  } catch (err) {
    // A handler that throws AFTER writing its response used to take the whole dashboard down:
    // writeHead here threw ERR_HTTP_HEADERS_SENT, which is not catchable from inside this catch,
    // so node killed the process and supervisord restarted it into the same crash on the next
    // request. Report it and close the response that is already open.
    console.error('Request failed:', req.method, req.url, err && err.stack);
    if (res.headersSent) { try { res.end(); } catch (_) { /* already gone */ } return; }
    if (req.headers['hx-request']) {
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(`<div class="msg error">Server error: ${esc(err.message)}</div>`);
    }
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end(`Server error: ${err.message}`);
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`workspace-dashboard (node:http + HTMX) listening on :${PORT}`);
});
