/**
 * The @webship.co packages the installed plugins are built on, that the workspace does not ask for itself: a family's
 * base (workspace-hosting for upsun, acquia, cpanel …; workspace-forge; workspace-container), the plugin types.
 *
 * npm keeps the copy its lock file holds while that copy still fits the plugins' ranges (`^1.0.2`), so updating a
 * plugin left its base at the version first installed, and every later fix in the base never reached the plugins
 * that load it (#650). The steps that add or update plugins (`plugins.sh --require`, `webship-workspace update`)
 * bring these to the newest version that fits, with `npm update`.
 *
 *   node shared-packages.mts [appDir]    prints them on one line, space-separated ('' when there are none)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCOPE = '@webship.co';

/** The fields of a package.json that are read. */
interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

/** The shared packages under appDir/node_modules: depended on by an installed @webship.co package, and not by the app. */
export function sharedPackages(appDir: string = import.meta.dirname): string[] {
  let app: PackageJson = {};
  try { app = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8')); } catch (_) { return []; }
  const own = new Set([app.dependencies, app.devDependencies, app.optionalDependencies].flatMap((d) => Object.keys(d || {})));
  const scope = path.join(appDir, 'node_modules', SCOPE);
  let installed: string[] = [];
  try { installed = fs.readdirSync(scope); } catch (_) { return []; }
  const shared = new Set<string>();
  for (const folder of installed) {
    let pkg: PackageJson;
    try { pkg = JSON.parse(fs.readFileSync(path.join(scope, folder, 'package.json'), 'utf8')); } catch (_) { continue; }
    for (const dep of Object.keys({ ...(pkg.dependencies || {}), ...(pkg.peerDependencies || {}) })) {
      // Only a copy npm placed at the top, where every plugin finds it: a nested copy is that plugin's own.
      if (dep.startsWith(`${SCOPE}/`) && !own.has(dep) && fs.existsSync(path.join(scope, dep.slice(SCOPE.length + 1), 'package.json'))) shared.add(dep);
    }
  }
  return [...shared].sort();
}


// Run as a command (`node shared-packages.mts`), not imported. import.meta.main is Node.js 24.2 and later; the core runs from 24.0.18.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(sharedPackages(process.argv[2] || import.meta.dirname).join(' '));
