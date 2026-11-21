/**
 * The @webship.co packages the installed plugins are built on, that the workspace does not ask for itself: a family's
 * base (workspace-hosting for upsun, acquia, cpanel …; workspace-forge; workspace-container), the plugin types.
 *
 * npm keeps the copy its lock file holds while that copy still fits the plugins' ranges (`^1.0.2`), so updating a
 * plugin left its base at the version first installed, and every later fix in the base never reached the plugins
 * that load it (#650). The steps that add or update plugins (`plugins.sh --require`, `webship-workspace update`)
 * bring these to the newest version that fits, with `npm update`.
 *
 *   node shared-packages.js [appDir]     prints them on one line, space-separated ('' when there are none)
 */

'use strict';

const fs = require('fs');
const path = require('path');

const SCOPE = '@webship.co';

/** The shared packages under appDir/node_modules: depended on by an installed @webship.co package, and not by the app. */
function sharedPackages(appDir = __dirname) {
  let app = {};
  try { app = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8')); } catch (_) { return []; }
  const own = new Set([app.dependencies, app.devDependencies, app.optionalDependencies].flatMap((d) => Object.keys(d || {})));
  const scope = path.join(appDir, 'node_modules', SCOPE);
  let installed = [];
  try { installed = fs.readdirSync(scope); } catch (_) { return []; }
  const shared = new Set();
  for (const folder of installed) {
    let pkg;
    try { pkg = JSON.parse(fs.readFileSync(path.join(scope, folder, 'package.json'), 'utf8')); } catch (_) { continue; }
    for (const dep of Object.keys({ ...(pkg.dependencies || {}), ...(pkg.peerDependencies || {}) })) {
      // Only a copy npm placed at the top, where every plugin finds it: a nested copy is that plugin's own.
      if (dep.startsWith(`${SCOPE}/`) && !own.has(dep) && fs.existsSync(path.join(scope, dep.slice(SCOPE.length + 1), 'package.json'))) shared.add(dep);
    }
  }
  return [...shared].sort();
}

module.exports = { sharedPackages };

if (require.main === module) console.log(sharedPackages(process.argv[2] || __dirname).join(' '));
