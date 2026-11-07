"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.workspaceTree = workspaceTree;
exports.fakeApi = fakeApi;
/**
 * A stand-in for the dashboard's api: records what register() asks for, and answers the helpers the
 * plugin calls while drawing. Tests hand it to register() and inspect `calls`.
 */
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
function workspaceTree() {
    const root = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'jira-ws-'));
    fs_1.default.mkdirSync(path_1.default.join(root, 'dev', 'site1'), { recursive: true });
    fs_1.default.mkdirSync(path_1.default.join(root, '.screens'), { recursive: true });
    return root;
}
function fakeApi(root, settings = {}, opts = {}) {
    const calls = { rowMenus: {}, chips: [], badges: [], actions: {}, fragments: [], pages: [], setups: [], keyLinks: [], prompts: [], logs: [], starts: [], options: [], contexts: [] };
    const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const api = {
        name: 'jira',
        config: {},
        settings: { file: 'plugin.jira.settings.yml', read: () => settings, set() { }, setList() { } },
        lib: {
            esc,
            ROOT: root,
            workspaceDir: (ws) => path_1.default.join(root, ws),
            listProjects: (dir) => fs_1.default.readdirSync(dir),
            isValidWorkspace: (ws) => /^[a-z0-9_-]+$/.test(ws),
            loadWorkspaces: () => ({ dev: { dir: path_1.default.join(root, 'dev'), typeActions: new Set(['jira']) } }),
            hubDomain: () => 'workspace.test',
            screensCached: () => opts.screens || [],
            claudeSessionsFor: () => [],
            iconHtml: (name) => `<i data-icon="${name}"></i>`,
            humanTime: (d) => d.toISOString(),
            tabModalHtml: (o) => `<div class="tab-modal" data-id="${o.id}">${o.title}</div>`,
            run: async () => ({ ok: false, code: 1, stdout: '', stderr: 'AUTH_REQUIRED' }),
            startJob: () => 'job1', jobFragment: () => ({ html: '' }), startInScreen: async () => ({ ok: true, session: 's' }), screenStartedHtml: () => '', screenAction: () => { }, listScreens: async () => opts.screens || [],
            NAME_RE: /^[a-zA-Z0-9_-]+$/,
        },
        addRowMenu: (slot, spec, fn) => { calls.rowMenus[slot] = { spec, fn }; },
        addProjectChip: (fn) => calls.chips.push(fn),
        addProjectBadge: (fn) => calls.badges.push(fn),
        addAction: (name, fn) => { calls.actions[name] = fn; },
        addFragment: (fn) => calls.fragments.push(fn),
        addPage: (re, fn) => calls.pages.push({ re, fn }),
        addFolderSetup: (s) => calls.setups.push(s),
        addWorkKeyLink: (fn) => calls.keyLinks.push(fn),
        addWorkPrompt: (fn) => calls.prompts.push(fn),
        addSessionLog: (fn) => calls.logs.push(fn),
        addScreenStartHook: (fn) => calls.starts.push(fn),
        addSettingsOptions: (file, dotted, fn) => calls.options.push({ file, dotted, fn }),
        addAssistantContext: (fn) => calls.contexts.push(fn),
    };
    return { api, calls };
}
//# sourceMappingURL=fake-api.js.map