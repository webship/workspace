/**
 * The plugins a person can add, by family, with one line each.
 *
 * The core ships empty; this is what the empty dashboard suggests, what the Plugins page offers to
 * require, and what `webship-workspace catalog` prints. Every entry is an npm package
 * `@webship.co/workspace-<name>` (github.com/webship/workspace-<name>), turned on in four steps.
 *
 * Only what is published goes here: an entry is an offer, and `plugin require <name>` must be able to
 * fetch it. A plugin that is planned but not on npm yet is added the day its first version is.
 */

import { readFileSync } from 'node:fs';

/** One family of the catalogue: its plugins as [id, name, a line about it]. */
export interface CatalogFamily { id: string; label: string; about: string; plugins: [string, string, string][] }

/** One catalogue entry, flat. */
export interface CatalogEntry { name: string; module: string; label: string; summary: string; family: string; familyLabel: string }

// The data is plugin-catalog.json, beside this file, and this module gives it its types. It is JSON because
// `webship-workspace` reads it too: that command runs from the npm package, under node_modules, where Node.js runs no
// TypeScript. So a plugin is added, renamed or moved there, never here.
//
// Each plugin there: [id, name, what it is in a line]. The name is the one Settings shows everywhere; the line is
// what a person reads to decide, so it says what the plugin does, never its package name.
const data = JSON.parse(readFileSync(new URL('./plugin-catalog.json', import.meta.url), 'utf8')) as { scope: string; families: CatalogFamily[] };

export const SCOPE: string = data.scope;

export const FAMILIES: CatalogFamily[] = data.families;

/** Every catalogue entry, flat: { name (its id), module, label (its name), summary, family, familyLabel }. */
export function catalog(): CatalogEntry[] {
  const out: CatalogEntry[] = [];
  for (const f of FAMILIES) for (const [name, label, summary] of f.plugins) out.push({ name, module: `${SCOPE}/workspace-${name}`, label, summary, family: f.id, familyLabel: f.label });
  return out;
}
