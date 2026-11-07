/**
 * What the assistant answers, separated from how the answer is delivered.
 *
 * Two callers ask the same question: the HTMX pane posts a form and swaps the reply in, and the
 * deep-chat component posts JSON and renders it itself. Both need the same thing — the reply, and
 * the directives the agent ended with — so this returns those and neither owns the other's plumbing.
 *
 * The assistant runs in agent mode: it can actually drive the workspace tooling (Bash and the read
 * tools, inside this container where ~/workspace, ddev and docker all are) and then steer the
 * interface with NAVIGATE / OPEN / REFRESH, which the browser acts on.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');

const { esc } = require('./html');
const {
  ROOT, CONFIG_DIR, loadSettings, loadWorkspaces, isValidWorkspace, workspaceDir, hubDomain,
  findBuilderScripts, listBackups, commandFlags,
} = require('./workspaces');
const { run, listProjects } = require('./jobs');
const { hasGraph } = require('./graphs');
const { listSettingsFiles } = require('./settings-file');
const { HOME_URL, wsUrl } = require('./urls');
const { aiInventory } = require('./ai-inventory');

/**
 * What the page the question came from currently shows.
 *
 * Computed fresh per message, and separated from the reply so it can be checked without spawning
 * an agent: every branch here reaches into the rest of the app, and a name that is not imported
 * fails only when someone happens to ask from that page. That is exactly what happened — the
 * settings and workspace branches threw ReferenceError for `listSettingsFiles`, `CONFIG_DIR`,
 * `findBuilderScripts` and `listBackups` after the module split, so the assistant answered on the
 * home page and returned HTTP 500 everywhere else.
 */
// The AI Context a workspace carries: the folder's AGENTS.md (its own working
// instructions) and each command's real flag contract from its arg file. This
// is what lets the assistant run the right command with the right flags on the
// user's behalf instead of guessing at them.
function workspaceAiContext(key) {
  const meta = loadWorkspaces()[key];
  if (!meta) return '';
  const parts = [];
  try {
    const agentsMd = fs.readFileSync(path.join(meta.dir, 'AGENTS.md'), 'utf8').slice(0, 3000);
    parts.push(`This workspace's own AGENTS.md (follow it — it names the webship-workspace* skills that apply here; when one covers the task, invoke it with the Skill tool BEFORE improvising with Bash):\n${agentsMd}`);
  } catch (_) { /* no AGENTS.md here */ }
  let scripts = [];
  try {
    scripts = fs.readdirSync(meta.dir).filter((f) => /^cmd-.*\.sh$/.test(f)).sort();
  } catch (_) { /* no folder, no commands */ }
  const flagLines = scripts.map((scriptName) => {
    const flags = commandFlags(meta.dir, scriptName)
      .map((f) => `${f.long} (${f.short}) ${f.help}`).join(' | ');
    return flags ? `  ${scriptName}: ${flags}` : `  ${scriptName}`;
  });
  if (flagLines.length) {
    parts.push('Command contract — every builder here and the flags it ACTUALLY takes '
      + '(--install is always opt-in: without it a build stops at a codebase for the browser installer):\n'
      + flagLines.join('\n'));
  }
  return parts.join('\n\n');
}

function pageContextFor(ctx) {
  let pageContext = 'The user is on the dashboard home page showing all workspace cards. '
    + 'Each workspace folder carries its own AI Context: an AGENTS.md with its working rules, and '
    + 'cmd-*.sh commands whose real flags come from core/scripts/args/. Read a workspace\'s AGENTS.md '
    + 'before running its commands on the user\'s behalf.';
  // `ctx` is the page the question was asked from, so the answer can be about what is on it.
  if (ctx === 'settings') {
    const files = listSettingsFiles();
    // Name the files and the KEYS, never a value: this page is the one place the
    // real API keys and the account password live.
    pageContext = `The user is on the Settings page (/settings), editing the YAML in ${CONFIG_DIR}. `
      + `Files: ${files.join(', ')}. Secret keys in settings.yml (pass, api_key, token) hold REAL `
      + 'credentials on this machine. NEVER print, echo, cat, grep or otherwise reveal the value of '
      + 'any secret key, and never copy one into a command line — describe whether it is set instead. '
      + 'The dashboard writes these files line by line to preserve comments, so prefer telling the '
      + 'user which field to change on this page over rewriting a file with Bash.';
  }
  const ctxMatch = ctx.match(/^(workspace|backups):([a-z0-9_-]+)$/);
  if (ctxMatch && isValidWorkspace(ctxMatch[2])) {
    const cKey = ctxMatch[2];
    const cMeta = loadWorkspaces()[cKey];
    if (ctxMatch[1] === 'workspace') {
      const projs = listProjects(cMeta.dir);
      // Name the projects that have a graph, so the assistant queries it instead of
      // grepping — and so it knows the graph exists at all, which it cannot infer.
      const graphed = projs.filter((pr) => hasGraph(cKey, pr, 'graph.json'));
      pageContext = `The user is on the "${cMeta.label}" workspace page (/${cKey}, folder ${cMeta.dir}). Projects currently listed: ${projs.join(', ') || '(none)'} .\n${workspaceAiContext(cKey)}`
        + (graphed.length
          ? ` These projects have a graphify knowledge graph, kept in ${ROOT}/graphs/${cKey}/<project>/ rather than inside the project: ${graphed.join(', ')}. `
            + `For those, prefer \`graphify query "..." --graph ${ROOT}/graphs/${cKey}/<project>/graph.json\` (also explain, path, god-nodes) over grepping the tree, then read the files it points at. `
            + 'It maps PHP classes under src/, JS and SQL only — it does NOT map hooks in .module/.theme/.install, Twig, or any *.yml, so routing, services and plugin wiring are absent and a question about those comes back empty whether or not the answer exists. Rebuild it with `bash cmd-tools-graphify.sh <project>` after code changes; the graph is a snapshot and does not follow edits.'
          : '');
    } else {
      pageContext = `The user is on the "${cMeta.label}" backups page (/${cKey}/backups). Backups currently listed: ${listBackups(cKey).map((b) => b.file).join(', ') || '(none)'}.`;
    }
  }
  return pageContext;
}

/** The id of a YouTube video link, or null. */
function youtubeId(link) {
  try {
    const u = new URL(link);
    const host = u.hostname.replace(/^www\.|^m\./, '');
    const id = host === 'youtu.be' ? u.pathname.slice(1) : host === 'youtube.com' ? (u.searchParams.get('v') || (u.pathname.match(/^\/(?:embed|shorts|live)\/([\w-]{11})/) || [])[1]) : null;
    return /^[\w-]{11}$/.test(String(id || '')) ? id : null;
  } catch (_) { return null; }
}

// The avatar's moves, as the assistant may write them: [wave] … in a reply (public/assistant-avatar.js).
const AVATAR_GESTURES = ['wave', 'nod', 'think', 'explain', 'point', 'idea', 'shrug', 'thumbsup', 'cheer', 'clap', 'crossarms', 'look', 'bye'];
// More moves for an avatar with a set of its own (public/assistant-avatar-moves.js), and what each is for.
const AVATAR_MOVE_SETS = {
  clock: {
    stand: 'fists on hips: ready', welcome: 'arms out, palms up: welcome, here it is', showcase: 'an arm swept out, palm up: look at this',
    fistpump: 'a fist pumped: yes, it worked', me: 'a thumb at itself: leave it with me', sideeye: 'a sidelong look: really?',
    wink: 'a wink and a thumbs up: got it', strut: 'a strut on the spot: on its way', tilt: 'a curious tilt', lean: 'leaning in to listen',
    bounce: 'a bounce, pleased', spinhands: 'its hands race round the dial, delighted', tada: 'arms up, hands spinning: good news',
    tick: 'ticking side to side while it waits', glance: 'a look over the shoulder', alert: 'a finger straight up: attention',
  },
  labiba: {
    bow: 'a polite bow, to thank or welcome', shake: 'no', listen: 'while you take in a question', read: 'reading something through',
    magnify: 'looking closely, reviewing', draw: 'drawing on the board', drawbig: 'a big diagram on the board', holdup: 'showing something',
    proud: 'proud of a result', laugh: 'a light laugh', surprised: 'surprise', confused: 'puzzled', hips: 'ready, waiting',
    raiseright: 'a raised hand, a point to make', raiseleft: 'a raised hand', tap: 'tapping a key', push: 'pushing a change',
    swipeup: 'scrolling up', swipedown: 'scrolling down', globe: 'the world, languages', rocket: 'a launch, a release', fly: 'flying',
  },
};
// Big moves, where the whole avatar travels the page (public/assistant-avatar-ui.js, BIG), and what each is for.
const AVATAR_BIG_MOVES = {
  tour: 'a loop round the page and back, for a big moment or a welcome', dash: 'walks across the page and back',
  jump: 'a big leap, for good news', zoom: 'grows to its biggest for a moment', present: 'walks to the middle, grows and explains',
  spin: 'a full turn, for a finished job',
};
const AVATAR_PLACES = ['home', 'left', 'right', 'center', 'panel'];
const AVATAR_SIZES = ['small', 'medium', 'large', 'xl', 'huge', 'bigger', 'smaller'];

async function assistantReply(message, ctx, thread = null, { voice = false, avatar = false, avatarName = '', avatarId = '', page = null } = {}) {
  const cast = require('./assistant-cast');
  const moveSet = AVATAR_MOVE_SETS[cast.moveSetOf(avatarId)] || {};
  const moves = [...AVATAR_GESTURES, ...Object.keys(AVATAR_BIG_MOVES), ...Object.keys(moveSet).filter((m) => !AVATAR_GESTURES.includes(m))];
  // The avatar picked in the panel: a display name, nothing more, so it is cut down to letters and spaces.
  const shownAs = String(avatarName || '').replace(/[^\p{L}\p{N} .'-]/gu, '').trim().slice(0, 40) || 'Druplicon';

  // Agent mode: the assistant can actually run the workspace tooling
  // (Bash + read tools inside this container, where ~/workspace, ddev and
  // docker are all available) and steers the interface afterwards through
  // NAVIGATE/OPEN/REFRESH directives that ui.js executes in the browser.
  const workspaceNames = Object.values(loadWorkspaces())
    .map((w) => `${w.key} (${w.subtitle})`)
    .join('; ');
  const pageContext = pageContextFor(ctx);
  // Which workspace (and project, when the page is about one) the inventory and the work
  // documents below resolve against — the same context string that titles the panel
  // "Dev AI Assistant" and scopes the "@"/"/" suggestions, so all three agree.
  const ctxScope = String(ctx || '').match(/^(?:workspace|backups):([a-z0-9_-]+)(?::([a-zA-Z0-9_-]+))?$/);
  const ctxWs = ctxScope && isValidWorkspace(ctxScope[1]) ? ctxScope[1] : '';
  const ctxProj = ctxWs && ctxScope[2] ? ctxScope[2] : '';
  // Its memory: one folder (settings.yml assistant.memory), made on first use and private to this user.
  const memoryDir = path.join(ROOT, require('./speech').assistantSettings(loadSettings()).memory);
  try { fs.mkdirSync(memoryDir, { recursive: true, mode: 0o700 }); } catch (_) { /* reported by the agent if it cannot write */ }
  const system = [
    `You are the Webship Workspace AI Assistant embedded in the web dashboard at https://workspace.ddev.site, managing the Webship Workspace tooling rooted at ${ROOT}.`,
    `You run inside the dashboard's container with Bash access: the whole workspace tree is at ${ROOT}, and the ddev + docker CLIs manage sibling DDEV projects.`,
    `Workspaces (folders under ${ROOT}): ${workspaceNames}.`,
    'The components workspace holds Drupal SDC components, React components, code components for Drupal Canvas, and HTMX and web components.',
    `Default domain scheme (hub domain: ${hubDomain()}): each workspace has <workspace>.${hubDomain()} (its dashboard page), and every running project has https://<project>.<workspace>.${hubDomain()} (its real site) — prefer these hierarchical URLs in OPEN directives; the canonical https://<project>.ddev.site also works.`,
    pageContext,
    (() => {
      // The Workspace's default language (settings.yml `language:`): answer in it unless spoken to in another.
      const sp = require('./speech');
      const lang = sp.workspaceLanguage(loadSettings());
      return `The Workspace's language is ${sp.languageName(lang)} (${lang}): answer in it, unless the person writes to you in another language; then answer in theirs. Commands, paths and code stay as they are.`;
    })(),
    // What the activated plugins let the assistant reach (a tracker, a cloud), each with its own rules.
    ...require('./plugin-loader').pluginAssistantContext(),
    // WHAT THIS MACHINE ACTUALLY HAS. Without this the assistant improvised: it would
    // describe doing a job by hand that a skill on this very machine does properly, or
    // name an agent that does not exist. Names only, with the descriptions left on disk —
    // 87 agents and 42 skills with their descriptions is a prompt of its own, and the
    // right move is to read the one file that matters when it matters.
    (() => {
      const inv = aiInventory(ctxWs, ctxProj);
      if (!inv.length) return '';
      // The workspace tooling is YOURS, not something the user picks. It is deliberately
      // absent from the "@"/"/" suggestions — asking for a build should not require
      // remembering `@webship-workspace-build` first — so it is stated here instead, as
      // the rules this assistant already works by.
      const mine = inv.filter((i) => i.builtIn);
      const theirs = inv.filter((i) => !i.builtIn);
      const of = (kind) => theirs.filter((i) => i.kind === kind);
      const names = (kind) => of(kind).map((i) => i.name).join(', ');
      return [
        ...(mine.length ? [
          'YOUR OWN TOOLING, BUILT IN. You ARE the Webship Workspace assistant, so these are not',
          'things the user has to name — they are the rules you already work by, and they are',
          'deliberately absent from the "@" and "/" suggestions for that reason. Read the one that',
          `covers the job and follow it: ${mine.map((i) => `${i.name} (${i.kind})`).join(', ')}.`,
          'Say which you are following, and never ask the user to name one of these.',
        ] : []),
        'WHAT THE USER CAN NAME. Installed on this machine and usable through the Claude Code CLI;',
        'these are exactly what the "@" and "/" suggestions offer.',
        `- Agents (${of('agent').length}), in ~/.claude/agents/<name>.md: ${names('agent')}`,
        `- Skills (${of('skill').length}), in ~/.claude/skills/<name>/SKILL.md: ${names('skill')}`,
        `- Commands (${of('command').length}), in ~/.claude/commands/<name>.md: ${names('command')}`,
        'Read an item\'s frontmatter `description` before using it, and PREFER one over improvising:',
        'a skill carries the steps, the flags and the traps for that job. When a task matches one, say',
        'which you are following. The user can name them in the chat with "@<agent-or-skill>" and',
        '"/<command-or-skill>", and those refer to exactly these.',
        // Several names exist as BOTH an agent and a skill, and they are not the same thing.
        // Guessing wrong means doing a whole job with the recording steps, or the reverse.
        'Some names exist as BOTH an agent and a skill. They are not interchangeable: the agent drives',
        'the whole job, the skill carries the steps for one part of it. The user may write the kind to',
        'be explicit — @name (agent), @"name (agent)" and @name are all the same reference — and when',
        'a name is ambiguous and unqualified, say which one you are using before you start.',
        // A prompt naming three items and four folders is normal here, and the assistant has to
        // understand that the folders are not one workspace.
        'A REQUEST MAY CROSS WORKSPACES, and usually does: work in one folder, read a document from',
        `${ROOT}/docs, save output into ${ROOT}/videos, open a project in ${ROOT}/test. Each folder is a`,
        'workspace with its own AGENTS.md and its own rules; follow the rules of the folder each step',
        'happens in, not only those of the page the question was asked from. When several items are',
        'named in one message, use each for the part it covers and say which is doing what.',
      ].join('\n');
    })(),
    // THE WORK DOCUMENTS. The tooling's own rules live in files, not in this prompt, and they
    // are the difference between a correct command and a plausible one — AGENTS.md is where a
    // folder states its hard rules, and a project's CLAUDE.md is written by graphify.
    (() => {
      const lines = ['THE WORK DOCUMENTS — read the ones that cover what you are asked, before acting:',
        `- ${ROOT}/CLAUDE.md — how the whole tooling fits together, and the hard rules (DDEV only, and the rest).`,
        `- ${ROOT}/<workspace>/AGENTS.md — that folder explained to an agent: its commands, its rules, which`,
        '  agents and skills apply there. README.md beside it is the same folder for a person.',
        `- ${ROOT}/docs/ — the shared documents workspace (guides, datasheets, decks, PDFs).`,
        `- ${ROOT}/worklogs/ — dated session worklogs: what changed, what was learned, what was left unverified.`,
        `- ${ROOT}/specs/ — specifications for work in progress.`];
      if (ctxWs) {
        const wsDir = path.join(ROOT, ctxWs);
        const has = ['AGENTS.md', 'README.md', 'CLAUDE.md'].filter((n) => fs.existsSync(path.join(wsDir, n)));
        if (has.length) lines.push(`This page's workspace carries: ${has.map((n) => `${wsDir}/${n}`).join(', ')}. Read its AGENTS.md before running its commands.`);
      }
      if (ctxWs && ctxProj) {
        const pDir = path.join(ROOT, ctxWs, ctxProj);
        const has = ['CLAUDE.md', 'AGENTS.md', 'README.md'].filter((n) => fs.existsSync(path.join(pDir, n)));
        if (has.length) lines.push(`The project itself carries: ${has.map((n) => `${pDir}/${n}`).join(', ')} — a project's own rules win over the general ones.`);
      }
      return lines.join('\n');
    })(),
    'How to act:',
    `- Inspect: ls ${ROOT}/<workspace> ; ddev list ; each builder script has a "# workspace-name:" header naming what it builds.`,
    `- Build a new project: cd ${ROOT}/<workspace> && bash cmd-<...>-project.sh <project_name> --install`,
    // ONE ddev start at a time — and it is no longer this prompt's job to remember.
    // `ddev` on PATH in this container is core/scripts/ddev-shim/ddev, which takes the
    // router lock for start/stop/restart/poweroff/delete and passes everything else
    // straight through. The rule used to live here as "always write flock … ddev start",
    // which held only as well as the model followed it and said nothing to a cmd-*.sh
    // script or a person in a terminal.
    `- Start/stop an existing project: cd ${ROOT}/<workspace>/<project> && ddev start -y (or ddev stop -y)`,
    '  These are SERIALISED for you: the workspace ships a ddev wrapper that holds a lock for',
    '  start, stop, restart, poweroff and delete, because each one recreates the ONE shared',
    '  ddev-router and two at a time can destroy it — taking every workspace URL down at once.',
    '  So run them one after another and never in parallel or in a background subshell; if one',
    '  seems to pause before starting, it is queued behind another and will say so.',
    `- Backup: run the folder's cmd-tool*-backup-*.sh <project_name> from inside ${ROOT}/<workspace>.`,
    `- Create/edit AI agents, skills, prompts, docs: write markdown files with Bash redirection — agents: ${ROOT}/agents/<name>.md (YAML frontmatter: name, description, tools), skills: ${ROOT}/skills/<name>/SKILL.md, prompts: ${ROOT}/prompts/<name>.md, docs: ${ROOT}/docs/<name>.md. Install into Claude Code by copying: agents → ~/.claude/agents/, skills → ~/.claude/skills/<name>/, prompts → ~/.claude/commands/.`,
    `- Docs tooling: render PDF with: pandoc <doc>.md -o <doc>.pdf --pdf-engine=weasyprint ; render HTML with: pandoc <doc>.md -o <doc>.html --standalone ; capture a site screenshot with: chromium --headless --no-sandbox --window-size=1440,1200 --screenshot=${ROOT}/docs/<name>.png <url>`,
    `- LONG WORK BELONGS IN A SCREEN SESSION. Anything that outlives one command — a build, an install,`,
    `  a suite, a sync, a Claude Code run — starts detached so it survives dashboard restarts and the user`,
    `  can watch it: cd ${ROOT}/<workspace> && bash cmd-tools-screen.sh <session-name> --run "<command>".`,
    '  Session names are lowercase and may hold digits, - _ . — name them for the work (build-webship11-demo2,',
    '  suite-browser, upsun-pull-website_starter). The output lands in both the session window and',
    `  ${ROOT}/.screens/<session>.log. List them with \`screen -ls\` or bash cmd-tools-screen.sh --list;`,
    '  follow one with --follow; stop one with --stop.',
    '- The Screens page (/screens) is where the user manages them: it starts a new session in any workspace',
    '  folder or project (a shell, the Claude Code CLI, or a command), opens a REAL interactive terminal in',
    '  the browser for any session, follows its log, detaches other clients, sends Ctrl-C, kills it, and wipes',
    '  dead ones. After starting something long, say the session name and end with NAVIGATE:/screens so the',
    '  user lands where it can be watched.',
    '- NEVER delete or remove anything unless the user explicitly asked for that in this exact message.',
    // The other half of that rule. Not deleting unasked must not become leaving debris behind: a
    // scratch site built to check something costs a database volume, a snapshots volume and two
    // per-project images, none of which go when the folder does. So the assistant names what it made
    // and OFFERS to remove it — the deciding stays with the person, the remembering does not.
    '- CLEAN UP AFTER YOUR OWN WORK, BY ASKING. When you built a project or wrote files just to check',
    '  something and the goal is met, say plainly what you created and offer to remove it. Do not delete',
    '  it yourself, and do not leave it unmentioned. To remove a project use the workspace command —',
    '  `bash cmd-tools-remove.sh <project>` from its workspace folder, or `ddev delete -y -O` inside it.',
    '  Deleting the folder alone leaves the DDEV registry entry, the database and snapshots volumes and',
    '  the per-project built images behind, invisible until the disk is full.',
    'After acting, end your reply with directives, each alone on its own line, so the interface can react:',
    'NAVIGATE:/<workspace>   (go to that workspace page, e.g. NAVIGATE:/dev — or its backups page: NAVIGATE:/dev/backups; NAVIGATE:/screens for the screen sessions)',
    'OPEN:<https url>        (open a site in a new tab, e.g. after ddev start)',
    'REFRESH                 (refresh the visible project list)',
    'PROMPT MODE. The mode selector lists only the commands of the workspace the user is on (every',
    'workspace on the home page), so a command they pick is always one that belongs here. When you',
    'suggest something yourself, suggest it from THIS workspace and name what is actually in it — real',
    'project names, real builder scripts, real items from the page context above. Never offer a generic',
    'example ("build a site", "back up a project") or invent a project that is not listed.',
    'When the user picked a command it arrives as',
    '"Run <script> in <workspace>: ..." — they chose it, so carry it out.',
    'When they did NOT pick one (Auto mode — anything that does not start with "Run <script> in"),',
    'you decide what to run, but PROPOSE BEFORE ACTING for anything that builds, installs, removes,',
    'restores, deploys or otherwise changes state:',
    '  1. One line on what you will do and why that command.',
    '  2. The exact command on its own line, in a ```bash block — the real cmd-*.sh with its arguments.',
    '  3. End with the line: PLAN:<workspace>|<one-line summary>',
    'The interface turns that last line into a confirm card offering "Run it", "Keep prompting" and',
    'a link to the target workspace, so do not run the command in that same turn — wait for the',
    'user to confirm. Read-only questions (status, what exists, logs) need no plan: just answer.',
    'Keep replies short and factual; report real command results, never invented ones.',
    `YOUR MEMORY. The team teaches you this workspace, and you keep what they teach in ${memoryDir}/MEMORY.md.`,
    'Read it at the start of a conversation (cat it, if it exists) and use it. When someone teaches you something worth',
    'keeping (a habit of this team, what a project is for, who works on what, an explanation that worked), or you find',
    'it in the workspace yourself, append one dated line under its heading with Bash, for example:',
    `printf '%s\\n' "- 2026-10-25: test/ holds a fresh site per ticket for QA." >> ${memoryDir}/MEMORY.md`,
    'Headings: # Team, # Workspace, # Projects, # Hard parts. One line per fact; update a line rather than repeat it. Never',
    'write a password, key, token, a client\'s confidential detail, or anything someone asked you to forget. Writing to',
    'your memory is the one change you may make without asking.',
    ...(avatar ? [
      `YOUR AVATAR IS SHOWN: ${shownAs === 'Druplicon' ? 'Druplicon, a friendly cartoon Drupal drop,' : `${shownAs}, the character the person picked,`} stands in your panel (or floats on the page) and`,
      'acts out what you write. You talk with a development team: developers, testers, designers, site builders, managers.',
      `- Moves: put a tag in square brackets where it fits, at most one per sentence and two or three per reply: ${moves.map((g) => `[${g}]`).join(' ')}.`,
      `  Big moves, where it travels the page (at most one per reply, for a real moment, not every reply): ${Object.entries(AVATAR_BIG_MOVES).map(([m, what]) => `[${m}] ${what}`).join(', ')}.`,
      ...(Object.keys(moveSet).length ? [`  This avatar's own: ${Object.entries(moveSet).map(([m, what]) => `[${m}] ${what}`).join(', ')}.`] : []),
      '  [wave]/[bye] hello and goodbye, [nod] yes, [think] a hard question, [idea] the answer, [explain] while you walk',
      '  through something, [point] at what you mean, [thumbsup] or [clap] when something works, [cheer] for a release,',
      '  [shrug] when nobody can know, [look] while you check, [crossarms] while a long job runs. Never refer to the tags.',
      'Lines of their own the page acts on (use them when they help; the person sees the result, not the line):',
      '  BOARD: <short text>     writes a line on the board beside the avatar (a step, a command name, a heading); BOARD: clear wipes it;',
      '                          BOARD: note <text> pins a sticky note on it (a reminder, a decision, a to-do the person can edit).',
      '  DRAW: <shape> ...       draws on the board, on a 100 x 60 grid, one shape per line, drawn stroke by stroke:',
      '                          DRAW: box x y w h <label>   DRAW: circle x y r <label>   DRAW: arrow x1 y1 x2 y2',
      '                          DRAW: line x1 y1 x2 y2      DRAW: text x y <words>       (labels are a few words; no quotes needed)',
      '                          DRAW: ellipse x y rx ry     DRAW: curve x1 y1 x2 y2 x3 y3 ...   (a smooth line through the points)',
      '                          DRAW: poly x1 y1 x2 y2 ...  DRAW: polygon x1 y1 ... (closed)',
      '                          Any shape takes color=, fill=, width=, opacity= and dash: colours ink blue sky teal green amber',
      '                          coral pink purple grey black white (or #hex). Draw like an artist: thin lines (width=0.2 to 0.4),',
      '                          a few colours that go together, soft fills (opacity=0.3), curves for organic shapes, layers.',
      '                          A flow: boxes with labels and arrows between them, each step its own colour.',
      '  SHOW: <youtube link>    plays that video in a window beside the avatar. Only a real video you are sure exists.',
      '  VIDEO: play | pause | forward [seconds] | back [seconds] | seek m:ss | louder | quieter | volume <0-100> | mute |',
      '         unmute | speed <0.25-2> | restart | loop | close      controls the latest video, as a person would.',
      '  BROWSE: <https link>    opens that page in a reading window beside the avatar (documentation, an issue, a README).',
      '  SEARCH: <words>         searches the web in that reading window; then open the best result with BROWSE:.',
      '  BROWSE: back | forward | reload | down | up | top | bottom | zoomin | zoomout | read | newtab | close',
      '  BROWSE: find <words> | click <the words of a link>   drive that window as a person would, one command per line.',
      '  When the browser is open, each message tells you its title, address, how far down it is, the text in view and',
      '  its links: read from that, scroll on with BROWSE: down, and click on with BROWSE: click <link words>.',
      `  MOVE: ${AVATAR_PLACES.join(' | ')}   moves the avatar across the page (home is beside your text box, where it lives), or back into the panel.`,
      `  SIZE: ${AVATAR_SIZES.join(' | ')}   makes the avatar that size: huge to show something off or when asked to be bigger, back to medium after.`,
    ] : []),
    ...(voice ? [
      'VOICE IS ON: the user hears a spoken summary instead of reading the reply aloud. As the very last',
      'line of every reply, write SUMMARY: followed by one or two short plain sentences saying what you',
      'did or found. No code, paths, URLs, markdown or lists, and no more than about 40 words.',
    ] : []),
  ].join('\n');

  // The conversation continues rather than starting over. A thread carries claude's own session id:
  // the first turn names it (--session-id, a uuid we chose), every later turn resumes it (--resume),
  // and the agent keeps what was already said and done. Without this the transcript the page draws
  // is in front of an agent that remembers none of it, which reads as memory and is not.
  //
  // --no-session-persistence is therefore gone: it is the flag that threw the session away.
  const sessionId = (thread && thread.sessionId) || null;
  const wanted = sessionId || crypto.randomUUID();
  // What the avatar's browser shows, when it is open: read from it rather than guessing.
  const p = page && typeof page === 'object' ? page : null;
  if (avatar && p && typeof p.url === 'string') {
    const clean = (v, n) => String(v || '').replace(/[\u0000-\u001f]/g, ' ').slice(0, n);
    message = `${message}\n\n[The browser window, right now. The user did not write this part.]\n`
      + `Page: ${clean(p.title, 140)} (${clean(p.url, 300)}), ${Number(p.scrolled) || 0}% down.\n`
      + `In view: ${clean(p.text, 1500)}\n`
      + `Links you can click: ${(Array.isArray(p.links) ? p.links : []).slice(0, 30).map((l) => `«${clean(l, 60)}»`).join(', ')}`;
  }
  const baseArgs = [
    '-p', message,
    '--output-format', 'json',
    '--append-system-prompt', system,
    '--allowedTools', 'Bash', 'Read', 'Glob', 'Grep', 'Skill',
    '--disallowedTools', 'Write', 'Edit', 'NotebookEdit', 'WebFetch', 'Agent',
  ];
  // The agent it runs as (settings.yml assistant.agent, `webship-workspace` by default): that agent's rules
  // and skills, on top of everything above. Only when the agent is installed for this user.
  // An avatar may bring an agent of its own (settings.yml assistant.avatar_agents), while it is shown.
  const agentName = (avatar && cast.agentOf(loadSettings(), String(avatarId || ''))) || require('./speech').assistantSettings(loadSettings()).agent;
  if (agentName && fs.existsSync(path.join(process.env.HOME || '', '.claude', 'agents', `${agentName}.md`))) baseArgs.push('--agent', agentName);
  const withSession = (id, resume) => [...baseArgs, ...(resume ? ['--resume', id] : ['--session-id', id])];

  let result = await run('claude', withSession(wanted, Boolean(sessionId)), ROOT, { timeoutMs: 15 * 60 * 1000 });
  // A session can be gone — pruned, or written by another machine — and the ask still has to be
  // answered. Start a fresh one rather than reporting the conversation as broken, and say nothing:
  // what the user asked for is the answer, not the bookkeeping.
  if (sessionId && result.code !== 0) {
    result = await run('claude', withSession(crypto.randomUUID(), false), ROOT, { timeoutMs: 15 * 60 * 1000 });
  }
  let newSessionId = null;
  let reply = result.stdout.trim();
  try {
    const parsed = JSON.parse(result.stdout);
    reply = parsed.result || parsed.response || reply;
    // What to resume next time, read back from the run rather than assumed: a resumed session can
    // answer under a different id (a fork), and resuming the one we asked for would lose the turn.
    if (parsed.session_id) newSessionId = String(parsed.session_id);
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
    // The agent's proposal in Auto mode: keep the workspace and summary,
    // render them as a confirm card rather than leaving a bare marker.
    const plan = line.match(/^\s*PLAN:([a-z0-9_-]+)\|(.+)$/);
    if (plan && isValidWorkspace(plan[1])) { directive.plan = { workspace: plan[1], summary: plan[2].trim() }; return false; }
    if (/^\s*REFRESH\s*$/.test(line)) { directive.refresh = true; return false; }
    // The avatar's lines (only acted on while the avatar is shown, but always taken out of the text).
    const board = line.match(/^\s*BOARD:\s*(.+)$/);
    if (board) { (directive.board = directive.board || []).push(board[1].trim().slice(0, 120)); return false; }
    const draw = line.match(/^\s*DRAW:\s*(.+)$/);
    if (draw) { const d = directive.draw = directive.draw || []; if (d.length < 200) d.push(draw[1].trim().slice(0, 160)); return false; }
    const show = line.match(/^\s*SHOW:\s*(https:\/\/\S+)\s*$/);
    if (show) { const id = youtubeId(show[1]); if (id) directive.show = { video: id }; return false; }
    const browse = line.match(/^\s*BROWSE:\s*(https:\/\/\S+)\s*$/);
    if (browse) { directive.browse = browse[1].slice(0, 2000); return false; }
    const browseCmd = line.match(/^\s*BROWSE:\s*(back|forward|reload|close|newtab|zoomin|zoomout|read|down|up|top|bottom|(?:find|click)\s+.{1,80})\s*$/i);
    if (browseCmd) { const c = directive.browseCommands = directive.browseCommands || []; if (c.length < 10) c.push(browseCmd[1]); return false; }
    const search = line.match(/^\s*SEARCH:\s*(.+)$/);
    if (search) { directive.search = search[1].trim().slice(0, 160); return false; }
    const videoCmd = line.match(/^\s*VIDEO:\s*(play|pause|mute|unmute|louder|quieter|restart|loop|close|(?:forward|back|volume|speed)(?:\s+[\d.]+)?|seek\s+\d{1,2}(?::\d{1,2}){0,2})\s*$/i);
    if (videoCmd) { const c = directive.videoCommands = directive.videoCommands || []; if (c.length < 6) c.push(videoCmd[1]); return false; }
    const move = line.match(/^\s*MOVE:\s*([a-z]+)\s*$/);
    if (move) { if (AVATAR_PLACES.includes(move[1])) directive.move = move[1]; return false; }
    const size = line.match(/^\s*SIZE:\s*([a-z]+)\s*$/);
    if (size) { if (AVATAR_SIZES.includes(size[1])) directive.size = size[1]; return false; }
    const spoken = line.match(/^\s*SUMMARY:\s*(.+)$/);
    if (spoken) { directive.spoken = spoken[1].replace(/[`*_#>|~]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300); return false; }
    return true;
  }).join('\n').trim();
  // [wave], [nod] … : the avatar's moves, in the order written; never left in the text.
  const gestures = [];
  reply = reply.replace(/\s?\[([a-z]+)\]/g, (m, g) => {
    if (!moves.includes(g)) return m;
    if (gestures.length < 6) gestures.push(g);
    return '';
  });
  if (gestures.length) directive.gestures = gestures;
  if (directive.spoken) directive.spoken = directive.spoken.replace(/\[[a-z]+\]/g, '').replace(/\s+/g, ' ').trim();
  let replyHtml = `<p>${esc(reply)}</p>`;
  // Rendered after the reply body when the agent proposed a plan.
  const planHtml = directive.plan ? `
    <div class="plan-card">
      <p class="plan-summary"><span uk-icon="icon: bolt; ratio: .8"></span> ${esc(directive.plan.summary)}</p>
      <div class="plan-actions">
        <button class="uk-button uk-button-primary uk-button-small plan-run" type="button">Run it</button>
        <button class="uk-button uk-button-default uk-button-small plan-keep" type="button">Keep prompting</button>
        <a class="uk-button uk-button-default uk-button-small" href="${esc(wsUrl(directive.plan.workspace))}">Go to ${esc(directive.plan.workspace)}</a>
      </div>
    </div>` : '';
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

  return { replyHtml: `${replyHtml}${planHtml}`, directive, sessionId: newSessionId };
}

module.exports = { assistantReply, pageContextFor, youtubeId, AVATAR_GESTURES, AVATAR_MOVE_SETS, AVATAR_BIG_MOVES };
