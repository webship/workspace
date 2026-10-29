/**
 * DDEV add-ons: what this project has installed, and what it could.
 *
 * An add-on is a repository DDEV copies into a project — a service (`ddev-redis`, `ddev-solr`), a
 * tool (`ddev-adminer`, `ddev-playwright`), or a whole development setup (`ddev-drupal-contrib`).
 * There are 294 of them in the registry, and until now the only way to add one here was a terminal.
 *
 * **Installed is read off disk.** DDEV records every add-on it installs in
 * `.ddev/addon-metadata/<name>/manifest.yaml` — the name, the repository, the version, when, and the
 * files it owns — so listing them is a readdir and a project row costs no subprocess.
 *
 * **Available comes from the registry, not from `ddev add-on list`.** That command renders a table
 * and truncates: 38 of the 294 names come back ending in `…`, and a truncated name cannot be
 * installed. The registry IS the GitHub topic `ddev-get`, so that is what is asked, through the `gh`
 * already in this container — full names, descriptions and star counts, cached, with the table as a
 * fallback that marks what it could not read rather than pretending.
 *
 * **A name from the browser is never passed through.** `ddev add-on get` also accepts a URL or a
 * local path, which is a download-and-run from anywhere; only an `owner/repo` that the registry
 * listing actually contains is allowed to reach it.
 */

const fs = require('fs');
const path = require('path');

const { run } = require('./jobs');

// `owner/repo`, which is the only shape `ddev add-on get` is given here. Not a URL and not a path:
// both are things that command will happily install from.
const ADDON_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;

// The registry is a GitHub topic; DDEV's own list is that search.
const REGISTRY_TOPIC = 'ddev-get';
const REGISTRY_TTL = 30 * 60 * 1000;
let _registry = { at: 0, list: null, error: '' };

/**
 * A few that earn their place in THIS workspace, said with the reason.
 *
 * Not a ranking of the 294 and not a copy of the registry's stars: these are the ones a Drupal or
 * Varbase project here actually reaches for, and each line says what it is for so the list is a
 * recommendation rather than a shelf.
 */
const RECOMMENDED = [
  { repo: 'ddev/ddev-drupal-contrib', why: 'The setup for working on a contrib module or theme inside a core checkout — what the modules and themes workspaces are for.' },
  { repo: 'ddev/ddev-drupal-solr', why: 'Apache Solr, configured for Drupal Search API: the search backend Varbase sites use in production.' },
  { repo: 'ddev/ddev-redis', why: 'Redis for Drupal caching — the difference a page-heavy site feels immediately.' },
  { repo: 'ddev/ddev-adminer', why: 'A database UI on its own URL, for when drush sql-cli is not the tool you want.' },
  { repo: 'ddev/ddev-selenium-standalone-chrome', why: 'A real Chrome for functional tests, with noVNC to watch them run.' },
  { repo: 'Lullabot/ddev-playwright', why: 'Playwright in the project, which is what the varbase-e2e suites drive.' },
  { repo: 'ddev/ddev-browsersync', why: 'Live reload while theming: a saved SCSS file refreshes the page.' },
  { repo: 'ddev/ddev-memcached', why: 'Memcached, where a site is configured for it rather than for Redis.' },
];

/** Everything DDEV has recorded as installed in this project, newest first. */
function installedAddons(projectDir) {
  const dir = path.join(projectDir, '.ddev', 'addon-metadata');
  let names = [];
  try {
    names = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch (_) {
    return [];
  }
  const out = [];
  for (const name of names) {
    const file = path.join(dir, name, 'manifest.yaml');
    let raw = '';
    try { raw = fs.readFileSync(file, 'utf8'); } catch (_) { continue; }
    // One flat block of scalars — read the four that matter rather than taking a YAML parser to it.
    const field = (k) => (raw.match(new RegExp(`^${k}:\\s*"?([^"\\n]+)"?\\s*$`, 'm')) || [, ''])[1].trim();
    const repository = field('repository');
    out.push({
      name: field('name') || name,
      repository,
      version: field('version'),
      installed: field('install_date'),
      // What it put in the project, which is what removing it takes away again.
      files: (raw.match(/^project_files:\s*$([\s\S]*?)(?=^\S|\Z)/m) || [, ''])[1]
        .split('\n').map((l) => l.replace(/^\s*-\s*/, '').trim()).filter(Boolean),
    });
  }
  return out.sort((a, b) => String(b.installed).localeCompare(String(a.installed)));
}

/**
 * The registry, cached.
 *
 * `gh` is in this container and already authenticated for the shared-agents listing, so the same
 * search DDEV itself runs is one call away. It is cached for half an hour because it is a network
 * round trip and the answer is a list of repositories, which does not change by the minute.
 */
async function availableAddons({ force = false } = {}) {
  if (!force && _registry.list && Date.now() - _registry.at < REGISTRY_TTL) return _registry;
  const out = await run('gh', ['search', 'repos', '--topic', REGISTRY_TOPIC, '--limit', '300',
    '--json', 'fullName,description,stargazersCount,updatedAt'], process.env.HOME, { timeoutMs: 60 * 1000 });
  let list = null;
  try {
    list = JSON.parse(String(out.stdout || '[]')).map((r) => ({
      repo: String(r.fullName || ''),
      description: String(r.description || '').trim(),
      stars: Number(r.stargazersCount || 0),
      updated: String(r.updatedAt || ''),
    })).filter((r) => ADDON_RE.test(r.repo));
  } catch (_) { list = null; }
  if (!list || !list.length) {
    // The fallback is DDEV's own table. It truncates long names with `…`, and a truncated name
    // cannot be installed — so those are listed as unavailable WITH the reason rather than as a
    // button that would fail.
    const table = await run('ddev', ['add-on', 'list'], process.env.HOME, { timeoutMs: 60 * 1000 });
    const rows = String(table.stdout || '').split('\n')
      .map((l) => l.replace(/\x1b\[[0-9;]*m/g, '').match(/^│\s*([^│]+?)\s*│\s*([^│]*?)\s*│/))
      .filter(Boolean)
      .map((m) => ({ repo: m[1], description: m[2], stars: 0, updated: '', truncated: m[1].includes('…') }))
      .filter((r) => r.repo !== 'ADD-ON');
    _registry = { at: Date.now(), list: rows, error: rows.length ? '' : String(out.stderr || table.stderr || '').slice(0, 200) };
    return _registry;
  }
  _registry = { at: Date.now(), list: list.sort((a, b) => b.stars - a.stars), error: '' };
  return _registry;
}

/** Forget the cache: after installing or removing one, the next page should say what is true now. */
function invalidateRegistry() { _registry = { at: 0, list: null, error: '' }; }

/**
 * Is this a name the registry actually lists?
 *
 * The check the whole feature rests on. `ddev add-on get` takes a URL or a path as happily as a
 * repository, so a name that came from a browser is only allowed through when the registry listing
 * contains it — and when the registry could not be read, nothing is installed rather than anything
 * being trusted.
 */
async function isKnownAddon(repo) {
  if (!ADDON_RE.test(String(repo || ''))) return { ok: false, why: 'An add-on is named owner/repo.' };
  const reg = await availableAddons();
  if (!reg.list || !reg.list.length) {
    return { ok: false, why: `The add-on registry could not be read${reg.error ? `: ${reg.error}` : ''}.` };
  }
  const found = reg.list.find((r) => r.repo.toLowerCase() === String(repo).toLowerCase());
  return found ? { ok: true, addon: found } : { ok: false, why: `${repo} is not in the DDEV add-on registry.` };
}

/** The registry, narrowed by what somebody typed — name and description, like `ddev add-on search`. */
function searchAddons(list, q) {
  const needle = String(q || '').trim().toLowerCase();
  if (!needle) return list;
  return list.filter((r) => r.repo.toLowerCase().includes(needle)
    || String(r.description || '').toLowerCase().includes(needle));
}

module.exports = {
  ADDON_RE, RECOMMENDED, REGISTRY_TOPIC,
  installedAddons, availableAddons, invalidateRegistry, isKnownAddon, searchAddons,
};
