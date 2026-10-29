/**
 * The name the Build form proposes.
 *
 * The shape is `<code><major>x<minor><patch>b<n>` — `w11x0xb1` is Webship on the 11.0.x branch, first
 * build. Three things have to hold and they pull against each other: it must say what is being built,
 * it must never be a name that is already taken, and it must never cost somebody the name they typed.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { suggestProjectName, stemFor, versionBlock, shortCode } = require('../../project-name');
const { ROOT } = require('../../workspaces');

const SITE_TEMPLATES = path.join(ROOT, 'site-templates');
const DEV = path.join(ROOT, 'dev');
const TEST = path.join(ROOT, 'test');
const none = { existing: [] };

/** A folder of builders written for the test, for the shapes the tree does not happen to hold. */
function folder(scripts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-name-'));
  for (const [name, body] of Object.entries(scripts)) fs.writeFileSync(path.join(dir, name), `#!/usr/bin/env bash\n${body}`);
  return dir;
}

/* ---------------- the version block ---------------- */

test('the last segment is written the way the constraint writes it', () => {
  // This is the whole difference between the development branch and the release, and it is the
  // difference people most often need to see in a folder listing.
  assert.equal(versionBlock('11.0.x-dev'), '11x0x');
  assert.equal(versionBlock('~11.0.0'), '11x00');
  assert.equal(versionBlock('2.0.x-dev'), '2x0x');
  assert.equal(versionBlock('11.4.x-dev'), '11x4x');
  // A pre-release suffix is not part of the line.
  assert.equal(versionBlock('~11.0.0-rc1'), '11x00');
  // A segment the constraint leaves out is 0.
  assert.equal(versionBlock('^1'), '1x00');
  assert.equal(versionBlock('^2'), '2x00');
  assert.equal(versionBlock(''), '');
});

test('a distribution and its line', () => {
  assert.equal(suggestProjectName(DEV, 'cmd-webship11-0-x-project.sh', none), 'w11x0xb1');
  assert.equal(suggestProjectName(DEV, 'cmd-webship11-0-0-project.sh', none), 'w11x00b1');
  assert.equal(suggestProjectName(DEV, 'cmd-webships2-0-x-project.sh', none), 'webships2x0xb1');
  assert.equal(suggestProjectName(DEV, 'cmd-cucumber11-0-x-project.sh', none), 'cucumber11x0xb1');
  assert.equal(suggestProjectName(DEV, 'cmd-drupal11-recommended-project.sh', none), 'd11x00b1');
  assert.equal(suggestProjectName(DEV, 'cmd-drupal11-4-x-recommended-project.sh', none), 'd11x4xb1');
  assert.equal(suggestProjectName(DEV, 'cmd-drupalcms2-x-project.sh', none), 'dc2x00b1');
  assert.equal(suggestProjectName(DEV, 'cmd-drupalcms2-1-0-project.sh', none), 'dc2x10b1');
});

/* ---------------- the code ---------------- */

test('several words give their initials, one word keeps its word', () => {
  // Reducing a single word to a letter is where a code scheme stops being readable and starts being
  // a puzzle — and it collides: Haven and Healthcare are both `h`, CareSphere and Convene both `c`.
  assert.equal(shortCode('drupal_cms', 'Drupal CMS'), 'dc');
  assert.equal(shortCode('hourglass_inc', 'Hourglass Corporate'), 'hc');
  assert.equal(shortCode('provus_edu', 'Provus EDU'), 'pe');
  assert.equal(shortCode('haven', 'Haven'), 'haven');
  assert.equal(shortCode('byte', 'Byte'), 'byte');
  assert.equal(shortCode('webships', 'Webships'), 'webships');
});

test('short_codes: overrides the derivation', () => {
  // Webship and Drupal are typed often enough to have earned a letter; Cucumber has not, and keeps
  // its word like any other.
  assert.equal(shortCode('webship', 'Webship'), 'w');
  assert.equal(shortCode('drupal', 'Drupal'), 'd');
  assert.equal(shortCode('cucumber', 'Cucumber'), 'cucumber');
});

test('a site template is named by its template, and its version by the template', () => {
  // Dashi and Hourglass declare `^1`; Byte declares no version at all, so it keeps a plain counter.
  assert.equal(suggestProjectName(SITE_TEMPLATES, 'cmd-dashi-project.sh', none), 'dashi1x00b1');
  assert.equal(suggestProjectName(SITE_TEMPLATES, 'cmd-hourglass_inc-project.sh', none), 'hc1x00b1');
  assert.equal(suggestProjectName(SITE_TEMPLATES, 'cmd-goodwell-project.sh', none), 'goodwell1x00b1');
  assert.equal(suggestProjectName(SITE_TEMPLATES, 'cmd-byte-project.sh', none), 'byte1');
});

/* ---------------- the base ---------------- */

const TEMPLATE = 'site_template_name="starter";\nsite_template_title="Site Starter";\nsite_template_version="1.0.x-dev";\n';

test('a template built on an unusual base says so, and one on Drupal CMS does not', () => {
  // Drupal CMS is the base for nearly every site template, so saying so would lengthen every name for
  // nothing, and the Webship installers are as usual. Another distribution is the exception, and a real
  // difference: the same recipe at the same version on two bases is two different sites.
  const dir = folder({
    'cmd-starter-thunder-project.sh': `${TEMPLATE}distribution_name="thunder";\ndistribution_title="Thunder";\n`,
    'cmd-starter-project.sh': `${TEMPLATE}distribution_name="drupal_cms";\ndistribution_title="Drupal CMS";\n`,
  });
  assert.equal(suggestProjectName(dir, 'cmd-starter-thunder-project.sh', none), 'ss1x0xthunderb1');
  assert.equal(suggestProjectName(dir, 'cmd-starter-project.sh', none), 'ss1x0xb1');
});

test('a builder that picks its base from a flag claims neither', () => {
  // A builder that assigns distribution_name twice, in the two halves of an if/else, is read by an
  // assignment reader that is last-one-wins — so it reported the distribution for a builder whose
  // DEFAULT is Drupal CMS. It builds either, so it claims neither.
  const dir = folder({
    'cmd-starter-project.sh': `${TEMPLATE}if [ "$1" = "--distribution" ]; then\n  distribution_name="webship";\n  distribution_title="Webship";\nelse\n  distribution_name="drupal_cms";\n  distribution_title="Drupal CMS";\nfi\n`,
  });
  assert.equal(suggestProjectName(dir, 'cmd-starter-project.sh', none), 'ss1x0xb1');
});

/* ---------------- builders with nothing to read ---------------- */

test('automated testing is marked, not dropped', () => {
  // test/ holds BOTH cmd-webship11-0-x-project.sh and its automated-testing twin, and a name that
  // cannot tell them apart is a name that sends somebody to the wrong project.
  assert.equal(suggestProjectName(TEST, 'cmd-automated-testing-webship11-0-x-project.sh', none), 'atw11x0xb1');
  assert.notEqual(suggestProjectName(TEST, 'cmd-automated-testing-webship11-0-x-project.sh', none),
    suggestProjectName(TEST, 'cmd-webship11-0-x-project.sh', none));
});

test('a builder with no version keeps its name and a plain counter', () => {
  // There is nothing there for a number to be confused with, and a lone `p1` says less than the
  // folder already did.
  assert.equal(suggestProjectName(path.join(ROOT, 'designs'), 'cmd-penpot-project.sh', none), 'penpot1');
  assert.equal(suggestProjectName(path.join(ROOT, 'rag'), 'cmd-milvus-project.sh', none), 'milvus1');
  assert.equal(suggestProjectName(TEST, 'cmd-claudecodeui-project.sh', none), 'claudecodeui1');
});

/* ---------------- the counter ---------------- */

test('b marks the build, and counts past the highest taken', () => {
  const s = 'cmd-webship11-0-x-project.sh';
  assert.equal(suggestProjectName(DEV, s, { existing: [] }), 'w11x0xb1');
  assert.equal(suggestProjectName(DEV, s, { existing: ['w11x0xb1'] }), 'w11x0xb2');
  // The gap is deliberately NOT filled: `b2` may still be in a bookmark, a DDEV router entry or
  // somebody's notes, and handing that name to a different site is worse than skipping a number.
  assert.equal(suggestProjectName(DEV, s, { existing: ['w11x0xb1', 'w11x0xb3'] }), 'w11x0xb4');
  // Written by hand, either way, it is still the second one.
  assert.equal(suggestProjectName(DEV, s, { existing: ['w11x0x-2'] }), 'w11x0xb3');
});

test('a name that only starts with the stem does not count', () => {
  assert.equal(suggestProjectName(DEV, 'cmd-webship11-0-x-project.sh',
    { existing: ['w11x0xbackup', 'w11x0xb1x', 'myw11x0xb3'] }), 'w11x0xb1');
});

/* ---------------- across the whole tree ---------------- */

test('a script that is not there suggests nothing, rather than a name built from a typo', () => {
  assert.equal(suggestProjectName(SITE_TEMPLATES, 'cmd-no-such-thing-project.sh', none), '');
  assert.equal(stemFor(SITE_TEMPLATES, 'cmd-no-such-thing-project.sh'), '');
});

test('EVERY builder in EVERY workspace proposes a usable name', () => {
  const { loadWorkspaces, findBuilderScripts, workspaceDir } = require('../../workspaces');
  const bad = [];
  let checked = 0;
  for (const w of Object.values(loadWorkspaces())) {
    const dir = workspaceDir(w.key);
    let scripts = [];
    try { scripts = findBuilderScripts(dir); } catch (_) { continue; }
    for (const script of scripts) {
      checked += 1;
      const name = suggestProjectName(dir, script, none);
      // The Build form's own pattern. A suggestion the form would then refuse is worse than none.
      if (!/^[a-zA-Z0-9_-]+$/.test(name)) bad.push(`${w.key}/${script} -> ${JSON.stringify(name)}`);
    }
  }
  assert.ok(checked > 80, `only ${checked} builders were reached`);
  assert.deepEqual(bad, [], bad.join('\n'));
});

test('no two builders share a name unless they build the same thing', () => {
  // A code scheme lives or dies on this. The one exemption is the same template under two file
  // names — `cmd-website_starter-project.sh` against `cmd-website_starter-1-0-x-project.sh` — where
  // the counter keeps the folders apart. A different template, or the automated-testing twin of a
  // distribution, is a different site and must not be offered the same name.
  const { loadWorkspaces, findBuilderScripts, workspaceDir } = require('../../workspaces');
  const template = (s) => s.replace(/^cmd-/, '').replace(/-?\d+(?:-\d+)*(?:-[x0])?-project\.sh$/, '').replace(/-project\.sh$/, '');
  const unexpected = [];
  for (const w of Object.values(loadWorkspaces())) {
    const dir = workspaceDir(w.key);
    let scripts = [];
    try { scripts = findBuilderScripts(dir); } catch (_) { continue; }
    const by = new Map();
    for (const s of scripts) {
      const stem = stemFor(dir, s);
      if (!by.has(stem)) by.set(stem, []);
      by.get(stem).push(s);
    }
    for (const [stem, list] of by) {
      if (list.length < 2) continue;
      const sameThing = new Set(list.map(template)).size === 1;
      if (!sameThing) unexpected.push(`${w.key}/${stem} <- ${list.join(', ')}`);
    }
  }
  assert.deepEqual(unexpected, [], unexpected.join('\n'));
});
