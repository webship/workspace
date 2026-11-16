/**
 * An entry of the navigation that runs a command (`use:`). The entry is on every page and carries no
 * target, and a command runs on something: without a target the command's own run form opens in the
 * modal (the one the Commands page opens), instead of the answer "Pick a workspace." with nowhere to pick.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const actions = require('../../actions/navigation');
const cc = require('../../commands');

const run = async (form) => {
  let answer = null;
  await actions['/actions/nav-run']({ form, send: (html, code = 200) => { answer = { html: String(html), code }; } });
  return answer;
};

test('pressed without a target, the entry opens the run form of its command in the modal', async () => {
  const builtin = cc.listCommands ? cc.listCommands().find((c) => c.on === 'workspace') : null;
  const id = builtin ? builtin.id : 'workspace-disk-use';
  assert.ok(cc.findCommand(id), `${id} is a command of the catalog`);
  const r = await run({ id: 'rail:disk', use: id });
  assert.equal(r.code, 200);
  assert.match(r.html, new RegExp(`hx-get="/fragments/cc/run/${id}"`));
  assert.match(r.html, /hx-trigger="load"/);
  assert.match(r.html, /hx-target="#editor-modal-body"/);
  assert.doesNotMatch(r.html, /Pick a workspace/);
});

test('an entry whose command is gone says so', async () => {
  const r = await run({ id: 'rail:gone', use: 'no-such-command-here' });
  assert.equal(r.code, 400);
  assert.match(r.html, /No such command/);
});
