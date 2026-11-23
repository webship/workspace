/**
 * A script in parts (src/browser/<name>/, ui.js): which files are its parts, and what each one puts into the built
 * script. Shared by the build (build-browser.mts) and its test (tests/unit/browser-build.test.mts).
 */
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

/** A folder's parts, in the order of their names: .js and .ts, not .d.ts. */
export function partsOf(dir: string): string[] {
  return fs.readdirSync(dir).filter((f) => /\.(js|ts)$/.test(f) && !f.endsWith('.d.ts')).sort();
}

/**
 * A part as it goes into its script: a .js part as it is; a .ts part with each type turned into blank space by
 * Node.js's own stripper, so it keeps its comments and its lines, and a test that reads the built script reads the
 * code as it is written.
 */
export function stripUiPart(file: string, source: string): string {
  if (!file.endsWith('.ts')) return source;
  // Node.js calls this experimental, and says so on every call; it is the stripper that runs the dashboard's .mts.
  const warn = process.emitWarning;
  process.emitWarning = () => {};
  try { return stripTypeScriptTypes(source, { mode: 'strip' }); } finally { process.emitWarning = warn; }
}
