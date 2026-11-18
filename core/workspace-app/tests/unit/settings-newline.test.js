/**
 * A value typed or pasted into a Settings field never breaks the file.
 *
 * A newline in a field's value was written as it was: the rest of the value became a line of its own and
 * the file stopped parsing ("can not read a block mapping entry"), and with it every setting in it.
 * Control characters are written double-quoted now and read back as typed; and a save that would leave a
 * parsing file unparseable writes nothing.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const APP = path.join(__dirname, '..', '..');

test('a newline, a tab or another control character in a value is written so the file parses and reads it back', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-settings-nl-'));
  const config = path.join(root, 'core', 'config');
  fs.mkdirSync(config, { recursive: true });
  fs.writeFileSync(path.join(config, 'workspace.dev.settings.yml'), "doc:\n  name: dev\n  label: 'Dev'\ntype: sites\n");
  const r = spawnSync(process.execPath, ['-e', `
    const sf = require('./settings-file');
    const yaml = require('js-yaml');
    const fs = require('fs');
    const file = 'workspace.dev.settings.yml';
    const rows = sf.readSettingsRows(file);
    const name = rows.find((x) => x.dotted === 'doc.name');
    const label = rows.find((x) => x.dotted === 'doc.label');
    sf.writeSettingsValues(file, [
      { line: name.line, key: name.key, value: 'Dev\\nbroken line' },
      { line: label.line, key: label.key, value: 'Tab\\there \\u0007 bell', quote: "'" },
    ]);
    const doc = yaml.load(fs.readFileSync(${JSON.stringify(path.join(config, 'workspace.dev.settings.yml'))}, 'utf8'));
    process.stdout.write(JSON.stringify(doc));
  `], { cwd: APP, env: { ...process.env, WORKSPACE_ROOT: root, WORKSPACE_CONFIG: config }, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  const doc = JSON.parse(r.stdout);
  assert.strictEqual(doc.doc.name, 'Dev\nbroken line', 'the newline is kept, inside the value');
  assert.strictEqual(doc.doc.label, 'Tab\there \u0007 bell');
  assert.strictEqual(doc.type, 'sites', 'and the rest of the file is as it was');
  fs.rmSync(root, { recursive: true, force: true });
});
