/**
 * AI items and cmd-* commands from several repositories, into any AI CLI (ai-anycli.js).
 *
 * No network: the sources here are git repositories made in a temporary folder and read through
 * file:// (allowed for tests only, by AI_ITEMS_ALLOW_FILE=1). No real home: HOME is a temporary one.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-anycli-test-'));
const ROOT = path.join(TMP, 'workspace');
const HOME = path.join(TMP, 'home');
const BIN = path.join(TMP, 'bin');
for (const d of [path.join(ROOT, 'core', 'config'), path.join(ROOT, 'ai-agents'), path.join(ROOT, 'ai-skills'),
  path.join(ROOT, 'ai-commands'), path.join(ROOT, 'ai-prompts'), path.join(ROOT, 'dev', 'site1'), HOME, BIN]) fs.mkdirSync(d, { recursive: true });
process.env.WORKSPACE_ROOT = ROOT;
process.env.WORKSPACE_CONFIG = path.join(ROOT, 'core', 'config');
process.env.HOME = HOME;
process.env.AI_ITEMS_ALLOW_FILE = '1';
process.env.PATH = `${BIN}${path.delimiter}${process.env.PATH}`;
for (const v of ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'OPENAI_API_KEY', 'CODEX_API_KEY']) delete process.env[v];
fs.copyFileSync(path.join(__dirname, '..', '..', '..', 'config', 'ai.defaults.yml'), path.join(ROOT, 'core', 'config', 'ai.defaults.yml'));

const A = require('../../ai-anycli');
const cli = require('../../ai-anycli-cli');

test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const git = (dir, ...args) => {
  const r = spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'init.defaultBranch=main', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
/** A repository with the given files, committed. Returns its file:// address and a `commit(files)` to move it. */
function repo(name, files) {
  const dir = path.join(TMP, 'repos', name);
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q');
  const commit = (more, message = 'change') => {
    for (const [f, text] of Object.entries(more)) {
      if (text === null) fs.rmSync(path.join(dir, f), { recursive: true, force: true }); else write(path.join(dir, f), text);
    }
    git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', message);
  };
  commit(files, 'first');
  return { url: `file://${dir}`, dir, commit };
}
const lines = () => { const out = []; const say = (s) => out.push(s); say.out = out; return say; };
const settings = (text) => fs.writeFileSync(A.settingsFile(), text);
const SKILL = (name) => `---\nname: ${name}\ndescription: What ${name} does. Use when testing.\n---\n\n# ${name}\n`;
const AGENT = (name) => `---\nname: ${name}\ndescription: Use this agent to test.\nmodel: fable\ntools:\n  - Bash\n  - Read\n---\n\n# ${name}\n\nYou test things.\n`;
const COMMAND = '---\ndescription: Test a site.\nargument-hint: <site> [path]\n---\n\n# /site-test\n\nTest the site named in: `$ARGUMENTS`\n';

/* ---------------------------------------------------------------- what a person may type */

test('a source is read from the short form, the three forges and skills.sh', () => {
  assert.deepStrictEqual(A.parseSource('webship/ai-agents'), { url: 'https://github.com/webship/ai-agents', ref: '', path: '', forge: 'github', host: 'github.com', item: '', via: '' });
  assert.strictEqual(A.parseSource('webship/ai-agents@main').ref, 'main');
  const gh = A.parseSource('https://github.com/webship/workspace-wordpress/tree/1.0.x/ai/skills');
  assert.deepStrictEqual([gh.url, gh.ref, gh.path, gh.forge], ['https://github.com/webship/workspace-wordpress', '1.0.x', 'ai/skills', 'github']);
  assert.strictEqual(A.parseSource('https://github.com/webship/ai-agents.git').url, 'https://github.com/webship/ai-agents');
  const gl = A.parseSource('https://git.drupalcode.org/project/webtheme/-/tree/12.0.x/.gitlab/issue_templates');
  assert.deepStrictEqual([gl.url, gl.ref, gl.path, gl.forge, gl.host], ['https://git.drupalcode.org/project/webtheme', '12.0.x', '.gitlab/issue_templates', 'gitlab', 'git.drupalcode.org']);
  assert.strictEqual(A.parseSource('https://gitlab.com/group/sub/project').url, 'https://gitlab.com/group/sub/project', 'a GitLab project may sit in subgroups');
  const bb = A.parseSource('https://bitbucket.org/team/repo/src/main/skills');
  assert.deepStrictEqual([bb.url, bb.ref, bb.path, bb.forge], ['https://bitbucket.org/team/repo', 'main', 'skills', 'bitbucket']);
  const sk = A.parseSource('https://skills.sh/owner/repo/my-skill');
  assert.deepStrictEqual([sk.url, sk.item, sk.via, sk.forge], ['https://github.com/owner/repo', 'my-skill', 'skills.sh', 'github']);
  assert.strictEqual(A.parseSource('skills.sh/owner/repo').item, '');
});

test('a source that is not https, carries an account, or climbs out is refused', () => {
  for (const bad of ['http://github.com/a/b', 'https://user:secret@github.com/a/b', 'git@github.com:a/b.git', 'ssh://git@github.com/a/b',
    'https://github.com/a/b/tree/main/../../etc', 'https://github.com/a', 'a/b; rm -rf x', '', 'https://github.com/a/b?x=1', '--upload-pack=x/y']) {
    assert.throws(() => A.parseSource(bad), A.AnyCliError, bad);
  }
  assert.throws(() => A.parseSource('file:///tmp/x', { allowFile: false }), A.AnyCliError, 'a local path is for the tests only');
});

test('a source nobody named gets an id from the repository, and a free one', () => {
  assert.strictEqual(A.defaultSourceId(A.parseSource('webship/ai-agents')), 'webship-ai-agents');
  assert.strictEqual(A.defaultSourceId(A.parseSource('webship/ai-agents'), ['webship-ai-agents']), 'webship-ai-agents-2');
  assert.strictEqual(A.defaultSourceId(A.parseSource('skills.sh/Owner/Repo/My.Skill')), 'owner-repo-my-skill');
});

/* ---------------------------------------------------------------- several sources, one lock entry each */

test('two sources of one kind: each is placed, listed with its state, updated and removed on its own', () => {
  const one = repo('one', { 'skills/alpha/SKILL.md': SKILL('alpha'), 'skills/alpha/examples/a.feature': 'Feature: a\n', 'README.md': '# one\n' });
  const two = repo('two', { '.claude/skills/beta/SKILL.md': SKILL('beta'), '.claude/skills/gamma/SKILL.md': SKILL('gamma') });
  const say = lines();
  A.sourceAdd('ai-skills', one.url, { id: 'one', say });
  A.sourceAdd('ai-skills', two.url, { id: 'two', say });
  assert.ok(fs.existsSync(path.join(ROOT, 'ai-skills', 'alpha', 'examples', 'a.feature')), 'every file of a skill folder is placed');
  assert.ok(say.out.some((l) => /SKILL\.md {2}\d+ bytes/.test(l)), 'each file fetched is shown with its size');
  assert.ok(say.out.some((l) => /Nothing was run/.test(l)));

  let st = A.sourcesStatus('ai-skills');
  assert.deepStrictEqual(st.map((s) => [s.id, s.state, s.items.map((i) => `${i.name}:${i.state}`).join(',')]),
    [['one', 'reachable', 'alpha:current'], ['two', 'reachable', 'beta:current,gamma:current']]);
  const lock = JSON.parse(fs.readFileSync(A.lockFile('ai-skills'), 'utf8'));
  assert.deepStrictEqual(Object.keys(lock.sources), ['one', 'two'], 'one lock entry per source');
  assert.match(lock.sources.one.items.alpha.upstream, /^[0-9a-f]{40}$/);
  assert.doesNotMatch(JSON.stringify(lock), /token|password/i);

  // Upstream moves in `two`: beta changes, gamma goes, delta is new. A check says so and changes no file.
  two.commit({ '.claude/skills/beta/SKILL.md': `${SKILL('beta')}\nMore.\n`, '.claude/skills/gamma': null, '.claude/skills/delta/SKILL.md': SKILL('delta') });
  const before = fs.readFileSync(path.join(ROOT, 'ai-skills', 'beta', 'SKILL.md'), 'utf8');
  A.sourceCheck('ai-skills', '', { say: lines() });
  st = A.sourcesStatus('ai-skills');
  assert.deepStrictEqual(st[1].items.map((i) => `${i.name}:${i.state}`), ['beta:behind', 'gamma:removed upstream']);
  assert.strictEqual(st[0].items[0].state, 'current', 'the other source is untouched');
  assert.strictEqual(fs.readFileSync(path.join(ROOT, 'ai-skills', 'beta', 'SKILL.md'), 'utf8'), before, 'a check changes no item');

  // Changed here: an update leaves it, and says so; --force takes the source's.
  fs.appendFileSync(path.join(ROOT, 'ai-skills', 'beta', 'SKILL.md'), 'mine\n');
  assert.strictEqual(A.sourcesStatus('ai-skills')[1].items[0].state, 'changed locally, behind');
  let out = lines();
  let r = A.sourceUpdate('ai-skills', 'two', { say: out });
  assert.deepStrictEqual([r.updated, r.placed, r.left], [0, 1, 1]);
  assert.ok(out.out.some((l) => /left ai-skills\/beta: changed locally/.test(l)));
  assert.ok(out.out.some((l) => /gamma: removed upstream, left as is/.test(l)));
  assert.ok(fs.existsSync(path.join(ROOT, 'ai-skills', 'gamma')), 'an item removed upstream is left as is');
  r = A.sourceUpdate('ai-skills', 'two', { say: lines(), force: true });
  assert.strictEqual(r.updated, 1);
  assert.match(fs.readFileSync(path.join(ROOT, 'ai-skills', 'beta', 'SKILL.md'), 'utf8'), /More\.\n$/);
  assert.deepStrictEqual(A.sourcesStatus('ai-skills')[1].items.map((i) => `${i.name}:${i.state}`), ['beta:current', 'delta:current', 'gamma:removed upstream']);

  // Changed here while the source did not move: an update says it left it, not that all is up to date.
  fs.appendFileSync(path.join(ROOT, 'ai-skills', 'delta', 'SKILL.md'), 'mine\n');
  out = lines();
  r = A.sourceUpdate('ai-skills', 'two', { say: out });
  assert.deepStrictEqual([r.updated, r.left], [0, 1]);
  assert.ok(out.out.some((l) => /left ai-skills\/delta: changed locally/.test(l)));
  assert.ok(!out.out.some((l) => /up to date/.test(l)));
  A.sourceUpdate('ai-skills', 'two', { say: lines(), force: true });
  assert.strictEqual(A.sourcesStatus('ai-skills')[1].items.find((i) => i.name === 'delta').state, 'current');

  // Deleted here: said, and put back by an update.
  fs.rmSync(path.join(ROOT, 'ai-skills', 'alpha'), { recursive: true });
  assert.strictEqual(A.sourcesStatus('ai-skills')[0].items[0].state, 'missing here');
  A.sourceUpdate('ai-skills', 'one', { say: lines() });
  assert.strictEqual(A.sourcesStatus('ai-skills')[0].items[0].state, 'current');

  // Remove one source: its items go, the other source's stay, the settings entry goes.
  A.sourceRemove('ai-skills', 'two', { say: lines() });
  assert.ok(!fs.existsSync(path.join(ROOT, 'ai-skills', 'beta')));
  assert.ok(fs.existsSync(path.join(ROOT, 'ai-skills', 'alpha')));
  assert.deepStrictEqual(A.sourcesStatus('ai-skills').map((s) => s.id), ['one']);
  A.sourceRemove('ai-skills', 'one', { say: lines() });
  assert.doesNotMatch(fs.readFileSync(A.settingsFile(), 'utf8'), /sources:/);
});

test('a source that cannot be reached is said, and nothing is changed', () => {
  const gone = repo('gone', { 'skills/zeta/SKILL.md': SKILL('zeta') });
  A.sourceAdd('ai-skills', gone.url, { id: 'gone', say: lines() });
  fs.renameSync(gone.dir, `${gone.dir}-moved`);
  const out = lines();
  A.sourceCheck('ai-skills', 'gone', { say: out });
  assert.strictEqual(A.sourcesStatus('ai-skills')[0].state, 'unreachable');
  const r = A.sourceUpdate('ai-skills', 'gone', { say: out });
  assert.strictEqual(r.unreachable, 1);
  assert.ok(fs.existsSync(path.join(ROOT, 'ai-skills', 'zeta', 'SKILL.md')));
  assert.throws(() => A.sourceAdd('ai-skills', `file://${TMP}/nowhere`, { id: 'nowhere', say: lines() }), /Could not read/);
  assert.deepStrictEqual(A.sourcesStatus('ai-skills').map((s) => s.id), ['gone'], 'a source that could not be read is not added');
  A.sourceRemove('ai-skills', 'gone', { say: lines(), force: true });
});

test('a name that is already here is never replaced by a source, and one skill of a skills.sh address is taken alone', () => {
  write(path.join(ROOT, 'ai-agents', 'mine.md'), AGENT('mine'));
  const r = repo('agents', { 'agents/mine.md': AGENT('theirs'), 'agents/other.md': AGENT('other'), 'agents/README.md': '# no\n', 'NOTES.md': '# no\n' });
  const out = lines();
  A.sourceAdd('ai-agents', r.url, { id: 'agents', say: out });
  assert.match(fs.readFileSync(path.join(ROOT, 'ai-agents', 'mine.md'), 'utf8'), /name: mine/);
  assert.ok(out.out.some((l) => /left ai-agents\/mine\.md: the name is taken/.test(l)));
  assert.deepStrictEqual(A.sourcesStatus('ai-agents')[0].items.map((i) => i.name), ['other'], 'README.md and a root file are not items');
  assert.throws(() => A.sourceAdd('ai-agents', r.url, { id: 'agents', say: lines() }), /already a source called agents/);
  A.sourceRemove('ai-agents', 'agents', { say: lines() });
  fs.rmSync(path.join(ROOT, 'ai-agents', 'mine.md'));

  const many = repo('many', { 'skills/a1/SKILL.md': SKILL('a1'), 'skills/a2/SKILL.md': SKILL('a2') });
  A.sourceAdd('ai-skills', many.url, { id: 'pick', item: 'a2', say: lines() });
  assert.deepStrictEqual(A.sourcesStatus('ai-skills')[0].items.map((i) => i.name), ['a2']);
  assert.throws(() => A.sourceAdd('ai-skills', many.url, { id: 'none', item: 'nope', say: lines() }), /No skill called nope/);
  A.sourceRemove('ai-skills', 'pick', { say: lines() });
  assert.throws(() => A.sourceAdd('ai-agents', 'skills.sh/owner/repo/x', { say: lines() }), /skills\.sh lists skills/);
});

test('what is fetched is files only: a link is skipped, the execute bit is dropped, nothing is run', () => {
  const marker = path.join(TMP, 'ran');
  const r = repo('hostile', {
    'skills/tool/SKILL.md': SKILL('tool'),
    'skills/tool/scripts/run.sh': `#!/bin/sh\ntouch ${marker}\n`,
    'commands/cmd-tools-thing.sh': `#!/usr/bin/env bash\ntouch ${marker}\n`,
    'commands/not-a-command.sh': 'echo no\n',
  });
  fs.chmodSync(path.join(r.dir, 'skills/tool/scripts/run.sh'), 0o755);
  fs.chmodSync(path.join(r.dir, 'commands/cmd-tools-thing.sh'), 0o755);
  fs.symlinkSync('/etc/passwd', path.join(r.dir, 'skills/tool/passwd'));
  fs.symlinkSync('/etc', path.join(r.dir, 'skills/linked'));
  write(path.join(r.dir, '.git', 'hooks', 'post-checkout'), `#!/bin/sh\ntouch ${marker}\n`);
  fs.chmodSync(path.join(r.dir, '.git', 'hooks', 'post-checkout'), 0o755);
  r.commit({}, 'link');

  const out = lines();
  A.sourceAdd('ai-skills', r.url, { id: 'hostile', say: out });
  const placed = path.join(ROOT, 'ai-skills', 'tool');
  assert.ok(!fs.existsSync(path.join(placed, 'passwd')), 'a symbolic link is not copied');
  assert.ok(out.out.some((l) => /skipped passwd: not a regular file/.test(l)), 'and that is said');
  assert.deepStrictEqual(A.sourcesStatus('ai-skills')[0].items.map((i) => i.name), ['tool'], 'a linked folder is not an item');
  assert.strictEqual(fs.statSync(path.join(placed, 'scripts', 'run.sh')).mode & 0o111, 0, 'no execute bit');
  A.sourceCheck('ai-skills', 'hostile', { say: lines() });
  A.sourceUpdate('ai-skills', 'hostile', { say: lines(), force: true });

  // cmd-*: into the folder named, listed with its source, never run, and never over a command of the workspace.
  write(path.join(ROOT, 'dev', 'cmd-tools-own.sh'), '#!/usr/bin/env bash\n');
  assert.throws(() => A.sourceAdd('cmd', r.url, { id: 'tools', say: lines() }), /needs the workspace folder/);
  assert.throws(() => A.sourceAdd('cmd', r.url, { id: 'tools', to: 'core', say: lines() }), /needs the workspace folder/);
  assert.throws(() => A.sourceAdd('cmd', r.url, { id: 'tools', to: 'nowhere', say: lines() }), /no nowhere\/ folder/);
  const cmdOut = lines();
  A.sourceAdd('cmd', r.url, { id: 'tools', to: 'dev', say: cmdOut });
  assert.ok(cmdOut.out.some((l) => /placed, not run/.test(l)));
  const st = A.sourcesStatus('cmd');
  assert.deepStrictEqual(st.map((s) => [s.id, s.to, s.items.map((i) => i.to).join(',')]), [['tools', 'dev', 'dev/cmd-tools-thing.sh']]);
  assert.strictEqual(fs.statSync(path.join(ROOT, 'dev', 'cmd-tools-thing.sh')).mode & 0o111, 0);
  assert.ok(!fs.existsSync(path.join(ROOT, 'dev', 'not-a-command.sh')), 'only cmd-*.sh is a command');
  assert.ok(fs.existsSync(A.lockFile('cmd')) && A.lockFile('cmd').endsWith(path.join('core', 'config', 'cmd-sources.lock.json')));
  A.sourceRemove('cmd', 'tools', { say: lines() });
  assert.ok(fs.existsSync(path.join(ROOT, 'dev', 'cmd-tools-own.sh')), 'a command of the workspace is never removed');
  A.sourceRemove('ai-skills', 'hostile', { say: lines() });
  assert.ok(!fs.existsSync(marker), 'nothing fetched was run: not on add, check, update or remove');
});

test('a token reaches git through the environment of that one call, never an address or an argument', () => {
  write(path.join(ROOT, 'core', 'config', 'plugin.gitlab.settings.yml'), 'host: git.example.org\ntoken: s3cret-value\n');
  const src = A.parseSource('https://git.example.org/group/project');
  const env = A.gitEnv(src);
  assert.strictEqual(env.WORKSPACE_GIT_TOKEN, 's3cret-value');
  assert.strictEqual(env.GIT_TERMINAL_PROMPT, '0');
  const helper = Object.keys(env).filter((k) => /^GIT_CONFIG_VALUE_/.test(k)).map((k) => env[k]).join('\n');
  assert.match(helper, /WORKSPACE_GIT_TOKEN/);
  assert.doesNotMatch(helper, /s3cret-value/, 'the helper names the variable, not the value');
  assert.doesNotMatch(src.url, /s3cret/);
  assert.strictEqual(A.gitEnv(A.parseSource('https://gitlab.com/a/b')).WORKSPACE_GIT_TOKEN, undefined, 'a token is for its own host only');
  assert.strictEqual(A.gitEnv(A.parseSource('webship/ai-agents')).WORKSPACE_GIT_TOKEN, undefined);
  write(path.join(ROOT, 'core', 'config', 'plugin.gitlab.settings.yml'), 'host: git.example.org\ntoken: CHANGE_ME\n');
  assert.strictEqual(A.gitEnv(src).WORKSPACE_GIT_TOKEN, undefined, 'a placeholder is not a token');
  fs.rmSync(path.join(ROOT, 'core', 'config', 'plugin.gitlab.settings.yml'));
});

/* ---------------------------------------------------------------- the AI CLIs are settings */

test('the shipped CLIs: Claude Code is the default, three are on, each names its documentation', () => {
  const clis = A.listClis();
  assert.deepStrictEqual(clis.map((c) => c.id), ['claude', 'gemini', 'codex', 'grok', 'vibe', 'qwen', 'kimi']);
  assert.deepStrictEqual(clis.filter((c) => c.enabled).map((c) => c.id), ['claude', 'gemini', 'codex']);
  assert.strictEqual(clis.find((c) => c.isDefault).id, 'claude');
  for (const c of clis) { assert.match(c.docs, /^https:\/\//, c.id); assert.ok(c.run && c.run.includes('{prompt}'), `${c.id} has its headless form`); }
  for (const c of clis) assert.ok(c.kinds['ai-skills'] && c.kinds['ai-skills'].convert === 'skill-folder', `${c.id} reads skills as folders`);
  assert.strictEqual(clis.find((c) => c.id === 'grok').kinds['ai-agents'], undefined, 'no agents path where the format is not documented');
});

test('states: on or off, installed or missing, signed in or out, from the settings and from presence alone', () => {
  settings('clis:\n  codex:\n    enabled: false\n');
  let clis = A.listClis();
  assert.strictEqual(clis.find((c) => c.id === 'codex').enabled, false);
  assert.ok(!A.listClis(undefined, { onlyEnabled: true }).some((c) => c.id === 'codex'), 'a CLI switched off is gone from what is offered');

  write(path.join(BIN, 'gemini'), '#!/bin/sh\nexit 0\n'); fs.chmodSync(path.join(BIN, 'gemini'), 0o755);
  let gemini = A.listClis().find((c) => c.id === 'gemini');
  assert.deepStrictEqual([gemini.installed, gemini.signIn], [true, 'signed out']);
  assert.deepStrictEqual(A.cliStateWords(gemini), ['on', 'installed', 'signed out']);
  write(path.join(HOME, '.gemini', 'oauth_creds.json'), 'not read');
  gemini = A.listClis().find((c) => c.id === 'gemini');
  assert.strictEqual(gemini.signIn, 'signed in');
  fs.rmSync(path.join(HOME, '.gemini'), { recursive: true });
  process.env.GEMINI_API_KEY = 'x';
  assert.strictEqual(A.listClis().find((c) => c.id === 'gemini').signIn, 'signed in', 'a variable that is set counts');
  delete process.env.GEMINI_API_KEY;
  fs.rmSync(path.join(BIN, 'gemini'));

  settings('default_cli: gemini\n');
  clis = A.listClis();
  assert.strictEqual(clis.find((c) => c.isDefault).id, 'gemini');
  assert.strictEqual(A.cliById('default').id, 'gemini');
  fs.rmSync(A.settingsFile());
});

test('a CLI added only in the settings is listed and can be installed into, with no code change', () => {
  settings(`clis:
  acme:
    label: Acme Code
    vendor: Acme
    command: acme
    docs: https://example.org/acme
    kinds:
      ai-skills:
        user: ~/.acme/skills
        project: .acme/skills
        convert: skill-folder
      ai-commands:
        user: ~/.acme/commands
        convert: command-toml
        extension: .toml
`);
  const acme = A.listClis().find((c) => c.id === 'acme');
  assert.deepStrictEqual([acme.label, acme.enabled, acme.installed, acme.signIn], ['Acme Code', true, false, 'unknown']);
  write(path.join(ROOT, 'ai-skills', 'alpha', 'SKILL.md'), SKILL('alpha'));
  write(path.join(ROOT, 'ai-commands', 'site-test.md'), COMMAND);
  const out = lines();
  A.install('ai-skills', 'alpha', 'acme', { say: out });
  A.install('ai-commands', 'site-test', 'acme', { say: out });
  assert.ok(fs.existsSync(path.join(HOME, '.acme', 'skills', 'alpha', 'SKILL.md')));
  assert.match(fs.readFileSync(path.join(HOME, '.acme', 'commands', 'site-test.toml'), 'utf8'), /^description = "Test a site\."\nprompt = """/);
  assert.ok(out.out.some((l) => /acme is not on the PATH here/.test(l)));
  const m = A.matrix('ai-skills');
  assert.ok(m.clis.some((c) => c.id === 'acme'));
  assert.strictEqual(m.rows.find((r) => r.name === 'alpha').cells.find((c) => c.cli === 'acme').state, 'installed');
  // In a project: where the entry says; a kind with no project path has none.
  A.install('ai-skills', 'alpha', 'acme', { to: 'dev/site1', say: lines() });
  assert.ok(fs.existsSync(path.join(ROOT, 'dev', 'site1', '.acme', 'skills', 'alpha', 'SKILL.md')));
  const none = lines();
  A.install('ai-commands', 'site-test', 'acme', { to: 'dev/site1', say: none });
  assert.ok(none.out.some((l) => /no place for a command in a project/.test(l)));
  assert.throws(() => A.install('ai-skills', 'alpha', 'acme', { to: '../x', say: lines() }), /needs a workspace folder and a project/);
  fs.rmSync(A.settingsFile());
  assert.ok(!A.listClis().some((c) => c.id === 'acme'), 'and gone again with its entry');
  assert.throws(() => A.install('ai-skills', 'alpha', 'acme', { say: lines() }), /No AI CLI called acme/);
});

/* ---------------------------------------------------------------- converters, against the documented formats */

test('Claude Code: an agent, a command and a skill are placed as they are, where its documentation says', () => {
  write(path.join(ROOT, 'ai-agents', 'tester.md'), AGENT('tester'));
  A.install('ai-agents', 'tester', 'claude', { say: lines() });
  A.install('ai-commands', 'site-test', 'claude', { say: lines() });
  A.install('ai-skills', 'alpha', 'default', { say: lines() });
  assert.strictEqual(fs.readFileSync(path.join(HOME, '.claude', 'agents', 'tester.md'), 'utf8'), AGENT('tester'));
  assert.strictEqual(fs.readFileSync(path.join(HOME, '.claude', 'commands', 'site-test.md'), 'utf8'), COMMAND);
  assert.strictEqual(fs.readFileSync(path.join(HOME, '.claude', 'skills', 'alpha', 'SKILL.md'), 'utf8'), SKILL('alpha'));
});

test('Gemini CLI: a command is TOML with prompt and description and {{args}}; an agent keeps name and description', () => {
  const out = lines();
  A.install('ai-commands', 'site-test', 'gemini', { say: out });
  const toml = fs.readFileSync(path.join(HOME, '.gemini', 'commands', 'site-test.toml'), 'utf8');
  assert.strictEqual(toml, 'description = "Test a site."\nprompt = """\n# /site-test\n\nTest the site named in: `{{args}}`\n"""\n');
  assert.ok(out.out.some((l) => /left out argument-hint/.test(l)), 'what was not carried over is said');
  A.install('ai-agents', 'tester', 'gemini', { say: out });
  const agent = fs.readFileSync(path.join(HOME, '.gemini', 'agents', 'tester.md'), 'utf8');
  assert.match(agent, /^---\nname: tester\ndescription: Use this agent to test\.\n---\n\n# tester\n/);
  assert.doesNotMatch(agent, /tools:|model:/);
  assert.ok(out.out.some((l) => /left out model, tools/.test(l)));
  A.install('ai-skills', 'alpha', 'gemini', { say: out });
  assert.strictEqual(fs.readFileSync(path.join(HOME, '.gemini', 'skills', 'alpha', 'SKILL.md'), 'utf8'), SKILL('alpha'));
});

test('Codex: an agent is TOML with name, description, developer_instructions; a prompt keeps $ARGUMENTS; skills go to ~/.agents/skills', () => {
  A.install('ai-agents', 'tester', 'codex', { say: lines() });
  assert.strictEqual(fs.readFileSync(path.join(HOME, '.codex', 'agents', 'tester.toml'), 'utf8'),
    'name = "tester"\ndescription = "Use this agent to test."\ndeveloper_instructions = """\n# tester\n\nYou test things.\n"""\n');
  A.install('ai-commands', 'site-test', 'codex', { say: lines() });
  const prompt = fs.readFileSync(path.join(HOME, '.codex', 'prompts', 'site-test.md'), 'utf8');
  assert.match(prompt, /^---\ndescription: Test a site\.\nargument-hint: <site> \[path\]\n---\n/);
  assert.match(prompt, /\$ARGUMENTS/);
  A.install('ai-skills', 'alpha', 'codex', { say: lines() });
  assert.ok(fs.existsSync(path.join(HOME, '.agents', 'skills', 'alpha', 'SKILL.md')));
  const none = lines();
  A.install('ai-commands', 'site-test', 'codex', { to: 'dev/site1', say: none });
  assert.ok(none.out.some((l) => /no place for a command in a project/.test(l)), 'its prompts are for the user only');
});

test('the other converters: TOML text is escaped, {{args}} in Markdown, the second TOML agent shape', () => {
  const tricky = '---\nname: t\ndescription: Says "hi" \\ there\n---\n\nUse """ and a \\ backslash.\nRun $1 and !`git status`.\n';
  const toml = A.CONVERTERS['command-toml'](tricky, 't');
  assert.match(toml.text, /description = "Says \\"hi\\" \\\\ there"/);
  assert.match(toml.text, /Use ""\\" and a \\\\ backslash\./);
  assert.strictEqual(toml.notes.length, 3, 'left-out keys, $1 and shell lines are each said');
  const md = A.CONVERTERS['command-markdown-args'](COMMAND, 'site-test');
  assert.match(md.text, /^---\ndescription: Test a site\.\n---\n/);
  assert.match(md.text, /`\{\{args\}\}`/);
  const vibe = A.CONVERTERS['agent-toml-vibe'](AGENT('tester'), 'tester');
  assert.match(vibe.text, /^agent_type = "subagent"\ndisplay_name = "tester"\ndescription = "Use this agent to test\."\ninstructions = """\n# tester/);
  assert.strictEqual(A.CONVERTERS['agent-markdown']('No frontmatter.\n', 'plain').text, '---\nname: plain\ndescription: \'\'\n---\n\nNo frontmatter.\n');
  for (const c of A.listClis()) for (const [kind, k] of Object.entries(c.kinds)) {
    assert.ok(k.convert === 'skill-folder' ? kind === 'ai-skills' : !!A.CONVERTERS[k.convert], `${c.id} ${kind}: the converter ${k.convert} exists`);
  }
});

test('an item\'s state in a CLI: not installed, installed, differs after the item changes, removed again; prompts install nowhere', () => {
  const gemini = A.cliById('gemini');
  assert.strictEqual(A.itemCliState('ai-commands', 'site-test', gemini), 'installed');
  fs.appendFileSync(path.join(ROOT, 'ai-commands', 'site-test.md'), '\nOne more line.\n');
  assert.strictEqual(A.itemCliState('ai-commands', 'site-test', gemini), 'installed, differs');
  assert.strictEqual(A.itemCliState('ai-commands', 'site-test', A.cliById('grok')), 'no such thing');
  const out = lines();
  A.uninstall('ai-commands', 'site-test', 'gemini', { say: out });
  assert.strictEqual(A.itemCliState('ai-commands', 'site-test', gemini), 'not installed');
  assert.ok(!fs.existsSync(path.join(HOME, '.gemini', 'commands', 'site-test.toml')));
  // A file added to an installed skill by hand makes it differ.
  write(path.join(HOME, '.gemini', 'skills', 'alpha', 'extra.md'), 'x');
  assert.strictEqual(A.itemCliState('ai-skills', 'alpha', gemini), 'installed, differs');
  // --cli all: every CLI that is on, and only those.
  const all = lines();
  A.install('ai-skills', 'alpha', 'all', { say: all });
  assert.deepStrictEqual(all.out.filter((l) => /: installed alpha/.test(l)).map((l) => l.split(':')[0]), ['Claude Code', 'Gemini CLI', 'OpenAI Codex CLI']);
  assert.throws(() => A.install('ai-skills', 'alpha', 'grok', { say: lines() }), /switched off/);
  write(path.join(ROOT, 'ai-prompts', 'launch.md'), 'A prompt.\n');
  assert.throws(() => A.install('ai-prompts', 'launch', 'claude', { say: lines() }), /run, not installed/);
  assert.throws(() => A.install('ai-skills', 'nope', 'claude', { say: lines() }), /No skill called nope/);
  assert.throws(() => A.install('cmd', 'x', 'claude', { say: lines() }), /Only AI items/);
});

test('the shipped CLIs are in the npm package, and the machine file is one Settings lists', () => {
  const repo = path.join(__dirname, '..', '..', '..', '..');
  if (fs.existsSync(path.join(repo, 'package.json'))) {
    assert.ok(JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8')).files.includes('core/config/ai.defaults.yml'));
  }
  assert.ok(require('../../settings-file').SETTINGS_FILE_RE.test('ai.settings.yml'));
  assert.ok(!require('../../settings-file').SETTINGS_FILE_RE.test('ai.defaults.yml'), 'the shipped file is not edited');
});

/* ---------------------------------------------------------------- the dashboard panel */

test('the panel: a row per source with its state, the CLIs of the settings, a cell per CLI that is on', () => {
  const page = require('../../ai-anycli-page');
  const one = repo('panel-one', { 'skills/p1/SKILL.md': SKILL('p1') });
  const two = repo('panel-two', { 'skills/p2/SKILL.md': SKILL('p2') });
  A.sourceAdd('ai-skills', one.url, { id: 'panel-one', say: lines() });
  A.sourceAdd('ai-skills', two.url, { id: 'panel-two', say: lines() });
  fs.appendFileSync(path.join(ROOT, 'ai-skills', 'p2', 'SKILL.md'), 'mine\n');
  settings(`${fs.readFileSync(A.settingsFile(), 'utf8')}clis:\n  codex:\n    enabled: false\n  acme:\n    label: Acme <Code>\n    command: acme\n    kinds:\n      ai-skills:\n        user: ~/.acme/skills\n        convert: skill-folder\n`);
  let html = page.panelHtml('ai-skills');
  assert.match(html, /<div id="any-cli-panel" class="any-cli" data-kind="ai-skills">/);
  assert.strictEqual((html.match(/class="any-cli-source"/g) || []).length, 2);
  assert.match(html, /data-source="panel-one"[\s\S]*data-state="reachable"[\s\S]*1 item: 1 current/);
  assert.match(html, /data-source="panel-two"[\s\S]*1 item: 1 changed locally/);
  for (const verb of ['source-check', 'source-update', 'source-remove', 'source-add', 'install']) assert.ok(html.includes(verb), verb);
  assert.match(html, /class="any-cli-chip" data-cli="claude"/);
  assert.match(html, /class="any-cli-chip is-off" data-cli="codex"/, 'a CLI switched off is listed as off');
  assert.match(html, /Acme &lt;Code&gt;/, 'a CLI from the settings alone is there, and escaped');
  const head = html.slice(html.indexOf('any-cli-items'), html.indexOf('</thead>', html.indexOf('any-cli-items')));
  assert.match(head, /Claude Code[\s\S]*Gemini CLI[\s\S]*Acme/);
  assert.doesNotMatch(head, /Codex/, 'and has no column');
  assert.match(html, /data-item="p1"[\s\S]*?data-cli="acme"><span[^>]*data-state="not installed"/);
  A.install('ai-skills', 'p1', 'acme', { say: lines() });
  assert.match(page.panelHtml('ai-skills'), /data-item="p1"[\s\S]*?data-cli="acme"><span[^>]*data-state="installed"/);
  // What an action printed is shown, escaped; an error is marked.
  html = page.panelHtml('ai-skills', { said: 'placed <x>', failed: true });
  assert.match(html, /<pre class="any-cli-said is-error" role="status">placed &lt;x&gt;<\/pre>/);
  // cmd: sources only, with the folder to place into; prompts: no install.
  html = page.panelHtml('cmd', { workspaces: ['dev', 'test'] });
  assert.match(html, /Commands from repositories/);
  assert.match(html, /<option value="dev">dev\/<\/option><option value="test">test\/<\/option>/);
  assert.doesNotMatch(html, /any-cli-chip/);
  assert.strictEqual(page.fragment('/fragments/ai-agents/any-cli') !== null, true);
  assert.strictEqual(page.fragment('/fragments/dev/any-cli'), null);
  A.sourceRemove('ai-skills', 'panel-one', { say: lines() });
  A.sourceRemove('ai-skills', 'panel-two', { say: lines(), force: true });
  fs.rmSync(A.settingsFile(), { force: true });
});

test('the dashboard is wired: the rail buttons, the fragment and the one action', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');
  assert.match(server, /'Sources and AI CLIs',\s*`hx-get="\/fragments\/\$\{esc\(key\)\}\/any-cli"/);
  assert.match(server, /hx-get="\/fragments\/cmd\/any-cli"/);
  assert.match(server, /require\('\.\/ai-anycli-page'\)\.fragment\(pathname/);
  assert.match(server, /\.\.\.require\('\.\/actions\/ai-anycli'\)/);
  const action = fs.readFileSync(path.join(__dirname, '..', '..', 'actions', 'ai-anycli.js'), 'utf8');
  assert.match(action, /ai-anycli-cli\.js/, 'a button runs the terminal command');
  assert.doesNotMatch(action, /execSync|shell: true/);
});

/* ---------------------------------------------------------------- the terminal */

test('the terminal: arguments, the verbs, an unknown kind', () => {
  assert.deepStrictEqual(cli.parseArgs(['ai-skills', 'source-add', 'a/b', '--as', 'x', '--force']), { pos: ['ai-skills', 'source-add', 'a/b'], opt: { as: 'x', force: true } });
  assert.strictEqual(cli.age(new Date().toISOString()), 'just now');
  assert.throws(() => cli.main(['nothing', 'sources']), /Unknown kind/);
  assert.throws(() => cli.main(['ai-skills', 'dance']), /Unknown verb/);
  assert.throws(() => cli.main(['ai-skills', 'source-remove']), /Name the source/);
  fs.rmSync(path.join(ROOT, 'ai-prompts'), { recursive: true });
  assert.throws(() => A.sourceAdd('ai-prompts', 'webship/ai-agents', { say: lines() }), /There is no ai-prompts\/ workspace here/);
});
