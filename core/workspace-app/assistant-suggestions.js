// Suggested prompts for an empty assistant conversation, made from each workspace's own noun and
// actions. A workspace can replace them with `assistant: suggestions:`; an empty list turns them off.

const MAX_SUGGESTIONS = 5;
const MAX_LENGTH = 120;

const an = (noun) => (/^[aeiou]/i.test(noun) ? 'an' : 'a');

// null = not given (use the defaults), [] = none.
function cleanSuggestions(list) {
  if (!Array.isArray(list)) return null;
  const seen = new Set();
  const out = [];
  for (const item of list) {
    if (typeof item !== 'string') continue;
    const text = item.replace(/\s+/g, ' ').trim().slice(0, MAX_LENGTH);
    if (!text || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    out.push(text);
    if (out.length >= MAX_SUGGESTIONS) break;
  }
  return out;
}

const HOME = [
  'What can this dashboard do?',
  'Which workspaces have something running right now?',
  'Where do I start on a new machine?',
  'How do I build a new project?',
];

const SETTINGS = [
  'What can I change on this page?',
  'What does each setting here control?',
  'Which of these settings matter most on a new machine?',
];

const COMMANDS = [
  'What can I run from here?',
  'How do I add a command of my own?',
  'Which commands act on a project, and which on a whole workspace?',
];

function defaultSuggestions(context, meta) {
  const ctx = String(context || 'home');
  if (ctx === 'settings') return SETTINGS;
  if (ctx === 'commands') return COMMANDS;
  if (!meta) return HOME;

  const noun = meta.noun || 'item';
  const plural = meta.nounPlural || `${noun}s`;
  const can = (action) => !!(meta.typeActions && meta.typeActions.has && meta.typeActions.has(action));

  if (/^backups:/.test(ctx)) {
    return [
      `What backups are there for these ${plural}?`,
      `How do I restore ${an(noun)} ${noun} from a backup?`,
      `Which ${plural} have no backup yet?`,
      `How do I back up ${an(noun)} ${noun} before I change it?`,
    ];
  }

  if (meta.kind === 'files') {
    return [
      `What ${plural} are here?`,
      `Which ${plural} changed most recently?`,
      `How do I add ${an(noun)} ${noun}?`,
      `How do I edit ${an(noun)} ${noun}?`,
    ];
  }

  // Only DDEV workspaces have anything "running"; a folder of git clones does not.
  const out = can('ddev')
    ? [`What ${plural} are here, and which are running?`]
    : [`What ${plural} are here?`];
  out.push(`Which ${plural} have a screen or an agent running?`);
  if (can('build')) out.push(`How do I build a new ${noun} here?`);
  if (can('backup') && can('ddev')) out.push(`How do I back up and restore ${an(noun)} ${noun}?`);
  if (!can('ddev')) out.push(`Which ${plural} have changes that are not committed yet?`);
  if (can('tests')) out.push(`How do I run the tests on ${an(noun)} ${noun}?`);
  else if (can('clone')) out.push(`How do I clone ${an(noun)} ${noun}?`);
  return out;
}

// The workspace's own list, else settings.yml's, else the defaults.
function suggestionsFor({ context, meta, own, global }) {
  const chosen = cleanSuggestions(own) || cleanSuggestions(global);
  return (chosen || defaultSuggestions(context, meta)).slice(0, MAX_SUGGESTIONS);
}

module.exports = { suggestionsFor, defaultSuggestions, cleanSuggestions, MAX_SUGGESTIONS, MAX_LENGTH };
