/**
 * What is typed after a command in "Run a tool": split into arguments the way a shell reads quotes,
 * and nothing more of a shell than that.
 *
 * An argument is letters, numbers and ._@^~:/=,- (names, flags, versions, paths). An argument of
 * several words goes in quotes — a platform tool's --run "plugin list --status=active" is one
 * argument — and the same characters plus the space are all a quoted part may hold. Nothing here can
 * close a quote, start a second command or reach a variable: there is no $, no backtick, no ; and no \.
 */

// The characters of an argument, as the inside of a character class.
const WORD = 'a-zA-Z0-9._@^~:/=,\\-';
const WORD_RE = new RegExp(`^[${WORD}]$`);
const QUOTED_RE = new RegExp(`^[${WORD} ]*$`);

const ALLOWED = 'Arguments may hold letters, numbers, and ._@^~:/=,- only. Put an argument of several words in quotes: --run "plugin list".';
const UNCLOSED = 'A quote in the arguments is not closed.';

// The same rule for the form field (the pattern attribute of the input), so the browser says it before the request.
const ARGS_PATTERN = `(?:[a-zA-Z0-9 ._@^~:\\/=,\\-]|"[a-zA-Z0-9 ._@^~:\\/=,\\-]*"|'[a-zA-Z0-9 ._@^~:\\/=,\\-]*')*`;

/** Split the typed arguments. Answers { ok: true, argv } or { ok: false, error }. */
function splitToolArgs(raw) {
  const s = String(raw == null ? '' : raw).trim();
  const argv = [];
  let i = 0;
  while (i < s.length) {
    if (/\s/.test(s[i])) { i += 1; continue; }
    let arg = '';
    while (i < s.length && !/\s/.test(s[i])) {
      const c = s[i];
      if (c === '"' || c === "'") {
        const end = s.indexOf(c, i + 1);
        if (end < 0) return { ok: false, error: UNCLOSED };
        const inside = s.slice(i + 1, end);
        if (!QUOTED_RE.test(inside)) return { ok: false, error: ALLOWED };
        arg += inside;
        i = end + 1;
      } else if (WORD_RE.test(c)) {
        arg += c;
        i += 1;
      } else {
        return { ok: false, error: ALLOWED };
      }
    }
    argv.push(arg);
  }
  return { ok: true, argv };
}

/** The arguments as the shell is given them: each one in single quotes, which nothing in an argument can close. */
function shellArgs(argv) {
  return argv.map((a) => `'${a}'`).join(' ');
}

/** The arguments as a person reads them in a label: quotes only where an argument has a space, or is empty. */
function shownArgs(argv) {
  return argv.map((a) => (a === '' || /\s/.test(a) ? `'${a}'` : a)).join(' ');
}

module.exports = { splitToolArgs, shellArgs, shownArgs, ARGS_PATTERN, ALLOWED, UNCLOSED };
