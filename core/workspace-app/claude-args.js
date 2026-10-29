/**
 * The Claude Code CLI's own arguments, read from `claude --help`.
 *
 * The New screen form used to offer a permission-mode select and one free-text box labelled "more
 * claude options" — which means knowing the flags by heart, and typing them without a single check
 * until the screen either starts or dies. The CLI already documents every one of them, so this parses
 * what it prints rather than keeping a hand-written list that drifts the next time it gains a flag.
 *
 * Two things fall out of that:
 *
 *   - every option is offered with the control its own shape asks for — a checkbox for a flag, a select
 *     for one with `(choices: …)`, a field for one that takes a value;
 *   - a value is checked against that shape before it reaches a shell line, instead of a charset test
 *     over one long string.
 *
 * **Not every flag belongs on a screen.** A screen is an interactive terminal in a directory — that is
 * the whole point of starting one — so the flags that only work with `--print`, the ones that start the
 * session somewhere else (the cloud, the background, a remote control), and the ones this form already
 * asks about itself (the resume row, the prompt field) are held back, each with the reason. Everything
 * else is offered, including flags that did not exist when this was written.
 */

const { execFile } = require('child_process');

/* ------------------------------------------------------------------ *
 * Parsing `claude --help`
 * ------------------------------------------------------------------ */

/**
 * One option of the Options: block. The flag line is `  -p, --print`, `  --add-dir <directories...>`,
 * `  --autocompact <auto|tokens>` or `  --cloud [description|session_id|url]`, and its description runs
 * on until the next one — wrapped, and sometimes starting on the line below when the flags are long.
 */
function parseOptions(help) {
  const body = help.slice(help.indexOf('\nOptions:'));
  const end = body.indexOf('\nCommands:');
  const lines = (end < 0 ? body : body.slice(0, end)).split('\n').slice(1);

  const out = [];
  let current = null;
  for (const line of lines) {
    const start = line.match(/^ {2}(-[^\s].*)$/);
    if (start) {
      if (current) out.push(current);
      // Two columns: the flags, then a run of 2+ spaces, then the description — which wraps, and which
      // starts on the NEXT line when the flags are too long for the column. Splitting on the first wide
      // gap is what tells the two apart; without it the description was read as part of the flag name.
      const both = start[1].match(/^(.*?)(?:\s{2,}(.*))?$/);
      current = { spec: both[1].trim(), text: (both[2] || '').trim() };
      continue;
    }
    if (!current) continue;
    const cont = line.match(/^ {4,}(\S.*)$/);
    if (cont) current.text += `${current.text ? ' ' : ''}${cont[1].trim()}`;
  }
  if (current) out.push(current);

  return out.map(shape).filter(Boolean);
}

/**
 * A raw entry as something to render and to check. The flags and the value come off the front of the
 * spec; anything left on it is the first line of a wrapped description.
 */
function shape({ spec, text }) {
  // The value is the LAST bracketed group of the flag part: `--allowedTools, --allowed-tools <tools...>`.
  const m = spec.match(/^([^<[]+?)(?:\s+([<[][^\])>]*[\])>]))?\s*$/);
  if (!m) return null;
  const flagPart = m[1].trim().replace(/,$/, '');
  const arg = m[2] || '';
  const flags = flagPart.split(/,\s*/).map((f) => f.trim()).filter((f) => /^--?[A-Za-z]/.test(f));
  if (!flags.length) return null;
  const name = flags.filter((f) => f.startsWith('--')).pop() || flags[0];

  const description = text.replace(/\s+/g, ' ').trim();
  // Only what the CLI calls a CHOICE is one. `<auto|tokens>` in the flag line is a hint at the shape of
  // the value ("auto, or 100k-1M tokens"), and rendering that as a select would refuse 200k. The
  // parenthesis also carries `default:` and `preset:` inside the same list, which are not choices.
  const choices = (description.match(/\(choices: ([^)]*)\)/) || [])[1];

  return {
    name,
    flags,
    // `<x>` needs a value, `[x]` may take one, neither is a plain flag. `...` means it repeats.
    takes: arg.startsWith('<') ? 'required' : arg.startsWith('[') ? 'optional' : 'none',
    repeatable: arg.includes('...'),
    placeholder: arg.replace(/^[<[]|[\])>]$/g, '').replace(/\.\.\.$/, ''),
    choices: choices
      ? choices.split(',').map((c) => c.trim()).filter((c) => c && !c.includes(':'))
        .map((c) => c.replace(/^"|"$/g, ''))
      // Some options enumerate their values in PROSE rather than in the `(choices: …)` the help
      // generator emits — `--effort <level>  Effort level for the current session (low, medium, high,
      // xhigh, max)`. That is a closed list said in a sentence, and reading it is better than leaving
      // a field where five known answers have to be typed from memory. Bare lowercase words only, and
      // three or more of them: `(default: sonnet)` and `(e.g. 'fable', 'opus')` do not match, and
      // neither does the `<auto|tokens>` shape hint the comment above warns about.
      : (((description.match(/\((([a-z][a-z0-9-]*)(, [a-z][a-z0-9-]*){2,})\)/) || [])[1] || '')
        .split(',').map((c) => c.trim()).filter(Boolean)),
    default: (description.match(/\(default: ([^),]*)\)/) || [])[1] || '',
    // What the help NAMES as examples, which is not the same as the whole set. `--model` says "an alias
    // for the latest model (e.g. 'fable', 'opus', or 'sonnet') or a model's full name (e.g.
    // 'claude-fable-5')" — so those are worth offering, and typing another one has to stay possible.
    // A closed select here would refuse every model released after this help text was read.
    suggestions: [...description.matchAll(/'([a-z][a-z0-9.-]{1,40})'/g)].map((m) => m[1]),
    description,
  };
}

/**
 * The agents `--agent` can actually resolve on this machine.
 *
 * Read from the files rather than from a list kept here: the CLI dispatches on the frontmatter `name`,
 * which is what a file may have been cloned and renamed to, so the name in the file wins over the name
 * of the file. A project's own `.claude/agents` counts too, which is why the directory is a parameter.
 *
 * Suggestions, not a closed list: an agent can also come from a plugin or a directory this does not
 * know about, and refusing a name the CLI would have accepted is worse than offering an incomplete list.
 */
function installedAgents(projectDir) {
  const fs = require('fs');
  const path = require('path');
  const homes = [path.join(process.env.HOME || '', '.claude', 'agents')];
  if (projectDir) homes.push(path.join(projectDir, '.claude', 'agents'));
  const names = new Set();
  for (const dir of homes) {
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.md')); } catch (_) { continue; }
    for (const f of files) {
      let head = '';
      try { head = fs.readFileSync(path.join(dir, f), 'utf8').slice(0, 800); } catch (_) { continue; }
      // An agent is a file with FRONTMATTER naming it — that is what the CLI dispatches on, and it is
      // also what tells an agent apart from the prose that lives in the same folder: RULES.md there is
      // the standing working rules, not something `--agent RULES` could ever resolve. Blocklisting the
      // names of the docs would work until somebody added another one.
      if (!/^---\s*$/m.test(head.split('\n')[0] || '')) continue;
      const m = head.match(/^name:\s*["']?([a-zA-Z0-9][a-zA-Z0-9_-]{0,60})["']?\s*$/m);
      if (!m) continue;
      names.add(m[1]);
    }
  }
  return [...names].sort();
}

/* ------------------------------------------------------------------ *
 * What belongs on a screen
 * ------------------------------------------------------------------ */

/**
 * Held back, each with the reason it is not offered. Stated rather than filtered by a clever rule: a
 * person reading this should be able to see why a flag they know is missing, and disagree with it.
 */
const WITHHELD = {
  '--help': 'prints the help and exits',
  '--version': 'prints the version and exits',
  '--print': 'a screen IS the interactive session; --print exits as soon as it has answered',
  '--resume': 'the Resume row above asks this, and checks the id against the sessions that directory has',
  '--continue': 'takes the most recent session for the directory, which after a day of parallel work is often not the one meant — resume by id instead',
  '--from-pr': 'opens its own picker over the session this form is starting',
  '--session-id': 'a new session gets its own id; naming one that exists resumes it, which the Resume row does',
  '--background': 'returns immediately, so the screen would hold nothing',
  '--bg': 'returns immediately, so the screen would hold nothing',
  '--cloud': 'runs the session somewhere else, so a screen on this machine is not where it is',
  '--environment': 'belongs to a cloud session',
  '--teleport': 'resumes a teleport session rather than starting one here',
  '--remote-control': 'a screen is already the way back to this session, through screen -r',
  '--remote-control-session-name-prefix': 'belongs to Remote Control',
  '--tmux': 'a tmux inside a screen is two multiplexers over one session',
  '--ide': 'connects to an IDE on this machine, which a detached session has no window in',
  '--chrome': 'drives a browser on the desktop, which a detached session cannot show',
  '--no-chrome': 'the integration is off unless --chrome asks for it',
  '--file': 'downloads resources by id, which belongs to a hosted session',
  '--permission-prompts': 'answers prompts for --print; on a screen a person is sitting in front of it',
  '--json-schema': 'validates structured output, which needs --print to have any output to validate',
};

/** Only works when the CLI is printing rather than running a session. */
const PRINT_ONLY = /only works with (--print|--input-format|--output-format)|\(only works with --print\)/i;

function usableOnAScreen(opt) {
  if (WITHHELD[opt.name]) return false;
  if (opt.flags.some((f) => WITHHELD[f])) return false;
  return !PRINT_ONLY.test(opt.description);
}

/* ------------------------------------------------------------------ *
 * Reading it, once
 * ------------------------------------------------------------------ */

// The help text changes only when the CLI is updated, and the form is drawn on every modal open — so it
// is read once and kept. A failure is kept too, briefly: a machine with no claude on PATH must not shell
// out on every keystroke to be told so again.
let memo = { at: 0, options: null, error: '' };
const TTL = 10 * 60 * 1000;
const FAIL_TTL = 30 * 1000;

function helpText() {
  return new Promise((resolve) => {
    execFile('claude', ['--help'], { timeout: 15000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      // Commander prints its help on stdout; a version that uses stderr is still the help.
      const text = `${stdout || ''}${stderr || ''}`;
      if (text.includes('\nOptions:')) return resolve({ text });
      resolve({ error: (err && err.message) || 'claude --help printed no options' });
    });
  });
}

/** Every option a screen can be started with, newest help text, cached. */
async function claudeOptions() {
  const now = Date.now();
  const ttl = memo.error ? FAIL_TTL : TTL;
  if (memo.options && now - memo.at < ttl) return memo;
  const { text, error } = await helpText();
  memo = error
    ? { at: now, options: [], error }
    : { at: now, options: parseOptions(text).filter(usableOnAScreen), error: '' };
  return memo;
}

/** Forget what was read — for a test, and for a machine that has just updated the CLI. */
function forget() { memo = { at: 0, options: null, error: '' }; }

/* ------------------------------------------------------------------ *
 * How the form shows them
 * ------------------------------------------------------------------ */

/**
 * The handful that are asked about every time, in the order someone reaches for them. Everything else is
 * behind "All options", so the form opens as four controls rather than fifty.
 */
const COMMON = ['--model', '--permission-mode', '--effort', '--agent'];

/** A field name that cannot collide with the form's own: `--add-dir` posts as `arg_add_dir`. */
const fieldName = (name) => `arg_${name.replace(/^--/, '').replace(/[^A-Za-z0-9]+/g, '_')}`;

/** The option a posted field name belongs to. */
function optionFor(options, field) {
  return options.find((o) => fieldName(o.name) === field) || null;
}

/**
 * A value on its way to a shell line. The line is handed to an outer shell, so a value may hold no
 * quote, no backtick, no `$` and no newline — the same rule every command in this dashboard follows.
 * A value that breaks it is REFUSED by name rather than dropped, because a flag that silently did
 * nothing is worse than one that says why.
 */
const SAFE_VALUE = /^[A-Za-z0-9 @=+.,:/_-]*$/;

/**
 * The flags one submitted form asks for, as an array of shell words, or an error naming the field.
 * Every flag has to be one the CLI printed, and every value has to fit the shape that flag documented.
 */
function flagsFromForm(options, form) {
  const words = [];
  const problems = [];
  for (const opt of options) {
    const raw = form[fieldName(opt.name)];
    if (raw === undefined) continue;
    const value = String(Array.isArray(raw) ? raw[raw.length - 1] : raw).trim();
    if (!value) continue;
    if (opt.takes === 'none') {
      // A checkbox posts its value only when it is ticked.
      words.push(opt.name);
      continue;
    }
    if (opt.choices.length && !opt.choices.includes(value)) {
      problems.push(`${opt.name} does not take “${value}”`);
      continue;
    }
    if (!SAFE_VALUE.test(value)) {
      problems.push(`${opt.name} may hold only letters, digits and @ = + . , : / _ -`);
      continue;
    }
    words.push(opt.name, ...(opt.repeatable ? value.split(/\s+/) : [value]));
  }
  return { words, problems };
}

module.exports = {
  installedAgents,
  parseOptions, shape, usableOnAScreen, WITHHELD, PRINT_ONLY, COMMON,
  claudeOptions, forget, fieldName, optionFor, flagsFromForm, SAFE_VALUE,
};
