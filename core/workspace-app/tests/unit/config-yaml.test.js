const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const CONFIG = path.join(__dirname, '..', '..', '..', 'config');

// Every .yml in core/config must actually be YAML.
//
// core/config/norms.yml was NOT, for as long as it had existed: one entry began with a
// backtick (a reserved indicator) and two carried a colon-space (read as a key separator).
// Nothing broke, because the only reader `cat`s it into a prompt — but it sat beside
// settings.yml and the workspace.*.settings.yml files, which ARE parsed, and anything that
// walked the directory would have thrown or silently produced nothing. `parse_yaml` gave
// zero variables from it. Found by a testing round rather than by a failure, which is the
// wrong way round; this makes the next one fail loudly instead.
test('every YAML file in core/config parses', () => {
  const files = fs.readdirSync(CONFIG).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
  assert.ok(files.length > 5, `expected the config directory, found ${files.length} files`);
  const broken = [];
  for (const f of files) {
    try { yaml.load(fs.readFileSync(path.join(CONFIG, f), 'utf8')); } catch (e) {
      broken.push(`${f}: ${String(e.message).split('\n')[0]}`);
    }
  }
  assert.deepEqual(broken, [], 'these are not valid YAML');
});

test('norms.yml carries the three lists cmd-spdd.sh states it does', () => {
  const d = yaml.load(fs.readFileSync(path.join(CONFIG, 'norms.yml'), 'utf8'));
  for (const key of ['norms', 'safeguards', 'canvas_required_sections']) {
    assert.ok(Array.isArray(d[key]) && d[key].length, `norms.yml has no ${key} list`);
  }
});

test('the workspace registry and every workspace settings file parse', () => {
  const settings = yaml.load(fs.readFileSync(path.join(CONFIG, 'settings.yml'), 'utf8'));
  assert.ok(Array.isArray(settings.workspaces) && settings.workspaces.length, 'no workspaces list');
  const missing = settings.workspaces.filter(
    (w) => !fs.existsSync(path.join(CONFIG, `workspace.${w}.settings.yml`)));
  // A registered workspace with no settings file renders as a card that configures nothing.
  assert.deepEqual(missing, [], 'registered workspaces with no settings file');
});

// The release a machine runs comes from core/workspace-app/.app-version, written by
// install.sh, sync-tooling.sh --pull and update.sh. package.json's "version" is npm
// metadata for an app that is never published, and it has said 1.0.0 since the first
// commit — which is worse than no answer, because it looks like one. Nothing may read it
// for display, or two numbers start disagreeing in public.
test('nothing displays package.json version — .app-version is the only source', () => {
  const app = path.join(__dirname, '..', '..');
  const readers = [];
  for (const f of ['server.js', 'workspaces.js', 'screens.js', 'assistant.js']) {
    const src = fs.readFileSync(path.join(app, f), 'utf8');
    // require('./package.json').version, or reading the file and pulling .version out
    if (/package\.json'\s*\)\s*\.version|packageJson\.version/.test(src)) readers.push(f);
  }
  assert.deepEqual(readers, [], 'these read package.json version — use appVersion() instead');
});

test('appVersion reads the stamp, and says nothing when there is none', () => {
  const { appVersion } = require(path.join(__dirname, '..', '..', 'workspaces'));
  const v = appVersion();
  assert.equal(typeof v, 'string');
  // Either a real tag, or empty. Never a placeholder, never a guess.
  if (v) assert.match(v, /^[0-9]+\.[0-9]+\.[0-9]+/, `unexpected version stamp: ${v}`);
});


/* ---------- the assistant's name and placeholder, at both levels ---------- */

test('settings.yml names the assistant and says what its composer shows', () => {
  const text = fs.readFileSync(path.join(CONFIG, 'settings.yml'), 'utf8');
  assert.match(text, /^\s{2}name: AI Assistant$/m, 'the default name, for the home dashboard');
  assert.match(text, /^\s{2}placeholder: /m, 'and what the composer says when empty');
});

test('every workspace can be given its own, from the dashboard', () => {
  // The settings editor writes values onto lines that already exist — it does not add keys — so a
  // workspace whose file has no `assistant:` block offers no field to edit and the setting looks
  // like it does not exist. The shipped value is `default`, which means "inherit", so twenty-four
  // files carrying the key do not pin the name against a rename in settings.yml.
  const settings = yaml.load(fs.readFileSync(path.join(CONFIG, 'settings.yml'), 'utf8'));
  const without = [];
  for (const w of settings.workspaces) {
    const f = path.join(CONFIG, `workspace.${w}.settings.yml`);
    if (!fs.existsSync(f)) continue;
    const own = yaml.load(fs.readFileSync(f, 'utf8')) || {};
    if (!own.assistant || own.assistant.name === undefined || own.assistant.placeholder === undefined) without.push(w);
  }
  assert.deepEqual(without, [], 'these workspaces cannot name their assistant from the dashboard');
});

test('both settings are explained in the editor, not shown as bare keys', () => {
  // Without a label a row renders as the raw key — here, `name` and `placeholder` sitting under a
  // workspace's own `doc: name:` and `presentation:`, which is two rows called name on one page.
  const labels = yaml.load(fs.readFileSync(path.join(CONFIG, 'settings.labels.yml'), 'utf8'));
  for (const k of ['assistant.name', 'assistant.placeholder']) {
    assert.ok(labels[k] && labels[k].label, `${k} has no label`);
    assert.ok(labels[k].info, `${k} says nothing about what it does`);
  }
});

test('the composer is never handed an empty placeholder', () => {
  // deep-chat reads it as `placeholder.text || "Ask me anything!"`, so an empty string does not
  // remove its placeholder, it restores deep-chat's. Whatever is passed must be a real string, and
  // the hiding is done in CSS — which also keeps the aria-label that textbox needs.
  const ui = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'ui.js'), 'utf8');
  assert.match(ui, /placeholder: \{ text: cfg\.placeholder \|\| `Message the \$\{cfg\.name \|\| 'AI Assistant'\}` \}/,
    'an empty text here brings back "Ask me anything!"');
  assert.match(ui, /#text-input:empty::before \{ content: "" !important; \}/,
    'the placeholder is hidden by blanking what is drawn, not by blanking what it is called');
  assert.match(ui, /\.deep-chat-intro \{ display: none !important; \}/,
    'and the empty intro bubble is hidden, not left as a blank pill at the top of every transcript');
});
