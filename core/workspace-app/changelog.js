/**
 * Reading the CHANGELOG of anything in the tree that keeps one.
 *
 * Not only `products/`. A changelog turns up wherever work does — a built site in `dev/` carries
 * the one Drupal CMS ships, a module checkout in `modules/` carries its own, a recipe in
 * `recipes/` carries the one its maintainer writes. 68 of them across the registered workspaces
 * today, and the number is not the point: the point is that somebody adding a checkout tomorrow
 * gets it read without anybody wiring it up.
 *
 * Answering "what shipped in Horizon Aid last week" meant opening a file and scrolling, which is
 * why nobody did it — and a changelog nobody reads is a changelog that stops being written.
 *
 * So the files are parsed into releases and entries and rendered as a page. What this module does
 * NOT do is rewrite anything: a changelog is the product's own record, edited in its own repository
 * by whoever cut the release. This only reads.
 *
 * Three formats are in the tree and all three are parsed, because the alternative is a reader that
 * works for the products somebody remembered:
 *
 *   1. **Keep a Changelog** — `## [1.0.3] - 2026-09-14`, with `### Added` / `### Fixed` sections.
 *      Most of the recipes and the site templates.
 *   2. **The Varbase suite's own** — `# 11.0.0` as a top-level heading, with prose sections under it
 *      and entries prefixed `feat:` / `fix:` / `task:`.
 *   3. **The old Drupal .txt** — `Menu Position 7.x-1.1, 2012-02-22` underlined with dashes. Two
 *      products still carry one, and they are the oldest things here.
 *
 * A release nobody can date is still a release, so a missing date is left empty rather than guessed.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { ROOT, loadWorkspaces, isValidWorkspace, workspaceDir } = require('./workspaces');

/** The file names a product might keep its changelog in, in the order they are preferred. */
const CHANGELOG_NAMES = ['CHANGELOG.md', 'CHANGELOG.txt', 'changelog.md', 'changelog.txt'];

/** Nothing bigger than this is parsed: a changelog is a document, not a log file. */
const MAX_BYTES = 512 * 1024;

/**
 * The kinds of change, and how each is shown.
 *
 * Keep a Changelog names six; our own entries are prefixed in the Drupal commit-type style
 * (`feat:`, `fix:`, `task:`), and drupal.org adds a few more. Both vocabularies map onto the same
 * small set, because a reader should not have to know which convention a given product follows.
 *
 * `tone` is a UIkit label modifier, so the badge is coloured by the component rather than by a rule
 * of ours — success, warning, danger are UIkit's own.
 */
const KINDS = {
  added: { label: 'Added', tone: 'success' },
  feat: { label: 'Added', tone: 'success' },
  feature: { label: 'Added', tone: 'success' },
  fixed: { label: 'Fixed', tone: 'danger' },
  fix: { label: 'Fixed', tone: 'danger' },
  bug: { label: 'Fixed', tone: 'danger' },
  changed: { label: 'Changed', tone: '' },
  change: { label: 'Changed', tone: '' },
  update: { label: 'Changed', tone: '' },
  task: { label: 'Task', tone: '' },
  chore: { label: 'Task', tone: '' },
  docs: { label: 'Docs', tone: '' },
  removed: { label: 'Removed', tone: 'warning' },
  remove: { label: 'Removed', tone: 'warning' },
  deprecated: { label: 'Deprecated', tone: 'warning' },
  security: { label: 'Security', tone: 'danger' },
};

/** What a section heading or an entry prefix means, or null when it means nothing in particular. */
function kindOf(word) {
  if (!word) return null;
  const key = String(word).trim().toLowerCase().replace(/[^a-z]/g, '');
  return KINDS[key] || null;
}

/**
 * Everything in the tree that keeps a changelog, with the file it keeps it in.
 *
 * Every registered workspace is walked, and in each one: the folder's own changelog, if it has one,
 * and then every item inside it. Discovery rather than a list, for the same reason the builders are
 * found by filename — a checkout added tomorrow should appear without anybody editing this file.
 *
 * Memoised for two seconds, the same window `loadWorkspaces` uses. 68 files is a cheap walk, but
 * the index parses every one of them and a page can ask for the list more than once.
 */
let _cache = null;
let _cacheAt = 0;

function listChangelogs() {
  const now = Date.now();
  if (_cache && now - _cacheAt < 2000) return _cache;

  const out = [];
  const fileIn = (dir) => {
    for (const name of CHANGELOG_NAMES) {
      const full = path.join(dir, name);
      let stat;
      try { stat = fs.statSync(full); } catch (_) { continue; }
      if (!stat.isFile() || !stat.size || stat.size > MAX_BYTES) continue;
      return { file: name, path: full, bytes: stat.size, changed: stat.mtimeMs };
    }
    return null;
  };

  for (const ws of Object.values(loadWorkspaces())) {
    if (!ws.dir) continue;
    // The workspace folder's own, if it keeps one.
    const own = fileIn(ws.dir);
    if (own) out.push({ workspace: ws.key, item: '', label: ws.label || ws.key, ...own });

    let entries = [];
    try {
      entries = fs.readdirSync(ws.dir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .map((e) => e.name)
        .sort();
    } catch (_) { continue; }

    for (const item of entries) {
      const found = fileIn(path.join(ws.dir, item));
      if (found) out.push({ workspace: ws.key, item, label: item, ...found });
    }
  }

  _cache = out;
  _cacheAt = now;
  return out;
}

/** Forget the walk — for a test that writes a changelog and expects to see it. */
function invalidate() { _cache = null; _cacheAt = 0; }

/** An item name that cannot climb out of its workspace. The folder must exist to be used anyway. */
const isItem = (name) => name === '' || /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(String(name || ''));

/** The changelog of one item, or null when it keeps none. */
function changelogFor(workspace, item = '') {
  if (!isValidWorkspace(workspace) || !isItem(item)) return null;
  return listChangelogs().find((c) => c.workspace === workspace && c.item === (item || '')) || null;
}

/* ---------------- parsing ---------------- */

// `## [1.0.3] - 2026-09-14`, `## [Unreleased]`, `## 1.0.3 — 2026-09-14`, `# 11.0.0`.
//
// The separator before the date must be SURROUNDED by whitespace. Without that, `# 11.0.0-rc1`
// parses as version `11.0.0` with `rc1` where the date goes — and the file then shows three
// releases called 11.0.0, which is how this was found.
const MD_HEADING = /^(#{1,4})\s+\[?([^\]\n]+?)\]?(?:\s+[-—–]\s+(.+?))?\s*$/;
// `Menu Position 7.x-1.1, 2012-02-22` followed by a line of dashes.
const TXT_HEADING = /^(.+?),\s*([0-9x]{4}-[0-9x]{2}-[0-9x]{2}|\d{2}-\d{2}-\d{4})\s*(\(.*\))?\s*$/;
// A date on its own, in any of the shapes these files use.
const DATE_ONLY = /^(\d{4}-\d{2}-\d{2}|\d{2}-\d{2}-\d{4}|[0-9x]{4}-[0-9x]{2}-[0-9x]{2})$/;
// `- feat: [#3622833](…) Add a Newsletter Canvas page`
const ENTRY_PREFIX = /^([A-Za-z]+)\s*:\s*(.+)$/s;

/** Is this heading text a version rather than prose? */
function looksLikeVersion(text) {
  const t = String(text).trim();
  if (/^unreleased$/i.test(t)) return true;
  // 1.0.3, 11.0.0-rc1, 8.x-1.1, v2.3
  return /^v?\d/.test(t) && /[\d.x]/.test(t) && t.length < 40 && !/\s{2}/.test(t);
}

/**
 * One changelog, as releases.
 *
 * Entries keep their Markdown: the page renders it, so a `[#3622833](https://…)` stays a link and
 * `` `config/optional` `` stays code. Stripping it here would mean the reader shows less than the
 * file does, which is the one thing a reader must not do.
 */
function parseChangelog(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const releases = [];
  let current = null;
  let section = null;          // the `### Added` a bullet sits under
  let group = null;            // the `#### Varbase Starter 1.0.1` it belongs to
  let pending = null;          // an entry being continued on the next line

  const flush = () => {
    if (pending && current) current.entries.push(pending);
    pending = null;
  };
  const open = (version, date) => {
    flush();
    section = null;
    group = null;
    current = { version: String(version).trim(), date: (date || '').trim(), entries: [], notes: [] };
    releases.push(current);
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();

    // The old .txt shape: a title line, underlined with dashes.
    const under = lines[i + 1] && /^-{3,}$/.test(lines[i + 1].trim());
    if (under) {
      const m = TXT_HEADING.exec(line);
      if (m) { open(m[1], m[2]); i++; continue; }
      if (line) { open(line, ''); i++; continue; }
    }

    const h = MD_HEADING.exec(line);
    if (h) {
      const [, hashes, title, rest] = h;
      if (looksLikeVersion(title)) {
        // `## [1.0.3] - 2026-09-14` — the date is what follows the dash, when it is a date.
        const date = rest && DATE_ONLY.test(rest.trim()) ? rest.trim() : '';
        // A `## 1.0.3 - some words` heading keeps its version and simply has no date, rather than
        // showing "some words" where a date belongs.
        open(title, date);
        continue;
      }
      // `#### Varbase Starter 1.0.1` inside a release: the package a bullet belongs to. The Varbase
      // suite writes one release as a stack of per-package sections, and 239 entries in a flat list
      // is a list nobody reads — the group is what makes it navigable.
      if (current && hashes.length === 4) {
        flush();
        group = title.trim();
        section = null;
        continue;
      }
      // `### Added` under a release: the kind every bullet below it carries.
      if (current && hashes.length === 3) {
        flush();
        const k = kindOf(title);
        if (k) { section = k; } else { section = null; group = title.trim(); }
        continue;
      }
      // Any other heading before the first release is the file's own preamble.
      continue;
    }

    if (!current) continue;

    const bullet = /^[-*+]\s+(.*)$/.exec(line);
    if (bullet) {
      flush();
      let body = bullet[1];
      let kind = section;
      const pre = ENTRY_PREFIX.exec(body);
      // A `feat:` prefix wins over the section it sits under: it is the more specific statement,
      // and the two disagree in practice — a `fix:` often lives under `### Added`.
      if (pre && kindOf(pre[1])) { kind = kindOf(pre[1]); body = pre[2]; }
      pending = { kind: kind ? kind.label : '', tone: kind ? kind.tone : '', group: group || '', text: body.trim() };
      continue;
    }

    // A wrapped bullet: these files hard-wrap at 100 columns, so most entries are several lines.
    if (pending && line) { pending.text += ` ${line}`; continue; }
    if (pending && !line) { flush(); continue; }

    // Prose inside a release that is not a bullet — Varbase's "At a glance" paragraphs.
    if (line) current.notes.push(line);
  }
  flush();

  return releases.filter((r) => r.entries.length || r.notes.length);
}

/** An item's releases, parsed. An unreadable file is no releases rather than an error page. */
function releasesFor(workspace, item = '') {
  const found = changelogFor(workspace, item);
  if (!found) return null;
  let text = '';
  try { text = fs.readFileSync(found.path, 'utf8'); } catch (_) { return { ...found, releases: [] }; }
  return { ...found, releases: parseChangelog(text) };
}

/**
 * Every changelog in the tree, summarised for the index: how many releases, and the newest one.
 *
 * The newest release is the FIRST in the file, not the highest version number: every one of these
 * files is written newest-first, and comparing versions across three numbering schemes (1.0.3,
 * 8.x-1.1, 11.0.0-rc1) would be a guess dressed as a sort.
 */
function changelogIndex() {
  return listChangelogs().map((c) => {
    let releases = [];
    try { releases = parseChangelog(fs.readFileSync(c.path, 'utf8')); } catch (_) { /* unreadable */ }
    const newest = releases.find((r) => !/^unreleased$/i.test(r.version)) || releases[0] || null;
    const unreleased = releases.find((r) => /^unreleased$/i.test(r.version));
    return {
      ...c,
      releases: releases.length,
      entries: releases.reduce((n, r) => n + r.entries.length, 0),
      latest: newest ? newest.version : '',
      latestDate: newest ? newest.date : '',
      unreleasedEntries: unreleased ? unreleased.entries.length : 0,
    };
  });
}

module.exports = {
  CHANGELOG_NAMES, KINDS,
  listChangelogs, changelogFor, releasesFor, changelogIndex, invalidate,
  parseChangelog, kindOf, looksLikeVersion,
};
