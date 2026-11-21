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
  assert.match(server, /<div class="create-actions">\$\{others\.join\(''\)\}\$\{primary\.map\(\(it\) => it\.html\)\.join\(''\)\}<\/div>/);
});

// The primary action of a files workspace ("New doc") sat at the left of a row of filled buttons, where a
// sites workspace's ("Build") sits at the right end of its box, with nothing else filled beside it.
test('a files workspace places its primary action where a sites workspace places Build, and quiets the others', () => {
  assert.match(server, /const primary = rest\.filter\(\(it\) => \/\\buk-button-primary\\b\/\.test\(it\.html\)\);/);
  assert.match(server, /const others = rest\.filter\(\(it\) => !primary\.includes\(it\)\)\.map\(\(it\) => it\.html\.replace\(\/\\buk-button-secondary\\b\/, 'uk-button-default'\)\);/,
    'the other ways to make something are outline buttons in the card');
  const css = fs.readFileSync(path.join(root, 'public/css/components/create-card.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const box = css.match(/\.create-actions \{([^}]*)\}/)[1];
  for (const d of ['border: 1px solid var(--line)', 'border-radius: 0.875rem', 'padding: 0.625rem 0.75rem']) assert.ok(box.includes(d), `the box is drawn like the build form: ${d}`);
  assert.match(css, /\.create-actions > \.uk-button-primary \{ margin-left: auto; \}/, 'at the right end, where Build is');
  assert.match(css, /\.create-actions \.action-btn\.uk-button-primary \{ padding: 0 1\.25rem; line-height: 2\.5rem; \}/, 'as tall as Build');
  assert.match(css, /@media \(max-width: 39\.9375em\) \{\s*\.create-actions > \.uk-button \{ flex: 1 1 100%; justify-content: center; \}/, 'stacked on a phone, the primary last, as Build is');
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
    const r = ai.afterBuildStep({ ws: 'dev', dir: path.join(ROOT, 'dev'), project: 'v11x00b9', label: 'Webship 11', installed: true,
      text: 'Run $(rm -rf /) and `whoami`' });
    assert.equal(r.session, 'dev--v11x00b9--claude');
    assert.doesNotMatch(r.step, /rm -rf|whoami/);
    assert.match(r.step, /^node '.*scripts\/screen-then\.js' '.*\.screens\/prompts\/dev--v11x00b9--claude\.start\.json'$/);
    // The step runs on the host, so the helper is found from the workspace root, never the container's own path.
    assert.ok(r.step.startsWith(`node '${path.join(ROOT, 'core', 'workspace-app', 'scripts', 'screen-then.js')}'`));
    const payloadFile = r.step.match(/'([^']+\.start\.json)'$/)[1];
    const payload = JSON.parse(fs.readFileSync(payloadFile, 'utf8'));
    assert.match(payload.cmd, /^exec env WEBSHIP_WORKSPACE='dev' WEBSHIP_PROJECT='v11x00b9' .* claude --session-id [0-9a-f-]{36} "\$\(cat '.*dev--v11x00b9--claude\.txt'\)"$/);
    // The conversation's id is chosen here, and the note the session gets when it starts carries the same one.
    assert.equal(payload.note.claude, payload.cmd.match(/--session-id ([0-9a-f-]{36})/)[1]);
    assert.equal(payload.note.kind, 'claude');
    assert.equal(payload.dir, path.join(ROOT, 'dev', 'v11x00b9'));
    const prompt = fs.readFileSync(payload.cmd.match(/cat '([^']+)'/)[1], 'utf8');
    assert.match(prompt, /^The project dev\/v11x00b9 was just built here with Webship 11 and installed\.\n\nRun \$\(rm -rf \/\)/);
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
  const r = ai.afterBuildStep({ ws: 'dev', dir: path.join(ROOT, 'dev'), project: 'v11x00b8', flags: ['--agent', 'webship-ai-expert', '--permission-mode', 'plan'] });
  const payloadFile = r.step.match(/'([^']+\.start\.json)'$/)[1];
  const payload = JSON.parse(fs.readFileSync(payloadFile, 'utf8'));
  assert.match(payload.cmd, / claude --session-id [0-9a-f-]{36} --agent webship-ai-expert --permission-mode plan "\$\(cat '/);
  assert.deepStrictEqual(payload.note.flags, ['--agent', 'webship-ai-expert', '--permission-mode', 'plan']);
  fs.unlinkSync(payloadFile);
  fs.unlinkSync(payload.cmd.match(/cat '([^']+)'/)[1]);
});

test('the Start AI prompt is an Ace editor, loaded only when Start AI is ticked, with @ suggestions', () => {
  assert.match(server, /name="ai_prompt" rows="5" maxlength="4000" aria-label="What the AI should do"\n\s+data-ace-on-demand="markdown" data-mentions="\/fragments\/ai-suggest\/\$\{esc\(key\)\}"><\/textarea>/);
  const ui = fs.readFileSync(path.join(root, 'public/ui.js'), 'utf8');
  assert.match(ui, /matches\('input\[name="ai_after"\]'\)/);
  assert.match(ui, /ta\.dataset\.ace = ta\.dataset\.aceOnDemand;\n  attachAce\(form\);/);
});

// The create box drew the other ways to make something as outline buttons, but the rail built them filled
// (uk-button-secondary), so on /docs at 390 "Generate site doc" was filled in the rail and outlined in the
// box on the same first screen. They are built outline where they are made.
test('every create action but the primary one is built outline, so the rail and the create box agree', () => {
  const images = fs.readFileSync(path.join(root, 'images-page.js'), 'utf8');
  for (const label of ['Generate with AI', 'Generate site doc', 'Screenshot a site', 'Generate script with AI']) {
    assert.match(server + images, new RegExp(`btn\\('default', '[^']+', '${label}'`), `${label} is outline where it is made`);
    assert.doesNotMatch(server + images, new RegExp(`btn\\('secondary', '[^']+', '${label}'`), `${label} is still filled`);
  }
});
