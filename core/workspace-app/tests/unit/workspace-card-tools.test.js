/**
 * The tools on a home page workspace card: Edit opens the card editor, Settings opens the workspace's own file.
 */

const { test } = require('node:test');
const assert = require('node:assert');

const tools = require('../../workspace-card-tools');

const w = { key: 'dev', label: 'Dev', icon: 'tabler:code' };

test('the corner offers Edit and Settings for the workspace it is on', () => {
  const html = tools.cornerHtml(w);
  assert.match(html, /hx-get="\/fragments\/workspace-edit\/dev"[\s\S]*hx-target="#editor-modal-body"/);
  assert.match(html, /href="\/settings\/workspace\.dev\.settings\.yml"/);
  assert.match(html, /data-tabmodal-open="\/fragments\/settings\/modal\?tab=workspace\.dev\.settings\.yml"/);
  assert.doesNotMatch(html, /ws-backups/);
});

test('the backups count joins the corner when there are backups', () => {
  const html = tools.cornerHtml(w, { backupCount: 2, backupsUrl: 'https://dev.example/backups' });
  assert.match(html, /class="ws-backups" href="https:\/\/dev\.example\/backups" title="View the 2 backups for Dev"/);
  assert.ok(html.indexOf('ws-backups') < html.indexOf('ws-card-tool'));
});

test('the edit modal names the card and wraps the presentation editor', () => {
  const html = tools.editModalHtml(w, '<div id="ws-presentation"></div>');
  assert.match(html, /Edit the Dev card/);
  assert.match(html, /<div id="ws-presentation"><\/div>/);
});
