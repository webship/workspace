"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * The Claude Code runs a workitem has had: noted when a session starts, read back live or finished.
 * The conversation id is claimed only when a transcript appeared AFTER the run began.
 */
const node_test_1 = __importDefault(require("node:test"));
const node_assert_1 = __importDefault(require("node:assert"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const sessions_1 = __importDefault(require("../src/lib/sessions"));
const fake_api_1 = require("./fake-api");
function runsIn(root, transcripts = () => []) {
    return (0, sessions_1.default)({ ROOT: root, claudeSessionsFor: transcripts });
}
(0, node_test_1.default)('a workitem key is read back out of a session name, in the shape Jira writes it', () => {
    const runs = runsIn((0, fake_api_1.workspaceTree)());
    node_assert_1.default.strictEqual(runs.keyOfSession('dev--blog1--jira-webship-2199'), 'WEBSHIP-2199');
    node_assert_1.default.strictEqual(runs.keyOfSession('test--ruverify1--jira-webship-9999--2'), 'WEBSHIP-9999', 'found in the middle too');
    for (const bad of ['dev--blog1--claude', 'dev--blog1--jira-2199', '', undefined])
        node_assert_1.default.strictEqual(runs.keyOfSession(bad), '');
});
(0, node_test_1.default)('every run is noted, so a finished one is still listed, newest first, live ones first', () => {
    const root = (0, fake_api_1.workspaceTree)();
    const runs = runsIn(root);
    runs.recordRun('test--unit--jira-unit-1', { key: 'UNIT-1', workspace: 'test', project: 'unit', dir: '/nowhere' });
    node_assert_1.default.ok(fs_1.default.existsSync(runs.noteFile('test--unit--jira-unit-1')));
    let list = runs.runsFor('UNIT-1', []);
    node_assert_1.default.strictEqual(list.length, 1);
    node_assert_1.default.strictEqual(list[0].live, false);
    node_assert_1.default.strictEqual(list[0].project, 'test/unit');
    // A live session that was never noted still belongs to the workitem.
    list = runs.runsFor('UNIT-1', [{ session: 'dev--x--jira-unit-1', state: 'Detached' }, { session: 'dev--x--jira-unit-1--old', state: 'Dead' }]);
    node_assert_1.default.strictEqual(list.length, 2);
    node_assert_1.default.strictEqual(list[0].live, true, 'the live one first');
    node_assert_1.default.strictEqual(runs.runsFor('OTHER-1', []).length, 0);
});
(0, node_test_1.default)('the conversation id is claimed only from a transcript written after the run began', async () => {
    const root = (0, fake_api_1.workspaceTree)();
    const before = { id: 'old1', at: Date.now() - 60000 };
    const runsOld = runsIn(root, () => [before]);
    runsOld.recordRun('s1', { key: 'UNIT-2', dir: path_1.default.join(root, 'dev', 'site1') });
    node_assert_1.default.strictEqual(await runsOld.fillClaudeId('s1', path_1.default.join(root, 'dev', 'site1'), { tries: 1, waitMs: 1 }), '', 'an older transcript is not this run');
    const runsNew = runsIn(root, () => [{ id: 'new1', at: Date.now() + 1000 }]);
    runsNew.recordRun('s2', { key: 'UNIT-2', dir: path_1.default.join(root, 'dev', 'site1') });
    node_assert_1.default.strictEqual(await runsNew.fillClaudeId('s2', path_1.default.join(root, 'dev', 'site1'), { tries: 1, waitMs: 1 }), 'new1');
    node_assert_1.default.strictEqual(runs(root).readNote('s2').claude, 'new1', 'written into the note');
});
function runs(root) { return runsIn(root); }
//# sourceMappingURL=sessions.test.js.map