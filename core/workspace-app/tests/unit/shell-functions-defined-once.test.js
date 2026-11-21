/**
 * Every function of a core script is defined once (webship/workspace#675).
 *
 * plugins.sh defined plugin_active() twice. Bash keeps the last definition, so the first never ran: a reader who
 * changed it changed nothing. This reads every .sh under core/scripts and finds no name defined twice in one file.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const SCRIPTS = path.join(__dirname, '..', '..', '..', 'scripts');
const files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  if (e.isDirectory()) return e.name === 'node_modules' ? [] : files(p);
  return e.name.endsWith('.sh') ? [p] : [];
});

test('no function is defined twice in one core script', () => {
  const all = files(SCRIPTS);
  assert.ok(all.length > 20, `read ${all.length} scripts`);
  const twice = [];
  for (const f of all) {
    const names = [...fs.readFileSync(f, 'utf8').matchAll(/^([A-Za-z_][A-Za-z0-9_]*) *\(\) *\{/gm)].map((m) => m[1]);
    const dup = names.filter((n, i) => names.indexOf(n) !== i);
    if (dup.length) twice.push(`${path.relative(SCRIPTS, f)}: ${[...new Set(dup)].join(', ')}`);
  }
  assert.deepStrictEqual(twice, []);
});

test('plugins.sh asks plugin-needs whether a plugin is active, in one place', () => {
  const sh = fs.readFileSync(path.join(SCRIPTS, 'plugins.sh'), 'utf8');
  assert.strictEqual((sh.match(/^plugin_active\(\)/gm) || []).length, 1);
  assert.match(sh, /^plugin_active\(\) \{ \( cd "\$\{APP\}" && node -e 'process\.exit\(require\("\.\/plugin-needs"\)\.state\(\)\.active\.has/m);
});
