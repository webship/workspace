/**
 * Is there a newer release than the one this machine runs?
 *
 * The version in the top bar answers "what am I on". It cannot answer "and is that current", and a
 * number with nothing beside it reads as up to date whether it is or not — which is how a team ends up
 * spread across four releases with nobody aware of it.
 *
 * Three rules, all of them about not lying:
 *
 *   - **Unknown is not up to date.** This repository is private, and the dashboard's container has no
 *     GitHub token of its own unless one is put in `.ddev/config.yaml` `web_environment` (the same gap
 *     the AI-items repo column reports). When the check cannot be made, nothing is shown — never a
 *     reassuring silence dressed up as a verdict.
 *   - **Only a number that is really greater is newer.** A tag this cannot parse says nothing.
 *   - **It never blocks a page.** The answer arrives in a fragment on its own, cached for hours, and a
 *     page with no network renders exactly as fast as one with.
 */

import { execFile } from 'node:child_process';

/** What is known of the newest release: its tag, or why it is not known, and when it was read. */
export interface LatestRelease { at: number; tag: string; error: string }

const NUMERIC = /^[0-9]+(\.[0-9]+)*$/;

/**
 * Is `candidate` a later release than `current`? Segment by segment, numerically. Anything that is not
 * a plain dotted number is not comparable, and not comparable means no claim either way.
 */
export function isNewer(candidate: unknown, current: unknown): boolean {
  const a = String(candidate || '').trim();
  const b = String(current || '').trim();
  if (!NUMERIC.test(a) || !NUMERIC.test(b)) return false;
  const as = a.split('.').map(Number);
  const bs = b.split('.').map(Number);
  for (let i = 0; i < Math.max(as.length, bs.length); i += 1) {
    const x = as[i] || 0;
    const y = bs[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

// Hours, because releases are not frequent and a check on every page load would be a network call per
// page for an answer that changes a few times a month. A failure is remembered too, briefly: a machine
// with no token must not shell out on every render to be told so again.
export const TTL = 6 * 60 * 60 * 1000;
export const FAIL_TTL = 10 * 60 * 1000;
let memo: LatestRelease = { at: 0, tag: '', error: '' };

function ghLatest(repo: string): Promise<{ tag?: string; error?: string }> {
  return new Promise((resolve) => {
    execFile('gh', ['api', `repos/${repo}/releases/latest`, '--jq', '.tag_name'],
      { timeout: 15000 }, (err, stdout) => {
        const tag = String(stdout || '').trim();
        if (!err && tag) return resolve({ tag });
        resolve({ error: 'the repository could not be read' });
      });
  });
}

/**
 * The newest release of the tooling repository, or why it is not known.
 *
 * `gh` first: it carries whatever auth the machine has, and this repository is private. There is no
 * unauthenticated fallback on purpose — a plain request to a private repository answers 404, which is
 * indistinguishable from "no releases" and would be reported as one.
 */
export async function latestRelease(repo: string | null | undefined, { force = false }: { force?: boolean } = {}): Promise<LatestRelease> {
  const now = Date.now();
  const ttl = memo.error ? FAIL_TTL : TTL;
  if (!force && memo.at && now - memo.at < ttl) return memo;
  if (!repo) return { at: now, tag: '', error: 'no repository is configured' };
  const { tag, error } = await ghLatest(repo);
  memo = { at: now, tag: tag || '', error: error || '' };
  return memo;
}

/** Forget what was read — for a test, and for a machine that has just been given a token. */
export function forget(): void { memo = { at: 0, tag: '', error: '' }; }

/**
 * What the top bar should say beside the version: nothing at all unless a newer release really exists.
 * Not "up to date", not "could not check" — the version is read in passing, and a line of chrome that
 * says nothing useful on every page of every machine is worse than a blank.
 */
/** What the top bar's hint is made from. */
export interface UpdateHintOptions {
  current: string | null | undefined;
  repo: string;
  host?: string;
  esc: (s: string) => string;
}

export async function updateHintHtml({ current, repo, host = 'github.com', esc }: UpdateHintOptions): Promise<string> {
  if (!current) return '';
  const { tag } = await latestRelease(repo);
  if (!tag || !isNewer(tag, current)) return '';
  const href = `https://${host}/${repo}/releases/tag/${encodeURIComponent(tag)}`;
  return `<a class="version-new" href="${esc(href)}" target="_blank" rel="noopener"
    title="${esc(`${tag} has been released — this machine runs ${current}. Update with: npx -y @webship.co/workspace@latest update  (then each plugin from its tab in Settings)`)}"
    ><span uk-icon="icon: arrow-up; ratio: .7"></span>${esc(tag)}</a>`;
}
