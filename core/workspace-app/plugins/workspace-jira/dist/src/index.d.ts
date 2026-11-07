/**
 * Jira for Webship Workspace, over the Teamwork Graph CLI (twg).
 *
 * The JIRA menu on every site row, the workitems list and the one-workitem modal (overview, analyze,
 * do the work, runs, comment, worklog), the key badge an agent at work puts on the card, the link a
 * work key in a folder's name gets, the New-folder option that files a workitem, live project options
 * on the settings page, and what the assistant is told about Jira.
 *
 * Everything the dashboard is asked for goes through `api`; this package imports nothing from the
 * dashboard's own files.
 */
import type { PluginApi } from '@webship/workspace-plugin-api';
export declare function register(api: PluginApi): void;
