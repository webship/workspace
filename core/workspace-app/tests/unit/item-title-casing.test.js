/**
 * An AI item a plugin placed is titled with the casing the plugin's label gives its own name:
 * "WooCommerce Tester", not "Woocommerce Tester" (webship/workspace#494). No item has to carry a
 * new field, and an item no plugin placed keeps the usual title case.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { nameCasing } = require('../../plugin-manifest');

// humanItemName lives in server.js beside the words it knows; it is evaluated here from its source.
const src = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');
const from = src.indexOf('const NAME_WORDS = {');
const to = src.indexOf('\nfunction listItems(');
assert.ok(from > 0 && to > from, 'the name helpers are found in server.js');
// eslint-disable-next-line no-new-func
const { humanItemName } = new Function(`${src.slice(from, to)}\nreturn { humanItemName };`)();

test('a plugin label gives the casing of the words of its name', () => {
  assert.deepStrictEqual(nameCasing('woocommerce', 'WooCommerce'), { woocommerce: 'WooCommerce' });
  assert.deepStrictEqual(nameCasing('django-cms', 'django CMS'), { django: 'django', cms: 'CMS' });
  assert.deepStrictEqual(nameCasing('typo3', 'TYPO3'), { typo3: 'TYPO3' });
  assert.deepStrictEqual(nameCasing('magento', 'Magento Open Source'), {}, 'a label that is not the name word for word');
  assert.deepStrictEqual(nameCasing('bootstrap', ''), {});
  assert.deepStrictEqual(nameCasing('', 'Anything'), {});
});

test("an item a plugin placed is titled with the plugin's casing; any other keeps the usual title case", () => {
  assert.strictEqual(humanItemName('woocommerce-tester', nameCasing('woocommerce', 'WooCommerce')), 'WooCommerce Tester');
  assert.strictEqual(humanItemName('woocommerce-tester'), 'Woocommerce Tester', 'no plugin, no casing of its own');
  assert.strictEqual(humanItemName('codeigniter-site-builder', nameCasing('codeigniter', 'CodeIgniter')), 'CodeIgniter Site Builder');
  assert.strictEqual(humanItemName('django-cms-tester', nameCasing('django-cms', 'django CMS')), 'django CMS Tester');
  assert.strictEqual(humanItemName('figma-to-drupal'), 'Figma to Drupal', 'the known words and the small connectors stand');
});

test('the row of an item asks for the casing of the plugin that placed it', () => {
  assert.match(src, /humanItemName\(it\.name, itemCasing\(key, rel, it\.name, placedRecord, casings\)\)/);
  assert.match(src, /nameCasing\(p\.name, \(p\.manifest \|\| \{\}\)\.label\)/, 'from each installed plugin\'s label, once per page');
});
