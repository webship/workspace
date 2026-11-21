/**
 * From the accessibility test of this round, on the settings files' switches (General has 35):
 * - each had two labels, its name and a label wrapping it around the On/Off word, and axe asked for a review
 *   on every one (form-field-multiple-labels);
 * - the off track was --line-strong, 1.76:1 on the light card and 1.85:1 on the dark one (WCAG 1.4.11);
 * - one read as its raw key, avatars_discover, like eight other core keys;
 * - with text spacing at 320, a fieldset's long legend ("ai_providers.claude_code_cli") pushed the page 10px
 *   sideways (WCAG 1.4.12).
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const yaml = require('js-yaml');

const APP = path.join(__dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(APP, ...p), 'utf8');
const css = (...p) => read('public', 'css', ...p).replace(/\/\*[\s\S]*?\*\//g, '');

test('a switch has one name, its setting\'s; the On/Off word still turns it, hidden from a screen reader', () => {
  const src = read('server.js');
  assert.match(src, /<div class="settings-key"><label for="\$\{id\}" id="\$\{id\}-name">\$\{esc\(name\)\}<\/label>/);
  const at = src.indexOf('<span class="settings-toggle">');
  assert.ok(at > 0, 'the switch is still wrapped in a label');
  const row = src.slice(at, src.indexOf('</span>', src.indexOf('settings-switch-state', at)) + 7);
  assert.match(row, /<input class="settings-switch" type="checkbox" role="switch" id="\$\{id\}" aria-labelledby="\$\{id\}-name"/);
  assert.match(row, /<label class="uk-text-meta settings-switch-state" for="\$\{id\}" aria-hidden="true">\$\{on \? 'On' : 'Off'\}<\/label>/);
  assert.doesNotMatch(src, /<label class="settings-toggle">/);
});

test('off, the track has a field\'s 3:1 edge and a knob of the same colour; on, it is filled', () => {
  const c = css('components', 'settings-editor-core-config-yml.css');
  const EDGE = 'color-mix(in srgb, var(--text-subtle) 70%, var(--surface-card))';
  const off = c.match(/\.settings-switch \{([^}]*)\}/)[1];
  assert.ok(off.includes(`border: 1px solid ${EDGE}`), 'no edge on the off track');
  assert.match(off, /background: var\(--surface-card\)/);
  assert.doesNotMatch(off, /--line-strong/);
  assert.ok(c.match(/\.settings-switch::after \{([^}]*)\}/)[1].includes(`background: ${EDGE}`));
  assert.match(c, /\.settings-switch:checked \{ border-color: var\(--brand-primary\); background: var\(--brand-primary\); \}/);
  assert.match(c, /\.settings-switch:checked::after \{ background: var\(--surface-card\);/);
});

test('a settings group\'s long legend wraps instead of widening the page', () => {
  const c = css('components', 'responsive-home-and-the-workspace-pages.css');
  assert.match(c.match(/\.settings-group \{([^}]*)\}/)[1], /min-inline-size: 0;/);
  assert.match(c.match(/\.settings-group-name \{([^}]*)\}/)[1], /overflow-wrap: anywhere;/);
});

test('the core keys that read as raw keys have labels', () => {
  const labels = yaml.load(fs.readFileSync(path.join(APP, '..', 'config', 'settings.labels.yml'), 'utf8'));
  for (const k of ['assistant.avatars_discover', 'assistant.avatar', 'assistant.memory', 'assistant.agent', 'ai_providers.xai.api_key',
    'ai_providers.stability.api_key', 'auth.google.enabled', 'auth.google.allowed_domains', 'auth.google.session_hours', 'language']) {
    assert.ok(labels[k] && labels[k].label, `${k} has no label`);
  }
  assert.deepStrictEqual(labels['auth.google.session_hours'].number, { min: 1, max: 720, step: 1 }, 'what the file says it takes');
});
