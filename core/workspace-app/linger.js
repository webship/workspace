/**
 * A session that lingers: a command that finishes in under a second would be gone before anyone
 * opened its terminal, so the session stays open after the output, waiting for Enter, and closes by
 * itself after 15 minutes. Shared by the GIT plugin, COMPOSER, NODE, the row actions and the commands
 * center, so every lingering session ends the same way and the menus can read the mark back.
 */

// How long a finished session stays open to be read.
const LINGER_SECONDS = 900;

// The last line a lingering session prints. The COMPOSER menu reads it back from the log to tell a
// session that is only waiting to be read from one whose command is still running.
const LINGER_MARK = 'Press Enter to close this session';

/** The end of a lingering session's line: say it finished, then wait for Enter or 15 minutes. Shared with COMPOSER. */
// The wait itself: Enter, or the time. Only a session has a terminal to press Enter in.
const LINGER_WAIT = `timeout --foreground ${LINGER_SECONDS} bash -c 'while :; do read -r _ && exit 0; sleep 1; done' || true`;

function lingerTail(label) {
  return `echo; echo "${label} finished. ${LINGER_MARK}, or leave it: it closes by itself in 15 minutes."; `
    + LINGER_WAIT;
}

/** The same line for a terminal of your own: the command alone, without the notice and the wait a session ends with. */
function withoutLinger(cmdLine) {
  const line = String(cmdLine);
  const at = line.lastIndexOf('; echo; echo "');
  return at >= 0 && line.endsWith(LINGER_WAIT) && line.slice(at).includes(LINGER_MARK) ? line.slice(0, at) : line;
}

module.exports = { LINGER_SECONDS, LINGER_MARK, lingerTail, withoutLinger };
