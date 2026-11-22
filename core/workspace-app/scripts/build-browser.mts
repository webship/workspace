/**
 * The browser scripts: src/browser/<name>.ts built into public/<name>.js, the file the pages load.
 *
 * A browser cannot run TypeScript, and a fresh clone must start the dashboard with no build. So the built files are
 * committed: `npm run build:browser` rebuilds them after a change to a source, and `npm run build:browser -- --check`
 * (CI) fails when a committed file is not what its source builds to. Each file is built on its own (no bundling,
 * no module format), so a page loads it exactly as it loaded the hand-written script, at the same address.
 * The vendored libraries (public/vendor, htmx) are not built here.
 *
 * A folder src/browser/<name>/ is one script in parts (ui.js): its files, in the order of their names
 * (`01-core.js`, `02-…`), are put one after the other into public/<name>.js, so they share one script's
 * scope exactly as the single file did. A `.js` part goes in as it is; a `.ts` part has its types stripped
 * first (esbuild, no bundling).
 */

import fs from 'node:fs';
import path from 'node:path';
import { build, transform } from 'esbuild';

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

/** One script in parts: its files in name order, a .ts part with its types stripped, one after the other. */
async function joined(dir: string): Promise<string> {
  const parts = fs.readdirSync(dir).filter((f) => /\.(js|ts)$/.test(f) && !f.endsWith('.d.ts')).sort();
  let text = `${BANNER}\n`;
  for (const f of parts) {
    const source = fs.readFileSync(path.join(dir, f), 'utf8');
    text += f.endsWith('.ts')
      ? (await transform(source, { loader: 'ts', target: 'es2022', charset: 'utf8', legalComments: 'inline', sourcefile: f })).code
      : source;
  }
  return text;
}
const folders = fs.readdirSync(SRC, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
const outputs: { path: string; text: string }[] = result.outputFiles.map((f) => ({ path: f.path, text: f.text }));
for (const name of folders) outputs.push({ path: path.join(OUT, `${name}.js`), text: await joined(path.join(SRC, name)) });

const stale: string[] = [];
for (const file of outputs) {
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
if (check) console.log(`${outputs.length} browser script(s) match their source.`);
