/**
 * The workitems list and the one-workitem modal, as the plugin's fragments:
 *   /fragments/p/jira/list/<ws>/<project>[/results]            the list (the shell first, the rows into #jira-results)
 *   /fragments/p/jira/workitem/<ws>/<project>/<KEY>[/<tab>]      one workitem, a tab per thing to do with it
 */
import type { FragmentContext, PluginApi } from '@webship/workspace-plugin-api';
import type TwgT from './twg';
import type SessionsT from './sessions';
export default function workitems(api: PluginApi, twg: ReturnType<typeof TwgT>, runs: ReturnType<typeof SessionsT>): {
    workitem: ({ send, searchParams }: FragmentContext, wWs: string, wName: string, wKey: string, wTab: string) => Promise<void>;
    list: ({ send, searchParams }: FragmentContext, jWs: string, jName: string, jResults: string) => Promise<void>;
};
