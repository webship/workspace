const fs = require('fs');
const path = require('path');
/**
 * The DDEV verbs a row's menu offers, as a table rather than as six near-identical branches.
 *
 * `needsRunning` is refused rather than attempted: `ddev drush` on a stopped project produces a
 * wall of connection errors instead of a sentence. `toBackups` writes into the workspace's backups
 * directory, so an export lands where the restore button looks for it.
 */

/**
 * ONE `ddev start` at a time, machine-wide.
 *
 * Every router-mutating verb (`start`, `stop`, `restart`, `poweroff`, `delete`) tears the
 * SHARED `ddev-router` down and brings it back up with the routes of whatever is running.
 * Run two at once and they race on one container: one removes it while the other has just
 * created it, and the loser can leave it removed for good. What that looks like is the whole
 * workspace going dark — every *.ddev.site address, the dashboard's own hub included, with
 * healthy web containers behind it and DDEV then refusing to start anything at all:
 *
 *   Failed to start workspace: Error response from daemon: No such container: ddev-router
 *
 * Recovering needs `ddev poweroff`. It is easy to trigger: five clicks on Start in
 * thirty-eight seconds did it here, because each one is its own detached screen session.
 *
 * `flock` and not an in-process queue: the dashboard is not the only door. A person at a
 * terminal, an agent, and a cmd-*.sh script all run `ddev` too, and a lock in this process
 * would not be seen by any of them. The lock file lives at the root of the workspace tree,
 * which is bind-mounted at the SAME absolute path inside the container — so the host and the
 * dashboard take the same lock.
 *
 * The command runs EXACTLY ONCE. The obvious shape — `flock -n … cmd || flock -w … cmd` —
 * is wrong: `||` fires on any non-zero exit, so a start that failed on its own merits would
 * be run a second time. So the lock is probed with `true` purely to decide whether to say
 * "waiting", and the real call is a single bounded acquire whose status is the session's.
 *
 * NO SHELL VARIABLES IN HERE. The line travels through two shells — the runner builds
 * `bash -lc "… screen -dmS <s> bash -lc \"<this>\" …"` — so the OUTER one expands anything
 * starting with `$` before the inner one ever sees it. A first version captured `rc=$?` and
 * tested it, and the session logged `[: : integer expected` because `$rc` had already been
 * expanded away to nothing by the outer shell. Keeping the string free of `$` makes it
 * immune to however many quoting layers it passes through.
 */
const ROUTER_VERBS = new Set(['start', 'stop', 'restart', 'poweroff', 'delete']);

function routerLockPath() {
  const { ROOT } = require('./workspaces');
  return path.join(ROOT, '.ddev-router.lock');
}

/** Wrap a command line so it holds the router lock while it runs. */
function serialiseRouter(cmdLine) {
  const lock = JSON.stringify(routerLockPath());
  const busy = 'Waiting: another ddev start/stop/restart holds the router lock. '
    + 'They cannot run at once — each one recreates the shared ddev-router.';
  // The probe cannot fail the session: `|| echo` only decides whether to explain the wait.
  // The second flock is the last command, so ITS status is the session's status.
  // DDEV_ROUTER_LOCK_HELD tells the `ddev` shim (core/scripts/ddev-shim/ddev, on PATH in
  // this container) that the lock is ALREADY held by this very command, so it runs instead
  // of taking the same lock again. Without it the two protections deadlock each other:
  // proven — an outer flock plus an unaware shim hangs for the full 1800s timeout.
  return `{ flock -n ${lock} true || echo ${JSON.stringify(busy)} ; } ; `
    + `flock -w 1800 ${lock} env DDEV_ROUTER_LOCK_HELD=1 ${cmdLine}`;
}

/** Does this argv touch the router? */
function touchesRouter(args) { return ROUTER_VERBS.has(String((args || [])[0] || '')); }

const DDEV_ACTIONS = {
  '/actions/ddev-restart':   { icon: '🔄', label: 'ddev restart',       args: ['restart'],                            ms: 5 * 60 * 1000 },
  '/actions/ddev-describe':  { icon: 'ℹ️',  label: 'ddev describe',      args: ['describe'],                           ms: 60 * 1000 },
  '/actions/ddev-logs':      { icon: '📜', label: 'ddev logs',          args: ['logs', '-s', 'web', '--tail', '100'], ms: 60 * 1000 },
  '/actions/ddev-drush-cr':  { icon: '⚡', label: 'ddev drush cr',      args: ['drush', 'cr'],                        ms: 5 * 60 * 1000, needsRunning: true },
  '/actions/ddev-drush-uli': { icon: '🔑', label: 'ddev drush uli',     args: ['drush', 'uli'],                       ms: 60 * 1000, needsRunning: true },
  '/actions/ddev-export-db': { icon: '💾', label: 'ddev export-db',     args: ['export-db'],                          ms: 10 * 60 * 1000, needsRunning: true, toBackups: true },
  // Long ones run detached in a screen session: a composer update outlives any
  // page, and it must be watchable and reattachable rather than tied to a toast.
  '/actions/ddev-composer-install': { icon: '📦', label: 'ddev composer install', args: ['composer', 'install'],            ms: 60 * 60 * 1000, inScreen: true },
  '/actions/ddev-composer-update':  { icon: '⬆️',  label: 'ddev composer update',  args: ['composer', 'update'],             ms: 60 * 60 * 1000, inScreen: true },
  '/actions/ddev-drush-updb':       { icon: '🗃️',  label: 'ddev drush updb',       args: ['drush', 'updb', '-y'],            ms: 30 * 60 * 1000, needsRunning: true, inScreen: true },
  '/actions/ddev-drush-cim':        { icon: '📥', label: 'ddev drush cim',        args: ['drush', 'cim', '-y'],             ms: 30 * 60 * 1000, needsRunning: true, inScreen: true },
  '/actions/ddev-drush-cex':        { icon: '📤', label: 'ddev drush cex',        args: ['drush', 'cex', '-y'],             ms: 30 * 60 * 1000, needsRunning: true, inScreen: true },
  '/actions/ddev-drush-status':     { icon: '🩺', label: 'ddev drush status',     args: ['drush', 'status'],                ms: 2 * 60 * 1000, needsRunning: true },
  // A snapshot can be named, and one that is not gets DDEV's timestamp. `needsRunning` is honest
  // rather than strict: `ddev snapshot` will START a stopped project to take one and stop it again,
  // which is a surprise worth not springing on somebody who clicked a menu item.
  '/actions/ddev-snapshot':         { icon: '📸', label: 'ddev snapshot',         args: ['snapshot'],                       ms: 15 * 60 * 1000, needsRunning: true, named: true },
  // Restoring REPLACES the database — there is no merge and no undo, which is why it is confirmed
  // and why it runs in a screen: a large database takes minutes and must be watchable.
  '/actions/ddev-snapshot-restore': { icon: '⏮️',  label: 'ddev snapshot restore', args: ['snapshot', 'restore'],            ms: 30 * 60 * 1000, destructive: true, inScreen: true, named: true },
  // Removing one is `--cleanup --name <n> -y`; it takes the same confirm, because a snapshot is
  // somebody's only copy of a database often enough.
  '/actions/ddev-snapshot-delete':  { icon: '🗑️',  label: 'ddev snapshot cleanup', args: ['snapshot', '--cleanup', '-y'],    ms: 5 * 60 * 1000, destructive: true, named: true },
  '/actions/ddev-mutagen-sync':     { icon: '🔃', label: 'ddev mutagen sync',     args: ['mutagen', 'sync'],                ms: 10 * 60 * 1000 },
  // Step debugging, on and off. It is a toggle in the web container rather than a config change, so
  // it costs nothing and needs no restart — which is exactly why it belongs on a menu instead of in
  // somebody's shell history. Xdebug makes PHP roughly three times slower while it is on, so turning
  // it OFF is the half people forget, and the menu says which state it is in before either is clicked.
  '/actions/ddev-xdebug-on':        { icon: '🐞', label: 'ddev xdebug on',        args: ['xdebug', 'on'],                   ms: 2 * 60 * 1000, needsRunning: true },
  '/actions/ddev-xdebug-off':       { icon: '🐞', label: 'ddev xdebug off',       args: ['xdebug', 'off'],                  ms: 2 * 60 * 1000, needsRunning: true },
  // Which it is now. `ddev describe` does not report it — checked — so a row cannot show the state
  // without a subprocess of its own, and asking is a click rather than a cost on every render.
  '/actions/ddev-xdebug-status':    { icon: '🐞', label: 'ddev xdebug status',    args: ['xdebug', 'status'],               ms: 60 * 1000, needsRunning: true },
  // Your SSH keys, into the container that lends them to every project. It is what makes a composer
  // install against a private repository work, and it is INTERACTIVE — ssh-add asks for the
  // passphrase — so it runs in a screen session you can open and type into. Nothing else here needs
  // a human at the keyboard, which is exactly why it would be baffling as a fire-and-forget button.
  '/actions/ddev-auth-ssh':         { icon: '🔑', label: 'ddev auth ssh',         args: ['auth', 'ssh'],                    ms: 10 * 60 * 1000, inScreen: true },
  // A public tunnel to this project, for showing somebody the work. It RUNS UNTIL IT IS STOPPED and
  // it puts a local site on the open internet, so: a screen session (the URL it prints is in there,
  // and closing a browser tab must not take the tunnel down with it), and the confirm dialog — this
  // is the only verb here whose effect is visible to people who are not on this machine.
  '/actions/ddev-share':            { icon: '🌍', label: 'ddev share',            args: ['share'],                          ms: 8 * 60 * 60 * 1000, needsRunning: true, destructive: true, inScreen: true,
    confirmWhy: 'puts this project on the open internet' },
  // When a project is broken, these are the four questions worth asking before anyone starts
  // guessing — Docker and the network, the certificate, the ports, and whether the database volume
  // is the version the config claims. Each reads and reports; none of them changes anything, which
  // is why they are one group and why none is confirmed.
  '/actions/ddev-diagnose':         { icon: '🩺', label: 'ddev utility diagnose',        args: ['utility', 'diagnose'],        ms: 5 * 60 * 1000 },
  '/actions/ddev-tls-diagnose':     { icon: '🔏', label: 'ddev utility tls-diagnose',    args: ['utility', 'tls-diagnose'],    ms: 5 * 60 * 1000 },
  '/actions/ddev-port-diagnose':    { icon: '🔌', label: 'ddev utility port-diagnose',   args: ['utility', 'port-diagnose'],   ms: 5 * 60 * 1000 },
  // The one that answers "it started, and then the database was empty / the wrong version": the
  // volume on disk against what config.yaml says it should be.
  '/actions/ddev-db-match':         { icon: '🗄️',  label: 'ddev utility check-db-match',  args: ['utility', 'check-db-match'],  ms: 2 * 60 * 1000 },
  // Mutagen beyond `sync`. Status answers the question a slow or stale project raises — is the sync
  // behind, or is it broken — and it says plainly when Mutagen is not enabled at all, which is worth
  // knowing before anybody blames it.
  '/actions/ddev-mutagen-status':   { icon: '🔃', label: 'ddev mutagen status',   args: ['mutagen', 'status'],              ms: 2 * 60 * 1000 },
  // Reset STOPS THE PROJECT and removes the sync volume, which is why it is confirmed: it is the
  // answer to a sync that cannot be repaired, and it is not a thing to click while somebody is
  // working. The files on disk are the source; the volume is rebuilt on the next start.
  '/actions/ddev-mutagen-reset':    { icon: '♻️',  label: 'ddev mutagen reset',    args: ['mutagen', 'reset'],               ms: 10 * 60 * 1000, destructive: true,
    confirmWhy: 'stops the project and removes its sync volume' },
  // Destructive: every table goes. It takes a dump into the workspace's backups
  // folder first, because there is nothing else keeping that database.
  '/actions/ddev-drush-sql-drop':   { icon: '🧨', label: 'ddev drush sql:drop',   args: ['drush', 'sql:drop', '-y'],        ms: 10 * 60 * 1000, needsRunning: true, destructive: true, backupFirst: true },
};

// The project's OWN ddev commands, from every .ddev/commands/<service>/ folder. See ddev-custom-commands.js.
function projectDdevCommands(projectDir) {
  return require('./ddev-custom-commands').customCommands(projectDir).map((c) => ({ ...c, help: c.description }));
}

module.exports = { DDEV_ACTIONS, projectDdevCommands,
  serialiseRouter, touchesRouter, routerLockPath, ROUTER_VERBS };
