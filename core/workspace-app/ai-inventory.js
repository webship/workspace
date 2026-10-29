/**
 * What "@" and "/" can offer, and what the AI Assistant is told it has.
 *
 * ONE inventory, read by three callers that used to disagree or not know at all:
 *
 *   - the suggestion popup in any prompt field (@ for agents and skills, / for commands),
 *   - the Ace completer on the New screen form,
 *   - the assistant's own system prompt, which never listed these at all — so it could
 *     not use a skill it had, and would improvise instead of invoking one.
 *
 * The DESCRIPTION is why this is not just a directory listing. Claude Code chooses an
 * agent or a skill by its frontmatter `description`, and a picker that shows only names
 * makes the reader guess between `webship-workspace-build` and `webship-workspace-backups`.
 * The same line is what lets the assistant pick correctly, so both read it from the file
 * rather than from a hand-kept table that would drift.
 *
 * Three places hold items, and precedence runs the same way Claude Code resolves them:
 * a project's own .claude/ wins over ~/.claude, which wins over the workspace draft
 * folders (ai-agents/, ai-skills/, ai-commands/, ai-prompts/). `where` says which, so
 * the list can show it and the assistant knows whether an item is actually installed.
 */

const fs = require('fs');
const path = require('path');

const { ROOT } = require('./workspaces');

/**
 * The workspace tooling itself: `webship-workspace` and its skills (-build, -backups,
 * -graphify, -dashboard, -authoring, -site-templates, -upsun, -linux-install).
 *
 * These are BUILT IN to the AI Assistant — it already operates this workspace, and its
 * system prompt carries these rules whether anybody names them or not. So offering them
 * in the picker is noise at best and misleading at worst: it implies that building a
 * project needs you to remember `@webship-workspace-build` first, when asking for a build
 * is enough. Nine rows out of 135, and they crowd the top of the list because they share
 * a prefix with the product's own name.
 *
 * They stay in the inventory — the assistant is still told it has them, so it can say
 * which one it is following — and are filtered out of the SUGGESTIONS only.
 */
const BUILT_IN = /^webship-workspace(-|$)/;

// Kind -> which trigger character offers it.
//
// This mirrors the CLI rather than inventing a scheme: in Claude Code a slash command is
// typed as `/name`, and an agent is named in prose. Skills appear under BOTH here on
// purpose — a skill is a capability you name (@) and also the thing you most often want
// to invoke directly (/) — and prompts under neither, because a prompt is a whole
// `claude …` launch command for a NEW session, so it cannot be dropped into a message
// that is already running. The New screen form offers those in its own template picker.
const TRIGGERS = {
  agent: ['@'],
  skill: ['@', '/'],
  command: ['/'],
};

// A frontmatter description, as one line.
//
// Read from the head of the file only: a skill can be hundreds of lines and none of the
// rest is frontmatter. The value may be folded over several lines in YAML, so a
// continuation (indented, no `key:` of its own) is joined back on.
const HEAD_BYTES = 4096;
function descriptionOf(file) {
  let head = '';
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(HEAD_BYTES);
    const read = fs.readSync(fd, buf, 0, HEAD_BYTES, 0);
    fs.closeSync(fd);
    head = buf.slice(0, read).toString('utf8');
  } catch (_) { return ''; }
  if (!/^---\s*$/m.test(head.split('\n')[0] || '')) return '';
  const lines = head.split('\n').slice(1);
  let out = '';
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^---\s*$/.test(line)) break;
    const m = line.match(/^description:\s*(.*)$/);
    if (!m) continue;
    out = m[1].trim().replace(/^["']|["']$/g, '');
    // A folded value: following lines that are indented and are not themselves a key.
    for (let j = i + 1; j < lines.length; j += 1) {
      if (/^---\s*$/.test(lines[j])) break;
      if (/^\s+\S/.test(lines[j]) && !/^\s*[a-zA-Z_-]+:/.test(lines[j])) {
        out += ` ${lines[j].trim()}`;
      } else break;
    }
    break;
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** Items of one kind in one directory. Skills are directories with a SKILL.md. */
function readKind(dir, kind, where, out) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
  for (const e of entries) {
    let name = '';
    let file = '';
    if (kind === 'skill') {
      if (!e.isDirectory()) continue;
      file = path.join(dir, e.name, 'SKILL.md');
      if (!fs.existsSync(file)) continue;
      name = e.name;
    } else {
      if (!e.isFile() || !e.name.endsWith('.md')) continue;
      // A folder's own documentation is not an item in it.
      if (['README.md', 'AGENTS.md', 'CLAUDE.md'].includes(e.name)) continue;
      name = e.name.replace(/\.md$/, '');
      file = path.join(dir, e.name);
    }
    const key = `${kind}:${name}`;
    // First writer wins, and callers add in precedence order: a project's own copy of an
    // item is the one that would actually run there, so it must not be overwritten by
    // the global one found later.
    if (out.has(key)) continue;
    out.set(key, { name, kind, where, file, description: descriptionOf(file),
      triggers: TRIGGERS[kind] || [], builtIn: BUILT_IN.test(name) });
  }
}

// The filesystem is walked per request otherwise, and a keystroke in the composer asks
// for this list. Short enough that installing a skill shows up while you are looking.
const TTL = 5000;
const _cache = new Map();

/**
 * Everything "@" and "/" can offer here.
 * @param {string} [workspace] the workspace key, when a page is scoped to one
 * @param {string} [project]   a project inside it, whose own .claude/ takes precedence
 */
function aiInventory(workspace, project) {
  const ck = `${workspace || ''}/${project || ''}`;
  const hit = _cache.get(ck);
  if (hit && Date.now() - hit.at < TTL) return hit.items;

  const home = process.env.HOME || '';
  const items = new Map();

  // Precedence, highest first.
  if (workspace && project) {
    const pDir = path.join(ROOT, workspace, project, '.claude');
    readKind(path.join(pDir, 'agents'), 'agent', 'this project', items);
    readKind(path.join(pDir, 'skills'), 'skill', 'this project', items);
    readKind(path.join(pDir, 'commands'), 'command', 'this project', items);
  }
  readKind(path.join(home, '.claude', 'agents'), 'agent', 'installed', items);
  readKind(path.join(home, '.claude', 'skills'), 'skill', 'installed', items);
  readKind(path.join(home, '.claude', 'commands'), 'command', 'installed', items);
  // The workspace drafts. Anything only here is NOT loaded by a session yet, which the
  // label has to say — otherwise a draft reads as available and silently does nothing.
  readKind(path.join(ROOT, 'ai-agents'), 'agent', 'workspace draft', items);
  readKind(path.join(ROOT, 'ai-skills'), 'skill', 'workspace draft', items);
  readKind(path.join(ROOT, 'ai-commands'), 'command', 'workspace draft', items);

  const list = [...items.values()].sort((a, b) => a.name.localeCompare(b.name));
  _cache.set(ck, { at: Date.now(), items: list });
  return list;
}

/** Just the items a trigger character offers, optionally filtered by what is typed. */
function suggestFor(trigger, typed, workspace, project) {
  const q = String(typed || '').toLowerCase();
  return aiInventory(workspace, project)
    // The assistant's own tooling is not something to pick — see BUILT_IN above.
    .filter((i) => !i.builtIn)
    .filter((i) => i.triggers.includes(trigger))
    .filter((i) => !q || i.name.toLowerCase().includes(q)
      || (i.description || '').toLowerCase().includes(q))
    .sort((a, b) => {
      // What the user is typing, first: a name that STARTS with it beats one that
      // merely contains it, and a description match comes last.
      const rank = (i) => (i.name.toLowerCase().startsWith(q) ? 0
        : i.name.toLowerCase().includes(q) ? 1 : 2)
        // then by how close to hand it is
        + (i.where === 'this project' ? 0 : i.where === 'installed' ? 0.1 : 0.2);
      return rank(a) - rank(b) || a.name.localeCompare(b.name);
    });
}

module.exports = { aiInventory, suggestFor, descriptionOf, TRIGGERS, BUILT_IN };
