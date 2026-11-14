/**
 * The platform of a project that is not Drupal, read from its DDEV project type.
 *
 * The core's tools were written for Drupal; a plugin for another platform (WordPress, TYPO3, …)
 * carries that platform's user list and CLI under the name DDEV gives the project type
 * (`set_wordpress_users`, `add_wordpress_users`). This is the one place the dashboard reads that
 * name, so a row's Users menu hands `cmd-tools-add-users.sh` the right list.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// Types that say nothing about the platform, and Drupal's own (the profile decides there).
const NOT_A_PLATFORM = /^(drupal\d*|php|generic|)$/;

/** `wordpress`, `typo3`, `magento2`… — or '' for a Drupal project, a bare PHP one, or no DDEV project. */
function platformOfProject(projectDir) {
  let type = '';
  try {
    const config = fs.readFileSync(path.join(projectDir, '.ddev', 'config.yaml'), 'utf8');
    type = (config.match(/^type:\s*["']?([a-z0-9_-]+)["']?\s*$/m) || [])[1] || '';
  } catch (_) { return ''; }
  // The name becomes part of a bash function name.
  return NOT_A_PLATFORM.test(type) ? '' : type.replace(/-/g, '_');
}

/**
 * The user list of a Drupal project that has no install profile of a distribution under
 * `profiles/contrib`: `drupal_cms` when its composer.json carries the Drupal CMS packages,
 * `drupal` otherwise. '' for a project whose DDEV project type is not Drupal's.
 *
 * Without this the Users menu handed such a project the list of the Webship distribution, and the
 * lists of Drupal core and Drupal CMS (the tooling's, or a platform plugin's) were never reached.
 */
function drupalBaseOfProject(projectDir) {
  let type = '';
  try {
    const config = fs.readFileSync(path.join(projectDir, '.ddev', 'config.yaml'), 'utf8');
    type = (config.match(/^type:\s*["']?([a-z0-9_-]+)["']?\s*$/m) || [])[1] || '';
  } catch (_) { return ''; }
  if (!/^drupal\d*$/.test(type)) return '';
  let composer = '';
  try { composer = fs.readFileSync(path.join(projectDir, 'composer.json'), 'utf8'); } catch (_) { /* a project with no composer.json is a plain one */ }
  return /"drupal\/(cms|drupal_cms_[a-z0-9_]+)"/.test(composer) ? 'drupal_cms' : 'drupal';
}

module.exports = { platformOfProject, drupalBaseOfProject };
