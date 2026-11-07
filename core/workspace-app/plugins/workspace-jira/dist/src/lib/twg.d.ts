/**
 * The Jira domain, over the Teamwork Graph CLI (twg): whether twg is usable here, which Jira
 * projects it can see, and which Jira project a workspace project works against. One instance per
 * plugin (a factory over api.lib), shared by the menu, the list and the actions, so they never
 * disagree about the effective project.
 */
import type { PluginLib } from '@webship/workspace-plugin-api';
export interface JiraProject {
    key: string;
    name: string;
}
export interface TwgState {
    ok: boolean;
    reason: string;
}
export interface TwgVersions {
    running: string;
    minimum: string;
}
export default function twg(lib: PluginLib): {
    jiraProjectListCached: () => JiraProject[] | null;
    warmJiraProjects: () => void;
    postComment: (key: string, body: string) => Promise<{
        ok: boolean;
        error: string;
    }>;
    twgAuthReason: () => string;
    twgAuthProbe: () => Promise<void>;
    twgAuthForget: () => void;
    twgNeedsLogin: (text: unknown) => boolean;
    TWG_LOGIN_HINT: string;
    twgUpdateNeeded: (text: unknown) => TwgVersions | null;
    twgUpdateHint: (v: TwgVersions | null) => string;
    twgIsStale: () => boolean;
    twgNoteOutput: (text: unknown) => TwgVersions | null;
    twgState: () => TwgState;
    twgAvailable: () => boolean;
    jiraProjectList: () => Promise<JiraProject[] | null>;
    projectJiraKey: (projectDir: string) => string | null;
};
