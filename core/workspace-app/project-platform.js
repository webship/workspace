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

module.exports = { platformOfProject };
