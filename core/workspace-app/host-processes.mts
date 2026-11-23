/**
 * What the process table says about the screen sessions and the browsers on a machine.
 *
 * Two places ask it. The host runner (scripts/screen-runner.js) asks about the machine, where the sessions run, and
 * publishes the answers with its list of sessions; the dashboard asks about the place it runs itself, for the sessions
 * its own screen started. The dashboard's container has a process space of its own (webship/workspace#564), so it can
 * no longer read the machine's: what it knows about a session on the machine is what the runner published.
 *
 * Pure, and with no dependencies: the runner loads it on a machine where nothing else of the dashboard is installed,
 * from where it lies in the workspace, with that machine's Node.js (24 or later, which strips the types: screen-host.sh
 * checks it).
 */

import fs from 'node:fs';

/** The process table, as maps: pid -> children, pid -> command line, pid -> elapsed time. */
export interface ProcessTable { kids: Map<string, string[]>; args: Map<string, string>; etime: Map<string, string> }
/** An automation browser, as one `ps` line shows it. */
export interface BrowserRow { pid: string; uptime: string; profile: string; headless: boolean; port: string; pipe: boolean }

/** `ps -eo pid=,ppid=,etime=,args=` as maps: pid -> children, pid -> command line, pid -> elapsed time. */
export function parseProcessTable(text: unknown): ProcessTable {
  const kids = new Map<string, string[]>();
  const args = new Map<string, string>();
  const etime = new Map<string, string>();
  for (const line of String(text || '').split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    if (!m) continue;
    const [, pid = '', ppid = '', up = '', cmd = ''] = m;
    if (!kids.has(ppid)) kids.set(ppid, []);
    kids.get(ppid)!.push(pid);
    args.set(pid, cmd);
    etime.set(pid, up);
  }
  return { kids, args, etime };
}

/** The arguments `ps` takes for the table parseProcessTable reads. */
export const PS_ARGS = ['-eo', 'pid=,ppid=,etime=,args='];

// `claude` the CLI, never a path that merely mentions it: a shell sitting in a folder called
// claude-something is not an agent, and neither is `tail -F .../claude.log`.
export const isClaudeCmd = (cmd: unknown): boolean => /(^|\/)claude(\s|$)/.test(String(cmd || '').trim());

/**
 * Is Claude Code running under this process? Walked DOWN from a session's own screen process: `screen` forks the
 * command, and a Claude Code session is `exec claude …`, so the agent is a descendant rather than the screen itself.
 *
 * Never from 0 or from nothing: every top-level process has ppid 0, so a row with no pid would walk the whole table
 * and claim every agent on it as its own.
 */
export function agentUnder(rootPid: unknown, table: ProcessTable | null | undefined): boolean {
  const root = String(rootPid || '');
  if (!root || root === '0' || !table) return false;
  const seen = new Set<string>();
  const stack = [root];
  while (stack.length) {
    const pid = stack.pop();
    if (!pid || seen.has(pid)) continue;
    seen.add(pid);
    if (isClaudeCmd(table.args.get(pid))) return true;
    (table.kids.get(pid) || []).forEach((k) => stack.push(k));
  }
  return false;
}

/** What one `ps` line (`<pid> <etime> <args>`) says about an automation browser, or null when it is not one. */
export function parseBrowserLine(line: unknown): BrowserRow | null {
  const m = String(line || '').trim().match(/^(\d+)\s+(\S+)\s+(.*)$/);
  if (!m) return null;
  const args = m[3] ?? '';
  // The program itself has to BE a browser. Matching the arguments alone listed
  // `ddev exec … BROWSER=chromium`, its docker-compose and the bash that runs
  // the suite as three separate "browsers".
  const prog = args.split(/\s+/)[0] || '';
  const exe = prog.split('/').filter(Boolean).pop() || '';
  // A browser in ANOTHER container is listed with its path only: this process
  // cannot read that one's cmdline, and `ps` then prints the executable, often
  // cut at a directory (…/chromium_headless_shell). So the whole path counts as
  // evidence, not just the last segment.
  const isBrowser = /^(google-)?chrome(-headless-shell)?$|^chromium(-browser)?$|^headless_shell$|^firefox$|^msedge$|webkit/i.test(exe)
    || /ms-playwright|headless[-_]shell/i.test(prog);
  if (!isBrowser) return null;
  if (/ --type=/.test(args)) return null;                       // a renderer, not the browser
  if (!/remote-debugging-(port|pipe)|ms-playwright|mcp-chrome|playwright/i.test(args)) return null;
  const dir = (args.match(/--user-data-dir=(\S+)/) || [])[1] || '';
  return {
    pid: m[1] ?? '',
    uptime: m[2] ?? '',
    profile: (dir.split('/').filter(Boolean).pop() || (/headless[-_]shell/i.test(prog) ? 'test browser' : 'playwright')).slice(0, 40),
    // A headless shell has no window whatever its flags say, so the binary
    // counts as much as --headless does.
    headless: /--headless/.test(args) || /headless[-_]shell/i.test(prog),
    port: (args.match(/--remote-debugging-port=(\d+)/) || [])[1] || '',
    pipe: /--remote-debugging-pipe/.test(args),
  };
}

/** Is this process inside a container? A suite's browser in a project's web container is not on the desktop. */
export function processInContainer(pid: string): boolean {
  try {
    const cgroup = fs.readFileSync(`/proc/${pid}/cgroup`, 'utf8');
    return /docker|containerd|kubepods|libpod/.test(cgroup);
  } catch (_) { return false; }
}

/**
 * The automation browsers in a process table: one driven over a debugging pipe or port, or running from a
 * playwright/mcp profile. The docs tooling's screenshot chromium is short-lived and matches none of those.
 *
 * One browser is several processes, and the helpers of a browser in another container cannot be told apart from it
 * (their arguments are unreadable, so the usual `--type=` filter never sees them). They are grouped into the one
 * thing they are, oldest first, which is the browser itself.
 */
export function browsersIn(table: ProcessTable, { inContainer = processInContainer, limit = 10 }: { inContainer?: (pid: string) => boolean; limit?: number } = {}): (BrowserRow & { inContainer: boolean; count: number })[] {
  const rows: (BrowserRow & { inContainer: boolean })[] = [];
  for (const [pid, cmd] of table.args) {
    if (rows.length >= limit) break;
    const b = parseBrowserLine(`${pid} ${table.etime.get(pid) || '0:00'} ${cmd}`);
    if (b) rows.push({ ...b, inContainer: inContainer(b.pid) });
  }
  const groups = new Map<string, BrowserRow & { inContainer: boolean; count: number }>();
  for (const b of rows) {
    const key = `${b.profile}|${b.headless}|${b.inContainer}`;
    const seen = groups.get(key);
    if (!seen) groups.set(key, { ...b, count: 1 });
    else { seen.count += 1; if (b.uptime > seen.uptime) Object.assign(seen, b, { count: seen.count }); }
  }
  return [...groups.values()];
}

