/**
 * The name a new project is offered when a builder is chosen.
 *
 * The Build form's name field said `new-project-name` and nothing else, so every build began by
 * inventing a name — and the names people invent under that pressure are the ones in the tree now:
 * `my-drupal-site`, `my-drupal-site-pulse`, `my-drupal-site-pulse2`, `my-drupal-site-the-pulse10`.
 * A month later nobody knows what any of them was for.
 *
 * So the form proposes one, and it is a CODE rather than a sentence:
 *
 *     <code> <major> x <minor><patch> b <n>
 *
 *     v11x0xb1        Webship, the 11.0.x branch, first build
 *     v11x00b1        Webship, the ~11.0.0 release
 *     v9x2xb1         Webship, the 9.2.x branch
 *     ha1x00b1        Haven ~1.0.0
 *     pulse1x0xb1   Pulse, the 1.0.x branch
 *     b1x00b1         Byte ^1
 *
 * Short because it goes in a hostname, a DDEV project name and a folder, and gets typed and read far
 * more often than it gets written. Every part of it answers a question somebody asks while looking at
 * a folder listing: what is this, which line of it, and which of my attempts.
 *
 * It is a SUGGESTION. The field stays editable, and `ui.js` only fills it while it is empty or still
 * holds the last suggestion — a name somebody typed is never overwritten by changing the dropdown.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { scriptAssignments } = require('./builder-args');
const { loadSettings } = require('./workspaces');

/**
 * The short code for a product.
 *
 * Derived from the TITLE, not the machine name: `haven` is one word on disk and two in the
 * world, and `ha` is what a person writing it down would use. Several words give their initials —
 * Haven is `ha`, Website Starter is `vs`, Drupal CMS is `dc`.
 *
 * A SINGLE word keeps its word. Reducing it to a letter is where a code scheme stops being readable
 * and starts being a puzzle, and it collides: Haven and Healthcare are both `h`, CareSphere and
 * Convene are both `c`, and two products sharing a name inside one folder is the one thing a
 * generated name must never do.
 *
 * `short_codes:` in `core/config/settings.yml` overrides any of them, for the few that are typed so
 * often they have earned a letter (Webship is `v`, Drupal is `d`) and for the few the derivation gets
 * wrong (Pulse would be `tr`, which is a code for the word "the").
 */
function shortCode(machineName, title) {
  const overrides = (() => {
    try { return loadSettings().short_codes || {}; } catch (_) { return {}; }
  })();
  const own = overrides[machineName];
  if (own) return slugify(own);

  const words = String(title || machineName || '').trim().split(/[\s_-]+/).filter(Boolean);
  if (words.length > 1) return slugify(words.map((w) => w[0]).join(''));
  return slugify(words[0] || machineName);
}

/**
 * Which base a site template is being built on, when it is not the usual one.
 *
 * Drupal CMS is the base for nearly every site template, so saying so would lengthen every name for
 * nothing. A distribution is the exception, and it is a real difference: the same recipe at the same version
 * on the two bases is two different sites. Without this, a template builder and its Drupal CMS twin proposed one name in six workspaces.
 */
const USUAL_BASES = new Set(['drupal_cms', 'drupal', 'website', 'webship', 'webships']);

function baseMark(vars, src) {
  // A builder that picks its base from a `--distribution` flag assigns `distribution_name` twice, in
  // the two halves of an if/else. `scriptAssignments` is last-one-wins, so it reports the else branch
  // — the distribution — for a builder whose DEFAULT is Drupal CMS. It builds either, so it claims neither.
  if ((src.match(/^[ \t]*distribution_name="/gm) || []).length > 1) return '';
  const base = vars.distribution_name || '';
  // The usual bases say nothing: Drupal CMS, plain Drupal, and the Webship installers (website,
  // webship, webships), each of which is the ONLY base its templates are built on.
  if (!base || USUAL_BASES.has(base)) return '';
  return shortCode(base, vars.distribution_title || base);
}

/** Lowercase and alphanumeric: this ends up in a hostname and a DDEV project name. */
const slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 16);

/**
 * The version block: `<major>x<minor><patch>`.
 *
 * The last segment is written the way the constraint writes it — `11.0.x-dev` ends in `x` and gives
 * `11x0x`, `~11.0.0` ends in `0` and gives `11x00`. That one character is the whole difference
 * between the development branch and the release, and it is the difference people most often need to
 * see in a folder listing. A segment the constraint leaves out is 0, so `^1` is `1x00`.
 *
 * Returns '' when there is no version to read, and the caller then falls back to a plain name.
 */
function versionBlock(version) {
  const s = String(version || '').trim();
  const m = s.match(/(\d+)(?:\.(\d+|x))?(?:\.(\d+|x))?/);
  if (!m) return '';
  const [, major, minor, patch] = m;
  return `${major}x${minor || '0'}${patch || '0'}`;
}

/**
 * What a builder builds, as a code and a version.
 *
 * A site template is named by the TEMPLATE and versioned by the template's own constraint: the base
 * under it is `drupal/cms` for nearly all of them, so it distinguishes nothing, while `~1.0.0` against
 * `1.0.x-dev` distinguishes everything. A distribution is named and versioned by itself.
 *
 * A builder that declares neither is read from its file name, which is the only fact left.
 */
function stemFor(dir, script) {
  let src = '';
  try { src = fs.readFileSync(path.join(dir, script), 'utf8'); } catch (_) { return ''; }
  const v = scriptAssignments(src);
  // `at` marks an automated-testing build whichever path names it: the test workspace holds the
  // plain builder and its testing twin side by side, and both declare the same distribution.
  const at = script.startsWith('cmd-automated-testing-') ? 'at' : '';

  if (v.site_template_name) {
    const code = shortCode(v.site_template_name, v.site_template_title);
    // A template builder that installs through a distribution declares `site_version` instead.
    const ver = versionBlock(v.site_template_version || v.site_template_version_default || v.site_version);
    return ver ? `${at}${code}${ver}${baseMark(v, src)}` : `${at}${code}`;
  }
  if (v.distribution_name) {
    const code = shortCode(v.distribution_name, v.distribution_title);
    const ver = versionBlock(v.site_version);
    return ver ? `${at}${code}${ver}` : `${at}${code}`;
  }
  return stemFromFileName(script, v);
}

/**
 * A builder with nothing to read: its file name.
 *
 * The `cmd-automated-testing-*` scripts carry their own inline argparse and declare no distribution,
 * so this is the path they take. `automated testing` is compressed to `at` rather than dropped: the
 * test workspace holds BOTH `cmd-webship11-0-x-project.sh` and
 * `cmd-automated-testing-webship11-0-x-project.sh`, and a name that cannot tell them apart is a name
 * that sends somebody to the wrong project. The rest of the words say what KIND of build it is and
 * carry no information a folder full of them does not already have.
 */
const KIND_WORDS = ['recommended', 'tools', 'build', 'drupalcms2'];

function stemFromFileName(script, vars = {}) {
  const middle = script.replace(/^cmd-/, '').replace(/-?project\.sh$/, '').replace(/\.sh$/, '');
  let rest = middle;
  let prefix = '';
  if (rest.startsWith('automated-testing-')) { prefix = 'at'; rest = rest.slice('automated-testing-'.length); }

  const parts = rest.split('-').filter((p) => p && !KIND_WORDS.includes(p));
  if (!parts.length) return slugify(prefix + middle.replace(/-/g, ''));

  // `webship11`, `website_starter1` — the name and the first version digits are one token in these names.
  const head = parts[0].match(/^([a-z_]+)([0-9]*)$/);
  if (!head) return slugify(prefix + parts.join(''));
  const [, word, major] = head;

  // Some of them declare `<word>_version` even with no distribution — the real constraint, preferred
  // over the digits in the file name.
  const declared = vars[`${word}_version`];
  const ver = declared ? versionBlock(declared)
    : (major ? versionBlock([major, ...parts.slice(1)].join('.')) : '');
  // With no version there is nothing for a code to sit against, and a lone `p1` or `m1` says less
  // than the folder did. Penpot and Milvus keep their names.
  if (!ver) return slugify(prefix + word);
  return slugify(prefix + shortCode(word, word) + ver);
}

/**
 * The next free name for this builder in this workspace.
 *
 * `b` marks the build counter, so `v11x0xb2` is the second attempt at the same thing and never reads
 * as part of the version. A stem with no version to carry keeps the plain form — `penpot1`, `milvus1`
 * — because there is nothing there for a number to be confused with.
 *
 * "Next" is one past the HIGHEST number already used, not the first gap: `b1` and `b3` give `b4`,
 * because filling the hole left by a deleted `b2` reuses a name somebody may still have in a
 * bookmark, a DDEV router entry or a note.
 */
function suggestProjectName(dir, script, { existing = null } = {}) {
  const stem = stemFor(dir, script);
  if (!stem) return '';
  const sep = /\d/.test(stem) ? 'b' : '';

  let names = existing;
  if (!names) {
    try {
      names = fs.readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .map((e) => e.name);
    } catch (_) { names = []; }
  }

  const quoted = stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // `-?` and an optional `b` on the way IN: somebody may have made `v11x0x-2` or `v11x0x2` by hand,
  // and it is still the second one.
  const re = new RegExp(`^${quoted}-?b?(\\d+)$`);
  let highest = 0;
  for (const n of names) {
    const m = re.exec(n);
    if (m) highest = Math.max(highest, Number(m[1]));
  }
  return `${stem}${sep}${highest + 1}`;
}

module.exports = { suggestProjectName, stemFor, versionBlock, shortCode, slugify };
