/**
 * Every plugin in Settings has a line that says what it is (#435).
 *
 * Google Drive read "No description": its manifest names it `google-drive-sync`, the catalogue lists it as
 * `google-drive`, so the catalogue's line was not found; and its description, "Google Drive for Webship
 * Workspace: a Sync to Drive button …", was cut at the colon down to its own name, which says nothing.
 */
const assert = require('node:assert');
const { test } = require('node:test');

const model = require('../../settings-model');

const drive = {
  name: 'google-drive-sync', module: '@webship.co/workspace-google-drive', version: '1.0.12',
  manifest: { name: 'google-drive-sync', label: 'Google Drive' },
  description: 'Google Drive for Webship Workspace: a Sync to Drive button on the videos, audio, docs, specs and test workspaces, the command line behind it, a Google Drive MCP server for Claude Code, and the plugin\'s own settings file. It carries its AI items.',
};

test('a plugin the catalogue lists under another id is found by its package: its line, family and name', () => {
  assert.strictEqual(model.summaryOf(drive), 'Sync a workspace folder to Google Drive, and its MCP server');
  assert.strictEqual(model.familyOf(drive), 'features');
  assert.strictEqual(model.nameOf({ ...drive, manifest: { name: 'google-drive-sync' } }), 'Google Drive', 'the catalogue name when the manifest has no label');
  const [features] = model.groupByFamily([{ ...drive, step: 2, wants: { unmet: [], problems: [] } }]);
  assert.strictEqual(features.plugins[0].summary, 'Sync a workspace folder to Google Drive, and its MCP server');
});

test('a description that opens "<Name> for Webship Workspace:" says what it is after the colon', () => {
  const unlisted = { ...drive, name: 'x-drive', module: '@example/x-drive', manifest: { name: 'x-drive', label: 'Google Drive' } };
  // Longer than a line: cut at a word, with the sign that it goes on.
  assert.strictEqual(model.summaryOf(unlisted), 'A Sync to Drive button on the videos, audio, docs, specs and test workspaces, the command line behind it, a Google Drive MCP server for…');
  // The plain cases keep their answers.
  assert.strictEqual(model.summaryOf({ name: 'x', module: '@example/x', manifest: { name: 'x', label: 'Thing' }, description: 'Thing for Webship Workspace' }), '');
  assert.strictEqual(model.summaryOf({ name: 'y', module: '@example/y', manifest: { name: 'y' }, description: 'The thing that does one job well. And a second sentence.' }), 'The thing that does one job well');
});
