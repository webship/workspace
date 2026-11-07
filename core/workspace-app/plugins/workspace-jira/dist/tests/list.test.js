"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * The workitems list opens at once and narrows as you type: read from the fragment's source, which is
 * the one place those promises are kept.
 */
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const PKG = fs_1.default.existsSync(path_1.default.join(__dirname, '..', 'package.json')) ? path_1.default.join(__dirname, '..') : path_1.default.join(__dirname, '..', '..');
const src = fs_1.default.readFileSync(path_1.default.join(PKG, 'src/lib/workitems.ts'), 'utf8');
const index = fs_1.default.readFileSync(path_1.default.join(PKG, 'src/index.ts'), 'utf8');
(0, node_test_1.default)('the list opens at once: the shell answers before any Jira read, and the results load into their own box', () => {
    strict_1.default.match(index, /\(\\\/results\)\?\$\//, 'one route, with and without /results');
    const shell = src.indexOf('if (!jResults) {');
    const firstRead = src.indexOf("run('twg', ['jira', 'workitem', 'query'", shell);
    strict_1.default.ok(shell > 0 && firstRead > shell, 'the shell returns before the workitem query');
    strict_1.default.match(src, /<div id="jira-results"[^>]*hx-trigger="load"/);
});
(0, node_test_1.default)('the three reads run together', () => {
    strict_1.default.match(src, /const \[out, spOut, screensOut\] = await Promise\.all\(\[/);
});
(0, node_test_1.default)('searching replaces the results only, so the box keeps its focus, and narrows the cards on screen at once', () => {
    strict_1.default.match(src, /hx-target="#jira-results"/);
    strict_1.default.match(src, /hx-sync="this:replace"/);
    strict_1.default.match(src, /data-list-find="#jira-results"/, "the dashboard's quick filter, pointed at this list");
    strict_1.default.match(src, /jira-card/);
    strict_1.default.match(src, /data-find=/);
});
(0, node_test_1.default)('opening never waits for the list of Jira projects: it is read from the cache and warmed in the background', () => {
    strict_1.default.match(src, /const live = twg\.jiraProjectListCached\(\);\s*if \(!live\) twg\.warmJiraProjects\(\);/);
    const route = src.slice(src.indexOf('async function list('), src.indexOf('async function list(') + 3000);
    strict_1.default.doesNotMatch(route, /await twg\.jiraProjectList\(\)/);
});
(0, node_test_1.default)('the actions and routes are the plugin\'s own, never the dashboard\'s', () => {
    strict_1.default.doesNotMatch(src, /\/actions\/jira-|\/fragments\/projects\/jira|\/fragments\/jira\//);
    strict_1.default.match(src, /post\('task'\)/);
    strict_1.default.match(src, /post\('set-project'\)/);
});
//# sourceMappingURL=list.test.js.map