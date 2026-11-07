"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const node_assert_1 = __importDefault(require("node:assert"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const index_1 = require("../src/index");
const fake_api_1 = require("./fake-api");
const SETTINGS = { site: 'https://acme.atlassian.net/', default_project: 'ACME', allow_writes: false };
(0, node_test_1.default)('register() asks for exactly the surface the plugin owns', () => {
    const { api, calls } = (0, fake_api_1.fakeApi)((0, fake_api_1.workspaceTree)(), SETTINGS);
    (0, index_1.register)(api);
    node_assert_1.default.deepStrictEqual(Object.keys(calls.rowMenus), ['jira']);
    node_assert_1.default.deepStrictEqual(calls.rowMenus.jira.spec, { label: 'JIRA', row: 0 });
    node_assert_1.default.deepStrictEqual(Object.keys(calls.actions).sort(), ['set-project', 'task']);
    node_assert_1.default.strictEqual(calls.fragments.length, 1);
    node_assert_1.default.strictEqual(calls.badges.length, 1);
    node_assert_1.default.strictEqual(calls.keyLinks.length, 1);
    node_assert_1.default.strictEqual(calls.prompts.length, 1);
    node_assert_1.default.strictEqual(calls.logs.length, 1);
    node_assert_1.default.strictEqual(calls.starts.length, 1);
    node_assert_1.default.deepStrictEqual(calls.options.map((o) => [o.file, o.dotted]), [['plugin.jira.settings.yml', 'default_project']]);
    node_assert_1.default.strictEqual(calls.contexts.length, 1);
    node_assert_1.default.strictEqual(calls.setups.length, 1);
});
(0, node_test_1.default)('the row menu needs a default project and a usable twg, and says which is missing', () => {
    const root = (0, fake_api_1.workspaceTree)();
    const { api, calls } = (0, fake_api_1.fakeApi)(root, SETTINGS);
    (0, index_1.register)(api);
    const ctx = { key: 'dev', project: 'site1', dir: path_1.default.join(root, 'dev'), meta: {}, allowed: new Set(['jira']), vals: () => '' };
    const html = calls.rowMenus.jira.fn(ctx);
    // This machine has no twg on the paths the plugin looks at, so the button is there and disabled.
    node_assert_1.default.match(html, /JIRA/);
    node_assert_1.default.match(html, /disabled/);
    node_assert_1.default.match(html, /twg missing|twg not signed in|twg out of date/);
    const { api: api2, calls: calls2 } = (0, fake_api_1.fakeApi)(root, { ...SETTINGS, default_project: '' });
    (0, index_1.register)(api2);
    node_assert_1.default.strictEqual(calls2.rowMenus.jira.fn(ctx), null, 'no default project, no menu');
    node_assert_1.default.strictEqual(calls.rowMenus.jira.fn({ ...ctx, allowed: new Set() }), null, 'a type that does not allow jira gets nothing');
});
(0, node_test_1.default)('a work key in a folder name links to the configured site; an agent at work shows its key', () => {
    const { api, calls } = (0, fake_api_1.fakeApi)((0, fake_api_1.workspaceTree)(), SETTINGS);
    (0, index_1.register)(api);
    node_assert_1.default.strictEqual(calls.keyLinks[0]('ACME-12'), 'https://acme.atlassian.net/browse/ACME-12');
    node_assert_1.default.strictEqual(calls.keyLinks[0]('not a key'), null);
    const badge = calls.badges[0]({ sessions: [{ session: 'dev--site1--jira-acme-12' }, { session: 'dev--site1--jira-acme-12', state: 'Dead' }, { session: 'dev--site1--build' }] });
    node_assert_1.default.match(badge, /href="https:\/\/acme\.atlassian\.net\/browse\/ACME-12"/);
    node_assert_1.default.strictEqual((badge.match(/jira-key/g) || []).length, 1, 'live sessions only, once each');
});
(0, node_test_1.default)('a jira session logs inside the project it works, and its prompt reads the workitem with twg', () => {
    const root = (0, fake_api_1.workspaceTree)();
    const { api, calls } = (0, fake_api_1.fakeApi)(root, SETTINGS);
    (0, index_1.register)(api);
    fs_1.default.writeFileSync(path_1.default.join(root, 'dev', 'site1', '.jira-ACME-7.log'), '');
    node_assert_1.default.strictEqual(calls.logs[0]('dev--site1--jira-acme-7', [path_1.default.join(root, 'dev', 'site1')]), path_1.default.join(root, 'dev', 'site1', '.jira-ACME-7.log'));
    node_assert_1.default.strictEqual(calls.logs[0]('dev--site1--build', [path_1.default.join(root, 'dev', 'site1')]), '');
    node_assert_1.default.match(calls.prompts[0]({ key: 'ACME-7', workspace: 'dev', project: 'site1' }), /twg CLI/);
    node_assert_1.default.strictEqual(calls.prompts[0]({ key: 'nope' }), null);
});
(0, node_test_1.default)('the New-folder section files a workitem only where the workspace has Jira, and checks its inputs', () => {
    const { api, calls } = (0, fake_api_1.fakeApi)((0, fake_api_1.workspaceTree)(), SETTINGS);
    (0, index_1.register)(api);
    const [setup] = calls.setups;
    node_assert_1.default.match(setup.html('dev', { allowed: new Set(['jira']) }), /name="jira_project" value="ACME"/);
    node_assert_1.default.strictEqual(setup.html('modules', { allowed: new Set() }), '');
    node_assert_1.default.match(setup.prompt('dev', 'demo1', { jira: '1', jira_project: 'ACME', note: 'Try search' })[0], /jira-workitem-manager agent .*ACME.*dev\/demo1.*Try search/);
    node_assert_1.default.deepStrictEqual(setup.prompt('dev', 'demo1', {}), []);
    node_assert_1.default.match(setup.problem('dev', { jira: '1', jira_project: '1x', note: 'x' }, { allowed: new Set(['jira']) }), /Jira project key/);
    node_assert_1.default.match(setup.problem('dev', { jira: '1', jira_project: 'ACME', note: '' }, { allowed: new Set(['jira']) }), /what the folder is for/);
    node_assert_1.default.strictEqual(setup.problem('dev', {}, { allowed: new Set(['jira']) }), '');
});
(0, node_test_1.default)('the assistant is told about Jira only when a project is configured, with the writes switch', () => {
    const { api, calls } = (0, fake_api_1.fakeApi)((0, fake_api_1.workspaceTree)(), SETTINGS);
    (0, index_1.register)(api);
    node_assert_1.default.match(calls.contexts[0](), /Default project: ACME/);
    node_assert_1.default.match(calls.contexts[0](), /writes are DISABLED/);
    const { api: api2, calls: calls2 } = (0, fake_api_1.fakeApi)((0, fake_api_1.workspaceTree)(), { default_project: '' });
    (0, index_1.register)(api2);
    node_assert_1.default.strictEqual(calls2.contexts[0](), '');
});
(0, node_test_1.default)('the package requires nothing outside itself, and ships what the manifest names', () => {
    const PKG = fs_1.default.existsSync(path_1.default.join(__dirname, '..', 'package.json')) ? path_1.default.join(__dirname, '..') : path_1.default.join(__dirname, '..', '..');
    for (const f of ['src/index.ts', 'src/lib/twg.ts', 'src/lib/sessions.ts', 'src/lib/task.ts', 'src/lib/workitems.ts']) {
        const src = fs_1.default.readFileSync(path_1.default.join(PKG, f), 'utf8');
        node_assert_1.default.doesNotMatch(src, /from ['"](\.\.\/)+(html|jobs|workspaces|format|validate|screens|tab-modal)['"]/, `${f} imports a dashboard module`);
        node_assert_1.default.doesNotMatch(src, /require\(/, `${f} uses imports`);
    }
    const m = JSON.parse(fs_1.default.readFileSync(path_1.default.join(PKG, 'package.json'), 'utf8')).workspacePlugin;
    for (const f of [m.settingsTemplate, m.labels, m.scripts.hostInstall, ...m.ddev.compose, ...m.css, ...m.features])
        node_assert_1.default.ok(fs_1.default.existsSync(path_1.default.join(PKG, f)), `${f} is in the package`);
});
//# sourceMappingURL=register.test.js.map