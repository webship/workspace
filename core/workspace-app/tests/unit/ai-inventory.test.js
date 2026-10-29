const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { descriptionOf, suggestFor, aiInventory, TRIGGERS } = require('../../ai-inventory');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-inv-'));
const write = (name, body) => { const f = path.join(tmp, name); fs.writeFileSync(f, body); return f; };

test('a plain frontmatter description is read', () => {
  const f = write('a.md', '---\nname: a\ndescription: Build a Drupal project.\n---\n\n# body\n');
  assert.equal(descriptionOf(f), 'Build a Drupal project.');
});

test('a FOLDED description is joined back into one line', () => {
  // YAML lets a long description continue on indented lines, and real agents use it —
  // reading only the first line would cut the sentence that decides whether to use them.
  const f = write('b.md', '---\nname: b\ndescription: Use this agent when\n  the workspace needs a\n  new builder script.\nmodel: opus\n---\n');
  assert.equal(descriptionOf(f), 'Use this agent when the workspace needs a new builder script.');
});

test('a following key does not get swallowed into the description', () => {
  const f = write('c.md', '---\nname: c\ndescription: Short one.\nmodel: opus\ncolor: green\n---\n');
  assert.equal(descriptionOf(f), 'Short one.');
});

test('quotes are stripped, and a file with no frontmatter has no description', () => {
  assert.equal(descriptionOf(write('d.md', '---\ndescription: "Quoted."\n---\n')), 'Quoted.');
  assert.equal(descriptionOf(write('e.md', '# Just a heading\n')), '');
  assert.equal(descriptionOf(path.join(tmp, 'missing.md')), '');
});

test('each kind is offered by the right trigger', () => {
  // The contract the popup and the Ace completer both rely on.
  assert.deepEqual(TRIGGERS.agent, ['@']);
  assert.deepEqual(TRIGGERS.command, ['/']);
  assert.deepEqual(TRIGGERS.skill, ['@', '/'], 'a skill is both named and invoked');
});

test('the inventory reads this machine and every item is well formed', () => {
  const all = aiInventory();
  assert.ok(all.length > 0, 'no items found at all');
  for (const i of all.slice(0, 40)) {
    assert.match(i.kind, /^(agent|skill|command)$/);
    assert.ok(i.name && !i.name.endsWith('.md'), `bad name: ${i.name}`);
    assert.ok(Array.isArray(i.triggers) && i.triggers.length, `no triggers: ${i.name}`);
    assert.ok(i.where, `no provenance: ${i.name}`);
  }
});

test('a "/" query never returns an agent, and "@" never returns a command', () => {
  assert.equal(suggestFor('/', '').filter((i) => i.kind === 'agent').length, 0);
  assert.equal(suggestFor('@', '').filter((i) => i.kind === 'command').length, 0);
});

test('a name that starts with what was typed ranks above one that merely contains it', () => {
  const hits = suggestFor('@', 'workspace');
  const starts = hits.findIndex((i) => i.name.toLowerCase().startsWith('workspace'));
  const contains = hits.findIndex((i) => !i.name.toLowerCase().startsWith('workspace')
    && i.name.toLowerCase().includes('workspace'));
  if (starts !== -1 && contains !== -1) assert.ok(starts < contains, 'prefix match must come first');
});
