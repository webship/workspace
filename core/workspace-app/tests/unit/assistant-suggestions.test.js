/**
 * Suggested prompts in the assistant panel.
 *
 * What matters is what they are NOT: they never name a project, a branch, a command or a key, because
 * a name in a suggestion goes stale the day the thing is renamed, and a list that points at things
 * that are gone teaches the reader to skip the list. They are made from what a workspace states about
 * itself, so a new workspace gets sensible ones with no code change.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { suggestionsFor, defaultSuggestions, cleanSuggestions, MAX_SUGGESTIONS, MAX_LENGTH } = require('../../assistant-suggestions');
const { loadWorkspaces } = require('../../workspaces');

const app = (f) => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');
// The pronoun is the one capital a plain sentence may carry besides its first letter.
const plain = (s) => s.replace(/\bI\b/g, 'i');
const meta = (over) => ({ noun: 'project', nounPlural: 'projects', kind: 'projects', typeActions: new Set(['ddev', 'build', 'backup', 'tests', 'clone']), ...over });

test('every real workspace gets a short, general list', () => {
  const all = loadWorkspaces();
  assert.ok(Object.keys(all).length > 5, 'there are workspaces to check');
  for (const [key, ws] of Object.entries(all)) {
    const list = suggestionsFor({ context: `workspace:${key}`, meta: ws });
    assert.ok(list.length >= 3 && list.length <= MAX_SUGGESTIONS, `${key} has ${list.length}`);
    // Plain words only: a capital to start, lowercase after, and a question mark. That is what keeps a
    // project name, a script name, a key or a number out of every one of them.
    for (const s of list) assert.match(plain(s), /^[A-Z][a-z ,']*\?$/, `${key}: "${s}" names something or is not a question`);
  }
});

test('the pages that belong to no workspace get general ones too', () => {
  for (const context of ['home', 'assistant', 'settings', 'commands']) {
    const list = suggestionsFor({ context, meta: null });
    assert.ok(list.length >= 3, context);
    for (const s of list) assert.match(plain(s), /^[A-Z][a-z ,']*\?$/, `${context}: "${s}"`);
  }
});

test('a workspace is asked about its own kind of thing', () => {
  const dev = defaultSuggestions('workspace:dev', meta());
  assert.ok(dev.some((s) => /projects/.test(s)));
  const agents = defaultSuggestions('workspace:ai-agents', meta({ noun: 'agent', nounPlural: 'agents', kind: 'files', typeActions: new Set() }));
  assert.ok(agents.every((s) => /agent/.test(s)), 'every one is about agents');
  assert.ok(agents.some((s) => /add an agent/.test(s)), 'an agent, not a agent');
  const skill = defaultSuggestions('workspace:ai-skills', meta({ noun: 'skill', nounPlural: 'skills', kind: 'files', typeActions: new Set() }));
  assert.ok(skill.some((s) => /add a skill/.test(s)));
});

test('it never offers what the workspace cannot do', () => {
  const clones = defaultSuggestions('workspace:modules', meta({ noun: 'module', nounPlural: 'modules', typeActions: new Set(['build', 'graphify']) }));
  assert.ok(!clones.some((s) => /running\?$/.test(s) && /which are running/.test(s)), 'a folder of git clones has nothing "running"');
  assert.ok(!clones.some((s) => /back up/.test(s)), 'and cannot back anything up');
  assert.ok(clones.some((s) => /not committed/.test(s)));
  const site = defaultSuggestions('workspace:dev', meta());
  assert.ok(site.some((s) => /which are running/.test(s)));
  assert.ok(site.some((s) => /back up/.test(s)));
  const bare = defaultSuggestions('workspace:x', meta({ typeActions: new Set(['ddev']) }));
  assert.ok(!bare.some((s) => /build a new/.test(s)) && !bare.some((s) => /back up/.test(s)));
});

test('the backups page asks about backups', () => {
  const list = defaultSuggestions('backups:dev', meta());
  assert.ok(list.every((s) => /back ?up/.test(s)));
});

test('a workspace can say its own, and an empty list switches them off', () => {
  const m = meta();
  assert.deepStrictEqual(suggestionsFor({ context: 'workspace:dev', meta: m, own: ['What is in here?', 'How do I start?'] }), ['What is in here?', 'How do I start?']);
  assert.deepStrictEqual(suggestionsFor({ context: 'workspace:dev', meta: m, own: [] }), [], 'none, not the defaults');
  assert.strictEqual(suggestionsFor({ context: 'workspace:dev', meta: m, own: undefined }).length >= 3, true, 'absent means the defaults');
});

test('settings.yml gives one list to every page that has none of its own', () => {
  const m = meta();
  assert.deepStrictEqual(suggestionsFor({ context: 'workspace:dev', meta: m, global: ['Where is it?'] }), ['Where is it?']);
  assert.deepStrictEqual(suggestionsFor({ context: 'workspace:dev', meta: m, own: ['Mine?'], global: ['Where is it?'] }), ['Mine?'], 'the workspace wins');
  assert.deepStrictEqual(suggestionsFor({ context: 'home', meta: null, global: [] }), [], 'an empty global list switches it off');
});

test('what a person writes is cleaned the way the defaults are made', () => {
  assert.strictEqual(cleanSuggestions('not a list'), null);
  assert.strictEqual(cleanSuggestions(undefined), null);
  assert.deepStrictEqual(cleanSuggestions(['  spaced   out  ', '', '   ', 42, null, { a: 1 }, 'Spaced out']), ['spaced out'], 'trimmed, one line, deduplicated, strings only');
  assert.strictEqual(cleanSuggestions(Array.from({ length: 12 }, (_, i) => `Question ${i}?`)).length, MAX_SUGGESTIONS);
  assert.strictEqual(cleanSuggestions(['x'.repeat(500)])[0].length, MAX_LENGTH);
  assert.deepStrictEqual(cleanSuggestions(['one\ntwo']), ['one two'], 'one line each');
});

test('the page hands the list to the panel, and a workspace file can carry its own', () => {
  const server = app('server.js');
  assert.ok(server.includes("require('./assistant-suggestions')"));
  assert.ok(server.includes('suggestions });') || server.includes('suggestions };'), 'it is part of the settings the panel is given');
  assert.ok(server.includes('own: meta ? meta.assistantSuggestions : undefined'));
  assert.ok(app('workspaces.js').includes('assistantSuggestions: (wsSettings.assistant || {}).suggestions'));
});

test('the panel shows them only on an empty conversation, and a click fills the composer without sending', () => {
  const ui = app('public/ui.js');
  assert.ok(ui.includes('else showSuggestions();'), 'a thread with turns in it never sees them');
  assert.ok(ui.includes('deep-chat-temporary-message'), 'gone once anything is sent, never saved to the thread');
  assert.ok(ui.includes("'ws-suggestion':"));
  // The handler that runs on a click must not be able to send: the assistant has a shell.
  const handler = ui.slice(ui.indexOf("'ws-suggestion':"), ui.indexOf("'ws-suggestion':") + 500);
  assert.ok(handler.includes('fillComposer('));
  assert.ok(!handler.includes('submitUserMessage'));
  assert.ok(ui.includes('escapeHtml(s)'), 'text goes into the markup escaped');
  assert.ok(ui.includes('suggestTries += 1) < 8'), 'the retry is bounded');
});
