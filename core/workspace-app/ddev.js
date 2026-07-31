/**
 * The DDEV verbs a project row offers, in one table.
 *
 * Both halves read this: `views.js` builds the row's DDEV menu from it, and `server.js` runs the
 * entry whose path was posted. Adding a verb here adds both the menu item and the handler, so the
 * menu can never offer something the server does not do — the two drifting apart is the failure
 * this table exists to prevent.
 *
 * Every entry runs `ddev` inside the project directory. That is the whole workspace rule restated:
 * package and Drupal work goes through DDEV, never through a host composer, drush or mysql.
 */

const DDEV_ACTIONS = {
  '/actions/ddev-restart': {
    icon: '🔄', menuIcon: 'refresh', label: 'ddev restart', menuLabel: 'Restart',
    args: ['restart'], ms: 5 * 60 * 1000,
  },
  '/actions/ddev-describe': {
    icon: 'ℹ️', menuIcon: 'info', label: 'ddev describe', menuLabel: 'Describe (URLs, services)',
    args: ['describe'], ms: 60 * 1000,
  },
  '/actions/ddev-logs': {
    icon: '📜', menuIcon: 'file-text', label: 'ddev logs', menuLabel: 'Web logs (last 100)',
    // Bounded on purpose: a log with no tail is a container's entire history, which arrives as
    // megabytes into a terminal box meant for the last thing that went wrong.
    args: ['logs', '-s', 'web', '--tail', '100'], ms: 60 * 1000,
  },
  '/actions/ddev-drush-cr': {
    icon: '⚡', menuIcon: 'bolt', label: 'ddev drush cr', menuLabel: 'Rebuild Drupal cache',
    args: ['drush', 'cr'], ms: 5 * 60 * 1000, needsRunning: true,
  },
  '/actions/ddev-drush-uli': {
    icon: '🔑', menuIcon: 'unlock', label: 'ddev drush uli', menuLabel: 'One-time login link',
    args: ['drush', 'uli'], ms: 60 * 1000, needsRunning: true,
  },
  '/actions/ddev-export-db': {
    icon: '💾', menuIcon: 'database', label: 'ddev export-db', menuLabel: 'Export the database',
    // The dump's destination is added by the handler, which is the half that knows where this
    // workspace keeps its backups.
    args: ['export-db'], ms: 10 * 60 * 1000, needsRunning: true, toBackups: true,
  },
};

// The order the menu lists them in, and which of them a stopped project may be offered. `ddev
// drush` on a stopped project fails with a docker error that says nothing about the real problem.
const DDEV_MENU_ORDER = [
  '/actions/ddev-restart',
  '/actions/ddev-describe',
  '/actions/ddev-logs',
  '/actions/ddev-drush-cr',
  '/actions/ddev-drush-uli',
  '/actions/ddev-export-db',
];

module.exports = { DDEV_ACTIONS, DDEV_MENU_ORDER };
