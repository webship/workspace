/**
 * Is there a newer version of a plugin on npm than the one this workspace has?
 *
 * The same three rules as version-check.mts, which answers this for the core:
 *
 *   - **Unknown is not up to date.** A package that is not on the registry (a path, a GitHub repo, a
 *     folder under plugins/), or a registry that cannot be reached, gives no answer, and no answer is
 *     shown as no answer: never "up to date".
 *   - **Only a number that is really greater is newer** (version-check's isNewer).
 *   - **It never blocks a page.** Pages read what is remembered (`peek`); the question is asked in a
 *     fragment of its own (`refresh`), a few packages at a time, and kept for hours.
 *
 * What is sent: the package names, to the npm registry, and nothing else.
 */

import https from 'node:https';

import { isNewer } from './version-check.mts';

export { isNewer };

/** What is remembered of the registry: the newest version of each package asked about, and when. */
export interface UpdatesMemo { at: number; latest: Record<string, string>; error: string; names: string }

/** A plugin row, as far as `outdated` reads it. */
export interface PluginRow { name: string; module?: string; version?: string; manifest?: { label?: string } | null }

/** A plugin with a newer version on npm. */
export interface Outdated { name: string; label: string; module: string; version: string | undefined; latest: string }

export const TTL = 6 * 60 * 60 * 1000;
export const FAIL_TTL = 15 * 60 * 1000;
const TIMEOUT = 5000;
const REGISTRY = 'https://registry.npmjs.org';

let memo: UpdatesMemo = { at: 0, latest: {}, error: '', names: '' };
let pending: { key: string; promise: Promise<UpdatesMemo> } | null = null;

/** The `latest` dist-tag of one package, or '' when the registry has no such package. Rejects when it cannot be asked. */
export function registryLatest(name: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(`${REGISTRY}/${name.replace('/', '%2f')}`, { headers: { Accept: 'application/vnd.npm.install-v1+json', 'User-Agent': 'workspace-dashboard' }, timeout: TIMEOUT }, (res) => {
      if (res.statusCode === 404) { res.resume(); return resolve(''); }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`the registry answered ${res.statusCode}`)); }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d: string) => { body += d; if (body.length > 2e6) req.destroy(new Error('the answer is too long')); });
      res.on('end', () => {
        try { resolve(String(((JSON.parse(body) || {})['dist-tags'] || {}).latest || '')); } catch (e) { reject(new Error('the registry answer could not be read')); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('the registry did not answer in time')));
    req.on('error', reject);
  });
}

// A package name the registry can be asked about: scoped or not, nothing a URL could read as more.
const NAME_RE = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

/**
 * Ask the registry about these packages (a few at a time) and remember the answer.
 * Answers `{ latest: { module: version }, error, at }`. One package that fails does not lose the rest;
 * when none could be asked, `error` says why and the answer is kept for minutes, not hours.
 */
export async function refresh(modules: readonly unknown[],
  { force = false, ask = registryLatest, now = Date.now() }: { force?: boolean; ask?: (name: string) => Promise<string>; now?: number } = {}): Promise<UpdatesMemo> {
  const names = [...new Set(modules.filter((m): m is string => typeof m === 'string' && NAME_RE.test(m)))].sort();
  const key = names.join(' ');
  const fresh = memo.at && memo.names === key && now - memo.at < (memo.error ? FAIL_TTL : TTL);
  if (!force && fresh) return memo;
  if (process.env.WORKSPACE_NO_UPDATE_CHECK) return { at: 0, latest: {}, error: '', names: key };
  if (pending && pending.key === key) return pending.promise;
  const promise = (async () => {
    const latest: Record<string, string> = {};
    let failed = 0;
    let why = '';
    const queue = [...names];
    const worker = async () => {
      for (let name = queue.shift(); name; name = queue.shift()) {
        try { const v = await ask(name); if (v) latest[name] = v; } catch (e) { failed += 1; why = e instanceof Error && e.message ? e.message : String(e); }
      }
    };
    await Promise.all(Array.from({ length: Math.min(6, names.length) }, worker));
    memo = { at: now, latest, names: key, error: names.length && failed === names.length ? why || 'the registry could not be reached' : '' };
    return memo;
  })();
  pending = { key, promise };
  try { return await promise; } finally { pending = null; }
}

/** What is remembered, without asking anybody: `{ latest, error, at }`. */
export const peek = (): UpdatesMemo => memo;
export function forget(): void { memo = { at: 0, latest: {}, error: '', names: '' }; pending = null; }

/** The plugins of `rows` that have a newer version on npm: `[{ name, label, module, version, latest }]`. */
export function outdated(rows: readonly PluginRow[], latest: Record<string, string> = memo.latest): Outdated[] {
  const out: Outdated[] = [];
  for (const p of rows) {
    const newest = p.module ? latest[p.module] : undefined;
    if (!p.module || !newest || !isNewer(newest, p.version)) continue;
    out.push({ name: p.name, label: (p.manifest && p.manifest.label) || p.name, module: p.module, version: p.version, latest: newest });
  }
  return out;
}
