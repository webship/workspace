/**
 * The environment a screen session starts with: the one it was started from, without the marks of a Claude Code
 * session that happened to start the runner or the dashboard.
 *
 * Claude Code gives every process it runs a few variables that say "you are inside this session": its id, its
 * messaging socket and token, and CLAUDE_CODE_CHILD_SESSION. A runner started from a Claude Code terminal (an
 * agent asked to start it, say) passed all of them on to every screen, and a Claude Code session started in such
 * a screen took itself for a child of that other session and saved no transcript, so it could not be read or
 * resumed once it was gone. A screen session is a session of its own: these are taken off, and everything else
 * (the PATH, the user's own CLAUDE_CODE_* settings) stays as it was.
 *
 * Plain node, no dependencies: the host runner requires it too.
 */

export const PARENT_SESSION_VARS = [
  'CLAUDECODE',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_SESSION_ATTENDED',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_CODE_SSE_PORT',
  'CLAUDE_PID',
];

/** A copy of `env` that a new top-level session can start with. */
export function sessionEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out = { ...env };
  for (const name of PARENT_SESSION_VARS) delete out[name];
  return out;
}

