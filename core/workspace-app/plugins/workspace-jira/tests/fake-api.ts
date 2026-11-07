/**
 * A stand-in for the dashboard's api: records what register() asks for, and answers the helpers the
 * plugin calls while drawing. Tests hand it to register() and inspect `calls`.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

export function workspaceTree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jira-ws-'));
  fs.mkdirSync(path.join(root, 'dev', 'site1'), { recursive: true });
  fs.mkdirSync(path.join(root, '.screens'), { recursive: true });
  return root;
}

export function fakeApi(root: string, settings: Record<string, any> = {}, opts: { twgPath?: string; screens?: any[] } = {}) {
  const calls: Record<string, any> = { rowMenus: {}, chips: [], badges: [], actions: {}, fragments: [], pages: [], setups: [], keyLinks: [], prompts: [], logs: [], starts: [], options: [], contexts: [] };
  const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
  const api: any = {
    name: 'jira',
    config: {},
    settings: { file: 'plugin.jira.settings.yml', read: () => settings, set() {}, setList() {} },
    lib: {
      esc,
      ROOT: root,
      workspaceDir: (ws: string) => path.join(root, ws),
      listProjects: (dir: string) => fs.readdirSync(dir),
      isValidWorkspace: (ws: string) => /^[a-z0-9_-]+$/.test(ws),
      loadWorkspaces: () => ({ dev: { dir: path.join(root, 'dev'), typeActions: new Set(['jira']) } }),
      hubDomain: () => 'workspace.test',
      screensCached: () => opts.screens || [],
      claudeSessionsFor: () => [],
      iconHtml: (name: string) => `<i data-icon="${name}"></i>`,
      humanTime: (d: Date) => d.toISOString(),
      tabModalHtml: (o: any) => `<div class="tab-modal" data-id="${o.id}">${o.title}</div>`,
      run: async () => ({ ok: false, code: 1, stdout: '', stderr: 'AUTH_REQUIRED' }),
      startJob: () => 'job1', jobFragment: () => ({ html: '' }), startInScreen: async () => ({ ok: true, session: 's' }), screenStartedHtml: () => '', screenAction: () => {}, listScreens: async () => opts.screens || [],
      NAME_RE: /^[a-zA-Z0-9_-]+$/,
    },
    addRowMenu: (slot: string, spec: any, fn: any) => { calls.rowMenus[slot] = { spec, fn }; },
    addProjectChip: (fn: any) => calls.chips.push(fn),
    addProjectBadge: (fn: any) => calls.badges.push(fn),
    addAction: (name: string, fn: any) => { calls.actions[name] = fn; },
    addFragment: (fn: any) => calls.fragments.push(fn),
    addPage: (re: RegExp, fn: any) => calls.pages.push({ re, fn }),
    addFolderSetup: (s: any) => calls.setups.push(s),
    addWorkKeyLink: (fn: any) => calls.keyLinks.push(fn),
    addWorkPrompt: (fn: any) => calls.prompts.push(fn),
    addSessionLog: (fn: any) => calls.logs.push(fn),
    addScreenStartHook: (fn: any) => calls.starts.push(fn),
    addSettingsOptions: (file: string, dotted: string, fn: any) => calls.options.push({ file, dotted, fn }),
    addAssistantContext: (fn: any) => calls.contexts.push(fn),
  };
  return { api, calls };
}
