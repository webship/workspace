"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * The Teamwork Graph CLI: kept current, and honest when it is not. twg refuses every real command when
 * it is too old; the plugin says so in its own words and names both halves of the fix.
 */
const node_test_1 = __importDefault(require("node:test"));
const node_assert_1 = __importDefault(require("node:assert"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const twg_1 = __importDefault(require("../src/lib/twg"));
const PKG = fs_1.default.existsSync(path_1.default.join(__dirname, '..', 'package.json')) ? path_1.default.join(__dirname, '..') : path_1.default.join(__dirname, '..', '..');
const twgSrc = fs_1.default.readFileSync(path_1.default.join(PKG, 'src/lib/twg.ts'), 'utf8');
const listSrc = fs_1.default.readFileSync(path_1.default.join(PKG, 'src/lib/workitems.ts'), 'utf8');
const indexSrc = fs_1.default.readFileSync(path_1.default.join(PKG, 'src/index.ts'), 'utf8');
const compose = fs_1.default.readFileSync(path_1.default.join(PKG, 'ddev/docker-compose.twg.yaml'), 'utf8');
const twg = (0, twg_1.default)({ run: async () => ({ ok: false, code: 1, stdout: '', stderr: '' }) });
// What the CLI actually printed, the day this was found.
const REAL = 'Update required: Please run `twg update`: this CLI is running v1.2.7, '
    + 'below the minimum supported version v1.3.1. Update Required to apply critical fixes.';
(0, node_test_1.default)('the refusal is recognised, and both versions read out of it; none is hardcoded', () => {
    node_assert_1.default.deepStrictEqual(twg.twgUpdateNeeded(REAL), { running: '1.2.7', minimum: '1.3.1' });
    const code = twgSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    node_assert_1.default.ok(!/\b\d+\.\d+\.\d+\b/.test(code), 'no version number is hardcoded in the gate');
});
(0, node_test_1.default)('it still reads when the CLI hard-wraps its prose, and a full stop is not part of a version', () => {
    const wrapped = 'Update required: this CLI is running v1.2.7,\nbelow the minimum supported\nversion v1.3.1.';
    node_assert_1.default.deepStrictEqual(twg.twgUpdateNeeded(wrapped), { running: '1.2.7', minimum: '1.3.1' });
    node_assert_1.default.strictEqual(twg.twgUpdateNeeded('running v2.0, minimum supported version v2.5.').minimum, '2.5');
});
(0, node_test_1.default)('every other failure is left alone', () => {
    for (const other of ['AUTH_REQUIRED: authentication required', 'no issues found', '', undefined]) {
        node_assert_1.default.strictEqual(twg.twgUpdateNeeded(other), null, String(other));
    }
});
(0, node_test_1.default)('the message names both halves of the fix', () => {
    const hint = twg.twgUpdateHint(twg.twgUpdateNeeded(REAL));
    node_assert_1.default.match(hint, /running twg 1\.2\.7/);
    node_assert_1.default.match(hint, /needs 1\.3\.1/);
    node_assert_1.default.match(hint, /twg update/);
    node_assert_1.default.match(hint, /ddev restart/);
    node_assert_1.default.match(twg.twgUpdateHint(null), /^On the host, run: twg update\./);
});
(0, node_test_1.default)('the version failure outranks the login one, in the gate and in the list', () => {
    const reason = twgSrc.slice(twgSrc.indexOf('function twgAuthReason()'));
    node_assert_1.default.ok(reason.indexOf('_twgStale') > 0 && reason.indexOf('_twgStale') < reason.indexOf('twgSessionFileExists'), 'checked first');
    const branch = listSrc.slice(listSrc.indexOf("const said = String(out.stderr || out.stdout || '');"));
    node_assert_1.default.match(branch, /const stale = twg\.twgNoteOutput\(said\);/);
    node_assert_1.default.match(branch, /The Teamwork Graph CLI is out of date/);
    node_assert_1.default.ok(branch.indexOf('twgNoteOutput') < branch.indexOf('twgNeedsLogin'), 'before the login branch');
    node_assert_1.default.match(indexSrc, /twgIsStale\(\) \? 'twg out of date' : 'twg not signed in'/, "the row's disabled button says which of the three it is");
});
(0, node_test_1.default)('the container follows the host binary instead of pinning it, and the gate asks the binary, not the wrapper', () => {
    node_assert_1.default.match(compose, /\$\{HOME\}\/\.local\/bin:\/host-local-bin:ro/);
    node_assert_1.default.ok(!/\.local\/bin\/twg:/.test(compose), 'the binary itself is no longer mounted');
    node_assert_1.default.match(compose, /\$\{HOME\}\/\.config\/twg:.*:rw/, 'one binary, one session, still shared');
    const paths = twgSrc.match(/const TWG_PATHS = \[([^\]]+)\]/)[1];
    node_assert_1.default.ok(paths.indexOf("'/host-local-bin/twg'") < paths.indexOf("'/usr/local/bin/twg'"), 'the real binary is checked first');
});
//# sourceMappingURL=twg.test.js.map