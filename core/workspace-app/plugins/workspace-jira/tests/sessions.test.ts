/**
 * The Claude Code runs a workitem has had: noted when a session starts, read back live or finished.
 * The conversation id is claimed only when a transcript appeared AFTER the run began.
 */
import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';

import sessionsFactory from '../src/lib/sessions';
import { workspaceTree } from './fake-api';

function runsIn(root: string, transcripts: () => any[] = () => []) {
  return sessionsFactory({ ROOT: root, claudeSessionsFor: transcripts } as any);
}

test('a workitem key is read back out of a session name, in the shape Jira writes it', () => {
  const runs = runsIn(workspaceTree());
  assert.strictEqual(runs.keyOfSession('dev--blog1--jira-webship-2199'), 'WEBSHIP-2199');
  assert.strictEqual(runs.keyOfSession('test--ruverify1--jira-webship-9999--2'), 'WEBSHIP-9999', 'found in the middle too');
  for (const bad of ['dev--blog1--claude', 'dev--blog1--jira-2199', '', undefined]) assert.strictEqual(runs.keyOfSession(bad), '');
});

test('every run is noted, so a finished one is still listed, newest first, live ones first', () => {
  const root = workspaceTree();
  const runs = runsIn(root);
  runs.recordRun('test--unit--jira-unit-1', { key: 'UNIT-1', workspace: 'test', project: 'unit', dir: '/nowhere' });
  assert.ok(fs.existsSync(runs.noteFile('test--unit--jira-unit-1')));
  let list = runs.runsFor('UNIT-1', []);
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].live, false);
  assert.strictEqual(list[0].project, 'test/unit');
  // A live session that was never noted still belongs to the workitem.
  list = runs.runsFor('UNIT-1', [{ session: 'dev--x--jira-unit-1', state: 'Detached' }, { session: 'dev--x--jira-unit-1--old', state: 'Dead' }]);
  assert.strictEqual(list.length, 2);
  assert.strictEqual(list[0].live, true, 'the live one first');
  assert.strictEqual(runs.runsFor('OTHER-1', []).length, 0);
});

test('the conversation id is claimed only from a transcript written after the run began', async () => {
  const root = workspaceTree();
  const before = { id: 'old1', at: Date.now() - 60000 };
  const runsOld = runsIn(root, () => [before]);
  runsOld.recordRun('s1', { key: 'UNIT-2', dir: path.join(root, 'dev', 'site1') });
  assert.strictEqual(await runsOld.fillClaudeId('s1', path.join(root, 'dev', 'site1'), { tries: 1, waitMs: 1 }), '', 'an older transcript is not this run');
  const runsNew = runsIn(root, () => [{ id: 'new1', at: Date.now() + 1000 }]);
  runsNew.recordRun('s2', { key: 'UNIT-2', dir: path.join(root, 'dev', 'site1') });
  assert.strictEqual(await runsNew.fillClaudeId('s2', path.join(root, 'dev', 'site1'), { tries: 1, waitMs: 1 }), 'new1');
  assert.strictEqual(runs(root).readNote('s2')!.claude, 'new1', 'written into the note');
});

function runs(root: string) { return runsIn(root); }
