/**
 * The workspace assistant: the reply it gives, and the panel it lives in.
 *
 * Split out of server.js because it is one job — turn a message and a page into an answer and the
 * directives that steer the interface — and it does not route anything. Both chat front-ends call
 * assistantReply, so neither can drift from the other.
 */

const { spawn } = require('child_process');

const {
  ROOT,
  hubDomain,
  loadWorkspaces,
  isValidWorkspace,
  listProjects,
  listBackups,
  findBuilderScripts,
  builderLabel,
  assistantSettings,
} = require('./workspaces');
const { esc } = require('./html');
const { run } = require('./jobs');

// The mark drawn beside the assistant's replies. It moved here with the panel that draws it.
const AI_MARK = `<svg class="ai-mark" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="currentColor" aria-hidden="true"><path d="M10.5 2l1.9 6.1 6.1 1.9-6.1 1.9-1.9 6.1-1.9-6.1L2.5 10l6.1-1.9L10.5 2z"/><path d="M18.5 13.5l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3z"/></svg>`;

const HOME_URL = () => `https://${hubDomain()}`;
const wsUrl = (key, sub = '') => `https://${key}.${hubDomain()}${sub}`;

/* ---------------- assistant reply (shared by both chat front-ends) ------ */

// One reply, whichever UI asked for it: the HTMX pane and the deep-chat component send the same
// message and context and get back the same rendered markdown plus the same interface directives.
async function assistantReply(message, ctx) {
const workspaceNames = Object.values(loadWorkspaces())
      .map((w) => `${w.key} (${w.subtitle})`)
      .join('; ');
    // Live page context: the assistant always knows which page the user is
    // on and what that page currently shows (computed fresh per message).
    let pageContext = 'The user is on the dashboard home page showing all workspace cards.';
    
    const ctxMatch = ctx.match(/^(workspace|backups):([a-z0-9_-]+)$/);
    if (ctxMatch && isValidWorkspace(ctxMatch[2])) {
      const cKey = ctxMatch[2];
      const cMeta = loadWorkspaces()[cKey];
      if (ctxMatch[1] === 'workspace') {
        const projs = listProjects(cMeta.dir);
        pageContext = `The user is on the "${cMeta.label}" workspace page (/${cKey}, folder ${cMeta.dir}). Projects currently listed: ${projs.join(', ') || '(none)'} . Builder scripts available: ${findBuilderScripts(cMeta.dir).join(', ') || '(none)'}.`;
      } else {
        pageContext = `The user is on the "${cMeta.label}" backups page (/${cKey}/backups). Backups currently listed: ${listBackups(cKey).map((b) => b.file).join(', ') || '(none)'}.`;
      }
    }
    const system = [
      `You are the Workspace AI Assistant embedded in the web dashboard at https://workspace.ddev.site, managing the webship/workspace tooling rooted at ${ROOT}.`,
      `You run inside the dashboard's container with Bash access: the whole workspace tree is at ${ROOT}, and the ddev + docker CLIs manage sibling DDEV projects.`,
      `Workspaces (folders under ${ROOT}): ${workspaceNames}.`,
      'The components workspace holds Drupal SDC components, React components, code components for Drupal Canvas, and HTMX and web components.',
      `Default domain scheme (hub domain: ${hubDomain()}): each workspace has <workspace>.${hubDomain()} (its dashboard page), and every running project has https://<project>.<workspace>.${hubDomain()} (its real site) — prefer these hierarchical URLs in OPEN directives; the canonical https://<project>.ddev.site also works.`,
      pageContext,
      'How to act:',
      `- Inspect: ls ${ROOT}/<workspace> ; ddev list ; each builder script has a "# workspace-name:" header naming what it builds.`,
      `- Build a new project: cd ${ROOT}/<workspace> && bash cmd-<...>-project.sh <project_name> --install`,
      `- Start/stop an existing project: cd ${ROOT}/<workspace>/<project> && ddev start -y (or ddev stop -y)`,
      `- Backup: run the folder's cmd-tool*-backup-*.sh <project_name> from inside ${ROOT}/<workspace>.`,
      `- Create/edit AI agents, skills, prompts, docs: write markdown files with Bash redirection — agents: ${ROOT}/agents/<name>.md (YAML frontmatter: name, description, tools), skills: ${ROOT}/skills/<name>/SKILL.md, prompts: ${ROOT}/prompts/<name>.md, docs: ${ROOT}/docs/<name>.md. Install into Claude Code by copying: agents → ~/.claude/agents/, skills → ~/.claude/skills/<name>/, prompts → ~/.claude/commands/.`,
      `- Docs tooling: render PDF with: pandoc <doc>.md -o <doc>.pdf --pdf-engine=wkhtmltopdf ; render HTML with: pandoc <doc>.md -o <doc>.html --standalone ; capture a site screenshot with: wkhtmltoimage --width 1440 <url> ${ROOT}/docs/<name>.png`,
      '- NEVER delete or remove anything unless the user explicitly asked for that in this exact message.',
      'After acting, end your reply with directives, each alone on its own line, so the interface can react:',
      'NAVIGATE:/<workspace>   (go to that workspace page, e.g. NAVIGATE:/dev — or its backups page: NAVIGATE:/dev/backups)',
      'OPEN:<https url>        (open a site in a new tab, e.g. after ddev start)',
      'REFRESH                 (refresh the visible project list)',
      'Keep replies short and factual; report real command results, never invented ones.',
    ].join('\n');

    const args = [
      '-p', message,
      '--output-format', 'json',
      '--append-system-prompt', system,
      '--allowedTools', 'Bash', 'Read', 'Glob', 'Grep',
      '--disallowedTools', 'Write', 'Edit', 'NotebookEdit', 'WebFetch', 'Agent',
      '--no-session-persistence',
    ];
    const result = await run('claude', args, ROOT, { timeoutMs: 15 * 60 * 1000 });
    let reply = result.stdout.trim();
    try {
      const parsed = JSON.parse(result.stdout);
      reply = parsed.result || parsed.response || reply;
    } catch (_) { /* raw text fallback */ }
    if (!reply) reply = result.stderr.trim() || 'No response from the assistant.';

    // Pull the interface directives out of the reply text.
    const directive = {};
    reply = reply.split('\n').filter((line) => {
      // Accepts /<workspace> and /<workspace>/backups
      const nav = line.match(/^\s*NAVIGATE:\/([a-z0-9_-]+)(\/backups)?\s*$/);
      if (nav) { directive.navigate = isValidWorkspace(nav[1]) ? wsUrl(nav[1], nav[2] || '') : HOME_URL(); return false; }
      const open = line.match(/^\s*OPEN:(https?:\/\/\S+)\s*$/);
      if (open) { directive.open = open[1]; return false; }
      if (/^\s*REFRESH\s*$/.test(line)) { directive.refresh = true; return false; }
      return true;
    }).join('\n').trim();

    const triggers = { 'refresh-projects': directive.refresh ? {} : undefined, 'assistant-directive': (directive.navigate || directive.open) ? directive : undefined };
    const activeTriggers = Object.fromEntries(Object.entries(triggers).filter(([, v]) => v !== undefined));
    if (Object.keys(activeTriggers).length) res.setHeader('HX-Trigger', JSON.stringify(activeTriggers));

    // Render the reply's markdown (tables, bold, code, lists) — gfm-raw_html
    // strips raw HTML passthrough, so model output can't inject markup.
    let replyHtml = `<p>${esc(reply)}</p>`;
    const mdResult = await new Promise((resolve) => {
      const child = spawn('pandoc', ['-f', 'gfm-raw_html', '-t', 'html'], { stdio: ['pipe', 'pipe', 'pipe'] });
      let out = '';
      child.stdout.on('data', (d) => { out += d; });
      child.on('close', (code) => resolve(code === 0 ? out : null));
      child.on('error', () => resolve(null));
      child.stdin.write(reply);
      child.stdin.end();
    });
    if (mdResult) replyHtml = mdResult;
  return { replyHtml, directive };
}

const COMMAND_MENU_ORDER = ['products', 'dev', 'test', 'demos'];
// The commands offered in the prompt box.
//
// Scoped to one workspace when the user is on a workspace page: on /dev the only
// commands that can sensibly run are dev's own, and a list of every command in
// the tree buries them. The home page keeps the full grouped list, because there
// no workspace is implied.
function commandMenuGroups(scope) {
  const all = loadWorkspaces();
  const keys = Object.keys(all);
  const ordered = (scope && keys.includes(scope))
    ? [scope]
    : [...COMMAND_MENU_ORDER.filter((k) => keys.includes(k)),
       ...keys.filter((k) => !COMMAND_MENU_ORDER.includes(k))];
  const groups = [];
  for (const key of ordered) {
    const dir = all[key].dir;
    let files = [];
    try {
      files = fs.readdirSync(dir).filter((f) => /^cmd-.*\.sh$/.test(f)).sort();
    } catch (_) { continue; }
    if (!files.length) continue;
    groups.push({
      key,
      label: all[key].label,
      items: files.map((f) => ({ file: f, label: builderLabel(dir, f) })),
    });
  }
  return groups;
}


function assistantHtml({ context = 'home' } = {}) {
  // "workspace:dev" / "backups:dev" — both mean the user is working in dev.
  const scopeMatch = String(context).match(/^(?:workspace|backups):([a-z0-9_-]+)$/);
  const scope = scopeMatch && isValidWorkspace(scopeMatch[1]) ? scopeMatch[1] : null;
  // The settings page belongs to no workspace, so it gets no command list at all rather than every
  // command in the tree: none of them edit those files.
  const isSettings = context === 'settings';
  const scopeLabel = scope ? loadWorkspaces()[scope].label : (isSettings ? 'Settings' : null);
  // What the assistant opens with, written for the page it is on. The same greeting and the same
  // five examples on all twenty-one pages taught nothing after the first: on a workspace page the
  // useful examples are that workspace's, and on settings none of them are. Built here rather than
  // in ui.js because this is where the workspace and its kind are already known, and it rides in a
  // template so the markup stays server-rendered and escaped.
  const meta = scope ? loadWorkspaces()[scope] : null;
  const examples = (() => {
    if (isSettings) {
      return ['"What does the contributor block set?"',
              '"Which workspaces exist, and in what order?"'];
    }
    if (meta && meta.kind === 'files') {
      // "an agent", not "a agent" — the nouns come from the settings files and some start a vowel.
      const a = /^[aeiou]/i.test(meta.noun) ? 'an' : 'a';
      return [`"Create ${a} ${meta.noun} that reviews cmd- scripts"`,
              `"What ${meta.nounPlural} are here?"`,
              `"Back up every ${meta.noun} in ${scope}"`];
    }
    if (meta) {
      return [`"Build a Drupal 11.4 site named d114test in ${scope}"`,
              `"What's running in ${scope} right now?"`,
              `"Back up every project in ${scope}"`];
    }
    return ['"Build a Drupal 11.4 site named d114test"',
            '"Create a Webship 11 project called demo1 and open it"',
            '"What\'s running right now?"',
            '"Back up every project in dev"',
            '"Write a doc about demo1 and make a PDF"'];
  })();
  const opener = isSettings
    ? 'Ask me about the workspace settings — what a field is for, or what a change would do.'
    : meta
      ? `I can act on <strong>${esc(meta.label)}</strong> — and on anything else you ask for.`
      : 'I can actually do things for you — build, start, back up, and open your projects, then take you there.';

  const commandGroups = isSettings ? [] : commandMenuGroups(scope);
  // Scoped to one workspace, the optgroup would repeat that workspace's name on every row for no
  // information; flat reads better.
  const commandOptions = scope
    ? commandGroups.flatMap((g) => g.items.map((it) =>
        `<option value="${esc(g.key)}/${esc(it.file)}">${esc(it.label === it.file ? it.file : `${it.label} — ${it.file}`)}</option>`)).join('')
    : commandGroups.map((g) => `
    <optgroup label="${esc(g.label)}">
      ${g.items.map((it) => `<option value="${esc(g.key)}/${esc(it.file)}">${esc(it.label === it.file ? it.file : `${it.label} — ${it.file}`)}</option>`).join('')}
    </optgroup>`).join('');
  // Kept short: the select is only as wide as the sidebar, and the label is what it falls back to.
  const autoOption = scopeLabel
    ? `✨ Auto — ${scopeLabel}`
    : '✨ Auto — the agent decides';
  const pickerLabel = isSettings ? 'Prompt mode — Settings'
    : scope ? `Prompt mode — ${scopeLabel} commands` : 'Prompt mode';
  // The panel names the page it is on, the way the placeholder and the picker do.
  // "Dev AI Assistant", but "AI Agents Assistant" — a label that already says AI does not say it
  // twice.
  const assistantTitle = scopeLabel
    ? `${scopeLabel} ${/^AI\b/.test(scopeLabel) ? 'Assistant' : 'AI Assistant'}`
    : 'Workspace AI Assistant';
  const assistantSubtitle = scope
    ? `Ask about the ${scopeLabel} workspace — build, start, back up`
    : isSettings
      ? 'Ask about the workspace settings'
      : 'Ask about any workspace — build, start, back up';
  const settings = assistantSettings();
  const panel = `
    <div class="uk-card uk-card-default assistant-panel">
      <div class="assistant-head">
        <div class="uk-flex uk-flex-middle assistant-head-row">
          <span class="assistant-avatar">${AI_MARK}</span>
          <div class="assistant-head-text">
            <h3 class="uk-margin-remove">${esc(assistantTitle)}</h3>
            <span class="uk-text-small">${esc(assistantSubtitle)}</span>
          </div>
        </div>
      </div>
      <div class="uk-card-body assistant-body">
        <div class="chat-tools">
          <select class="uk-select command-picker" aria-label="${esc(pickerLabel)}" title="${esc(pickerLabel)}">
            <option value="">${esc(autoOption)}</option>
            ${commandOptions}
          </select>
        </div>
        ${settings.intro ? `<template id="ws-chat-intro"><div class="dc-intro">
          <p>${opener}</p>
          <p>\u{1F4A1} <strong>Try these:</strong></p>
          <ul>${examples.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>
        </div></template>` : ''}
        <deep-chat id="ws-deep-chat" class="ws-deep-chat"
                   data-context="${esc(context)}"
                   data-settings="${esc(JSON.stringify(settings))}"
                   style="width:100%;height:100%;border:none;background-color:transparent;"></deep-chat>
      </div>
    </div>`;

  return panel;
}

module.exports = { assistantReply, assistantHtml, commandMenuGroups };
