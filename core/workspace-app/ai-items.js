/**
 * The AI-items domain: agents, skills and prompts, in their three places —
 * this workspace's folders (drafts), ~/.claude (what a session loads) and the
 * shared repo (what the team has) — plus the git-blob comparison that says
 * when the repo's copy differs from the folder's. The handlers live in
 * actions/ai-items.js; the rendering in server.js imports the same primitives,
 * so the buttons and the CLI can never disagree about where things are.
 */

const fs = require('fs');
const path = require('path');

const { loadWorkspaces, workspaceDir, sourceOf } = require('./workspaces');
const { repoTree, invalidateRepoTree, gitBlobSha } = require('./repo-blobs');

/* ---------------- file-item workspaces (agents, skills, prompts, docs) --- */

// Where each editable kind installs into the live Claude Code CLI setup.
const INSTALL_TARGETS = {
  'ai-agents': path.join(process.env.HOME, '.claude', 'agents'),
  'ai-skills': path.join(process.env.HOME, '.claude', 'skills'),
  // Commands and prompts are two kinds that share one destination: a command is a
  // $ARGUMENTS spec typed mid-session, a prompt is a whole `claude …` launch command
  // for a new session. Installing one writes over the other where names collide.
  'ai-commands': path.join(process.env.HOME, '.claude', 'commands'),
  'ai-prompts': path.join(process.env.HOME, '.claude', 'commands'),
};

// Agents, skills and prompts exist in three places: this workspace folder
// (drafts), ~/.claude (what a session loads) and Vardot/dev-ai-agents (what
// the team has). The item lists show all three, merged by name, so it is
// obvious what is only local, only installed, or only in the repo.
const AI_ITEMS_REPO = () => process.env.WEBSHIP_AI_ITEMS_REPO || sourceOf('ai_items', 'repo', 'Vardot/dev-ai-agents');
const AI_ITEMS_REF = () => process.env.WEBSHIP_AI_ITEMS_REF || sourceOf('ai_items', 'ref', 'main');
// A prompt is the whole `claude …` launch command for a NEW session, so the only way
// to use one is to start a session with it — the dashboard's New screen form, or the
// CLI by hand. It is not a slash command, so nothing of a prompt's syncs into ~/.claude
// or a project's .claude/. It keeps its INSTALL_TARGETS entry only so listClaudeItems
// can still SHOW what a machine already has there.
// AI Commands is the kind that DOES install: same destination, different shape.
const NO_CLAUDE_SYNC = new Set(['ai-prompts']);

// Where each kind sits IN THE REPO. Prompts are the one kind whose directory name
// differs from the CLI's: Vardot/dev-ai-agents keeps them at the top level, in
// prompts/, beside the agents and skills they invoke.
const AI_ITEMS_REPO_PATHS = { 'ai-agents': '.claude/agents', 'ai-skills': '.claude/skills',
  'ai-commands': '.claude/commands', 'ai-prompts': 'prompts' };
// Where each kind installs INSIDE A PROJECT — always the project's own .claude/,
// which is what Claude Code reads there. Not the same map as above: a project's
// prompts go to .claude/commands, never to a prompts/ directory of its own.
const AI_ITEMS_PROJECT_PATHS = { 'ai-agents': '.claude/agents', 'ai-skills': '.claude/skills',
  'ai-commands': '.claude/commands', 'ai-prompts': '.claude/commands' };

// What ~/.claude currently has, by kind.
function listClaudeItems(key) {
  const dir = INSTALL_TARGETS[key];
  if (!dir) return new Set();
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    if (key === 'ai-skills') {
      return new Set(entries.filter((e) => e.isDirectory()
        && fs.existsSync(path.join(dir, e.name, 'SKILL.md'))).map((e) => e.name));
    }
    return new Set(entries.filter((e) => e.isFile() && e.name.endsWith('.md')
      && !['README.md', 'AGENTS.md', 'CLAUDE.md'].includes(e.name))
      .map((e) => e.name.replace(/\.md$/, '')));
  } catch (_) { return new Set(); }
}

// Blob shas for every shared item, grouped by name, from the ONE cached recursive
// Trees call repo-blobs makes per repo@ref — the same identity git itself uses, so
// comparing them against locally computed blob shas answers "does the repo's copy
// differ from this folder's?" without fetching a single file body. `null` means
// the repo was unreachable (an unauthenticated container), which the UI states
// rather than implying the repo has nothing.
async function repoItemBlobs(key) {
  if (!AI_ITEMS_REPO_PATHS[key]) return null;
  const tree = await repoTree(AI_ITEMS_REPO(), AI_ITEMS_REF());
  if (!tree) return null;
  const prefix = `${AI_ITEMS_REPO_PATHS[key]}/`;
  const map = new Map(); // item name -> Map<path-inside-item, blob sha>
  for (const [p, sha] of tree) {
    if (!p.startsWith(prefix)) continue;
    const rest = p.slice(prefix.length);
    let name; let inner;
    if (key === 'ai-skills') {
      const slash = rest.indexOf('/');
      if (slash < 1) continue;
      name = rest.slice(0, slash);
      inner = rest.slice(slash + 1);
    } else {
      if (!rest.endsWith('.md') || rest.includes('/')) continue;
      name = rest.slice(0, -3);
      inner = '';
    }
    if (['README', 'AGENTS', 'CLAUDE', 'RULES'].includes(name)) continue;
    if (!map.has(name)) map.set(name, new Map());
    map.get(name).set(inner, sha);
  }
  return map;
}

// The names alone — the same tree, so a page listing names AND comparing blobs
// still costs one network call, not two.
async function listRepoItems(key) {
  const blobs = await repoItemBlobs(key);
  return blobs === null ? null : new Set(blobs.keys());
}

// Does the repo's copy of one item differ from this folder's? null = not comparable
// (not in the repo, or the tree was unreachable).
function repoDiffers(key, name, repoBlobs) {
  if (!repoBlobs || !repoBlobs.has(name)) return null;
  const theirs = repoBlobs.get(name);
  const dir = workspaceDir(key);
  try {
    if (key !== 'ai-skills') {
      return theirs.get('') !== gitBlobSha(path.join(dir, `${name}.md`));
    }
    // A skill is a directory: same files with the same blob shas, or it differs.
    const base = path.join(dir, name);
    const mine = new Map();
    const walk = (d, rel) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.name === '.git') continue;
        const full = path.join(d, e.name);
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) walk(full, r);
        else if (e.isFile()) mine.set(r, gitBlobSha(full));
      }
    };
    walk(base, '');
    if (mine.size !== theirs.size) return true;
    for (const [rel, sha] of theirs) if (mine.get(rel) !== sha) return true;
    return false;
  } catch (_) {
    return null;
  }
}

const ITEM_TEMPLATES = {
  agents: (name) => `---
name: ${name}
description: Use this agent to <when to invoke it>.
tools:
  - Bash
  - Read
  - Glob
  - Grep
---

# ${name}

You are the specialist agent for <what this agent does>.

## Instructions

- <how to work>
`,
  skills: (name) => `---
name: ${name}
description: <what this skill does and when to use it>
---

# ${name}

## Instructions

- <steps the skill follows>
`,
  prompts: (name) => `<Write the reusable prompt here — installing it makes it available in Claude Code as /${name}>
`,
  docs: (name) => `# ${name}

<Write the document here — Markdown; use "Make PDF" to render a PDF next to it.>
`,
};

// The file that holds an item's content, given its display name.
function itemFile(key, name) {
  const dir = workspaceDir(key);
  if (key === 'ai-skills') return path.join(dir, name, 'SKILL.md');
  return path.join(dir, `${name}.md`);
}

// Where an install can land besides the global ~/.claude: any real project, so a session started
// under it (and only there) sees the item. Site workspaces only — a "project" in `docs/` or
// `agents/` itself would be another item, not something Claude Code scopes to.
function installTargetWorkspaces() {
  return Object.values(loadWorkspaces()).filter((w) => w.kind !== 'files');
}

// Every write toward the repo or the folders makes the cached tree stale.
function invalidateRepoCaches() {
  invalidateRepoTree(AI_ITEMS_REPO());
}

module.exports = {
  INSTALL_TARGETS, NO_CLAUDE_SYNC, AI_ITEMS_REPO, AI_ITEMS_REF, AI_ITEMS_REPO_PATHS, AI_ITEMS_PROJECT_PATHS,
  listClaudeItems, listRepoItems, repoItemBlobs, gitBlobSha, repoDiffers,
  ITEM_TEMPLATES, itemFile, installTargetWorkspaces, invalidateRepoCaches,
};
