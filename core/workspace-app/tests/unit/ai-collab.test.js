/**
 * Several AI CLIs on one spec (ai-collab.js): the runner by role, the record beside the spec, and the
 * skipped state. The CLIs here are small scripts in a temporary folder on the PATH: no provider is
 * called, no real home is read.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-collab-test-'));
const ROOT = path.join(TMP, 'workspace');
const HOME = path.join(TMP, 'home');
const BIN = path.join(TMP, 'bin');
const SPEC = 'specs/dev/site1/001-topic';
for (const d of [path.join(ROOT, 'core', 'config'), path.join(ROOT, SPEC), path.join(ROOT, 'dev', 'site1'), HOME, BIN]) fs.mkdirSync(d, { recursive: true });
process.env.WORKSPACE_ROOT = ROOT;
process.env.WORKSPACE_CONFIG = path.join(ROOT, 'core', 'config');
process.env.HOME = HOME;
// Only the scripts below are on the PATH, so a CLI this machine really has is not found.
process.env.PATH = BIN;
for (const v of ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'OPENAI_API_KEY', 'CODEX_API_KEY']) delete process.env[v];
fs.copyFileSync(path.join(__dirname, '..', '..', '..', 'config', 'ai.defaults.yml'), path.join(ROOT, 'core', 'config', 'ai.defaults.yml'));

const A = require('../../ai-anycli');
const C = require('../../ai-collab');

test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const write = (file, text, mode) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); if (mode) fs.chmodSync(file, mode); };
const lines = () => { const out = []; const say = (s) => out.push(s); say.out = out; return say; };
/** A CLI that prints its version, or keeps what it was sent and answers. */
const fakeCli = (name, answer) => write(path.join(BIN, name),
  `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "${name} 9.9"; exit 0; fi\nprintf '%s\\n' "$@" > "${TMP}/${name}.args"\npwd > "${TMP}/${name}.cwd"\n${answer}\n`, 0o755);
const record = () => fs.readFileSync(path.join(ROOT, SPEC, 'collaboration', 'record.md'), 'utf8');

write(path.join(ROOT, SPEC, '01-story.md'), '# Story\n\nCards are unscannable at twenty.\n');
write(path.join(ROOT, SPEC, 'spec.yml'), 'target: dev/site1\ntopic: topic\nstage: story\n');

test('the roles come from the settings, and say why one cannot run', () => {
  let roles = C.rolesStatus();
  assert.deepStrictEqual(roles.map((r) => [r.role, r.cli, r.ready]), [['author', 'claude', false], ['reviewer', 'gemini', false], ['second_opinion', 'codex', false]]);
  assert.match(roles[0].why, /not installed \(claude is not on the PATH\)/);
  fakeCli('claude', 'echo "Did the work."; echo "Notes: checked by hand."');
  write(path.join(HOME, '.claude', '.credentials.json'), 'not read');
  fakeCli('gemini', 'echo "Verdict: agree"; echo "The notes match the story."');
  roles = C.rolesStatus();
  assert.deepStrictEqual(roles.map((r) => r.ready), [true, false, false]);
  assert.match(roles[1].why, /Gemini CLI is signed out/);
  fs.writeFileSync(A.settingsFile(), 'roles:\n  reviewer: claude\n');
  assert.match(C.rolesStatus()[1].why, /author's CLI \(claude\): a review comes from a different one/);
  fs.writeFileSync(A.settingsFile(), 'default_cli: gemini\n');
  assert.strictEqual(C.roleCli('author'), 'gemini', '`default` follows the default CLI');
  fs.rmSync(A.settingsFile());
});

test('the author runs in the default CLI: its documented form, the spec and the task, in the project, and the answer is kept', () => {
  const out = lines();
  const r = C.runRole({ role: 'author', spec: SPEC, task: 'Group the cards.', agent: 'site-builder', say: out });
  assert.strictEqual(r.status, 'answered');
  const args = fs.readFileSync(path.join(TMP, 'claude.args'), 'utf8');
  assert.match(args, /^-p\nYou are the AUTHOR/);
  assert.match(args, /--- 01-story\.md ---\n# Story/);
  assert.match(args, /--- the task ---\nGroup the cards\./);
  assert.match(args, /Do not merge, release, tag, publish or mark anything as reviewed/);
  assert.match(args, /\n--agent\nsite-builder\n$/, 'the agent is named the way the settings say');
  assert.strictEqual(fs.readFileSync(path.join(TMP, 'claude.cwd'), 'utf8').trim(), fs.realpathSync(path.join(ROOT, 'dev', 'site1')), 'it runs in the project the spec is about');
  const kept = fs.readFileSync(r.file, 'utf8');
  assert.match(path.basename(r.file), /^\d{8}T\d{6}Z-author-claude\.md$/);
  assert.match(kept, /^---\nrole: author\ncli: claude\nlabel: Claude Code\n/);
  assert.match(kept, /version: claude 9\.9/);
  assert.match(kept, /status: answered/);
  assert.match(kept, /\n\nDid the work\.\nNotes: checked by hand\.\n$/);
  assert.match(record(), /\| Author \| Claude Code claude 9\.9 \| answered \|  \| \[/);
  assert.match(record(), /## Decision \(a person\)\n\n_Not decided yet\._/);
  assert.ok(out.out.some((l) => /nothing was merged, released or marked reviewed/.test(l)));
});

test('a reviewer that is signed out is written down as skipped: nothing is sent, nothing is faked', async () => {
  await new Promise((r) => setTimeout(r, 1100));
  fs.rmSync(path.join(TMP, 'gemini.args'), { force: true });
  const out = lines();
  const r = C.runRole({ role: 'reviewer', spec: SPEC, task: 'Review it.', say: out });
  assert.match(r.status, /^skipped: Gemini CLI is signed out$/);
  assert.ok(!fs.existsSync(path.join(TMP, 'gemini.args')), 'the CLI was not run');
  assert.match(fs.readFileSync(r.file, 'utf8'), /Nothing was sent and nothing was answered/);
  assert.match(record(), /\| Reviewer \| Gemini CLI \| skipped: Gemini CLI is signed out \|/);
  // The author's own CLI is refused as reviewer, also when asked for by hand.
  await new Promise((res) => setTimeout(res, 1100));
  const same = C.runRole({ role: 'reviewer', spec: SPEC, task: 'Review it.', cliId: 'claude', say: lines() });
  assert.match(same.status, /^skipped: Claude Code is the author's CLI/);
  const off = C.runRole({ role: 'second_opinion', spec: SPEC, task: 'And you?', cliId: 'grok', say: lines() });
  assert.match(off.status, /^skipped: Grok Build is switched off/);
});

test('a different CLI reviews: it gets the author\'s notes and the evidence, its verdict is recorded, a person\'s decision is kept', async () => {
  await new Promise((r) => setTimeout(r, 1100));
  write(path.join(HOME, '.gemini', 'oauth_creds.json'), 'not read');
  write(path.join(ROOT, 'dev', 'site1', 'tests', 'report.txt'), '12 scenarios (12 passed)\n');
  const rec = path.join(ROOT, SPEC, 'collaboration', 'record.md');
  fs.writeFileSync(rec, record().replace('_Not decided yet._', 'Accepted by a person, 2026-11-15.'));
  const r = C.runRole({ role: 'reviewer', spec: SPEC, task: 'Review it.', evidence: 'dev/site1/tests/report.txt', agent: 'x', say: lines() });
  assert.deepStrictEqual([r.status, r.verdict], ['answered', 'agree']);
  const args = fs.readFileSync(path.join(TMP, 'gemini.args'), 'utf8');
  assert.match(args, /You are the REVIEWER of this change, and you are a different AI provider/);
  assert.match(args, /--- the author's notes \(Claude Code\) ---\nDid the work\./);
  assert.match(args, /--- evidence: dev\/site1\/tests\/report\.txt ---\n12 scenarios \(12 passed\)/);
  assert.doesNotMatch(args, /--agent/, 'no agent flag is invented for a CLI that documents none');
  assert.match(fs.readFileSync(r.file, 'utf8'), /agent: 'x \(not named: Gemini CLI has no agent flag in the settings\)'/);
  assert.match(record(), /\| Reviewer \| Gemini CLI gemini 9\.9 \| answered \| agree \|/);
  assert.match(record(), /Accepted by a person, 2026-11-15\./, 'what a person wrote under the decision heading is kept');
  assert.match(record(), /ticked by a person only/);
});

test('a CLI that fails or answers nothing is recorded as that, and secrets are never sent', async () => {
  await new Promise((r) => setTimeout(r, 1100));
  fakeCli('gemini', 'echo "quota exceeded" >&2; exit 7');
  const r = C.runRole({ role: 'reviewer', spec: SPEC, task: 'Again.', say: lines() });
  assert.strictEqual(r.status, 'failed (exit 7)');
  assert.match(fs.readFileSync(r.file, 'utf8'), /It did not answer: failed \(exit 7\)\.[\s\S]*quota exceeded/);
  await new Promise((res) => setTimeout(res, 1100));
  fakeCli('gemini', 'exit 0');
  assert.strictEqual(C.runRole({ role: 'reviewer', spec: SPEC, task: 'Again.', say: lines() }).status, 'failed: it answered nothing');
  await new Promise((res) => setTimeout(res, 1100));
  fakeCli('gemini', '/bin/sleep 5');
  assert.match(C.runRole({ role: 'reviewer', spec: SPEC, task: 'Again.', timeoutMs: 300, say: lines() }).status, /^timed out/);

  write(path.join(ROOT, 'dev', 'site1', '.env'), 'KEY=1\n');
  for (const bad of ['dev/site1/.env', 'core/config/settings.yml', 'core/config/plugin.github.settings.yml', 'dev/site1/id_rsa'])
    assert.throws(() => C.runRole({ role: 'reviewer', spec: SPEC, task: 'x', evidence: bad, say: lines() }), /holds secrets|There is no/, bad);
  assert.ok(C.SECRET_FILE_RE.test('a/credentials.json') && !C.SECRET_FILE_RE.test('dev/site1/tests/report.txt'));
  assert.throws(() => C.runRole({ role: 'reviewer', spec: '../x', task: 'x', say: lines() }), /Name the spec folder/);
  assert.throws(() => C.runRole({ role: 'reviewer', spec: 'specs/none', task: 'x', say: lines() }), /There is no specs\/none/);
  assert.throws(() => C.runRole({ role: 'judge', spec: SPEC, task: 'x', say: lines() }), /Unknown role/);
  assert.throws(() => C.runRole({ role: 'author', spec: SPEC, task: ' ', say: lines() }), /Say what the role is to do/);
});
