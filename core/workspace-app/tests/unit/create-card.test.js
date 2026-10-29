const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

test('a project workspace asks "What would you like to create?" in its build card, with New folder in it', () => {
  assert.match(server, /<h2 class="uk-h3 uk-margin-remove">What would you like to create\?<\/h2>\$\{folderBtn\}/);
  assert.match(server, /class="uk-button uk-button-default uk-button-small create-folder-btn"/);
  assert.doesNotMatch(server, /Build a new \$\{esc\(meta\.noun\)\}/);
  // Files workspaces ask the same question inside their card: the create actions as a row, New folder on the right.
  assert.doesNotMatch(server, /class="ws-create"/);
  assert.match(server, /const folder = create\.find\(\(it\) => it\.id === 'new-folder'\);/);
  assert.match(server, /<div class="create-actions">\$\{rest\.map\(\(it\) => it\.html\)\.join\(''\)\}<\/div>/);
});

test('the build form offers Claude Code after the build, with its prompt shown only when ticked', () => {
  assert.match(server, /name="ai_after" value="1"> Start AI<\/label>/);
  assert.match(server, /name="ai_prompt"[^>]*><\/textarea>/);
  assert.doesNotMatch(server, /name="ai_prompt"[^>]*placeholder=/);
  const css = fs.readFileSync(path.join(root, 'public/css/components/create-card.css'), 'utf8');
  assert.match(css, /:has\(input\[name="ai_after"\]:checked\) \.build-ai-prompt \{ display: block; \}/);
});

test('the build ends with the step that starts Claude Code, so a failed build starts nothing', () => {
  assert.match(server, /cmdLine \+= ` && \$\{after\.step\}`;/);
  assert.match(server, /installed: flags\.some\(\(f\) => f === '--install' \|\| f === '-i'\)/);
});

test('the step writes a private prompt and payload, and the shell line holds only paths', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-'));
  const old = process.env.WORKSPACE_ROOT;
  try {
    const ai = require('../../build-ai');
    const { ROOT } = require('../../workspaces');
    const r = ai.afterBuildStep({ ws: 'dev', dir: path.join(ROOT, 'dev'), project: 'v11x00b9', label: 'Varbase 11', installed: true,
      text: 'Run $(rm -rf /) and `whoami`' });
    assert.equal(r.session, 'dev--v11x00b9--claude');
    assert.doesNotMatch(r.step, /rm -rf|whoami/);
    assert.match(r.step, /^node '.*scripts\/screen-then\.js' '.*\.screens\/prompts\/dev--v11x00b9--claude\.start\.json'$/);
    // The step runs on the host, so the helper is found from the workspace root, never the container's own path.
    assert.ok(r.step.startsWith(`node '${path.join(ROOT, 'core', 'workspace-app', 'scripts', 'screen-then.js')}'`));
    const payloadFile = r.step.match(/'([^']+\.start\.json)'$/)[1];
    const payload = JSON.parse(fs.readFileSync(payloadFile, 'utf8'));
    assert.match(payload.cmd, /^exec env WEBSHIP_WORKSPACE='dev' WEBSHIP_PROJECT='v11x00b9' .* claude "\$\(cat '.*dev--v11x00b9--claude\.txt'\)"$/);
    assert.equal(payload.dir, path.join(ROOT, 'dev', 'v11x00b9'));
    const prompt = fs.readFileSync(payload.cmd.match(/cat '([^']+)'/)[1], 'utf8');
    assert.match(prompt, /^The project dev\/v11x00b9 was just built here with Varbase 11 and installed\.\n\nRun \$\(rm -rf \/\)/);
    assert.equal(fs.statSync(payloadFile).mode & 0o777, 0o600);
    fs.unlinkSync(payloadFile);
    fs.unlinkSync(payload.cmd.match(/cat '([^']+)'/)[1]);
  } finally {
    if (old === undefined) delete process.env.WORKSPACE_ROOT; else process.env.WORKSPACE_ROOT = old;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('Start AI offers the Claude Code options New screen offers, with the local agents as a list and no placeholders', () => {
  assert.match(server, /claudeArgsHtml\(\{ target: `ws:\$\{bm\[1\]\}`, agentSelect: true \}\)\)\.replace\(\/ placeholder="\[\^"\]\*"\/g, ''\)/);
  assert.match(server, /const \{ words, problems \} = claudeArgs\.flagsFromForm\(options, form\);\n      if \(problems\.length\)/);
  const screens = fs.readFileSync(path.join(root, 'screens.js'), 'utf8');
  assert.match(screens, /claudeArgFieldHtml\(o, valueOf\(o\), suggestionsFor\(o\), !!p\.agentSelect && o\.name === '--agent'\)/);
  assert.match(screens, /<option value="">None<\/option>/);
});

test('the chosen Claude Code options go on the claude line after the build', () => {
  const ai = require('../../build-ai');
  const { ROOT } = require('../../workspaces');
  const r = ai.afterBuildStep({ ws: 'dev', dir: path.join(ROOT, 'dev'), project: 'v11x00b8', flags: ['--agent', 'varbase-ai-expert', '--permission-mode', 'plan'] });
  const payloadFile = r.step.match(/'([^']+\.start\.json)'$/)[1];
  const payload = JSON.parse(fs.readFileSync(payloadFile, 'utf8'));
  assert.match(payload.cmd, / claude --agent varbase-ai-expert --permission-mode plan "\$\(cat '/);
  fs.unlinkSync(payloadFile);
  fs.unlinkSync(payload.cmd.match(/cat '([^']+)'/)[1]);
});

test('the Start AI prompt is an Ace editor, loaded only when Start AI is ticked, with @ suggestions', () => {
  assert.match(server, /name="ai_prompt" rows="5" maxlength="4000" aria-label="What the AI should do"\n\s+data-ace-on-demand="markdown" data-mentions="\/fragments\/ai-suggest\/\$\{esc\(key\)\}"><\/textarea>/);
  const ui = fs.readFileSync(path.join(root, 'public/ui.js'), 'utf8');
  assert.match(ui, /matches\('input\[name="ai_after"\]'\)/);
  assert.match(ui, /ta\.dataset\.ace = ta\.dataset\.aceOnDemand;\n  attachAce\(form\);/);
});
