const test = require('node:test');
const assert = require('node:assert/strict');

const o = require('../../ddev-options');

test('every project type in the DDEV docs is offered, and nothing else', () => {
  const docs = ['asterios', 'backdrop', 'cakephp', 'codeigniter', 'craftcms', 'drupal', 'drupal6', 'drupal7', 'drupal8', 'drupal9',
    'drupal10', 'drupal11', 'drupal12', 'generic', 'joomla', 'laravel', 'magento', 'magento2', 'maho', 'modx', 'php',
    'shopware6', 'silverstripe', 'symfony', 'typo3', 'wordpress', 'wp-bedrock'];
  assert.deepEqual([...o.PROJECT_TYPES].sort(), [...docs].sort());
});

test('PHP 5.6 to 8.5, and the database versions the docs list', () => {
  assert.ok(o.PHP_VERSIONS.includes('5.6') && o.PHP_VERSIONS.includes('8.5'));
  for (const db of ['mariadb:11.8', 'mariadb:12.3', 'mariadb:10.11', 'mysql:8.4', 'mysql:9.7', 'postgres:9', 'postgres:18']) {
    assert.ok(o.DATABASES.includes(db), db);
  }
  assert.ok(!o.DATABASES.includes('mariadb:11.0'));
});

test('a form becomes checked flags, and anything off the lists is dropped', () => {
  assert.deepEqual(o.configArgs({ project_type: 'typo3', docroot: 'public', php_version: '8.3', database: 'postgres:16',
    webserver_type: 'apache-fpm', nodejs_version: 'auto', composer_version: '2.2', omit_db: '1', python: '1' }), [
    '--project-type=typo3', '--docroot=public', '--php-version=8.3', '--database=postgres:16', '--webserver-type=apache-fpm',
    '--nodejs-version=auto', '--composer-version=2.2', '--omit-containers=db', '--webimage-extra-packages=python3-pip,python3-venv']);
  assert.deepEqual(o.configArgs({ project_type: 'x; rm -rf', docroot: '../etc', php_version: '__default', database: 'oracle:1' }), []);
  assert.equal(o.shellArgs(["--docroot=it's"]), "'--docroot=it'\\''s'");
});

test('the quickstart presets only use values DDEV accepts', () => {
  for (const p of o.PRESETS) {
    assert.ok(o.PROJECT_TYPES.includes(p.project_type), p.id);
    if (p.php_version) assert.ok(o.PHP_VERSIONS.includes(p.php_version), p.id);
    if (p.database) assert.ok(o.DATABASES.includes(p.database), p.id);
    if (p.webserver_type) assert.ok(o.WEBSERVERS.includes(p.webserver_type), p.id);
  }
  for (const id of ['typo3', 'laravel', 'symfony', 'craftcms', 'wagtail', 'nodejs', 'shopware6', 'joomla']) {
    assert.ok(o.PRESETS.some((p) => p.id === id), id);
  }
});

test('the fields start on DDEV defaults, or on what the project already uses', () => {
  const fresh = o.fieldsHtml({ prefix: 't' });
  assert.match(fresh, /data-ddev-preset/);
  assert.match(fresh, /<option value="php" selected>php<\/option>/);
  assert.match(fresh, /name="php_version"><option value="__default" selected>/);
  const now = o.fieldsHtml({ prefix: 't', current: { project_type: 'drupal11', php_version: '8.3', omit_db: true } });
  assert.match(now, /<option value="drupal11" selected>/);
  assert.match(now, /<option value="8.3" selected>/);
  assert.match(now, /name="omit_db" value="1" checked/);
});
