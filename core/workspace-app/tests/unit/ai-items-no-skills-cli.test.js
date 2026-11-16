/**
 * The AI items tooling never runs the skills.sh installer (`npx skills`).
 *
 * The first `--add` for skills handed the work to `npx -y skills add`, `--update` ran `npx -y skills
 * update` and even `--check`, which only reads, ran `npx -y skills check`: a third-party package
 * downloaded and executed on the machine, with a lock of its own. Skills are fetched like the other
 * kinds now, and a skills.sh address is a source (`--source-add skills.sh/owner/repo/skill`).
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.join(__dirname, '../../../..');
const FUN = path.join(REPO, 'core/scripts/functions');

test('no function of the AI items tooling calls npx or the skills.sh installer', () => {
  const files = fs.readdirSync(FUN).filter((f) => /^fun-ai-items.*\.sh$/.test(f));
  assert.ok(files.length >= 3, 'the AI items functions are there');
  for (const f of files) {
    const code = fs.readFileSync(path.join(FUN, f), 'utf8').split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    assert.doesNotMatch(code, /\bnpx\b/, `${f} runs npx`);
    assert.doesNotMatch(code, /skills_cli/, `${f} still has the skills.sh installer path`);
  }
});

test('--check and --update of the skills folder run no npx, with one on the PATH', { skip: !fs.existsSync(path.join(REPO, 'ai-skills/cmd-tools-ai-items.sh')) }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-items-check-'));
  try {
    const bin = path.join(tmp, 'bin');
    const home = path.join(tmp, 'home');
    fs.mkdirSync(bin);
    // A skills folder with nothing tracked: the case in which the check and the update went to the installer.
    fs.mkdirSync(path.join(home, '.claude', 'skills'), { recursive: true });
    const marker = path.join(tmp, 'npx-was-run');
    fs.writeFileSync(path.join(bin, 'npx'), `#!/usr/bin/env bash\necho "$@" >> ${JSON.stringify(marker)}\nexit 0\n`, { mode: 0o755 });
    const env = { ...process.env, HOME: home, PATH: `${bin}${path.delimiter}${process.env.PATH}` };
    for (const v of ['WORKSPACE_ROOT', 'WORKSPACE_PATH', 'WORKSPACE_SCRIPTS', 'WORKSPACE_CONFIG', 'AI_ITEMS_NO_SKILLS_CLI']) delete env[v];
    for (const verb of ['--check', '--update']) {
      const r = spawnSync('bash', ['cmd-tools-ai-items.sh', verb], { cwd: path.join(REPO, 'ai-skills'), env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 });
      assert.strictEqual(r.status, 0, `${verb}: ${r.stdout}${r.stderr}`);
      assert.doesNotMatch(r.stdout + r.stderr, /skills\.sh CLI|npx skills/, `${verb} names the installer`);
    }
    assert.ok(!fs.existsSync(marker), `npx was run: ${fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8') : ''}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
