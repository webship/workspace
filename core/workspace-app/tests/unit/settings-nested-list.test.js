/**
 * Lists below the top level (auth.google.allowed_domains) are read and written by their dotted path,
 * at their own indentation, and an entry that is kept keeps its own line.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-nested-list-'));
process.env.WORKSPACE_CONFIG = TMP;

const { readListBlock, writeListBlock } = require('../../settings-file');

const FILE = 'settings.yml';
const TEXT = `workspaces:
  - dev
  - "images"   # quoted on purpose
auth:
  google:
    enabled: false
    allowed_domains:
      - example.com
    allowed_emails:
      - someone@example.org
    session_hours: 12
`;
const read = () => fs.readFileSync(path.join(TMP, FILE), 'utf8');

test('a nested list is found by its dotted path', () => {
  fs.writeFileSync(path.join(TMP, FILE), TEXT);
  const b = readListBlock(FILE, 'auth.google.allowed_domains');
  assert.deepStrictEqual(b.items, ['example.com']);
  assert.strictEqual(b.indent, '      ');
  assert.deepStrictEqual(readListBlock(FILE, 'auth.google.allowed_emails').items, ['someone@example.org']);
  assert.strictEqual(readListBlock(FILE, 'allowed_domains'), null);
  assert.strictEqual(readListBlock(FILE, 'auth.google.enabled'), null);
});

test('adding to a nested list writes at its indentation and leaves the rest alone', () => {
  fs.writeFileSync(path.join(TMP, FILE), TEXT);
  writeListBlock(FILE, 'auth.google.allowed_domains', ['example.com', 'example.org']);
  assert.strictEqual(read(), TEXT.replace('      - example.com\n', '      - example.com\n      - example.org\n'));
});

test('a kept entry keeps its quotes and comment; a removed one goes', () => {
  fs.writeFileSync(path.join(TMP, FILE), TEXT);
  writeListBlock(FILE, 'workspaces', ['images', 'dev', 'docs']);
  assert.ok(read().startsWith('workspaces:\n  - "images"   # quoted on purpose\n  - dev\n  - docs\nauth:\n'));
  writeListBlock(FILE, 'workspaces', ['images']);
  assert.ok(read().startsWith('workspaces:\n  - "images"   # quoted on purpose\nauth:\n'));
});
