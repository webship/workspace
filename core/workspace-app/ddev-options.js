/**
 * What `ddev config` accepts, as the DDEV docs list it (docs.ddev.com, users/configuration/config and
 * users/quickstart, checked against `ddev config --help` on v1.25.4), and the form that offers it.
 *
 * Every value is picked from a list, never typed into a shell line.
 */

const { esc } = require('./html');

const PROJECT_TYPES = ['php', 'generic', 'drupal12', 'drupal11', 'drupal10', 'drupal9', 'drupal8', 'drupal7', 'drupal6', 'drupal',
  'backdrop', 'wordpress', 'wp-bedrock', 'typo3', 'laravel', 'symfony', 'craftcms', 'shopware6', 'magento2', 'magento', 'maho',
  'joomla', 'silverstripe', 'cakephp', 'codeigniter', 'modx', 'asterios'];

const PHP_VERSIONS = ['8.5', '8.4', '8.3', '8.2', '8.1', '8.0', '7.4', '7.3', '7.2', '7.1', '7.0', '5.6'];

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => String(b - i));
const DATABASES = [
  ...['12.3', '11.8', '11.4', '10.11', '10.8', '10.7', '10.6', '10.5', '10.4', '10.3', '10.2', '10.1', '10.0', '5.5'].map((v) => `mariadb:${v}`),
  ...['9.7', '8.4', '8.0', '5.7', '5.6', '5.5'].map((v) => `mysql:${v}`),
  ...range(9, 18).map((v) => `postgres:${v}`),
];

const WEBSERVERS = ['nginx-fpm', 'apache-fpm', 'generic'];
// "" uses the version already in the image; auto and engine read it from the project's own files.
const NODE_VERSIONS = ['24', '22', '20', '18', 'auto', 'engine', ''];
const COMPOSER_VERSIONS = ['2', '2.2', 'stable', 'preview', 'snapshot', ''];
// The packages DDEV's own Python quickstart (Wagtail) adds; the version is the one Debian ships in the web image.
const PYTHON_PACKAGES = 'python3-pip,python3-venv';
const DOCROOT_RE = /^(?:[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*)?$/;

const CHOICES = {
  project_type: PROJECT_TYPES, php_version: PHP_VERSIONS, database: DATABASES,
  webserver_type: WEBSERVERS, nodejs_version: NODE_VERSIONS, composer_version: COMPOSER_VERSIONS,
};

// The DDEV quickstarts, with the settings each one's `ddev config` uses. Unset fields keep DDEV's defaults.
const PRESETS = [
  { id: 'php', label: 'Plain PHP', project_type: 'php' },
  { id: 'asterios', label: 'Asterios', project_type: 'asterios', docroot: 'public' },
  { id: 'backdrop', label: 'Backdrop', project_type: 'backdrop' },
  { id: 'cakephp', label: 'CakePHP', project_type: 'cakephp', docroot: 'webroot' },
  { id: 'codeigniter', label: 'CodeIgniter', project_type: 'codeigniter', docroot: 'public' },
  { id: 'contao', label: 'Contao', project_type: 'php', docroot: 'public', php_version: '8.4', webserver_type: 'apache-fpm' },
  { id: 'craftcms', label: 'Craft CMS', project_type: 'craftcms', docroot: 'web', database: 'mysql:8.0' },
  { id: 'drupal12', label: 'Drupal 12', project_type: 'drupal12', docroot: 'web' },
  { id: 'drupal11', label: 'Drupal 11 / Drupal CMS', project_type: 'drupal11', docroot: 'web' },
  { id: 'drupal10', label: 'Drupal 10', project_type: 'drupal10', docroot: 'web' },
  { id: 'expressionengine', label: 'ExpressionEngine', project_type: 'php', database: 'mysql:8.0' },
  { id: 'grav', label: 'Grav', project_type: 'php', php_version: '8.3', omit_db: true },
  { id: 'ibexa', label: 'Ibexa DXP', project_type: 'php', docroot: 'public' },
  { id: 'joomla', label: 'Joomla', project_type: 'joomla' },
  { id: 'kirby', label: 'Kirby CMS', project_type: 'php', webserver_type: 'apache-fpm', omit_db: true },
  { id: 'laravel', label: 'Laravel', project_type: 'laravel', docroot: 'public' },
  { id: 'magento2', label: 'Magento 2', project_type: 'magento2', docroot: 'pub' },
  { id: 'maho', label: 'Maho', project_type: 'maho', docroot: 'public' },
  { id: 'modx', label: 'MODX Revolution', project_type: 'modx' },
  { id: 'moodle', label: 'Moodle', project_type: 'php', docroot: 'public', webserver_type: 'apache-fpm' },
  { id: 'nodejs', label: 'Node.js (Express, SvelteKit)', project_type: 'generic', webserver_type: 'generic' },
  { id: 'openmage', label: 'OpenMage', project_type: 'magento', php_version: '8.1' },
  { id: 'october', label: 'October CMS', project_type: 'laravel', webserver_type: 'apache-fpm' },
  { id: 'pimcore', label: 'Pimcore', project_type: 'php', docroot: 'public' },
  { id: 'processwire', label: 'ProcessWire', project_type: 'php', webserver_type: 'apache-fpm' },
  { id: 'shopware6', label: 'Shopware 6', project_type: 'shopware6', docroot: 'public' },
  { id: 'silverstripe', label: 'Silverstripe', project_type: 'silverstripe', docroot: 'public' },
  { id: 'statamic', label: 'Statamic', project_type: 'laravel', docroot: 'public' },
  { id: 'sulu', label: 'Sulu', project_type: 'php', docroot: 'public', database: 'mysql:8.0' },
  { id: 'symfony', label: 'Symfony', project_type: 'symfony', docroot: 'public' },
  { id: 'tempest', label: 'Tempest', project_type: 'php', docroot: 'public', php_version: '8.5', omit_db: true },
  { id: 'typo3', label: 'TYPO3', project_type: 'typo3', docroot: 'public' },
  { id: 'wagtail', label: 'Wagtail (Python)', project_type: 'generic', webserver_type: 'generic', python: true, omit_db: true },
  { id: 'wordpress', label: 'WordPress', project_type: 'wordpress' },
  { id: 'wp-bedrock', label: 'WordPress (Bedrock)', project_type: 'wp-bedrock' },
];

/** The `ddev config` flags a form asks for, each checked against the lists above. Unchosen values are left to DDEV. */
function configArgs(form) {
  const args = [];
  const pick = (field, flag) => {
    const v = form[field];
    if (v === undefined || v === null || v === '__default') return;
    if (CHOICES[field].includes(String(v))) args.push(`${flag}=${String(v)}`);
  };
  pick('project_type', '--project-type');
  const docroot = String(form.docroot === undefined ? '' : form.docroot).trim();
  if (form.docroot !== undefined && DOCROOT_RE.test(docroot) && !docroot.split('/').includes('..')) args.push(`--docroot=${docroot}`);
  pick('php_version', '--php-version');
  pick('database', '--database');
  pick('webserver_type', '--webserver-type');
  pick('nodejs_version', '--nodejs-version');
  pick('composer_version', '--composer-version');
  if (form.omit_db === '1') args.push('--omit-containers=db');
  if (form.python === '1') args.push(`--webimage-extra-packages=${PYTHON_PACKAGES}`);
  return args;
}

/** Shell-quote each argument, for a line run in a screen session. */
function shellArgs(args) {
  return args.map((a) => `'${a.replace(/'/g, `'\\''`)}'`).join(' ');
}

/**
 * The fields, for a form. `current` holds the values a project already has (Configure DDEV on an existing
 * project); a field with no current value starts on "DDEV's default", so nothing is changed unasked.
 */
function fieldsHtml({ current = {}, prefix = 'ddev' } = {}) {
  const sel = (name, label, values, hint, def = '__default') => {
    const now = current[name] !== undefined ? String(current[name]) : def;
    const opts = [`<option value="__default"${now === '__default' ? ' selected' : ''}>DDEV's default</option>`]
      .concat(values.map((v) => `<option value="${esc(v)}"${now === v ? ' selected' : ''}>${esc(v === '' ? '(empty: what the image has)' : v)}</option>`));
    return `<div><label class="uk-form-label" for="${prefix}-${name}">${esc(label)}</label>
        <select class="uk-select uk-form-small" id="${prefix}-${name}" name="${name}">${opts.join('')}</select>
        <div class="uk-text-meta">${hint}</div></div>`;
  };
  const presetOpts = PRESETS.map((p) => {
    const data = ['project_type', 'docroot', 'php_version', 'database', 'webserver_type']
      .map((k) => `data-${k.replace(/_/g, '-')}="${esc(p[k] === undefined ? '__default' : p[k])}"`).join(' ');
    return `<option value="${esc(p.id)}" ${data} data-omit-db="${p.omit_db ? 1 : 0}" data-python="${p.python ? 1 : 0}">${esc(p.label)}</option>`;
  }).join('');
  return `
      <div class="ddev-options">
        <label class="uk-form-label" for="${prefix}-preset">Start from a DDEV quickstart <span class="uk-text-meta">(fills the fields below; change any of them)</span></label>
        <select class="uk-select uk-form-small uk-margin-small-bottom" id="${prefix}-preset" data-ddev-preset>
          <option value="">Choose…</option>${presetOpts}
        </select>
        <div class="uk-grid-small uk-child-width-1-2@m" uk-grid>
          ${sel('project_type', 'Project type', PROJECT_TYPES, 'What DDEV configures the container for.', current.project_type ? current.project_type : 'php')}
          <div><label class="uk-form-label" for="${prefix}-docroot">Docroot</label>
            <input class="uk-input uk-form-small" id="${prefix}-docroot" name="docroot" value="${esc(current.docroot || '')}"
                   pattern="[a-zA-Z0-9_/-]*" maxlength="80" placeholder="(the folder itself)">
            <div class="uk-text-meta">The folder the web server serves, like <code>web</code> or <code>public</code>.</div></div>
          ${sel('php_version', 'PHP version', PHP_VERSIONS, 'In the web container.')}
          ${sel('database', 'Database', DATABASES, 'Engine and version; the volume is made on first start.')}
          ${sel('webserver_type', 'Web server', WEBSERVERS, '<code>generic</code> runs your own server, for Node.js or Python.')}
          ${sel('nodejs_version', 'Node.js version', NODE_VERSIONS, '<code>auto</code> reads it from the project, like <code>.nvmrc</code>.')}
          ${sel('composer_version', 'Composer version', COMPOSER_VERSIONS, 'Composer 2 unless the project needs another.')}
          <div><span class="uk-form-label">Extras</span>
            <label class="uk-display-block"><input class="uk-checkbox" type="checkbox" name="omit_db" value="1"${current.omit_db ? ' checked' : ''}> No database container</label>
            <label class="uk-display-block"><input class="uk-checkbox" type="checkbox" name="python" value="1"${current.python ? ' checked' : ''}> Python (pip and venv) in the web container</label>
            <div class="uk-text-meta">DDEV has no Python version setting; this is the Python the web image ships.</div></div>
        </div>
      </div>`;
}

module.exports = { PROJECT_TYPES, PHP_VERSIONS, DATABASES, WEBSERVERS, NODE_VERSIONS, COMPOSER_VERSIONS, PRESETS, CHOICES,
  PYTHON_PACKAGES, configArgs, shellArgs, fieldsHtml };
