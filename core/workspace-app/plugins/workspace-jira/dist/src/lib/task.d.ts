/**
 * The Jira actions: remember a project's Jira project, and hand a workitem to Claude Code — view,
 * analyze, work (in a screen session), watch, comment, log. A factory over api, twg and the runs.
 */
import type { ActionContext, PluginApi } from '@webship/workspace-plugin-api';
import type TwgT from './twg';
import type SessionsT from './sessions';
export default function task(api: PluginApi, twg: ReturnType<typeof TwgT>, runs: ReturnType<typeof SessionsT>): {
    'set-project': ({ form, res, send, workspace }: ActionContext) => Promise<void | import("http").ServerResponse<import("http").IncomingMessage>>;
    task: ({ form, send, workspace }: ActionContext) => Promise<void>;
};
