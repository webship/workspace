/**
 * The Claude Code runs a Jira workitem has had, live and finished.
 *
 * A workitem gets worked more than once — a first pass, a session that was stopped and started again,
 * a second agent after the first was told something it needed. `screen -ls` answers only for the ones
 * still running, and a finished run leaves nothing behind but a log file nobody can map back to a
 * conversation. So each run is noted when it starts, and the notes are what this reads.
 *
 * A note is one small JSON file per screen session, beside the log the session already writes:
 *
 *   ~/workspace/.screens/<session>.run.json
 *   { "key": "WEBSHIP-2199", "project": "dev/v11x00b1gleap", "at": 1758…, "claude": "17e1…" }
 *
 * **The claude id is not known at start.** `exec claude` creates its transcript a second or two later,
 * so the id is filled in by looking for the newest transcript in that directory AFTER the session is
 * up — and left out when none appears, rather than guessed at. An id that belongs to another window
 * would be worse than no id: `claude --resume` would open somebody else's conversation.
 *
 * Nothing here posts anything anywhere. What a run is worth telling Jira is the caller's decision.
 */
import type { PluginLib } from '@webship/workspace-plugin-api';
export interface RunNote {
    session: string;
    key: string;
    project: string;
    dir: string;
    at: number;
    claude: string;
}
export interface Run extends RunNote {
    live: boolean;
}
export interface LiveSession {
    session: string;
    state?: string;
}
export default function sessions(lib: PluginLib): {
    keyOfSession: (session: unknown) => string;
    recordRun: (session: string, { key, workspace, project, dir }: {
        key: string;
        workspace?: string;
        project?: string;
        dir?: string;
    }) => Omit<RunNote, "session">;
    fillClaudeId: (session: string, dir: string, { tries, waitMs }?: {
        tries?: number;
        waitMs?: number;
    }) => Promise<string>;
    readNote: (session: string) => RunNote | null;
    runsFor: (key: unknown, liveSessions?: LiveSession[]) => Run[];
    claudeIdFor: (dir: string, since: number) => string;
    noteFile: (session: string) => string;
};
