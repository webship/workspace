/**
 * The assistant's page context: the part that reaches into the rest of the app.
 *
 * Every branch of it names something from another module, and a name that is not imported throws
 * only when somebody asks a question from that page. That is not theoretical — after the module
 * split the settings and workspace branches referenced `listSettingsFiles`, `CONFIG_DIR`,
 * `findBuilderScripts` and `listBackups` without importing any of them, so the assistant worked on
 * the home page and returned HTTP 500 on every workspace page and on settings.
 *
 * These tests call it for every context the dashboard can send. They cost nothing (no agent is
 * spawned) and they fail on a missing import rather than leaving it for a person to find.
 */

const { test } = require('node:test');
const assert = require('node:assert');

const { pageContextFor } = require('../../assistant');
const { loadWorkspaces, findBuilderScripts, commandFlags } = require('../../workspaces');

test('every context the dashboard sends produces a context line', () => {
  const keys = Object.keys(loadWorkspaces());
  assert.ok(keys.length, 'there is at least one workspace to ask about');
  const contexts = ['home', 'settings', 'commands',
    ...keys.map((k) => `workspace:${k}`), ...keys.map((k) => `backups:${k}`)];
  for (const ctx of contexts) {
    const out = pageContextFor(ctx);
    assert.equal(typeof out, 'string', `${ctx} should produce a string`);
    assert.ok(out.length > 20, `${ctx} produced nothing useful: ${out}`);
  }
});

test('the settings context names the files but never a secret', () => {
  const out = pageContextFor('settings');
  assert.match(out, /Settings page/);
  assert.match(out, /settings\.yml/);
  // It has to TELL the agent not to reveal a secret — that instruction is the safeguard.
  assert.match(out, /NEVER print, echo, cat, grep/);
});

test('a workspace context names that workspace and its builders', () => {
  // NOT `Object.keys(...)[0]`: the first workspace is whichever one the cards are ordered to put
  // first, which is a setting somebody can drag. When `designs` was moved to the top this test began
  // failing on a Penpot builder that has no --install — a true statement about the wrong workspace.
  // Pick one that actually has a builder taking --install, which is what the assertion is about.
  const all = loadWorkspaces();
  const key = Object.keys(all).find((k) => {
    const dir = all[k].dir;
    return dir && findBuilderScripts(dir).some((b) => commandFlags(dir, b).some((f) => f.long === '--install'));
  });
  assert.ok(key, 'some workspace builds something with --install');
  const out = pageContextFor(`workspace:${key}`);
  assert.ok(out.includes(all[key].label), `should name ${all[key].label}`);
  // The AI Context carries each command's real flag contract, not just names.
  assert.match(out, /Command contract/);
  assert.match(out, /--install \(-i\)/);
});

test('an unknown workspace falls back to the home context rather than throwing', () => {
  assert.match(pageContextFor('workspace:no-such-workspace'), /home page/);
  assert.match(pageContextFor('nonsense'), /home page/);
});
