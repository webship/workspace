/**
 * The browser scripts: src/browser/<name>.ts built into public/<name>.js, the file the pages load.
 *
 * A browser cannot run TypeScript, and a fresh clone must start the dashboard with no build. So the built files are
 * committed: `npm run build:browser` rebuilds them after a change to a source, and `npm run build:browser -- --check`
 * (CI) fails when a committed file is not what its source builds to. Each file is built on its own (no bundling,
 * no module format), so a page loads it exactly as it loaded the hand-written script, at the same address.
 * The vendored libraries (public/vendor, htmx) are not built here.
 */

import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const APP = path.join(import.meta.dirname, '..');
const SRC = path.join(APP, 'src', 'browser');
const OUT = path.join(APP, 'public');
const check = process.argv.includes('--check');

export const BANNER = '// Built from src/browser by `npm run build:browser`: edit the .ts source there, not this file.';

const entries = fs.readdirSync(SRC).filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts')).sort();
const result = await build({
  entryPoints: entries.map((f) => path.join(SRC, f)),
  outdir: OUT,
  bundle: false,
  write: false,
  target: 'es2022',
  charset: 'utf8',
  legalComments: 'inline',
  banner: { js: BANNER },
  logLevel: 'warning',
});

const stale: string[] = [];
for (const file of result.outputFiles) {
  const rel = path.relative(APP, file.path);
  let now = '';
  try { now = fs.readFileSync(file.path, 'utf8'); } catch (_) { /* not built yet */ }
  if (now === file.text) continue;
  if (check) stale.push(rel);
  else { fs.writeFileSync(file.path, file.text); console.log(`built ${rel}`); }
}
if (check && stale.length) {
  console.error(`Not what src/browser builds to: ${stale.join(', ')}. Run npm run build:browser and commit the result.`);
  process.exit(1);
}
if (check) console.log(`${result.outputFiles.length} browser script(s) match their source.`);
